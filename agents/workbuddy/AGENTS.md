# AGENTS.md — 全局工作规则

> 这份文件对**所有项目、所有 AI 助手**生效。项目内部可以有自己的 `AGENTS.md` 覆盖同名项。
> 维护人：<你的名字> ｜ 最后更新：2026-10-05

---

## 零、技能库统一规则（最高优先级，先看这条）

**唯一技能库：`%SKILL_LIB%\\`**（31 个技能）

**三家 AI 的技能目录都指向它**，库改一次全家同步：

| AI | 技能目录 |
| --- | --- |
| WorkBuddy | `%USERPROFILE%\\.workbuddy\skills` → `%SKILL_LIB%` |
| Cursor | `%USERPROFILE%\\.cursor\skills` → `%SKILL_LIB%` |
| Claude Code | `%USERPROFILE%\\.claude\skills` → `%SKILL_LIB%` |

各家另有各自的 user rule 文件，内容与本节一致：
- Cursor：`%USERPROFILE%\\.cursor\rules\skill-library-unified.mdc`
- Claude Code：`%USERPROFILE%\\.claude\CLAUDE.md`
- 库内总纲：`%SKILL_LIB%\\技能库统一规则.md`

**铁律**：
1. **动手之前先查库。** 任何任务开始前先扫 `%SKILL_LIB%\\` 有没有现成技能。
2. **有就用，禁止现场造轮子。** 已有技能覆盖的场景，不许临时写脚本顶替。
3. **没有就写进库。** 做完一段可复用工作流，沉淀成 `SKILL.md` 放进去，别只留在对话里。
   格式：YAML frontmatter + `name:` + `description:`，description 必写**触发语**。
4. **库必须扁平**：`%SKILL_LIB%\\<技能名>\SKILL.md`，不要建分类子目录，否则各家扫不到。

---

## 一、你是谁、在哪干活

- 用中文交流，风格务实：先查清再动手，不拿"看起来完成了"当完成。
- 讲解技术内容时按用户的水平定档位。**能用5 行代码说清的，不要用术语说**——
  学术名词和论文名一律砍掉，换成类比。
- 提了问题就是想听答案，**不是让你开工**。需求里夹着提问时，先答，等点头再写代码。

---

## 二、Skill 库在哪里、有啥、干什么用

