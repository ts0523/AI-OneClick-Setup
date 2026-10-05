# PixelWilderness 无头验证案例（项目专属）

> 这一份是**单项目**的实战记录：帧号脚本、编译命令、分析脚本全部绑定 PixelWilderness。
> 通用能力（静默无头验证）见上级 。换项目时这份只当案例看，不要照抄路径。

# 无头界面验证管线（PixelWilderness）

## 何时用
修改了 main.cpp 的 UI/渲染代码后，需要截图确认效果时。不要用窗口截屏（本机常有 Valorant 独占全屏，CopyFromScreen 会抓到别的游戏画面）。

## 步骤

1. 编译无头版（PowerShell 或 Bash 均可）：
   ```
   D:/codetool/mingw64/bin/g++.exe main.cpp world.cpp creature.cpp assets.cpp audio.cpp water.cpp -o game_dbg.exe -std=c++17 -O2 -Wall -DDEBUG_HEADLESS -DDEBUG_AUTO_SHOT -ID:/codetool/raylib-5.5_win64_mingw-w64/include -LD:/codetool/raylib-5.5_win64_mingw-w64/lib -lraylibdll -lopengl32 -lgdi32 -lwinmm
   ```
2. 运行：`./game_dbg.exe > dbg_run.log 2>&1`（约 1540 帧自动跑完，日志含 `DBG: exported xxx.png`）。
3. 导出的 PNG 是**垂直翻转**的（OpenGL 纹理原点），用 pillow 翻转后再看：
   ```python
   from PIL import Image
   Image.open('shot_x.png').transpose(Image.FLIP_TOP_BOTTOM).save('shot_x_ui.png')
   ```
   Python 用 `<用户目录>.workbuddy/binaries/python/envs/default/Scripts/python.exe`（venv 已装 pillow；若没有则 `pip install pillow` 到该 venv）。

## 三个必踩的坑（血泪）

1. **分析坐标必须做 Y 翻转**。不只是"看图前翻转"——凡是按坐标取像素的脚本都要转：
   `画面 y -> PNG y = H - y`。曾因忘记翻转，把画面 y=141 的材料当成 PNG y=141 去找，
   查到的是背景，误判"图标根本没画出来"，白白排查很久。
2. **A/B 逐像素对照必须锁死三个变量**，否则画面整体在变，差异淹没信号：
   - 同机位：验证期间持续清怪（`mobs.clear()`），怪物击退会让玩家和相机漂移；
   - 最小帧间隔：隔 2 帧各导一张，波浪动画近乎同步（隔 60 帧时差异达 99.6%）；
   - 锁天气：`rainTarget = 0; rainAmt = 0;`，雨幕/涟漪/树摆会污染全图。
3. **暗场景要降亮度阈值**。夜间水面倒影用阈值 >10 完全测不到信号（画面被光照压到
   亮度个位数），降到 >2 才显出光柱；判 PASS 前先确认信号不是"没画"而是"太暗测不到"。

## 验证前先确认目标真的触发了

曾遇到"合成动画不显示"，实为玩家被地牢怪推离工作台超过 52px，
`CraftMenu` 直接 return，动画压根没启动。排查前先打一条状态日志
（如 `animOn`、消耗后的资源数）确认功能已触发，再看渲染。

## 按坐标取样前先校验前置条件

做树木碰撞体积测试时，直接取第一棵树测出"阔叶 -37（穿树）、松 60（没动）"的怪值。
原因是：森林极密，"南边 40px 空旷"的样本几乎不存在，且部分树的 `objAt` 索引
会被同瓦片其他物体覆盖（被覆盖者不参与碰撞查询）。取样时须校验：
`ObjIndexAt(o.tx,o.ty)==oi`（确已登记）＋ 周围 2 格无其他固体（孤立样本）。

## 行为断言（DEBUG_VERIFY）与长时压测（DEBUG_STRESS）

截图只能证明"画出来了"，不能证明"逻辑对"。逻辑改动一律用断言宏实跑：

```
# 断言：run 完自动退出，stdout 打 VERIFYn PASS/FAIL
g++ ... -o game_verify.exe -O2 -DDEBUG_HEADLESS -DDEBUG_VERIFY
./game_verify.exe > v.log 2>&1 && grep -E "^VERIFY" v.log

# 压测：狂点攻击/交互 + 周期 NewGame/存读档/进出鬼域/随机传送
g++ ... -o game_stress.exe -O2 -DDEBUG_HEADLESS -DDEBUG_STRESS -DSTRES_SECS=120
```

**断言写在哪**：`main.cpp` 里 `Render();` 之后的 `#ifdef DEBUG_VERIFY` 块，用 `static int vf; vf++; if (vf == N) {...}`
按帧号编排（用例之间留 10~20 帧让状态稳定）。夹具里 `NewGame(seed)` 就是最干净的复位手段。

**必须 `fflush(stdout)`**，否则崩溃时缓冲丢失，看不到最后一条 PASS。

### 头号血泪坑：夹具里绝不能调 `CloseWindow()`

程序尾部本来就会 `CloseWindow()`，夹具再关一次 = 二次关闭 → **偶发 SIGSEGV**。
迷惑性极强：**日志会完整打印到最后一行的卸载 INFO，崩溃发生在日志结束之后**，
只在退出码上体现（bash 报 `Segmentation fault` / rc=139）。

