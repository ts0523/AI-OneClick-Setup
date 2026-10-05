---
name: headless-ui-verify
description: 100% 静默的无头界面验证管线（Web 优先，原生/游戏走适配器）。截图确认 UI/画面效果、跑 DOM 体检与像素比对，全程不创建可见窗口、不抢焦点、不出声、不弹通知、不写用户个人目录、不留残留进程。当用户说「截图看看效果」「验证下界面」「无头验证」「跑一遍 UI 体检」「静默验证」「别打扰我地验证」「改完 UI 检查一下」时使用。
agent_created: true
---

# 静默无头验证

**核心承诺：验证全程用户零感知。** 用户可以在旁边打游戏、开会、写文档，我们照跑。

## 静默十条（每次都要守住，违反任意一条 = 打扰了用户）

| # | 铁律 | 怎么做到 |
|---|---|---|
| 1 | 不创建可见窗口 | 浏览器 `--headless=new`（不是老 `--headless`）；Node `spawn` 带 `windowsHide: true` |
| 2 | 不抢前台焦点 | 不调 `SetForegroundWindow` / 不 `BringToTop`；"窗口截屏"路线**禁止使用**（独占全屏游戏下会抓到别的画面，且必然抢焦点） |
| 3 | 不出声 | `--mute-audio`；原生路线禁 `InitAudioDevice` |
| 4 | 不弹通知/信息条/权限框 | `--disable-notifications --disable-infobars --no-default-browser-check --disable-extensions` |
| 5 | 不写用户个人目录 | profile 落在 `os.tmpdir()` 且**每次新建**；产物落在项目 `.verify/` 或指定 out，绝不进桌面/文档/下载 |
| 6 | 不改系统设置 | 不改缩放、壁纸、默认浏览器、环境变量；不写注册表 |
| 7 | 不留残留进程 | 等 `close` 事件，超时强杀；报告里给 PID 复核 |
| 8 | 不占满 CPU | 长任务 `--low-priority`（`cmd /c start /wait /LOW /B`）；浏览器用 `--virtual-time-budget` 快进而不是真等 |
| 9 | 不联网打扰 | `--disable-background-networking --disable-component-update --disable-sync --no-pings` |
| 10 | 用完就清 | 临时 profile 结束即删；失败时保留并打印路径 |

**唯一例外**：确需真机/用户肉眼确认的部分（中文字形、刘海遮挡、返回键手感）必须**明确告诉用户**，交给用户看，不许自动弹窗。

## 快速开始

```bash
NODE="<node.exe 路径>"
SV="<skill_dir>/scripts/silent_verify.js"

# 1) 先自检（不打开任何真实页面，1 秒出结果）
"$NODE" "$SV" --self-test

# 2) 静默截一张页面
"$NODE" "$SV" --url "file:///D:/proj/index.html" --out "D:/proj/.verify" \
  --width 1440 --height 900 --wait 8000 --json "D:/proj/.verify/report.json"
```

退出码：`0` 静默 PASS ｜ `1` 出图但有 warn ｜ `2` 失败 ｜ `3` 用法错。
**先自检再干活**——自检不过说明浏览器/静默参数在本机不成立，后面的结论都不可信。

### 参数要点

- `--wait` 是 `--virtual-time-budget`（毫秒），决定"截到第几秒"。**页面里有自动隐藏元素（如 6 秒后消失的气泡）时把它压到 3–5 秒**，否则截不到。
- `--width/--height` 即 `--window-size`，截图尺寸 = 这两个值，精确可控。**高设得比整页高，滚动入场动画会一次全触发**，能截到完整长页。
- `--low-priority` 长任务必加。
- `--guard-cmd "<命令>"` 挂外部守卫：命令 stdout 吐 JSON，`{"disturbed": false}` 才算过。

## 三种验证强度，别拿截图当结论

