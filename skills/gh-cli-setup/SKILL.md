---
name: gh-cli-setup
description: |
  配置 GitHub CLI（gh）与 git：非交互登录（设备码 / PAT）、设置提交身份、
  配置凭据助手、验证搜索与克隆能力、排查「搜索返回空」等假故障。
  当用户说「配置 GitHub」「登录 gh」「gh 怎么用」「连不上 GitHub」
  「gh search 搜不到东西」「git 提交身份」时使用。
agent_created: true
---

# GitHub CLI 与 git 配置

## 前提：git 身份是 git 提交的硬需求

`user.name` / `user.email` 是**本机特定值**，不要把某台机器的写死进技能。
下面用占位符，实际执行时读用户的 git config 或问用户：

```powershell
$git = "%CODETOOL%\\git\cmd\git.exe"
& $git config --global user.name  "<用户的 GitHub 用户名>"
& $git config --global user.email "<用户注册 GitHub 用的邮箱>"
& $git config --global init.defaultBranch main
& $git config --global core.autocrlf false        # Windows 上别让 git 改行尾
& $git config --global core.quotepath false       # 中文文件名不转义成 \344\270...
& $git config --global credential.helper manager  # 凭据存 Windows 凭据管理器
& $git config --global push.default simple
& $git config --global pull.rebase false
& $git config --global fetch.prune true
& $git config --global advice.detachedHead false
```

`core.quotepath=false` 对中文用户尤其重要：默认 `true` 时 `git status` 里中文会显示成
`"\346\226\207.md"`，很多用户以为是乱码 bug。

## gh 非交互登录：设备码流程

`gh auth login` 是交互式的，**PowerShell 工具里不能交互**。别试 `Start-Job`
（被安全策略拦），直接后台跑 + 预喂一个空行：

```powershell
$out = "$env:TEMP\ghlogin.txt"
"" | & $gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key *>&1 |
  Out-File -LiteralPath $out -Encoding UTF8 -Append
```

输出 stderr 里会出现：

```
! One-time code (A792-FBEA) copied to clipboard
Open this URL to continue in your web browser: https://github.com/login/device
```

**把码原样告诉用户**，让他去 https://github.com/login/device 输入。
这是唯一必须用户本人操作的步骤，AI 代替不了。

码有时效（约 15 分钟）。过期就重跑一次生成新码。

成功后验证：

```powershell
& $gh auth status
# 期望：Logged in to github.com account XXX (keyring)
#       Token scopes: 'gist', 'read:org', 'repo'
```

## ⚠️ 假故障：搜索返回 `[]` 不代表坏了

新手最容易误判的点。`gh search repos "多个词"` 返回空数组 `[]`，**往往不是网络或
凭据问题**，而是 AND 匹配太严。

排查顺序（照着走，别跳步）：

```powershell
# 1. 换单个词
& $gh search repos "raylib" --limit 3 --json fullName,stargazersCount
# 2. 看限流额度
& $gh api rate_limit --jq '.resources.search'      # limit 30（search 限流很紧）
# 3. 直接打 REST 看总数
& $gh api "search/repositories?q=raylib&per_page=2" --jq '.total_count'
# 4. 绕开 search，单读仓库
& $gh repo view OWNER/REPO --json name,stargazerCount
```

⚠️ 另一个高频错：**owner 名字记错**。`raylib/raylib` 404，真实是 `raysan5/raylib`。
不确定就先 `search` 一下再 `view`。

## License 红线：拿 GitHub 代码前必查

AGENTS.md 里写死的规矩：

```powershell
& $gh repo view OWNER/REPO --json licenseInfo
```

| License | 能干什么 |
| --- | --- |
| MIT / Apache-2.0 / BSD | 商用随便用，保留版权声明 |
| GPL-3.0 | 用在你的项目里，**你的项目也必须开源** |
| AGPL-3.0 | 改成 SaaS / 加网络服务都算"分发"，同样要开源 |
| 无 License | 版权默认保留，**没有授权，不能用** |

User 要开源的项目，绝不能引入 GPL 依赖（会污染你的 License）。

## 军火库标准流程

1. `gh search repos` / `gh search code` 找
2. `gh repo view` 看 stars / license / pushedAt（**pushedAt 久 = 半年没维护，是坑**）
3. `gh issue list -R owner/repo` 读别人的踩坑记录
4. `gh repo clone owner/repo` 克隆
5. 记进项目 AGENTS.md 备查

## 其他要知道的

- `gh` 在 PATH 里**当前窗口可能不可见**（装完没重开终端），用绝对路径调
- gh token 存在 Windows 凭据管理器，重装系统不丢
- `gh search code` 需要登录才能用（匿名不行）
- search API 限流 **30 次/分钟**，别在循环里狂搜
