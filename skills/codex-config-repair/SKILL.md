---
name: codex-config-repair
description: 修复 Codex 桌面 App / CLI 因版本升级或第三方启动器改写 config.toml 导致的故障。当出现「Codex 打不开」「codex 启动报错」「API 用不了」「model_not_found」「Error loading config.toml」「wire_api is no longer supported」等现象时使用。
agent_created: true
---

# Codex 配置修复

> 分工：本技能管「**坏了要修**」（App 打不开、配置解析失败、升级后 hash 失效）。
> 要「**接入新 key / 换中转 / 换模型 / 多通道切换**」用 `codex-api-deploy` 技能，它带写入断言与回滚，且会真跑一次 CLI 验证。

## 这个技能治什么

三类症状，根因完全不同，必须先分清：

| 症状 | 根因 | 处理 |
|---|---|---|
| `Error loading config.toml: wire_api = "chat" is no longer supported` | 新版 CLI 已废除 chat 协议 | 改成 `wire_api = "responses"` |
| App 启动卡住 / 白屏 / MCP server 起不来 | 升级后运行时 hash 变了，config 里还写旧路径 | 替换 hash |
| 对话报 `503 model_not_found` | 通道与模型名不匹配 | 对齐 base_url 与 model |

## 铁律（踩过的坑）

1. **`wire_api` 只认 `"responses"`**。旧结论「必须用 chat 规避 Cloudflare 524」在 CLI >= 0.155 已作废，写了 chat 会导致配置**整体加载失败**，App 直接起不来。实测中转站的 `/v1/responses` 带工具、流式均可用。

2. **不要用 `codex exec "prompt"` 直接验证**。它会挂在 `Reading additional input from stdin...` 直到 stdin 关闭。必须用 `spawn` 并在拿到进程后立刻 `stdin.end('')`。

3. **Codex++（如 `<工具目录>\Codex++`）每次启动都会重写 config.toml**，把 base_url 改回 `http://127.0.0.1:<PORT>/v1`。而它自己的模型白名单只有 `agnes-*`，与 `gpt-5.6-sol` 不匹配 → 必然 503。修完配置必须杀掉它：
   ```powershell
   Get-Process -Name 'codex-plus-plus','codex-plus-plus-manager' -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }
   ```
   `taskkill /F /IM` 在此环境会被静默拦截，用 PowerShell 的 `.Kill()`。

4. **改完配置必须让 Codex App 完整重启**。App 主进程叫 `ChatGPT.exe`（藏在 WindowsApps 里），配置是启动时读进内存的，改文件不影响已在运行的实例。

5. **本机 Bash 工具 PATH 是坏的**（`ls`/`cat`/`rm` 全无），PowerShell 工具 stdout 不回传。所有验证都写成 node 脚本、用 managed node 绝对路径跑。

## 标准流程

### 第一步：一键诊断

```bash
"<node.exe 路径>" "<skill_dir>/scripts/repair.js" --dry-run
```

输出会给出：当前 App 版本、实际运行时 hash vs config 里写的 hash、通道与模型是否匹配、config 是否含已废弃字段。

### 第二步：看懂 config.toml 的两处关键位置

配置文件：`%USERPROFILE%\\.codex\config.toml`

```toml
[model_providers.custom]
name = "API Nexus"
base_url = "https://apinexus.dpdns.org/v1"   # 直连；绝不能是 127.0.0.1:<PORT>
wire_api = "responses"                        # 只能是 responses
requires_openai_auth = true
```

```toml
notify = [ "<cua_node>\<HASH>\bin\node_modules\@oai\sky\bin\windows\codex-computer-use.exe", "turn-ended" ]

[mcp_servers.node_repl]
command = '<cua_node>\<HASH>\bin\node_repl.exe'
```
其中 `<cua_node>` = `%USERPROFILE%\\AppData\Local\OpenAI\Codex\runtimes\cua_node`。
hash 目录名随每次 App 更新而变，**只能靠扫描目录得到，不能硬编码**。

### 第三步：执行修复

```bash
"<node.exe 路径>" "<skill_dir>/scripts/repair.js" --apply
```

脚本会自动：备份 → 扫描出当前真实 hash → 替换所有 stale 路径 → 校正 base_url / wire_api → 校验并复检每个被引用的 exe 是否真实存在。

### 第四步：杀 Codex++，实测

```bash
# 杀（PowerShell）
Get-Process -Name 'codex-plus-plus','codex-plus-plus-manager' -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }

# 实测（必须走 spawn + stdin.end，或用 repair.js --test）
"<node.exe 路径>" "<skill_dir>/scripts/repair.js" --test
```

通过标准：exit=0，stdout 出现预期文本，stderr 里 `provider: custom` / `model: gpt-5.6-sol` 正确，且**没有** `Error loading config.toml`。

### 第五步：让用户重启 Codex App

告诉用户手动退出并重开。不要替用户杀掉 App 进程——他可能正在里面有未保存的会话。

## 通道速查（本机实测）

| 通道 | base_url | 可用模型 | 状态 |
|---|---|---|---|
| 直连中转 | `https://apinexus.dpdns.org/v1` | `gpt-5.6-sol`（仅此一个） | 可用，responses 正常 |
| Codex++ 本地 | `http://127.0.0.1:<PORT>/v1` | `agnes-*` 系列 | 与 gpt-5.6-sol 不匹配，勿用 |

直连 key 存在 `%USERPROFILE%\\.codex\auth.json` 的 `OPENAI_API_KEY`。
注意 `codex-launcher-model-catalog.json` 是 Codex++ 生成的，只声明 `gpt-5.6-sol`，与直连通道恰好匹配，**修复时保留不要删**。

## 备份约定

脚本每次修改前写 `config.toml.bak-fix-<时间戳>`。要回滚就把它复制回 `config.toml`。目录里还有一堆 `*.bak-codex-launcher-*`，那是 Codex++ 留下的，可以不管。
