# Codex 配置与通道参考

本文件是实现细节与故障对照，供排查时查阅。SKILL.md 讲怎么做，这里讲为什么。

## 1. 目录结构（Windows）

```
%USERPROFILE%\.codex\                     ← CODEX_HOME
├── config.toml                           主配置（手工改写对象）
├── auth.json                             { "OPENAI_API_KEY": "sk-..." }
├── codex-launcher-model-catalog.json     模型目录（App 模型选择器读取）
├── AGENTS.md                             全局指令
└── *.bak-*                               历史备份（各工具自己命名）

%LOCALAPPDATA%\OpenAI\Codex\
├── bin\<16位hash>\codex.exe              CLI 本体，hash 随版本变
└── runtimes\cua_node\<hash>\bin\         node_repl.exe 等运行时

C:\Program Files\WindowsApps\OpenAI.Codex_<版本>_x64__2p2nqsd0c76g0\app\
├── ChatGPT.exe                           App 主进程
└── resources\codex.exe                   随包的 CLI；另有 resources/app.asar（Electron 前端）
```

App 是 MSIX 安装，包内文件**可读**（可以拿它做取证：搜 `model_catalog_json`、`model/list` 等关键字）。

## 2. config.toml 关键字段语义

```toml
model_provider = "custom"                  # 指向下面的 provider 段名
model = "gpt-5.6-sol"                      # 主模型
review_model = "gpt-5.6-sol"               # code review 用的模型，缺省继承 model
model_reasoning_effort = "medium"          # low | medium | high | xhigh
model_catalog_json = "codex-launcher-model-catalog.json"   # 相对 CODEX_HOME

[model_providers.custom]
name = "API Nexus"                         # 显示名，随便写
base_url = "https://relay.example.com/v1"  # 注意要带 /v1
wire_api = "responses"                     # 只接受 responses（0.155+）
requires_openai_auth = true                # 从 auth.json 读 OPENAI_API_KEY
# env_key = "MY_KEY"                        # 另一种认证：从环境变量读，与上面二选一
```

`requires_openai_auth = true` 与 `env_key` **互斥**：两者同时存在行为不确定，脚本会显式删掉不用的那个。

可以同时定义多个 `[model_providers.*]`，靠 `model_provider` 切换。`use` 命令就是改这一个值。

## 3. provider 名（slug）的选择

默认 `custom`，理由：

- 与 Codex++ 启动器生成的配置、以及 codex-config-repair 脚本的预期一致；
- 只有一个通道时不需要多占段位。

要并行保存多条通道时用 `--name relay2` 分开，之后 `list` / `use relay2` 切换。

## 4. 协议探测逻辑

`deploy` 对每个候选地址依次做：

1. `GET {base}/models` → 200 取出模型列表。401 直接换下一个候选。
2. 选模型：`--model` 指定 > 配置里当前模型（且在列表内）> `/gpt-5/` > `/gpt-4.1|^o[34]/` > 常见厂商名 > 列表第一个。跳过 `embed|whisper|tts|dall|image|moderation|rerank|audio|video|sora`。
   - 跳过的用意：中转常把图像生成模型（如 `gpt-image-2`）和 embedding 混在同一个 `/models` 返回里，若它们排在前面且名单里没有 gpt-5 系，会被误选成一个根本不能对话的模型。
   - `models` 命令**原样列出**这些模型（不过滤），只是标注用途不同，方便人工判断。
3. `POST {base}/responses` 发一条 `max_output_tokens=64` 的最小请求。
   - 200 → `wire_api = "responses"`，通过。
   - 4xx → 再探 `POST {base}/chat/completions`。若只有 chat 能用，**默认拒绝写入**（见下）。
4. 超时/网络错误会重试一次；拿到明确 HTTP 状态码就不重试。

### 为什么拒绝写 chat

CLI 0.155+ 里 `wire_api = "chat"` 不是「不可用」，而是**配置解析失败**。用 `codex debug models -c 'model_providers.custom.wire_api="chat"'` 实测，原文：

```
Error: `wire_api = "chat"` is no longer supported.
How to fix: set `wire_api = "responses"` in your provider config.
More info: https://github.com/openai/codex/discussions/7782
in `model_providers.custom.wire_api`
```

后果是 App 起不来，比「用不了模型」更糟。所以脚本遇到 chat-only 通道直接停下，把选择权交给用户（`--allow-chat`）。

**推论**：只实现了 chat 协议的模型（本机中转的 `claude-*` / `deepseek-*`）在 Codex 里**无论如何都用不了**，别写进目录。

## 5. 模型目录（model_catalog_json）—— 本文件最重要的一节

### 5.1 机制（实测，非推测）

用 `codex debug models` 可以直接看 app-server 解析出的目录，等同于 App 看到的东西：

