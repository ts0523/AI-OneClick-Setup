---
name: lmstudio-load-failure-triage
description: 诊断 LM Studio / llama.cpp 本地模型加载失败（llama-server 退出、exitCode 3221226505 / 0xC0000409、failed to allocate buffer for kv cache、cannot run the operation）的实证流程。用真实 llama-server.exe 跑参数矩阵定位触发条件，抓子进程命令行读出 LM Studio 实际下发的参数，解析 GGUF 头算 KV 内存账，不靠界面反复试错。也包含 LM Studio 1.x(Bionic) 界面里「上下文长度 / KV 缓存量化 / Flash 注意力 / GPU 卸载」这些开关的中文标签与位置。当用户说「LM Studio 报错」「模型加载失败」「llama-server exited before becoming healthy」「本地大模型跑不起来」「在 LM Studio 里找不到某个设置」时使用。
agent_created: true
---

# LM Studio / llama.cpp 加载失败定位

核心原则：**不要看界面猜，直接驱动 llama-server.exe 跑参数矩阵**。
LM Studio 只把致命错误记一行，而直接跑 CLI 能拿到完整的分配失败信息。

## 第 0 步：读懂退出码

| exitCode | 十六进制 | 真实含义 |
|---|---|---|
| 3221226505 | 0xC0000409 | **MSVC `abort()` → `__fastfail(FAST_FAIL_FATAL_APP_EXIT)`**。名字叫 STATUS_STACK_BUFFER_OVERRUN 是误导。ggml 断言失败 / 分配失败走这条路。 |
| 3221225477 | 0xC0000005 | 访问冲突（段错误） |
| 3221225725 | 0xC00000FD | 栈溢出 |
| 1 | — | llama.cpp 自己干净退出，通常是参数错或 `LMSTUDIO_STARTUP_ERROR` |

0xC0000409 一律先怀疑 **ggml abort**，别去查杀软。

## 第 1 步：取证（三处，都在本机）

1. `~/.lmstudio/apps/bionic/server-logs/YYYY-MM/YYYY-MM-DD.N.log`
   - 找 `ggml-backend.cpp:<行号>`、`cannot run the operation`、
     `alloc_tensor_range: failed to allocate <后端> buffer of size N`、
     `failed to allocate buffer for kv cache`、`LMSTUDIO_STARTUP_ERROR:{...}`
2. `%LOCALAPPDATA%\CrashDumps\llama-server.exe.*.dmp`
   - 有转储 = 真崩溃；文件名里的 PID + mtime 与日志时间戳一一对应即可确认。
3. `~/.lmstudio/apps/bionic/.internal/backend-preferences-v1.json`
   - 当前锁定哪套运行时（`llama.cpp-win-x86_64-{vulkan,nvidia-cuda,avx2}`）。
   - `~/.lmstudio/apps/bionic/.internal/model-index-cache.json` 里模型的 `contextLength`
     就是 LM Studio 加载时申请的上限（常等于模型自带的最大上下文，这才是爆内存的元凶）。

## 第 2 步：算内存账（解析 GGUF 头）

跑 `scripts/read-gguf-header.js <模型.gguf>`，拿这几个字段：

- `block_count` → 总层数
- `full_attention_interval` → **混合注意力模型的层间隔**（Qwen3-Next / Qwen3.6 这类）。
  `N` 表示每 N 层只有 1 层是全注意力 ⇒ 带 KV 缓存的层数 = `block_count / N`。
  这类模型的 KV 张量名形如 `cache_k_l3`（第 3 层正好是第一个全注意力层），
  **看到 `cache_k_l<小数字>` 就该想到混合架构**。
- `attention.head_count_kv`、`attention.key_length`、`attention.value_length`

**先判断是不是混合注意力**：

```
KV 层数 = full_attention_interval 存在 ? block_count / full_attention_interval
                                      : block_count      ← 普通全注意力
每 token KV 字节 = KV 层数 × (key_length + value_length) × head_count_kv × 2   // F16
```

**别漏掉第二种情况**：普通全注意力模型（如 Qwen3-8B / Qwen3.5-9B）**没有**
`full_attention_interval` 字段，此时**全部层都带 KV**，KV 会大得多的多。
实测 Qwen3-8B（36 层、GQA 8/32、head_dim 128）= **147 KB/token**，
32K 上下文就是 4.5 GiB —— 而混合注意力的 Bonsai-27B 才 64 KB/token。
**同样叫「32K 上下文」，KV 能差 3 倍**，所以必须按模型实测公式算，不要套用记忆里的数字。

