# Git 与 GitHub CLI：安装、配置与使用

> 面向 Windows 10/11 ｜ **不预设任何盘符**，工具装哪由你定，脚本会自己找
> 验证版本：Git 2.55 ｜ GitHub CLI 2.102

---

## 一、先说清楚一件事：路径是你定的

本文出现的所有 `<工具目录>` 都是**占位符**，不是某个固定路径。

`<工具目录>` 指你决定放工具的文件夹，比如：

- `D:\DevTools`
- `E:\DevTools`
- `C:\Users\你的用户名\DevTools`
- 任何你觉得合适、**不在系统根目录**、剩余空间大于 5 GB 的位置

**本项目不写死任何一个盘符。** 原因很简单：你的机器是 C 盘，别人可能是 E 盘，
把作者自己的 `D:\` 写进教程，读者第一反应是「我这儿没这个目录，那还装不装了」。

### 脚本怎么知道装哪？

`install/02-install-tools.ps1` 的顺序是：

1. **先探测** —— 从 `PATH` 和常见安装位置（`C:\Program Files\Git`、
   `%LOCALAPPDATA%\Programs\...`、Chocolatey 目录等）找已经装好的 git / gh / gcc。
   找到就直接用，不重复安装。
2. **找不到才问你** —— 命令行参数不给值时，脚本会挑一个**剩余空间够的非系统盘**
   建 `DevTools` 目录；没有非系统盘就退回你的用户目录。
3. **装完打印路径** —— 直接给你一行可复制的绝对路径，你填进 AI 规则文件即可。

```powershell
# 想自己指定（推荐，尤其是 C 盘空间紧张的人）
powershell -ExecutionPolicy Bypass -File .\install\02-install-tools.ps1 -ToolRoot "E:\DevTools"

# 不给参数 = 自动探测 + 自动选位置
powershell -ExecutionPolicy Bypass -File .\install\02-install-tools.ps1
```

---

## 二、为什么要集中装在一个文件夹

Windows 自带的 Git（如果通过某些安装器捎带进来的）往往版本旧、藏在系统目录里，
出问题很难查。把工具收拢到**一个文件夹**，好处：

1. **路径唯一且确定** —— AI 和脚本用绝对路径直接调，不会因 PATH 变化而失效。
   很多 AI 工具在受限沙箱里拿不到完整环境变量，靠 PATH 找 `git` 会直接失败。
2. **卸载干净** —— 删一个文件夹就完事，不动注册表。
3. **不占系统盘** —— C 盘常年紧张，很多人只剩几十 GB。

---

## 三、装完之后目录长什么样

脚本装完后，你的 `<工具目录>` 里会有：

```
<工具目录>\
├── git\                     # Git for Windows（自带一份 MinGW）
│   ├── cmd\git.exe          # ← 命令行入口，用这个
│   ├── bin\git.exe          # GUI 版（git-gui）
│   └── mingw64\             # Git 自带的 MinGW（与下面那份不是同一个）
├── gh\                      # GitHub CLI
│   └── bin\gh.exe           # ← 命令行入口
├── mingw64\                 # 独立的 MinGW-w64（编译 C/C++ 用）
│   └── bin\gcc.exe
└── ninja\                   # 构建工具（比 make 快得多）
    └── ninja.exe
```

**你只需要记住三个 exe 在哪：**

| 用途 | 完整路径长什么样 |
| --- | --- |
| Git 命令 | `<工具目录>\git\cmd\git.exe` |
| GitHub 命令 | `<工具目录>\gh\bin\gh.exe` |
| C/C++ 编译器 | `<工具目录>\mingw64\bin\gcc.exe` |

> ⚠️ **一个坑**：Git 自带的 MinGW 和独立的 mingw64 **不要同时在 PATH 里**。
> 否则 `gcc` 可能随机命中不同版本，表现为「昨天能编，今天同一个命令报错」。
> 需要指定编译器时，用完整路径而不是 `gcc`。

### 要不要加进 PATH？

本项目**默认不加**。如果你实在嫌敲长路径烦，加参数：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -AddToPath
```