```bash
codex.exe debug models                                  # 渲染当前生效的模型目录 JSON
codex.exe debug models -c model_providers.custom.wire_api='"chat"'   # 顺带验配置是否合法
```

实测结论：

1. **`model_catalog_json` 是「覆盖」内置目录，不是合并。**
   证据：内置目录 9 条（从 302MB 的 `codex.exe` 里可抽出来，搜 `"models"` 锚点 + 括号配平），
   文件里只写 1 条后 `debug models` 输出 **1 条**，内置 9 条一条不剩。
   ⇒ **想让 App 里能选到 N 个模型，就得在文件里写 N 条。**
2. **`visibility` 取值只有 `"list"`（进选择器）和 `"hide"`（不进）**。
   官方内置里 `gpt-5.4` 和 `gpt-daybreak-*` 是 `hide`。
3. **`minimal_client_version` 是版本门槛**，内置条目里是 `0.98.0` / `0.124.0` / `0.142.2` / `0.144.0` / `0.153.0`。
   第三方条目可以给低值（脚本用 `0.98.0` 或照抄内置同名条目的值）。
4. **必填字段不能少。** 缺字段时报错形如：
   ```
   Error: failed to parse model_catalog_json path `...` as JSON: missing field `support_verbosity` at line 25
   ```
   注意这是**整个配置加载失败**，不是单条失效——App 会起不来。脚本写出去前先把每条与
   `templates/model-entry.json`（从实测可用的 resolved 条目抄下来的完整形状）合并补齐。
   被完整化验证过的必填/常用字段包括：`slug`、`display_name`、`default_reasoning_level`、
   `supported_reasoning_levels`、`shell_type`、`visibility`、`supported_in_api`、`priority`、
   `model_messages.instructions_template`、`support_verbosity`、`default_verbosity`、
   `apply_patch_tool_type`、`web_search_tool_type`、`truncation_policy`、`supports_image_detail_original`、
   `context_window`、`max_context_window`、`effective_context_window_percent`、`experimental_supported_tools`、
   `input_modalities`、`supports_search_tool`。
5. **不要照抄官方条目的 `model_messages`。** 内置条目里带 `available_in_plans`（套餐门禁）、
   `guardian_v2`、`tools`、`confirmation_policies`、`token_budget` 等 App 内部机制，
   `gpt-6-astra` 的 `instructions_template` 里还有个没定义变量的 `{{connector_id}}` 占位符。
   脚本默认只用「当前正在用的那条」的形状做模板，要试官方提示词加 `--builtin-instructions`。
6. **不能写空目录**：`must contain at least one model`。脚本在写入列表为空时直接中止并报错。

### 5.2 `/v1/models` 会虚报，必须逐个实测

本机 `https://apinexus.dpdns.org/v1` 实测（同一 key）：

| 模型 | `/models` 列出 | `/responses` | `/chat/completions` | 结论 |
|---|---|---|---|---|
| `gpt-5.6-sol` | ✓ | **200** | 200 | 可用 |
| `gpt-6-astra` | ✓ | **200** | 200 | 可用 |
| `gpt-5.6-terra` | ✓ | **200** | 200 | 可用 |
| `gpt-5.5` | ✓ | **200** | 200 | 可用 |
| `gpt-5.6-luna` | ✓ | 404 not supported by any configured account | 404 | 账号无权限 |
| `gpt-5.4` / `gpt-5.4-mini` | ✓ | 502（网关 HTML 错误，15–47s 才返回） | 502 | 通道坏 |
| `claude-opus-4-6/4-7/4-8/5`、`claude-fable-5`、`deepseek-v4-flash/-max/-pro/-max` | ✓ | 500 `not implemented` | **200** | 只实现了 chat 协议 → Codex 用不了 |
| `gpt-image-2` / `-2.5-flare` / `-2.5-sunburst` | ✓ | — | — | 图像模型，跳过 |

**19 个里只有 4 个可用。** 所以 `catalog sync` 默认逐个实测，只写能应答的；`--include-dead` 才硬写。
不实测就写进去 = 在选择器里埋坑，点一下就报错。

### 5.3 条目顺序与旧条目去留

- `priority` 升序即选择器里的顺序。当前配置的模型固定为 `0`（置顶），内置同名条目用官方的
  `priority`（`gpt-6-astra` 1、`gpt-5.6-sol` 6、`gpt-5.6-terra` 7、`gpt-5.6-luna` 8、`gpt-5.5` 12），
  其余按厂商分组排（gpt 17+、claude-opus 20+、claude 25+、deepseek 30+）。
- 旧条目去留：已在写入列表里的不动；中转声明过但实测不通过的**剔除**；其余（中转没声明的，
  含当前配置的模型）**保留**，`--prune` 才清。
  —— 这里曾有个 bug：把「当前模型」无条件排除在保留之外，结果当它不在中转列表里时会被从目录抹掉。