再乘以 `-c` 的上下文长度，与目标后端的可用显存/内存对比。

## 第 3 步：参数矩阵实测（关键，绕开 LM Studio）

用 `scripts/probe-llama-server.js`。要点：

- exe 在 `~/.lmstudio/extensions/backends/<运行时>/llama-server.exe`，
  **cwd 必须是该目录**（`ggml-*.dll` / `llama-*.dll` 都在旁边）。
- 健康信号 = stdout 出现 `listening on http://`。**别用 `server is listening` 去匹配**（匹配不上）。
  失败信号 = `cannot run the operation` / `GGML_ASSERT` / `failed to allocate buffer for kv cache`。
- 失败通常 1–6 秒内返回，成功 6–80 秒。所以脚本要**边跑边匹配、命中即退出**，不要傻等超时。
- 别并行跑多个实例（本机核少内存小，会互相干扰）。

优先扫这几个维度（按性价比排序）：

1. **上下文长度**（`-c`）：最可能是元凶。二分找悬崖点。
2. **后端**：Vulkan vs CPU。CPU 吃系统内存，上限通常高得多（代价是慢）。
3. `-ngl`（0 / 部分 / 99）：区分「权重放不下」还是「KV 放不下」。
4. `--mmproj`：视觉模型的投影层，单独确认。
5. **`-fa on`（Flash Attention）：这是真正的必需项。**
   实测 Qwen3-8B @32K：不带 `-fa` 时 ⇒ `vk::Device::allocateMemory: ErrorOutOfDeviceMemory`；
   加上 `-fa on` 后 ⇒ 加载成功。**同一模型、同一上下文，只差这一个参数。**
   ⚠️ 本技能早期版本把这条列为"一般不会是元凶、先别花时间" —— 那是**混合注意力模型（KV 很小）**的结论，
   对全注意力模型不成立。判断依据就是上一步的 KV 层数。
6. **`-ctk q8_0 -ctv q8_0`（KV 量化）：余量项，不是必需项。** 别把它当成崩溃的唯一解药——
   实测 LM Studio 1.1.6 给 Qwen3.5-9B @32K 下发的就是 **`--cache-type-k f16 --cache-type-v f16`（未量化）**，
   照样 16.9 秒加载成功。KV 量化的作用是**再省一半 KV、换来更大上下文的余量**（F16 → q8_0 减半）。
   ⇒ 排查顺序：先确认 `-fa on`，再考虑 KV 量化。
7. **`--load-mode mmap+mlock` / `--kv-offload`**：LM Studio 1.x 默认会带（见下节）。
   手工对照实验不带这两个，内存账会跟界面结果对不上，**别拿手工数字直接否定界面的可行性**。
8. **思考模式开关**（推理模型专属，与崩溃无关但影响可用性）：Qwen3 / Qwen3.5 这类模型
   思考模式下生成速度会掉一半（实测 9B：1.40 → 2.84 tok/s）。本地部署写作类用途一律关掉，
   请求里传 `"chat_template_kwargs": {"enable_thinking": false}`。

## 第 4 步：抓 LM Studio「真正下发」的参数（决定性证据）

比看界面猜快十倍。LM Studio 把模型交给 `llama-server.exe` 子进程，命令行是完整可见的：

```powershell
Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" |
  Select-Object -ExpandProperty CommandLine | Out-File "$env:TEMP\llamaproc.txt" -Encoding UTF8
```

（PowerShell 工具的 stdout 可能不回传 ⇒ 输出到文件再用 Read 读。）

**命令里能直接读出**：`--ctx-size` / `--n-gpu-layers` / `--cache-type-k|v` / `--flash-attn` /
`--parallel` / `--kv-unified` / `--load-mode` / `--mmproj`，以及 **`--api-key`**——
拿这个 key 就能对实例端口直接发 `/v1/chat/completions` 验证真实生成速度（请求头
`Authorization: Bearer <key>`；不带 key 会得到 401）。

⚠️ 手工跑 CLI 做对照时缺少 `--kv-offload --kv-unified --load-mode mmap+mlock`，
结果可能比界面**更悲观**。要下结论先抓真实命令行。

## 第 5 步：LM Studio 1.x（Bionic）界面里这些开关在哪

