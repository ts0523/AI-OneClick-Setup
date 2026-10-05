# 技能库统一规则（Claude Code）

**唯一技能库：`%SKILL_LIB%\\`**（`~/.claude/skills` 已是指向它的符号链接，共 31 个技能）

## 铁律：先查库，再动手

1. **任何任务开始前，先扫一遍技能库有没有现成的。**
   看 `%SKILL_LIB%\\` 下的目录名，或读各 `SKILL.md` 的 `description` 行。
2. **有就用，禁止现场造轮子。** 已有技能覆盖的场景，不许临时写脚本顶替。
3. **没有就写进库。** 做完一段可复用的工作流，沉淀成 `SKILL.md` 放进 `%SKILL_LIB%\\`，
   不要只留在对话里。格式：YAML frontmatter + `name:` + `description:`，
   `description` 必须写清**触发语**（用户怎么说会命中它）。
4. **库必须扁平**：`%SKILL_LIB%\\<技能名>\SKILL.md`，不要建分类子目录。

## 技能速查

| 场景 | 用这个 |
| --- | --- |
| 生成图片 / 视频 | `agnes-image-gen`、`agnes-video-gen` |
| 演示动画 HTML | *（本仓库未收录，理由见 CREDITS.md） |
| 打 APK（无 Gradle） | `android-apk-no-gradle`、`android-webview-apk` |
| 无头验证界面 / 截图验收 | `headless-ui-verify`、`vscode-webview-verify` |
| VS Code 扩展图标 | `vscode-activitybar-icon` |
| 汉化、多语本地化 | `project-zh-localizer`、`bundle-string-patch` |
| 上架物料 / 推广物料 | `app-listing-kit`、`promo-kit` |
| 浏览器操作 | `browser-skill` |
| .bat 启动脚本 | `windows-bat-launcher` |
| 配 Codex API key / 修 config.toml | `codex-api-deploy`、`codex-config-repair` |
| LM Studio 加载失败 | `lmstudio-load-failure-triage` |
| WorkBuddy 报 ENOENT | `workbuddy-spill-enoent` |
| 清理文件 / 合并重复目录 / 建符号链接 | `sandbox-safe-file-ops` |
| 下载失败（证书错误） | `tls-mitm-downloader` |
| 配置 GitHub / git / gh 登录 | `gh-cli-setup` |
| 工具被拦 / 没输出 / 路径找不到 | `workbuddy-sandbox-constraints` |

## 工具链

| 工具 | 路径 |
| --- | --- |
| git | `%CODETOOL%\\git\cmd\git.exe` |
| gh（已登录 yourname） | `%CODETOOL%\\gh\bin\gh.exe` |
| node（托管，优先） | `%USERPROFILE%\\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| python（托管，优先） | `%USERPROFILE%\\.workbuddy\binaries\python\versions\3.13.12\python.exe` |
| bsk（浏览器自动化） | `%USERPROFILE%\\.local\bin\bsk.exe` |
| Edge 无头 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| C++ 工具链 | `%CODETOOL%\\`（mingw64/ninja/cmake/raylib-5.5/SFML/blender） |
| Android 工具链 | `%ANDROID_SDK%\\` |

⚠️ **Bash 的 PATH 是坏的**：`ls`/`cp`/`mv`/`grep`/`curl` 全部 command not found。
只用带绝对路径的可执行文件。建目录/移动文件用 PowerShell。

⚠️ **PowerShell 的 stdout 不回传**。要看结果必须
`... | Set-Content "$env:TEMP\r.txt"` 再读文件。

## 硬件天花板

<CPU_MODEL> 4 核 8 线程 / **单条 16GB内存**（不是双通道）/ <INTEGRATED_GPU> 核显无独显 / C 盘常剩 30GB。
本地大模型：4B Q4 约 5 tok/s，8~9B 掉到 2~3 tok/s，14B 以上基本不可用。

## GitHub 当军火库（先查 License）

1. `gh search repos` / `gh search code` 搜
2. `gh repo view <owner>/<repo> --json licenseInfo,pushedAt`
3. `gh issue list -R <owner>/<repo>`
4. `gh repo clone <owner>/<repo>`

MIT/Apache/BSD 随便用；**GPL 会要求你的项目也开源**；AGPL 连网络服务都算；
**无 License 等于没授权**。要开源的项目绝不能引 GPL 依赖。
`pushedAt` 超半年没动的基本是坑。

## 隐私红线（对外产物必过）

- 不能出现：昵称、真实姓名、手机号、邮箱、本机绝对路径
- 扫手机号 `1[3-9]\d{9}`、邮箱 `[\w.+-]+@[\w-]+\.[\w.]+`
- ⚠️ `glob` 默认不下钻 `.` 开头目录，扫隐藏目录用 `os.walk`；**备份文件里也会留隐私**
- 用户要把产物拿去训练 ⇒ 产物里**不能出现任何第三方作品名/IP**
  （泰拉瑞亚、饥荒、星露谷、纸嫁衣、DayZ、Minecraft…）。
  描述效果写效果本身（"块状波浪带"），不写"某某风格"。

## 干活硬规矩

1. **先核实再动手**：需求清单逐条对现状，区分"已有"和"真缺的"，并回告。
2. **证据优先于断言**：说"完成"前跑验证给数字，没把握标"待确认"。
3. **删除走隔离区**：`Move-Item` 到 `<隔离区>\_待清空_YYYY-MM-DD\`，不真删。
   合并重复目录前必须 SHA256 逐字节比对 + 扫引用。
4. **改了什么要说**：自己拿的主意改了什么、为什么改，交付时主动交代。
5. 沙箱限制（被禁 API / stdout 不回传 / 绝对路径）见技能 `workbuddy-sandbox-constraints`。
