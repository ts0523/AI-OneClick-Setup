---
name: codex-api-deploy
description: 把一个 API key 自动接入 Codex（桌面 App / CLI）。当需要「把 key 接进 codex」「codex 换 API / 换中转站」「codex 报 401、503、model_not_found 想换通道」「只给一个 key 就让 codex 能用」「给 codex 配 base_url / model」「切换 codex 的多个渠道」「codex 模型选择器里看不到模型 / 只有一两个模型」时使用。自动完成候选地址探测、协议探测（responses/chat）、模型逐个实测、配置备份改写、App 模型目录同步、真实 CLI 实测与回滚。
agent_created: true
---

# Codex API 自动部署

只给一个 key，把 Codex 的通道配好并**证明它真能用**。

## 与 codex-config-repair 的分工

- **本 skill**：接入 / 换渠道 / 换 key / 换模型 / 补模型目录 —— 「从没有到能用」。
- **codex-config-repair**：App 打不开、`wire_api is no longer supported`、升级后运行时 hash 失效 —— 「坏了要修」。

配置写坏时用 repair 的脚本修，不要重复造轮子。

## 主流程

```bash
NODE="<node.exe 路径>"
SK="<技能库>/codex-api-deploy/scripts/codex-deploy.js"

# 0) 先看现状（只读，永远先做这一步）
"$NODE" "$SK" status

# 1) 接入：有 key 就够
"$NODE" "$SK" deploy --key sk-xxxxxxxx

# 1b) key 出现在聊天里时，走 stdin，避免进命令行历史
"$NODE" "$SK" deploy --key-stdin < key.txt

# 2) 只换地址、沿用旧 key（不带 --key 时自动沿用 auth.json）
"$NODE" "$SK" deploy --base-url https://your-relay.example.com/v1
```

`deploy` 会自动：探测候选地址 → 探测 `/responses` 是否可用 → 选模型 → 备份 → 改写配置 → 校验 →**逐个实测模型**→ 同步 App 模型目录 → **真跑一次 codex CLI**。退出码 0 才算成功。

## 模型目录：App 里为什么看不到模型（最容易踩的坑）

App 的模型选择器读的是 `config.toml` 里 `model_catalog_json` 指向的那份 JSON。四条实测铁律：

1. **这份文件是「覆盖」内置目录，不是追加。** 官方 CLI 二进制里内嵌了 9 条模型（`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4`…），一旦设了 `model_catalog_json`，内置那 9 条**全部失效**，选择器里只剩文件里写的条目。所以想让 App 里能选到 N 个模型，就得在文件里写 N 条。
2. **`visibility` 只有两个取值**：`"list"` 进选择器，`"hide"` 不进。
3. **必填字段不能少**。缺 `support_verbosity` 之类会报 `failed to parse model_catalog_json ... missing field`，而且**整份配置解析失败、App 起不来**。脚本写出去前一律先跟 `templates/model-entry.json` 兜底形状合并补齐。
4. **中转的 `/v1/models` 会虚报。** 本机这条通道列出 19 个模型，实测只有 **4 个**真能通过 Codex 用的 `/responses` 协议应答：其余是 `500 not implemented`（`claude-*` / `deepseek-*` 只实现了 chat 协议，而 CLI 已废除 chat）、`502` 网关错误（`gpt-5.4`、`gpt-5.4-mini`）、`404 not supported by any configured account`（`gpt-5.6-luna`）。**所以目录同步默认逐个实测，只写能应答的**——否则等于在选择器里埋 12 个坑，点一下就报错。

验收手段：`codex debug models` 渲染 app-server 实际解析出的目录，**等同于 App 看到的东西**，不用重启 App 就能验证。脚本每次写完都会跑它做一致性验收，不一致自动回滚。

```bash
"$NODE" "$SK" models          # 中转列出什么 + 哪些 App 里能选到
"$NODE" "$SK" catalog         # 当前目录声明了什么 + App 实际能看到几条
"$NODE" "$SK" catalog sync    # 逐个实测后写入目录（deploy 里已自动做）
```

## 其他命令