**1.1.6 的界面跟 0.3.x 完全不同**，旧教程里的 "Context Length / KV Cache Quantization /
GPU Offload / Flash Attention" 独立面板**已经不存在**。现在的模型加载设置叫**「加载设置」**，
按功能分成 5 个可折叠分组（默认折叠高级项，这是"找不到"的主因）：

| 设置项（英文） | 中文界面标签 | 所在分组 |
|---|---|---|
| Context Length | **上下文长度** | 上下文与性能 |
| GPU Offload | **GPU 卸载** | 上下文与性能 |
| Flash Attention | **Flash 注意力** | 上下文与性能（组内靠后） |
| K Cache Quantization Type | **K 缓存量化类型** | 内存 |
| V Cache Quantization Type | **V 缓存量化类型** | 内存 |
| enableThinking | 思考（分区内的开关） | 思考 |

分组中文名：**提示词 / 上下文与性能 / 生成 / 思考 / 内存**。
查找方式：面板里有**搜索框**，直接搜「上下文」「量化」「Flash」比逐层展开快。

三条入口：
1. 聊天界面的模型加载器 → 勾选**「手动选择模型加载参数」**，或**按住 Alt 键点加载**；
2. **开发者 → 本地服务器 → 「加载设置」**（提示"选择一个模型进行配置"）；
3. 面板上有**「显示高级设置」**开关，先打开它。

**`lms load` 能设的只有 `--gpu` 和 `-c`**（没有 FA / KV 量化开关）。
`lms load <model> -c 32768 --gpu max -y` 是**一次性覆盖，不落盘**——
下次从界面加载仍用界面那套默认值。所以：**临时救急用 CLI，要持久必须改界面（或存预设），
预设需先在设置里开「在预设中启用模型加载配置支持」。**

**GUI 直接点加载失败、CLI 加 `-c` 就成功 ⇒ 十有八九是界面默认上下文取的是模型声明的最大值。**

## 第 6 步：把结论固化到磁盘（关键，否则下次又崩）

`lms load -c` 是一次性覆盖、不落盘；界面改完也可能被重置。**真正持久的位置是**：

```
~/.lmstudio/apps/bionic/.internal/user-concrete-model-default-config/<publisher>/<model>.json
```

文件名 = 模型 key（如 `qwen/qwen3-vl-4b.json`，跟 `~/.lmstudio/hub/models/` 下的目录一致）。
先 `fs.cpSync` 备份整个目录再改。格式（从现有成功配置反推即可）：

```json
{
  "preset": "",
  "operation": { "fields": [ { "key": "llm.prediction.reasoning.enableThinking", "value": false } ] },
  "load": { "fields": [
    { "key": "llm.load.llama.autoFit", "value": false },
    { "key": "llm.load.contextLength", "value": 32768 },
    { "key": "llm.load.llama.flashAttention", "value": true },
    { "key": "llm.load.llama.kCacheQuantizationType", "value": "q8_0" },
    { "key": "llm.load.llama.vCacheQuantizationType", "value": "q8_0" },
    { "key": "llm.load.llama.evalBatchSize", "value": 2048 }
  ] }
}
```

**KV 量化值用小写字符串**：`q8_0` / `f16`（源码里 `Q8_0="q8_0"`, `FP16="f16"`）。
`autoFit: false` 必须配 `contextLength`，否则又会取模型声明的最大值。

键名不用猜，从安装目录里 grep（注意 `.webpack-bionic` 是点开头目录，
**Grep 工具默认不下钻**，必须用 node 自己读文件扫）：

```
<LMSTUDIO安装目录>\Bionic\resources\app\.webpack-bionic\renderer\main_window.js
<LMSTUDIO安装目录>\Bionic\resources\app\.webpack-bionic\main\index.js
→ /"(llm\.(load|prediction)[a-zA-Z0-9_.]*)"/g
```

常用键：`llm.load.contextLength` / `llm.load.llama.autoFit` / `llm.load.llama.flashAttention` /
`llm.load.llama.k|vCacheQuantizationType` / `llm.load.llama.evalBatchSize` /
`llm.load.llama.acceleration.offloadRatio` / `llm.load.numParallelSessions` /
`llm.load.offloadKVCacheToGpu` / `llm.prediction.reasoning.enableThinking`。

