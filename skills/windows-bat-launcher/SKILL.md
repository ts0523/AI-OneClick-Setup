---
name: windows-bat-launcher
description: 写 Windows .bat 启动器/安装脚本时避开 cmd 的 quoting、start、CRLF 三大坑，并给出能静态验证的自检项。当需要「做个一键启动脚本」「双击 .bat 报错找不到文件」「.bat 里路径带空格出问题」「bat 里带空格的命令行被截断」时使用。已解决：找不到 \Code.exe（变量空 + Code.exe 不认 CLI 参数）、start 吃掉引号、裸 LF 导致整文件当一行、start "标题" 参数被误当命令、set /a 立即展开。
agent_created: true
---

# Windows .bat 启动器：三个致命坑

`.bat` 是个人人都能写、但**错了只在双击时才暴露**的文件。
本 skill 把「能静态检查出来」的部分变成断言，并给出可靠的写法。

## 坑 1：必须是 CRLF + 纯 ASCII

编辑器默认写 **裸 LF**。cmd 遇到 LF 会把整份文件当一行解析，
于是 `set "VSDIR=..."` 根本没生效，后面 `if not exist "%VSDIR%\Code.exe"`
拿到空串，报错长这样：

```
Windows 找不到文件 "\Code.exe"。
```

**注意盘符位置是空的，只剩一个反斜杠** —— 这是「变量为空」的特征信号，
不是「路径写错了」。

文件是 UTF-8 无 BOM 时，cmd 按 GBK 解码，中文注释显示乱码
（不影响执行，但让人以为文件坏了）。

**可靠写法**（用 node 写，别用编辑器）：

```js
const CRLF = '\r\n';
const lines = ['@echo off', 'setlocal', 'echo hello', 'endlocal', ''];
fs.writeFileSync('x.bat', Buffer.from(lines.join(CRLF), 'latin1'));
// 'latin1' 保证写入的是纯 ASCII 字节，且不会引入 BOM
```

## 坑 2：`start` 会重新解析命令行，把引号吃掉

```bat
rem ✗ 错：start + ^ 续行 + 带空格路径
start "My App" "D:\Microsoft VS Code\bin\code.cmd" ^
  --user-data-dir "C:\Users\me\AppData\Local\X" ^
  --new-window "D:\my project"
```

`start` 不是「后台运行」，它会**把整条命令行重新拼一遍再解析**。
碰到 `^` 续行 + 带空格路径，引号就断了，报错是一个**被截断的路径**
加上一个游离的单引号：

```
D:\Microsoft' 不是内部或外部命令，也不是可运行的程序。
```

**正解：用 `call` 直接调用，不加 `start`、不换行。**

```bat
rem ✓ 对：单行 + call
call "%CODECMD%" --user-data-dir "%USERDATA%" --extensions-dir "%EXPDIR%" --new-window "%APPDIR%"
```

`call` 保持引号原样；`code.cmd` 交出窗口后就返回，控制台会自己关掉。

### 顺带一个 `start` 的老坑
`start "标题" "命令" 参数` —— **第一个带引号的参数是窗口标题**。
写 `start "" "路径"` 才安全；省掉标题而路径含空格时，路径会被当标题，
命令静默失效，连报错都没有。

## 坑 3：`set /a` 的立即展开

```bat
set /a N=0
for /d %%D in ("%DIR%\*") do set /a N+=1
if %N% GTR 5 echo many     rem ✗ 若上面在括号块里，这里拿到的是旧值
```

`%N%` 在**解析该行时**就展开了。同一括号块内 `set /a` 赋的值，
在 `if` 里读到的还是块外那个旧值。
⇒ 比较语句要么放在块外，要么用 `setlocal enabledelayedexpansion` + `!N!`。

## 启动成功检测：不能只判「目录存在」

```bat
rem ✗ 错：上次运行留下的目录会让检查永远通过
if exist "%USERDATA%\logs" echo started
```

VS Code / Chrome 这类程序每次启动会新建一个时间戳目录。
正确做法是**比对启动前后的数量**：

```bat
set /a LOGSBEFORE=0
for /d %%D in ("%USERDATA%\logs\*") do set /a LOGSBEFORE+=1

call "%CODECMD%" --user-data-dir "%USERDATA%" ...

timeout /t 10 /nobreak >nul

set /a LOGSAFTER=0
for /d %%D in ("%USERDATA%\logs\*") do set /a LOGSAFTER+=1
if %LOGSAFTER% GTR %LOGSBEFORE% goto :started
echo [WARN] did not start
pause
exit /b 1
:started
echo ok
```

## 顺带：VS Code 不能用 Code.exe 启动独立实例

| 入口 | 能否接 `--user-data-dir` |
|---|---|
| `Code.exe` | ✗ 它是 GUI 程序（MZ 头），不认 CLI 参数 |
| `bin\code.cmd` | ✓ 它转调 `resources/app/out/cli.js` |

所以启动独立实例必须用 `bin\code.cmd`。

## ⭐⭐ 坑 4：Restricted Mode —— 扩展「装了但不激活」

**这是最难查的一个**，因为扩展代码完全正确、VS Code 也正常启动了。

### 症状
- VS Code 正常打开，扩展也装好了（`--list-extensions` 能看到）
- **但活动栏没有扩展的图标**
- **exthost.log 里完全查不到该扩展的激活记录**
- 顶部挂着黄色横幅：`Restricted Mode is intended for safe code browsing`

### 原因
**全新的 profile 首次打开任何文件夹都会进 Restricted Mode（受限模式），
而 VS Code 在受限模式下不激活扩展的工作区功能。**

### 正解
启动时往 `<user-data-dir>/User/settings.json` 写：