脚本会从探测到的 exe 路径反推目录，写进**用户级** PATH（不动系统级，不需要管理员）。
它只会添加实际存在的目录，不会塞一堆死路径进去。

---

## 四、安装方式

### 方式 A：用本仓库的脚本（推荐）

双击项目根目录的 **`install.bat`**，或手动执行 `install/02-install-tools.ps1`。

脚本做的事：

1. 探测系统里已有的 git / gh / gcc / ninja，跳过已装的。
2. 缺的从 `installers/` 里的离线包解压；没有离线包就打印官方下载地址。
3. 打印一份可直接复制的路径清单，以及「是否要加进 PATH」的提示。

> `installers/` 默认是空的（仓库不塞几十 MB 的二进制）。想离线安装就自己把官方安装包
> 放进去，脚本会优先用；文件名要求见 `installers/README.md`。

### 方式 B：手动下载

| 工具 | 官方地址 | 说明 |
| --- | --- | --- |
| Git for Windows | <https://git-scm.com/download/win> | 安装时选自定义目录 |
| GitHub CLI | <https://cli.github.com/> | Windows 版解压即用 |
| MinGW-w64 | <https://www.mingw-w64.org/downloads/> | 选 **UCRT runtime** 版本 |
| Ninja | <https://github.com/ninja-build/ninja/releases> | 单个 exe，扔哪都行 |

> **网络有 TLS 中间人代理时**（公司网、部分校园网、某些 VPN），
> 官方链接会报 `unable to verify the first certificate` 或 `CRYPT_E_NO_REVOCATION_CHECK`。
> 这时**不要**关掉证书校验硬下 —— 正确做法是用代理的证书文件，
> 或从可信渠道拿离线包再校验哈希。

---

## 五、首次配置

把下面三行里的 `<工具目录>` 换成你自己的：

```powershell
$git = "<工具目录>\git\cmd\git.exe"
$gh  = "<工具目录>\gh\bin\gh.exe"

# 1) 提交身份（**必填**，不填第一次 commit 直接失败）
& $git config --global user.name  "你的 GitHub 用户名"
& $git config --global user.email "你的 GitHub 邮箱"

# 2) 新仓库默认分支叫 main 而不是 master
& $git config --global init.defaultBranch main

# 3) 换行符策略（Windows 上建议关掉自动转换，避免整个文件被改写）
& $git config --global core.autocrlf false

# 4) 中文文件名不转义（否则 status 里全是八进制）
& $git config --global core.quotepath false
```

模板在 `git-github/gitconfig.template`，可以照着抄。

### 可选但推荐

```powershell
& $git config --global fetch.prune true        # 拉取时自动清理已删的远程分支
& $git config --global pull.rebase false       # 拉取不自动 rebase，团队协作更安全
& $git config --global credential.helper manager   # 凭据交给 Git Credential Manager，登录一次就行
```

---

## 六、登录 GitHub（两种方式）

### 方式 1：设备码（推荐，适合没有浏览器的环境 / 服务器 / AI 代跑）

```powershell
& $gh auth login --hostname github.com --git-protocol https --web
```

给你一串设备码，复制到浏览器输入即可。**这条路径完全非交互**，
AI 也能替你跑完，适合放进自动化脚本。

### 方式 2：Personal Access Token

1. GitHub 右上角头像 → Settings → Developer settings → Personal access tokens。
2. 生成 token，勾选 `repo`、`read:org`、`gist`。
3. 执行：

```powershell
& $gh auth login --with-token
# 粘贴 token 再回车
```

> ⚠️ **token 是密码级敏感信息**。不要写进任何代码仓库、截图、录屏、聊天记录。
> 本仓库所有配置文件里的 token 都是占位符 `<YOUR_TOKEN>`，需要你自己填。