| 命令 | 用途 |
|---|---|
| `status` | 诊断：当前 provider/model/wire_api、key 是否在、通道能不能通、目录声明数 vs App 可见数、CLI 版本。加 `--offline` 跳过网络 |
| `list` | 列出所有 `[model_providers.*]`，标出当前使用 |
| `models` | 列出当前通道 `/v1/models` 返回的全部模型，标出「当前」与「App可选」 |
| `catalog` / `catalog list` | 显示目录声明条目 + `codex debug models` 实测的 App 可见数 |
| `catalog sync` | 逐个实测模型 → 写进目录 → `codex debug models` 验收（不一致自动回滚） |
| `use <name> --model <m>` | 在已配好的多个渠道间切换 |
| `test` | 不写文件，只做协议探测 + CLI 实测 |
| `restore [序号/文件名片段]` | 回滚（`0`/省略 = 最近一次；`1` = 更早一份）。同时回滚 auth.json |
| `backups` | 列出全部备份 |

## 关键选项

| 选项 | 说明 |
|---|---|
| `--base-url <url>` | 可**重复**，按顺序作为候选自动探测，前一个不通就试下一个；`catalog sync` 也认它（可不动配置只同步目录） |
| `--model <name>` | 省略则从 `/v1/models` 自动选（跳过 embedding/tts 等） |
| `--name <slug>` | provider 段名，默认 `custom` |
| `--key <sk-...>` | 显式指定 key，优先级高于 auth.json / 环境变量 |
| `--dry-run` | 只打印改动预览，不落盘 |
| `--no-test` | 跳过 CLI 实测（快，但等于没验证） |
| `--no-catalog` | 不同步模型目录 |
| `--only <a,b>` | 目录同步只处理这几个模型 |
| `--no-probe` | 目录同步不逐个实测（快，但会把用不了的模型也写进去） |
| `--include-dead` | 目录同步连实测不通的也写（明知是坑，慎用） |
| `--include-image` | 目录同步也写图像/语音模型（默认跳过） |
| `--prune` | 目录同步丢掉不在当前中转列表里的旧条目（默认保留） |
| `--builtin-instructions` | 采用官方内置条目的提示词模板（默认用已验证的简短版，见下） |
| `--offline` | 跳过所有网络探测 |
| `--env-key <NAME>` | 改成从环境变量读 key（不写 auth.json），适合多机分发 |
| `--kill-launcher` | 结束会覆写 config.toml 的第三方启动器（Codex++） |
| `--json` | 机器可读输出 |

**为什么默认不照抄官方条目的提示词**：内置条目的 `model_messages` 里带 `available_in_plans` 套餐门禁、`guardian_v2` / `tools` / `confirmation_policies` 等 App 内部机制，还有没定义变量的 `{{connector_id}}` 占位符。搬进第三方中转条目风险大于收益，所以默认只用「当前正在用的那条」的形状做模板。想试官方提示词加 `--builtin-instructions`。

## 四条必须记住的铁律

1. **`wire_api` 只能是 `"responses"`**。CLI 0.155 起已废除 chat（`Error: wire_api = "chat" is no longer supported`），写 chat 会让配置**整体加载失败**。脚本探测到通道只支持 chat 时会**默认拒绝写入**，需显式 `--allow-chat`。
2. **只实现了 chat 协议的模型在 Codex 里用不了**。本机中转的 `claude-*` / `deepseek-*` 属于此类：`/chat/completions` 能通、`/responses` 一律 500，而 Codex 只能走 responses。别把它们写进目录。
3. **第三方启动器（Codex++）会在每次启动时覆写 config.toml**，把地址改回 `127.0.0.1:<PORT>`，其模型白名单只有 `agnes-*` → 必然 503。必须 `--kill-launcher` 或让用户关掉它。
4. **改完必须完整重启 Codex App**（主进程 `ChatGPT.exe`）。配置和模型目录都是启动时读进内存的。不要替用户杀 App 进程——他可能在里面有未保存的会话。

## 改动落点（仅这三处）

| 文件 | 改什么 |
|---|---|
| `%USERPROFILE%\.codex\config.toml` | `model_provider` / `model` / `review_model` + 目标 provider 段 |
| `%USERPROFILE%\.codex\auth.json` | `OPENAI_API_KEY`（`--env-key` 模式下不写） |
| `%USERPROFILE%\.codex\codex-launcher-model-catalog.json` | 写全可用模型条目（覆盖内置目录），每条先与兜底形状合并补齐必填字段 |