```json
{
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none"
}
```

- `security.workspace.trust.enabled: false` —— 关掉工作区信任。
  这个实例只打开你自己指定的目录，不存在运行陌生代码的风险。
- `workbench.startupEditor: none` —— 否则 Welcome 标签页每次都盖在工作台上。

**为什么启动器要每次重写这个文件**：清过缓存、换机器、换 VS Code 版本都可能让它丢失，
而症状（图标不见了）完全指不出原因。每次重写最省事。

### ⚠️ 顺带一个坑：`OutputChannel` 的名字别用中文
`createOutputChannel('Agent 图谱')` 在 bat 里排查时不好打，
建议英文（`Agent Graph`）。另外 OutputChannel 内容**不进日志文件**，
只在用户点开输出面板时落盘 —— 所以别指望从 logs 里读到它。

### ⚠️ 排查时用日志，别只看进程活着
VS Code 默认**不记录扩展激活**到 exthost.log（只有 error 级别）。
想确认扩展有没有跑，看 exthost.log 里有没有这一行：

```
ExtensionService#_doActivateExtension <publisher>.<name>, activationEvent: '...'
```

有就是激活了；没有就是根本没加载（先查 Restricted Mode，再查装没装）。

## ⭐⭐ 坑 4：`echo` 里的 `>` 会真的创建文件

**用箭头符号写提示文字时踩的**，而且它**每次运行都发生**，很隐蔽。

```bat
rem ✗ 错：`>` 被 cmd 当成输出重定向
echo   1. Restricted Mode banner at the top  -> settings.json was not written
```

cmd 解析成：把箭头**前**那半句输出到文件 `settings.json`，
箭头**后**的 `settings.json was not written` 当成另一条命令。

实测后果：项目根目录多出 `settings.json` / `run` / `shows` 三个垃圾文件，
内容正是「箭头前那半句」，时间戳与启动时刻一致。

**改成 `=>` 一样坏** —— cmd 只认 `>` 这一个字符，前面是什么无所谓。
⇒ **提示文字里彻底不用任何含 `>` 的写法**，改成冒号或纯文字。

```bat
echo   1. Restricted Mode banner at top, means settings.json was not written
```

### 排查这类问题的诀窍

**看项目根目录多出来的文件**。如果 bat 里有重定向错误，
会在「当前工作目录」留下奇怪的文件，而且内容往往就是命令的前半句。
文件内容 + 时间戳 = 精确的罪证。

### 自检项

```js
const echoLines = cmds.filter((l) => /^\s*echo\s/i.test(l));
const bad = echoLines.filter((l) => /[<>]/.test(l));
ok('echo 行里不含 > 或 <', bad.length === 0, bad.join(' | '));
```

`rem` 注释里的 `>` 无害（`rem` 之后 cmd 不做重定向解析），所以只查 `echo` 行。

合法的 `>` 只有两类：写文件（`>"%VAR%" echo ...`）和 `timeout ... >nul`。

## 静态自检清单

`.bat` 没法在很多沙箱里直接跑，所以这些必须写成断言：

- [ ] 行尾全是 CRLF，裸 LF 计数为 0
- [ ] 纯 ASCII（无非 ASCII 字节、无 BOM）
- [ ] **echo 行里没有 `>` 或 `<`**（会真的创建垃圾文件）
- [ ] 每行引号成对；圆括号成对
- [ ] 每个 `%VAR%` 都有对应的 `set`（**`set "X="` 和 `set /a X=` 两种都要认**）
- [ ] `goto :label` 的目标 label 存在
- [ ] **没有 `start` 包住带参数的命令**
- [ ] **没有 `^` 续行**（至少不在启动命令附近）
- [ ] 启动用的变量能**回溯到它的 `set` 赋值**（别只搜文件里有没有某个字样）
- [ ] 每个 CLI 参数值都带引号（路径含空格）
- [ ] 没用 `2>nul | find` 这类脆弱管道
- [ ] 成功检测是「数量变多」而非「目录存在」
- [ ] **写了 `security.workspace.trust.enabled: false`**（否则扩展不激活）
- [ ] **bat 拼出的 settings.json 用 `JSON.parse` 验过是真 JSON**
      （取写入行时只认 `^\s*>+\s*"?%SETTINGS%"?\s+echo`，
        别把 `echo Settings : ...` 这种显示行也抓进去）

### ⭐ 判定必须回溯变量，不能只搜字符串

我踩过：检查写成 `raw.includes('bin\\code.cmd')`，
注入 bug 把 `CODECMD` 从 `%VSDIR%\bin\code.cmd` 改成 `%VSDIR%\Code.exe` 后，
**检查全过** —— 因为定位那行还写着 code.cmd，只是启动用的变量被改了。

正确做法：

```js
function resolveVar(name, seen = new Set()) {
  if (seen.has(name)) return name;
  seen.add(name);
  for (const l of lines) {
    const m = new RegExp('^set "' + name + '=(.*)"\\s*$').exec(l);
    if (!m) continue;
    const val = m[1];
    const ref = /%(\w+)%/.exec(val);
    if (ref && ref[1] !== name) return val.replace(ref[0], resolveVar(ref[1], seen));
    return val;
  }
  return null;
}
```

## 写 node 脚本生成 .bat 时的自坑

在 JS 数组里写 bat 注释时，**英文名的撇号要转义**，否则自己先挂：

```js
'rem      D:\Microsoft\' is not recognized'   // ✗ SyntaxError
'rem      it is not recognized'                // ✓ 换个说法
```

`'\r\n'` 在 `node -e` 里会被 shell 吃掉 → **一律 Write 成 .js 文件再跑**。