| 强度 | 证明什么 | 手段 |
|---|---|---|
| 弱·看得到 | 元素画出来了 | 截图（人眼/模型看图） |
| 中·渲染对 | DOM 结构、class、布局、媒体查询生效 | `--dump-dom` 体检 + 逐"墨迹带"像素比对 |
| 强·逻辑对 | 行为正确 | 行为断言（原生项目见 `references/pixelwilderness.md` 的 DEBUG_VERIFY 段） |

**只交截图等于没验证。** 逻辑改动必须配行为断言。

### 窄屏怎么测（headless 有最小视口宽度 ≈477px）

`--window-size=390` 实际按 477 渲染 → 看着像"横向溢出"，是假象。
正确做法：外包一层 `<iframe src="page.html" style="width:390px;height:1700px">`，媒体查询按 iframe 视口生效；子页用 `window.parent.postMessage(报告)` 把体检结果送出来，父页写进 DOM，`--dump-dom` 就能抓到（file:// 下父页读不到 iframe 内部 DOM）。

### 像素比对的三个前提（否则差异淹没信号）

1. **同机位**：动态内容（怪物/动画）先清掉或冻结。
2. **最小帧间隔**：隔 2 帧取样，隔 60 帧差异可达 99.6%。
3. **锁随机源**：天气/粒子/摆动画全关。

暗场景要降亮度阈值（>10 测不到就降到 >2），**先确认信号不是"没画"而是"太暗测不到"**。

## 原生 / 游戏适配器（参数化，勿硬编码路径）

浏览器那条路对 C++/游戏不成立。原生程序走这四步：

1. **编译无头版**：加项目自己的无头宏（raylib 例：`-DDEBUG_HEADLESS`），**不创建真实窗口**（hidden window / offscreen FBO）。
2. **禁音频**：无头构建不要 `InitAudioDevice()`。
3. **输出重定向**：`> run.log 2>&1`，帧导出写到项目内目录，不写桌面。
4. **降优先级**：`cmd /c start /wait /LOW /B "" game.exe`。

单项目实战（PixelWilderness 的帧号脚本、编译命令、分析脚本、四个血泪坑）全在
`references/pixelwilderness.md`，换项目时**只当案例看**，路径一律参数化。

### 原生路线的静默额外坑

- 夹具里**绝不能**调 `CloseWindow()`：程序尾部会再关一次 → 二次释放 → 退出码 139。
  正确写法是 `harnessStop = true` 走正常退出路径。
- 夹具里**不要切全局状态**（如 `gs`）：主循环 `continue` 会吃掉后续帧，帧号冻结，脚本永远跑不完。
- 无头构建常跳过字体预热 → 首帧缺字，改文案后要重建字表。
- `rm -f` 类批量删除会被安全策略拦并返回非零，`&&` 一短路后面的程序就不跑了 → 你会对着上一次的旧图反复分析。**让程序覆盖同名文件**，别删。

## 打扰源排查表

| 现象 | 根因 | 对策 |
|---|---|---|
| 用户说"刚才闪了一下" | 用了老 `--headless` 或没 `windowsHide` | `--headless=new` + `windowsHide: true` |
| 截图抓到别的游戏画面 | 走了窗口截屏（本机常有独占全屏程序） | 一律 offscreen / 纹理导出 |
| 用户浏览器被登出 / 配置被改 | 复用了默认 profile | 每次新建 `--user-data-dir` 到 tmp |
| 用户说"电脑卡了一下" | 无头渲染吃满 CPU | `--low-priority` + 缩短 budget |
| 弹了"是否设为默认浏览器" | 缺 `--no-default-browser-check --no-first-run` | 静默基线已含，检查参数有没有被覆盖 |
| 跑完还有进程在后台 | 没等 `close` | 报告里查 `residual` 项 |

## 交付时说清

- 截了什么、尺寸多少、有没有 warn（warn 也要如实说，别只报好消息）
- 哪些结论是"截图看到的"，哪些是"断言证明的"——**强度不同，别混着说**
- 需要人眼确认的部分（真机字形、刘海、手感）明确列出来交给用户