界面分组对照（1.x Bionic）：「上下文与性能」= autoFit/contextLength/offloadRatio；
「内存」= offloadKVCacheToGpu/useUnifiedKvCache/k|vCacheQuantizationType。

**验证是否生效**：起一次实例后抓 `llama-server.exe` 命令行，确认
`--ctx-size` / `--cache-type-k q8_0` / `--flash-attn` 真的下发了（见第 4 步）。

## 已知坑（避免重复踩）

- **核显的 Vulkan 可用显存远小于物理内存**。实测 <INTEGRATED_GPU> + 15.79GB 共享内存时，
  Vulkan0 只有 **7422 MiB (7.25 GiB)** ≈ 物理内存的一半。
  **别靠猜 —— 加 `-lv 10` 跑一次，grep 这一行：**
  `llama_prepare_model_devices: using device Vulkan0 (<型号>) ... - NNNN MiB free`
- **报错 `failed to allocate Vulkan0 buffer of size 1073741824` 里的 1GB 是分配块大小，不是差额**。
  真实差额要用「权重 + KV + 计算缓冲」跟上面那行 `MiB free` 对账。
- **`-c` 在本代 llama-server 里是 per-slot 语义**：日志会打
  `n_slots = 4, n_ctx_slot = 32768, kv_unified = 'true'`。用 `--parallel` 增加槽位会成倍放大 KV。
  建议排查时先固定 `--parallel 1`。
- LM Studio 会**自动挂载** `mmproj-*.gguf`，手工跑 CLI 时不会——对照实验要显式加 `--mmproj`。
- 「模型文件损坏」在这类报错里**几乎从不是原因**：能打出 `model loaded` 就说明权重没问题。
- 结论要落到可执行的数字（"上下文 ≤ 32768"），不要只说"内存不足"。

## 附：选型时的容量规划（先算带宽，再挑尺寸）

加载成功 ≠ 可用。选模型前先算这一个公式：

```
生成速度 (tok/s) ≈ 有效内存带宽 ÷ 权重体积(Q4 时 ≈ 参数量 GB 数)
```

- **先测内存通道数**：`Get-CimInstance Win32_PhysicalMemory` 看有几条。
  一条 16GB DDR4-3200 = **单通道** ⇒ 理论 25.6 GB/s、**有效约 20 GB/s**。
  两条才是双通道（带宽翻倍）——**这是最容易被忽略、又影响最大的一项**。
- **核显不提升生成速度**：它和 CPU 共用同一条 DRAM，只加速 prompt 处理（prefill）。
  生成阶段是纯带宽受限，加核显层数不会让 tok/s 变高。
- 实测对照（本机 <CPU_MODEL> 单通道，Vulkan 全卸载 + KV q8_0）：

  | 模型 | 思考模式 | tok/s |
  |---|---|---|
  | Qwen3-8B Q4_K_M | 关 | 3.56 |
  | Qwen3.5-9B Q4_K_M | 关 | 2.84 |
  | Qwen3.5-9B Q4_K_M | 开 | 1.40 |

- 换算成人能感知的量：**一章 2000 字 ≈ 3000 token**。
  8B 约 14 分钟、9B 约 17.6 分钟、9B 开思考约 36 分钟（不可用）。
  ⇒ 8B~9B 是这个带宽档位的甜点；14B 开始掉到 2 tok/s 以下；32B+ 连内存都放不下。
- **别忘了算「可用内存」而不是「总内存」**：加载前先看
  `FreePhysicalMemory`，系统 + 浏览器 + 编辑器会吃掉几 GB。
- **「长 prompt 一发就崩」先怀疑内存，不要先怀疑 TDR / batch size。**
  实测对照（同一模型、同一 2404-token prompt、Vulkan 全卸载）：
  系统空闲 1.1 GB ⇒ `fetch failed`（服务直接 abort）；空闲 8 GB ⇒ 88.7 s 正常返回。
  缩小 `-b/-ub` 救不回来，只有腾内存才救得回来。
  ⇒ 排查顺序：先看 `FreePhysicalMemory`，再动参数。
- **`lms server start` 从 Bash 调会被 SIGTERM**（且可能拉起 GUI 打扰用户），
  别用它来验证配置。要验证就起实例后抓 `llama-server.exe` 命令行（第 4 步）。
- **残留进程会污染后续测量**：测完一定要杀掉 `llama-server`
  （`Get-Process -Name llama-server | %{$_.Kill()}`），否则下一个实验的内存基线是错的。