**位置**：`%SKILL_LIB%\\`（=`~\.workbuddy\skills\`，同一份）
每个技能一个文件夹，里面的 `SKILL.md` 第一段frontmatter 是它的"身份证"（name + description）。
**匹配规则**：用户说的话命中 description 里的触发词，就直接调那个技能，不要自己瞎实现。

| 技能 | 干什么 | 什么时候用 |
| --- | --- | --- |
| `sandbox-safe-file-ops` | 沙箱里安全整理文件：清空目录、合并重复目录、用符号链接代替快捷方式、删除转隔离区 | 「清理空文件夹」「合并重复目录」「这些不要了但先别删」 |
| `tls-mitm-downloader` | 有 TLS 中间人时可靠下载：跟随重定向、流式落盘、SHA256 交叉校验 | 「下不下来」「证书错误」「unable to verify」 |
| `gh-cli-setup` | 配 GitHub CLI 与 git：非交互设备码登录、提交身份、排查搜索返回空 | 「配置 GitHub」「登录 gh」「gh 搜不到东西」 |
| `workbuddy-sandbox-constraints` | 本机沙箱硬限制：被禁 API、stdout 不回传、BASH PATH 坏、绝对路径要求 | 工具报「Command blocked」或没输出时先查 |
| `browser-skill` | 操作用户已登录的 Chromium：读页、填表、抓数据、点流程、截图 | 要用他现成的登录态干活时。CLI 在 `~\.local\bin\bsk.exe` |
| `headless-ui-verify` | 静默无头验证界面：截图 + DOM 体检 + 像素比对，不抢焦点不弹窗 | 说「截图看看效果」「验证界面」「别打扰我」时 |
| `bundle-string-patch` | 改压缩后的单文件 JS bundle 里的界面文案 | 汉化 Cursor / VS Code / Electron 类软件界面 |
| `vscode-webview-verify` | 无头验证 VS Code 扩展的 webview 界面与交互 | 扩展 webview 点了没反应、要看长什么样 |
| `vscode-activitybar-icon` | 做 VS Code 扩展活动栏图标，避开描边被 mask 吃掉等坑 | 写 `viewsContainers.activitybar` 的 icon 时 |
| `android-apk-no-gradle` | 无 Gradle/AS 时手工搭 JDK+SDK 链，aapt2→javac→d8 产出签名 APK | 要出APK 但机器没装 Android Studio |
| `android-webview-apk` | 把 HTML/CSS/JS 界面打成 WebView APK | 想把做好的网页变成能装的 App |
| `project-zh-localizer` | 五语（zh/en/ja/ko/fr）互译，抓 HTML/JS/Vue/JSON/PO/XML/YAML 等 | 要给项目做多语言 |
| `agnes-image-gen` | 走 Agnes 通道文生图/图生图，模型全免费 | 「生成图片」「画一张图」「做海报」 |
| `agnes-video-gen` | 走 Agnes 通道生成视频，支持首尾帧控制 | 「生成视频」「把图变成视频」 |
| `promo-kit` | 一键生成宣传图+宣传视频+多渠道文案+落地页+定价推导 | 「帮我做宣传」「给项目做推广」 |
| `app-listing-kit` | 生成上架物料包：标题、卖点、详情页、SKU价格梯度、自动发货话术 | 「一键上架」「生成上架物料」 |
| `codex-api-deploy` | 把一个 API key 接进 Codex（桌面版/CLI） | 「把 key 接进 codex」「codex 换中转站」 |
| `codex-config-repair` | 修 Codex 因版本升级/启动器改写 config.toml 导致打不开 | 「codex 打不开」「Error loading config.toml」 |
| `lmstudio-load-failure-triage` | 诊断 LM Studio / llama.cpp 模型加载失败 | 「模型加载失败」「exitCode 3221226505」 |
| `windows-bat-launcher` | 写 .bat 启动器/安装脚本，避开 quoting、start、CRLF 三大坑 | 「做个一键启动脚本」「bat 路径带空格出问题」 |
| `workbuddy-spill-enoent` | 修 WorkBuddy 报 ENOENT: acc-product-config-v3.json.N.tmp | WorkBuddy 弹=== Error Report === 时 |
| `scholar-notes` `dynamic-archify` | 2 个文档/图表生成器（手写笔记风格笔记页、动画 SVG 架构图） | 要做"笔记本笔记"或"动态架构图"时 |
| `spec-driven-development` `test-driven-development` `code-review-and-quality` `verification-before-completion` | 4 个工程纪律技能（规格先行、TDD、多维评审、发布前验证） | 需求不清晰、要动手写大功能、或准备说"做完了"时 |

**维护规矩**：新技能统一放 **`%SKILL_LIB%\\`**（三家共享，别再放各家私有目录）。
技能正文用中文，代码块和命令行保持原样不翻译。


---

## 三、工具链在哪（别硬找路径）

| 工具 | 路径 | 备注 |
| --- | --- | --- |
| git | `%CODETOOL%\\git\cmd\git.exe` | 装在 codetool 里，不在系统 PATH |
| gh (GitHub CLI) | `%CODETOOL%\\gh\bin\gh.exe` | 2.102.0，设备码登录 |
| Files 文件管理器 | MSIX 4.2.9.0，入口 `%USERPROFILE%\\AppData\Local\Microsoft\WindowsApps\files-stable.exe` | 桌面已有图标 |
| C++ 工具链 | `%CODETOOL%\\` | mingw64、ninja、raylib-5.5、SFML-2.5.1/3.0.2、blender-5.2 |
| node（托管，推荐） | `%USERPROFILE%\\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` | **优先用这个**，不要用系统 node |
| python（托管，推荐） | `%USERPROFILE%\\.workbuddy\binaries\python\versions\3.13.12\python.exe` | 同上 |
| bsk（浏览器自动化） | `%USERPROFILE%\\.local\bin\bsk.exe` | bash PATH 不认，必须绝对路径调用 |
| Edge 无头 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | `--headless=new --dump-dom <url>` |
| Android 工具链 | `%ANDROID_SDK%\\` | aapt2 / javac / d8 / zipalign / apksigner |
| 游戏项目 | `%PROJECT_DIR%/`、`%PROJECT_DIR%/` | C++ raylib 与 Three.js 两条线 |

**本机硬件上限**（估算性能时必须考虑）：
<CPU_MODEL> 4核8线程 / **单条 16GB内存** / **<INTEGRATED_GPU> 核显无独显** / 磁盘 C 盘常仅剩 30GB。
⇒ 跑本地模型：4B Q4 约 5 tok/s，8~9B 掉到 2~3 tok/s，14B 以上不可用。
⇒ 核显只加速 prefill，**不提升生成速度**。

**环境坑（别重复踩）**：
- `node` 里 `execFile('powershell.exe', ...)` **已被安全策略拦截**。
  要拿 PowerShell 结果 → 用 PowerShell 工具跑并 `Set-Content` 写到 `$env:TEMP\xxx.txt` → 再读文件。
- bash 的 PATH 是坏的：`ls`/`cp`/`mv`/`grep`/`curl` 全部 command not found。
  只能用绝对路径调程序；建目录/移动文件/杀进程用 PowerShell 工具。
- 网络有 **TLS 中间人**（vpnNode 代理，`HTTPS_PROXY=127.0.0.1:<PORT>`，且该代理常失效）。
  现象：curl 报 `CRYPT_E_NO_REVOCATION_CHECK`，node 报 `unable to verify the first certificate`。
  ⇒ 下载时关校验 + **必须用官方 SHA256 校验完整性**。winget 在此环境常卡死，改用直链下载。

---

## 四、GitHub 就是军火库（重要）

**动手写之前，先去 GitHub 找。** 这是本机的第一原则。

顺序固定为：

1. **先搜**。用 `gh search repos` / `gh search code`，或 GitHub 网页搜。
   关键词用英文搜效果比中文好 3~10 倍。
2. **再看 stars 和最近提交**。`gh repo view <owner/repo>` 看 stars、license、`pushedAt`。
   - stars < 500 且两年没更新 → 只当参考，别当依赖。
   - 没有 LICENSE → **绝对不能抄进要发布的项目**。
3. **优先抄"零件"，不抄"整站"**。找能单独用的库、算法、UI 组件，
   别直接 clone 整个项目改。
4. **抄完必须**：
   - 在代码里注明来源（仓库名 + 作者 + License），写在文件头注释里。
   - 遵守原 License（MIT/Apache 要保留版权声明，GPL 会传染，要小心）。
5. **商用/上架前**：扫一遍有没有第三方作品名、IP、商标。
   项目要拿去卖，**产物里绝对不能出现任何第三方作品名/IP**。
   注释里要形容效果就写效果本身（"块状波浪带""立体屋顶"），不写"某某风格"。

**gh 常用命令**：
```bash
gh search repos "关键词" --limit 20 --sort stars
gh search code "具体函数名" --language python
gh repo view owner/repo          # 看 stars / license / 最近更新
gh repo clone owner/repo         # 克隆
gh issue list -R owner/repo      # 看别人提的问题，能省很多踩坑
gh pr list -R owner/repo
```

**搜不到就自己写，但要先确认真的搜过。** 说"GitHub 上没有"之前，
把搜过的关键词列出来。

---

## 五、隐私与合规红线（每次交付前必查）

项目要开源/上架，**交付前必须清掉隐私信息**：

- 昵称、真实姓名、手机号、邮箱、本机绝对路径，都不能出现在产物里。
- 扫描方式：`os.walk`（**不要用 glob，它默认不下钻 `.` 开头的目录**，
  会漏掉 `.loc/backup` 这类路径），再用「手机号正则 + 邮箱正则 + 昵称串」扫一遍。
- **备份文件里同样会留隐私**，不能只清源文件。

**另外两条**：
- 卖带 AI 的产品时，**只能让买家自带 Key**。自己搭服务器转发 AI 请求 =
  成为「生成式 AI 服务提供者」，需算法备案 + 内容安全，个人办不了。
  让买家填自己的 baseURL/model/key，产品定性退回「软件」。
- 多账号轮换 key 薅额度违反上游 ToS（按支付方式/设备指纹/IP 段一起封）。**不要做。**

---

## 六、干活时的硬规矩

1. **先逐条核对现状**。用户习惯一次丢一大份清单，里面常混着已完成项。
   逐条过代码，把「已有」和「真缺」分开，并明确回告哪些是新做的。
2. **说"已实现"之前先跑一遍验证**，给可核对的数字。拿不准的标「待确认」，不要含糊。
3. **挖到底层**。发现根因比表面问题更深就一并修掉，汇报时讲清楚。
4. **删除不可逆**。删任何东西前先列清单 + 警告 + 等确认，用回收站/隔离区，不用 `rm -rf`。
5. **自己拿主意改了什么要主动交代**（尺寸、数值、默认值），并给"不合适你说"的口子。
6. 讲解时**降层级**：能用 5 行 Python 讲清就别用术语。他会说"有点听不懂"，
   听到就立刻换代码类比，别硬撑。

---

## 七、项目内部规则放哪

- 项目根目录 `AGENTS.md` —— 只写这个项目特有的约定。
- 项目根目录 `.workbuddy/memory/` —— 每天的工作日志（追加式，不许覆盖）。
- 项目根目录 `.workbuddy/memory/MEMORY.md` —— 长期项目笔记。
- 两者都**继承**本文件的全局规则，同名项以项目内为准。