### 验证

```powershell
& $gh auth status
# 应显示：Logged in to github.com account <你的用户名>
```

---

## 七、日常命令速查

### 本地

```powershell
$g = "<工具目录>\git\cmd\git.exe"

& $g init                  # 建新仓库
& $g clone <仓库地址>       # 克隆
& $g status                # 看当前状态（最常用）
& $g add .                 # 暂存全部改动
& $g commit -m "说明"      # 提交
& $g log --oneline --graph # 看历史
& $g diff                  # 看还没 add 的改动
```

### 与远程同步

```powershell
& $g push
& $g pull
& $g branch                # 本地分支列表
& $g switch -c 新分支名     # 建并切分支
```

### 用 gh 干 GitHub 上的事

```powershell
$gh = "<工具目录>\gh\bin\gh.exe"

& $gh repo create 项目名 --public --source=. --push   # 建仓库并推上去
& $gh repo view owner/repo                            # 看 star / license / 最近更新
& $gh pr create --title "标题" --body "说明"           # 发 PR
& $gh issue list -R owner/repo                        # 看别人踩过什么坑
```

---

## 八、"动手写之前先去 GitHub 找"

这是本项目的**第一原则**。自己从零写之前，先搜一遍开源世界：

```powershell
& $gh search repos "关键词" --limit 20 --sort stars
& $gh search code "具体函数名" --language python
```

搜索技巧：

- **关键词用英文**，效果比中文好 3~10 倍。
- 先搜 `repos` 找整库，再搜 `code` 找具体实现。
- 找到候选后用 `repo view` 判断质量：

```powershell
& $gh repo view owner/repo
```

| 检查项 | 怎么判断 |
| --- | --- |
| 活跃度 | `pushedAt` 是不是最近几个月 |
| 质量 | stars 数量、issue 响应速度 |
| **许可** | **有没有 LICENSE，以及是什么协议** |

### 抄之前必须确认的三件事

1. **没有 LICENSE = 别人没授权你抄。** 公开可见不等于可以随便用。
2. **MIT / Apache-2.0**：可以商用，但**必须保留原作者的版权声明**。
3. **GPL**：有传染性，你用了它，你的项目也可能被迫开源。能不碰就不碰，
   或只参考思路、不复制代码。

### 抄完必须做的事

```python
"""
来源：https://github.com/owner/repo
作者：@owner
许可：MIT License
用途：实现 XX 功能
"""
```

本仓库的 `CREDITS.md` 和各技能目录下的 `ORIGIN.md` 就是这个动作的产物——
自己做的项目也一样，别人一眼就能看出你抄没抄、署没署名。

---

## 九、常见问题

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `Please tell me who you are` | 没配提交身份 | 见第五节 `git config --global user.name/email` |
| `gh search` 返回空数组 | token 没登录 / 关键词太具体 / 子命令用错（`repo` vs `repos`） | 先 `gh auth status`；关键词放宽成英文单词 |
| `SSL certificate problem` | 网络有 TLS 中间人代理 | 见第四节「注意」 |
| `fatal: not a git repository` | 当前目录不是仓库 | `cd` 到仓库根目录，或 `git init` |
| 中文文件名显示成 `\344\270\255\346\226\207` | `core.quotepath` 没关 | `git config --global core.quotepath false` |
| `gh` / `git` 提示找不到命令 | 不在 PATH 里 | 用完整路径调；或装的时候加 `-AddToPath` |
| gcc 编译行为飘忽不定 | PATH 里同时有两份 MinGW | 只保留一份，或直接写完整路径 `...\mingw64\bin\gcc.exe` |

---

## 相关文件

- 一键安装脚本：`install/02-install-tools.ps1`
- 工具链完整清单（版本、编译示例、更多坑）：`codetool/工具链清单.md`
- 隐私扫描脚本：`install/privacy-scan.js`
- git 配置模板：`git-github/gitconfig.template`