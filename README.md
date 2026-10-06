# AI 一键配置

> **AI 技能库** + **五家 AI 工具配置** + **Git / GitHub** + **C/C++ 工具链**  
> 一次配好，双击即用。  
> 作者：[ts0523](https://github.com/ts0523)

一个**组合式**开源项目：把 GitHub 上合规的开源技能、AI 工具配置方案、
工具链安装经验、Git 教程，组装成一套能在 Windows 上双击安装的方案。

核心思路是三句话：

1. **技能库只存一份**，用符号链接让五家AI 工具都指过去 —— 加一个技能，五家同时有。
2. **工具收拢到一个文件夹**，调用一律写绝对路径 —— 不污染系统 PATH，卸载是删文件夹。
3. **交付前必过隐私扫描** —— 密钥、邮箱、手机号、本机路径一个都不能漏。

## 这个仓库包含什么

这不是单一的技能库，而是四块内容打包在一起：

| 板块 | 目录 | 内容 |
| --- | --- | --- |
| **AI 技能库** | `skills/` | 54 个技能，五家AI 工具共享同一份。加一个技能，五家同时生效 |
| **AI 工具配置** | `agents/` | WorkBuddy / Cursor / Claude Code / VS Code / Cursor BYOK 五套user rule 与设置模板 |
| **Git & GitHub** | `git-github/` | 使用教程 + 提交身份模板（`gitconfig.template`），解决中文文件名、提交身份这类常见坑 |
| **工具链** | `codetool/` + `install/` | Git / gh / MinGW-w64 / ninja / Node.js / Python / 7-Zip 的探测与安装，以及一键配置脚本 |

配套还有：

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 隐私与合规扫描器 | `install/privacy-scan.js` | 一条命令扫出密钥、邮箱、手机号、本机路径、商标风险 |
| 上架物料包 | `installers/` | 离线安装包位（体积大，默认不入库） |
| 第三方署名与致谢 | `CREDITS.md` | 每个收录技能的作者、仓库、许可与判断依据 |

> 📌 **这是一个组合项目**：技能来自各个开源作者的贡献，安装方案、工具链、教程、
> 隐私扫描器是本项目自己的。每一个第三方技能都附`ORIGIN.md` 与 `LICENSE` 署名
> —— 详见 **[`CREDITS.md`](CREDITS.md)**。

> 📌 **本文不写死任何盘符。** 你的机器是 C 盘、别人的机器是 D 盘，都不影响这个方案。  
> 安装位置由脚本探测 + 你指定，详见 [第五节](#五路径怎么定的)。

---

## 一、装完你有什么

### 1. 一份技能库，五家 AI 工具共享

54 个技能放在 `skills/` 一个目录里，WorkBuddy / Cursor / Claude Code / VS Code /
Cursor BYOK 通过符号链接指过来。**加一个技能，五家同时生效。**

| 类别 | 代表技能 |
| --- | --- |
| **工程纪律** | 规格驱动开发、测试驱动、代码评审、渐进式实现、发布前验证（22 个来自 Addy Osmani） |
| **调试与协作** | 系统化调试、并行子 agent、代码分支收尾、Git worktree（10 个来自 superpowers） |
| **界面与前端** | 生产级可访问 UI、性能优化、无头界面验证、VS Code webview 验证 |
| **移动应用** | 无 Gradle 打 APK、WebView 打包（零 Android Studio 也能编译） |
| **桌面应用** | Codex 配置修复、API 部署、LM Studio 排障、Windows 启动脚本 |
| **汉化与本地化** | 压缩包字符串替换、项目级中文本地化 |
| **营销与上架** | 应用上架物料包、推广素材生成 |
| **安全与沙箱** | 沙箱内安全文件操作、TLS 代理下载、工作区约束清单 |

想快速看懂每个文件夹是干什么的，看 **[`skills/技能中文名对照表.md`](skills/技能中文名对照表.md)**。

### 2. 五家 AI 工具的配置模板

`agents/` 下是五套现成的 user rule 与设置，装完直接生效：

| 工具 | 配置 |
| --- | --- |
| WorkBuddy | `AGENTS.md` / `USER.md` / `SOUL.md` / `IDENTITY.md` 全套人格与规则 |
| Cursor | `.mdc` 规则文件 + `cli-config.json` |
| Claude Code | `CLAUDE.md` + `settings.json` |
| VS Code | 用户规则 + 工作区建议 |
| Cursor BYOK | 独立配置 |

### 3. Git & GitHub

`git-github/` 提供使用教程和 `gitconfig.template`。解决的是新手最常撞的几件事：

- 提交身份怎么配（`user.name` / `user.email`）
- 中文文件名在 `git status` 里显示成乱码怎么办
- 换行符（CRLF / LF）在Windows 上互相打架
- 提交前该检查什么

### 4. C/C++ 及其他工具链

`codetool/工具链清单.md` 说明装什么、为什么装、哪些是必须的：

| 工具 | 用途 | 必须？ |
| --- | --- | --- |
| Git + GitHub CLI | 版本管理、仓库操作 | **必须** |
| Node.js | 跑 JS 脚本、装依赖 | **必须** |
| MinGW-w64 (gcc/g++) | 编译 C/C++ | 按需 |
| ninja | 构建加速 | 按需 |
| Python | 脚本与数据处理 | 可选 |
| 7-Zip | 解压 `.7z`（装 MinGW 用） | 可选 |

### 5. 隐私与合规扫描器

```bash
node install/privacy-scan.js
```

扫出密钥、邮箱、手机号、真实姓名、本机路径、硬件型号、商标风险。
开源前跑一遍，避免把不该公开的东西带出去。


---

## 二、快速开始

### 方式 A：双击（推荐）

克隆或下载本仓库，然后**双击 `install.bat`**。

### 方式 B：命令行

```powershell
# 全部安装（自动探测已有工具 + 自动选安装位置）
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# 只装技能库和 AI 工具，不碰工具链
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Only skills

# 自己指定装哪（推荐 C 盘空间紧张的人）
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ToolRoot "E:\DevTools" -SkillLib "E:\AI-Skills"

# 想用 git / gh / gcc 短命令（不推荐，见第五节 2）
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -AddToPath
```

> ⚠️ 首次运行若报「脚本被禁止」，用**管理员** PowerShell 执行一次：
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

---

## 三、装完怎么验证

打开任意一家 AI 工具，问它：

```
你现在有哪些技能？技能库在哪？
```

- 答得出 29 个、路径指向你的技能库 → **成功**。
- 说找不到技能 → 检查符号链接是否建成（`install/03-setup-agents.ps1` 会逐个打印链接状态）。
- Windows 10/11 建符号链接需要**开发者模式**或管理员权限；  
  脚本会自动退回成「真实复制」，但那样各家的版本会分叉，需手动同步。

命令行验证工具链（路径换成你自己的）：

```powershell
& "<工具目录>\git\cmd\git.exe" --version
& "<工具目录>\gh\bin\gh.exe" --version
& "<工具目录>\mingw64\bin\gcc.exe" --version
```

---

## 四、目录结构

```
AI一键配置/
├── install.bat                  ← 双击这个
├── setup.ps1                    ← 主程序
├── LICENSE                      MIT（仅覆盖原创部分）
├── CREDITS.md                   ← 第三方署名与致谢 ★
│
├── install/                     一键脚本
│   ├── 02-install-tools.ps1     装 Git / gh / MinGW / ninja（自动探测）
│   ├── 03-setup-agents.ps1      部署技能库 + 配置五家 AI 工具
│   └── privacy-scan.js          隐私与合规扫描器
│
├── skills/                      29 个技能（扁平结构，每层一个文件夹）
│   ├── 技能库统一规则.md         库内总纲
│   ├── <技能名>/SKILL.md        每个技能的说明书
│   └── .../ORIGIN.md            第三方技能才有：来源 + 致谢
│
├── agents/                      五家 AI 工具的配置模板
│   ├── workbuddy/AGENTS.md      全局规则（最完整，建议先读这个）
│   ├── cursor/rules-*.mdc       Cursor 规则
│   ├── claude-code/             Claude Code 规则 + settings 模板
│   ├── vscode/settings.json     VS Code 设置
│   └── cursor-byok/rules/       Cursor BYOK 规则
│
├── git-github/
│   ├── Git与GitHub使用教程.md     安装 / 配置 / 命令速查 / 常见问题
│   └── gitconfig.template       脱敏后的 git 配置模板
│
├── codetool/
│   └── 工具链清单.md             工具布局、版本、编译示例、坑
│
├── docs/
│   ├── skills-manifest.json     技能清单（机器可读）
│   ├── agents-manifest.json     配置文件清单
│   └── privacy/脱敏报告.md       脱敏了哪些内容
│
└── installers/                  ← 把离线安装包丢这里，脚本会优先用
```

> **`codetool/` 里为什么没有可执行文件？**  
> 因为它是**说明文档目录**，不塞二进制。工具本体由 `install/02-install-tools.ps1`  
> 从官方渠道下载到你指定的目录 —— 开源仓库不该把几十 MB 的 exe 塞进 git 历史。  
> 你也可以完全不用脚本，按 [`codetool/工具链清单.md`](codetool/工具链清单.md) 手动装。

---

## 五、路径怎么定的

这是最容易被误解的地方，所以说清楚。

### 1. 脚本不预设盘符

`setup.ps1` 和 `install/02-install-tools.ps1` 的处理顺序：

1. **先探测** —— 从 `PATH` 和常见安装位置（`C:\Program Files\Git`、  
   `%LOCALAPPDATA%\Programs\...`、Chocolatey 目录）找已装的 git / gh / gcc。  
   找到就直接用，不重复安装。
2. **找不到才要你指定** —— 参数不给值时，挑一个**剩余空间够的非系统盘**建 `DevTools`；  
   没有非系统盘就退回你的用户目录。
3. **装完打印路径** —— 给你一行可复制的绝对路径，填进 AI 规则文件即可。

本文和文档里出现的 `<工具目录>` / `<技能库>` 都是占位符，需要你自己替换。

### 2. 工具不装进系统 PATH

很多 AI 工具在受限沙箱里拿不到完整环境变量，靠 PATH 找 `git` / `gcc` 会直接失败。  
本方案让所有调用都写绝对路径：

```powershell
$git = "<工具目录>\git\cmd\git.exe"
$gcc = "<工具目录>\mingw64\bin\gcc.exe"
```

真嫌麻烦可以加 `-AddToPath`，但注意：**Git 自带的 MinGW 和独立 mingw64 不能同时在 PATH 里**，  
否则 gcc 会随机命中不同版本，编译行为会飘。

### 3. 技能库只存一份，用符号链接共享

```
<技能库>\                              ← 唯一真实来源
    ↑
    ├── %USERPROFILE%\.workbuddy\skills   （符号链接）
    ├── %USERPROFILE%\.cursor\skills      （符号链接）
    └── %USERPROFILE%\.claude\skills      （符号链接）
```

往库里加一个技能，三家同时就有了，不会版本不一样。  
代价：**别动那个目录本身，别在里面加分类子文件夹**（各家只扫一层）。

```
<技能库>\<技能名>\SKILL.md                    ✅
<技能库>\分类\演示\某技能\SKILL.md   ❌ 各家扫不到
```

---

## 六、隐私与合规

这个仓库里的**所有文件**都过了脱敏，包括配置文件、脚本注释和文档示例。

| 类别                   | 处理                                               |
| -------------------- | ------------------------------------------------ |
| API 密钥 / token / JWT | 替换为 `<YOUR_KEY>` / `<YOUR_TOKEN>` / `<YOUR_JWT>` |
| 邮箱                   | `<YOUR_EMAIL>`                                   |
| 手机号                  | `<YOUR_PHONE>`                                   |
| 真实姓名、客户名             | `<NAME>` / `<CUSTOMER>`                          |
| 作者机器的绝对路径            | 全部替换为 `<工具目录>` / `<技能库>` 等占位符                    |
| 代理端口、硬件型号、机器哈希       | `<PORT>` / `<HARDWARE>` / `<HASH>`               |

**提交前请自己再扫一遍：**

```bash
node install/privacy-scan.js          # 只读扫描
node install/privacy-scan.js --fix    # 扫描并自动脱敏
```

扫描器用递归遍历而不是通配符 —— 通配符默认**不下钻 `.` 开头的目录**，  
会漏掉 `.git`、`.cursor`、`.claude` 这类目录，隐私常常就藏在那里。

> 扫描器会报一些**误报**，是正常的：
>
> - 商标/IP 名单文件和规则文档里出现的游戏名，那是「禁止出现」的黑名单本身。
> - 教学文档里的示例路径是反面教材。
> - `<工具目录>` 这类占位符是**方案默认值**，不是隐私 —— 它对任何人都无意义。

---

## 七、第三方技能与致谢

**技能来自这些作者的贡献，我们逐个署名：**

| 上游项目 | 作者 | 收录数 | 许可 |
| --- | --- | --- | --- |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | **Addy Osmani**（Google Chrome 团队） | 22 | MIT |
| [obra/superpowers](https://github.com/obra/superpowers) | **Jesse Vincent** | 10 | MIT |
| [UncleCheng-li/note-skill](https://github.com/UncleCheng-li/note-skill) | **UncleCheng-li** | 1 | MIT |
| architecture-diagram-generator | **tt-a1i** / **Cocoon AI** | 1 | MIT |

每个第三方技能目录下都有 **`ORIGIN.md`**，写明来源、作者、许可与使用须知。
完整清单与判断依据见 **[`CREDITS.md`](CREDITS.md)**。

### 核查后故意没有收录的

| 技能 | 核查结果 |
| --- | --- |
| 腾讯官方技能（20 个） | `cloud-service` 的 frontmatter 明确写 `license: Internal`（仅限内部、不可再分发），<br>另外 19 个既无 license 也无 LICENSE 文件|
| Cursor 官方技能（7 个） | 全部无任何 license 声明。**本仓库早期版本曾收录，已全部移除** ——<br>「本地能用」≠「可再分发」 |
| `browser-skill` | 腾讯官方产品的一部分，版权归腾讯所有 |
| `video-shot-demos` | 素材含多家厂商产品名与商标形象，且体积达74 MB |

> 判断标准很简单：**出现一个作品名/技能，是「用它」还是「禁止用它」是另一回事；
> 但把没有明确授权的文件打包进开源仓库发布，是明确违规。**

---

## 八、许可

- 原创部分：**MIT**（见 `LICENSE`）
- 第三方技能：**各自遵循其原始许可**（见各目录下的 `LICENSE` / `ORIGIN.md`）

---

## 九、想加自己的技能？

1. 在 `skills/` 下建文件夹：`skills/<你的技能名>/SKILL.md`
2. 格式：
   ```yaml
   ---
   name: your-skill
   description: |
     干什么用的。
     什么时候用：「触发语1」「触发语2」——AI 靠这些决定要不要调它。
   ---
   # 你的技能正文
   ```
3. description **必须写触发语**，否则 AI 不会主动用它。
4. 如果内容来自别人的工作，**务必**附上原 `LICENSE` 或写 `ORIGIN.md` 署名。
5. 跑一遍 `node install/privacy-scan.js` 确认没有隐私。
6. 在 `CREDITS.md` 加一行。

---

## 十、常见问题

| 现象               | 原因                | 解决                                                                                       |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| 脚本被禁止运行          | 执行策略是 Restricted  | 管理员 PowerShell 执行 `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| 符号链接建失败          | 没开开发者模式           | 开「设置 → 系统 → 开发者选项 → 开发人员模式」，或用管理员运行                                                      |
| AI 说找不到技能        | 链接没建成             | 重跑 `install/03-setup-agents.ps1`，看它打印的每个链接状态                                             |
| 提示「链接当前指向别处，已跳过」 | 脚本护栏，不动你已有的配置     | 确认要改就加 `-Force` 重跑                                                                       |
| `git` 提示没配身份     | 首次使用未配置           | `git config --global user.name "你的名字"`                                                   |
| 中文文件名显示成乱码八进制    | quotepath 未关      | `git config --global core.quotepath false`                                               |
| gcc 编译行为飘忽不定     | PATH 里同时有两份 MinGW | 只留一份，或写完整路径                                                                              |
| 端口 / 证书错误        | 网络有 TLS 中间人代理     | 见 `git-github/Git与GitHub使用教程.md` 第四节                                                     |



---

**再强调一次**：动手写之前，先去 GitHub 搜一遍。  
方法与判据见 `git-github/Git与GitHub使用教程.md` 第八节。