正确写法：
```cpp
bool harnessStop = false;                                   // 主循环前
while (!WindowShouldClose() && !harnessStop) { ... }
// 夹具内：harnessStop = true;   ← 走正常退出路径
```
判据：若 `STRESS DONE` 与 `AUDIO: Device closed successfully` 都打出来了却仍 rc=139，
那就是退出路径的二次释放，先查夹具有没有重复关闭。

### 老断言会烂掉，改枚举/机制时必须同步

本项目第十轮把 `CreatureKind::Zombie` 改成了十大规则鬼（`GhostChild` 等），
`ruleMask/RollGhostRule` 也被"每鬼固有规则"取代 —— 但 DEBUG_VERIFY 块没跟着改，
于是 `-DDEBUG_VERIFY` 直接编译不过（普通构建不受影响，所以长期没被发现）。
**改了枚举名/核心机制后，务必单独编一次 `-DDEBUG_VERIFY` 版本**，别只编正式版。

## 截图专属坑

### 夹具里不能切 `gs`（会被 `continue` 吃掉）
主循环 `if (gs == GS::Title) { ...; Render(); continue; }` —— 在夹具里写 `gs = GS::Title;`
会让后续所有帧都跳过夹具，**帧号冻结、脚本永远跑不完**（表现为日志刷屏但不出图）。
正确做法：临时切、就地 `Render()`、导出、立刻切回：
```cpp
if (fno == 1692) { GS keep = gs; gs = GS::Title; introOn = false; tutOn = false;
                   Render(); DumpRT(reflRT, "shot_title.png"); gs = keep; }
```
（`Render()` 内部按 gs 分发到 `DrawTitleScreen()`，所以这样能拿到标题页。）

### 别用 `rm -f shot_*` 清旧图
批量删除会被安全策略拦截并返回非零，`&&` 一短路后面的 `./game.exe` 就**不会执行**，
然后你会对着上一次的旧图反复分析。直接让程序覆盖同名文件，或改用 `mkdir -p _shots2`。

### 无头构建不调 `Zh_Flush()`，首帧会缺字
`Zh_Flush()` 只在 `#else`（非 HEADLESS）分支调用。无头出图时任何不在 `ZHTEXT` 预载表里的字
都会**永久**缺字（正式版只丢 1 帧，玩家无感）。对策：改文案后重跑 `gen_zhtext.py`
（会把全部源文件字符串字面量里的非 ASCII 字重新写进 `ZHTEXT`）。

### 出图前先看一眼坐标是不是"人看得见的"
本项目真实事故：鬼域结界与选中范围在 `BeginMode2D(cam)` 里用了 `x - camX`（屏幕坐标），
结果全画到屏幕外，**逻辑断言却全 PASS**。识别信号：世界层的剔除条件写成
`dx < -sr || dx > VW + sr`（拿着屏幕尺寸去比一个已经减过 camX 的值）。
出图后如果"该出现的东西没出现"，先检查这一条，别急着改美术。

## 增加新的验证帧
在 main.cpp 的 `#ifdef DEBUG_AUTO_SHOT` 块里按 fno（帧号，60fps）插入脚本：
- `if (fno == N) { ...设置状态... }` —— 可直接改 P.wood、craftOpen、hotbarOpen、gs、gameTime、调用 KillPlayer()/CraftMenu() 等。
- `if (fno == M) DumpRT(reflRT, "shot_xxx.png");` —— 状态设置后留 30~60 帧再导出，等动画/淡入稳定。
- 末帧 `if (fno >= END) { ...; break; }` 控制退出。

## 已有验证帧（fno → 文件）
540 深夜湖边传送(锁晴) / 600 深夜+光照图 / 606-615 夜间倒影分解(全开·仅月·仅星·全关) /
660 白天湖边传送 / 700 白天 / 740 开合成面板 / 800 合成页0七行 / 802-812 选中行切换 /
830 进 B3F 地牢 / 900 地牢 / 910 贴工作台 / 970 工作台页 / 980 环形栏 / 1040 环形栏 /
1046-1054 合成动画三阶段 / 1100 回地表满状态 / 1160 HUD / 1170 十槽环形栏 /
1240 血月夜 / 1290 树木碰撞测量 / 1300-1365 地牢进入过渡 / 1500 Boss / 1510 暂停 /
1530 死亡 / 1600 结束。

## 配套分析脚本（项目根目录）
- `verify_shots.py`   全量截图体检（亮度/暗部/色彩数；过渡黑幕图走"中心有文字"特判）
- `cmp_water.py`      水面天体倒影 A/B（默认白天，可传参对比夜间）
- `cmp_craftanim.py`  合成动画三阶段径向分布（验证材料由外向内收缩）
- `cmp_craftui.py`    合成面板 7 行布局与选中高亮跟随
- `check_zh.py`       中文字形覆盖校验；`gen_zhtext.py` 重建字表

## 调试开关
`dbgNoCelestial`（关日月/血月光柱）、`dbgNoStar`（关星辰倒影）—— 两者独立，
可在同一次运行里分离验证月光柱与星辰各自的贡献。

## 窗口版截屏（备选，仅在没有全屏独占程序时）
`snap_key.ps1 -VK @(0x09) -Out shot.png`：PostMessage 免焦点向 game.exe 窗口注键（VK：TAB=0x09 ESC=0x1B F=0x46 R=0x52），再截窗口。Valorant 全屏时不可用。