config.toml 写前做四项断言，任何一项不过就**整盘放弃**，一个字节都不写：
1. 候补配置结构合法（括号配对、每个 section 头合法、顶层键不重复）；
2. **指纹不变** —— 剔除本次允许改动的行后，其余配置逐字相同；
3. **不丢 provider 段** —— 已有的 `[model_providers.*]` 一个都不能少（允许新增）；
4. 目标字段落位正确（base_url / wire_api / 认证方式 / model / model_provider）。

目录写后做一致性验收（`codex debug models` 的解析结果必须与写入逐条相同），不一致**自动回滚**。

旧条目的去留规则：已经在写入列表里的不动；中转声明过但实测不通过的剔除（写进去是坑）；其余旧条目（中转没声明的，含当前配置的模型）保留，`--prune` 才清。

备份命名 `*.bak-api-<毫秒时间戳>`，同一秒连续操作也各留一份。

## 起不来时按这个顺序查

```bash
"$NODE" "$SK" status            # 配置层面
"$NODE" "$SK" catalog           # 目录层面（声明数 vs App 可见数）
"$NODE" "$SK" test              # 协议 + CLI 实测
"$NODE" "$SK" restore           # 直接回滚
```

- `401` → key 与 base_url 不匹配（换了中转却没换 key，或 key 已失效）
- `404` on `/responses` → 该中转不支持 responses，换中转，别写 chat
- `503 model_not_found` → 通道与模型名不匹配，用 `list` 确认走的是哪条通道
- `500 not implemented` on `/responses` → 该模型只实现了 chat 协议，Codex 用不了
- `failed to parse model_catalog_json ... missing field` → 目录条目缺必填字段，重新 `catalog sync`
- 模型选择器里只有一两个模型 → 目录文件里就只有那么多条（见上文「覆盖」规则），跑 `catalog sync`
- `/responses` 探测超时但 CLI 能跑通 → 正常现象（中转首次请求慢），别据此判定失败

更多字段语义、探测细节、故障对照见 `references/codex-config-reference.md`。

## 本机速查（实测）

| 项 | 值 |
|---|---|
| 直连中转 | `https://apinexus.dpdns.org/v1` |
| 中转虚报 | `/models` 列 19 个，实测只有 4 个能走 `/responses`：`gpt-5.6-sol`、`gpt-6-astra`、`gpt-5.6-terra`、`gpt-5.5` |
| 模型数量随 key 权限变 | 同一个中转，实测一个 key 只返回 1 个模型，另一个 key 返回 19 个。换 key 后先跑 `models` 看权限范围 |
| Codex App | MSIX 安装：`C:\Program Files\WindowsApps\OpenAI.Codex_<版本>_x64__2p2nqsd0c76g0\app\`（`resources/codex.exe` 是随包 CLI，真正用的是 `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`） |
| 模型目录字段语义 | 官方定义可从 CLI 二进制里抽：搜 `"models"` 锚点 + 括号配平，见 `readBuiltinCatalog()` |
| 选模型排除项 | `embed / whisper / tts / dall / image / moderation / rerank / audio / video / sora`，其余按 gpt-5 > gpt-4.1 > 常见厂商名排序 |
| 运行时报错排查 | 见 memory：本机 Bash 的 PATH 是坏的，必须用 managed node 绝对路径；PowerShell 工具的 stdout 不回传，要拿输出就「写文件再读」 |

## 自测

改动脚本后必须跑（全流程本地 mock，不碰真实配置）：

```bash
"$NODE" "<技能库>/codex-api-deploy/scripts/selftest.js"
```

覆盖 12 组 76 项断言：正常接入 / 候选回退 / 401 拒绝 / chat-only 拒绝写入 / dry-run / 缺 key / 幂等 /
无关配置零改动 / 模型目录同步 / **虚报模型剔除** / `--include-dead` / `--prune` / 字段补齐 / models 命令 /
图像模型不被选中 / 备份与回滚 / 全新机器 / env_key / --json。

两条硬约束：
- mock 服务器与子进程必须在同一进程内用**异步 spawn**驱动，用 `execFileSync` 会阻塞事件循环导致假失败。
- 调用 `codex debug models` 验收时必须带 `CODEX_HOME`，否则会去验真实家目录而不是目标目录（用 `--codex-home` 隔离时会误判并回滚）。