- `slug` 去重，同 slug 只留第一条。
- 目录文件不存在时**跳过，不凭空创建**——某些环境里它是启动器生成的。

### 5.4 命名

- 显示名从内置条目取（`GPT-6-Astra`、`GPT-5.6-Sol`…），没有则按规则生成：
  `gpt-*` 用连字符（`GPT-5.4-Mini`），其余用空格并把结尾连续数字合并成版本号
  （`claude-opus-4-6` → `Claude Opus 4.6`、`deepseek-v4-pro-max` → `DeepSeek V4 Pro Max`）。
- 旧条目里 `display_name` / `description` 等于 slug（自动填的）时会被换成好看的名字。

## 5b. 模型数量由 key 权限决定

实测同一个 `https://apinexus.dpdns.org/v1`：

| key | `/models` 返回 |
|---|---|
| A | 1 个（只有 `gpt-5.6-sol`） |
| B | 19 个（含 `gpt-5.4`、`gpt-5.5`、`gpt-6-astra`、`claude-opus-5`、`deepseek-v4-*` 等，另有 3 个 `gpt-image-*` 图像模型） |

所以「换了 key 但模型还是老的那个」通常是预期行为：`pickModel` 会优先沿用配置里已有的模型名。
想换模型必须显式 `--model`。要确认当前 key 到底能用什么，跑 `models`，再跑 `catalog sync` 看实测结果。

## 6. 故障对照

| 现象 | 根因 | 处理 |
|---|---|---|
| `Error loading config.toml: wire_api = "chat" ...` | 写了 chat（该值已废除） | 改 `responses`（或 `restore` 回滚） |
| `failed to parse model_catalog_json ... missing field` | 目录条目缺必填字段 | `catalog sync` 重写（会自动补齐） |
| 模型选择器里只有一两个模型 | 目录文件覆盖了内置目录，而文件里就只有那么几条 | `catalog sync` |
| 选某个模型后报 `500 not implemented` | 该模型只实现了 chat 协议 | 从目录里剔除（默认已剔），别用它 |
| `401 Invalid token` | key 与 base_url 不匹配 | 确认 key 属于该中转；`deploy --base-url ... --key ...` 重配 |
| `503 model_not_found` | 通道与模型名不匹配 | `list` 看走的是哪条；大概率是 Codex++ 把地址改成了 57321 |
| App 白屏 / MCP server 起不来 | 升级后运行时 hash 变了 | 用 codex-config-repair |
| `/responses` 探测超时但 CLI 能跑 | 中转首次请求慢（实测有 >25s、502 有 47s 的） | 不是故障，默认超时已提到 60s 并重试一次 |
| 配置改了但行为没变 | App 未重启 | 让用户手动完整退出重开 |
| 写完又被改回去 | Codex++ / 启动器在跑 | `--kill-launcher` |

## 7. 安全约定

- key 只在 `auth.json` 落盘；日志与 `--json` 输出一律只显示 `sk-XXXX...last4 (长度)`。
- key 不进 config.toml、不进备份文件名、不进 stdout。
- 命令行传 key 会进 shell 历史，key 出现在聊天里时优先 `--key-stdin`。
- 隔离测试用 `--codex-home <临时目录>`，脚本在该模式下不探测宿主进程（避免误杀用户的启动器）。
- key 优先级：`--key` / `--key-stdin` > `OPENAI_API_KEY` 环境变量 > `auth.json`。
  （曾写反过，导致显式传的 key 被 auth.json 里的旧 key 盖掉。）

## 8. 脚本内部不变量（改动时别破坏）

- 所有写操作走「先备份 → 写临时结果 → 断言 → 落盘」，断言失败不产生半成品文件。
- 备份名精确到毫秒且遇重名加序号，历史备份永不被覆盖。
- `allBackups()` 返回**绝对路径**（曾因只返回文件名导致 `restore` 从 CWD 找文件而 ENOENT）。
- `.map(path.basename)` 会把数组下标当作第二参数传给 `basename` → 必须写成箭头函数。
- 全新机器上 provider 段从 0 个变 1 个是合法变更；防呆检查只禁止「减少」，不禁止「增加」。
- `restore` 语义是「回到最近一次备份」，幂等；要更早的状态用 `restore 1`、`restore 2`…
- 目录写后验收必须带 `CODEX_HOME` 调 `codex debug models`，否则验的是真实家目录而不是目标目录。
- 目录写入是「内容相同就不改写」（幂等，避免每次部署都堆一份备份）。
- 自测里 mock 与子进程必须异步 spawn；`execFileSync` 会阻塞事件循环造成假失败。
