---
name: bundle-string-patch
description: 安全地修改压缩后的 JS bundle 里的界面文案（汉化/改词），用于 Cursor、VS Code、Electron 等把代码编译进单个大 JS 文件的程序。当用户要求"汉化 XX 软件界面""改 XX 的按钮文字""把 XX 界面改成中文"且目标不是扩展而是产品本体时使用。已解决：全局字符串替换导致白屏（Agent 出现 12540 次是变量名不是文案）、正则多捕获组错位生成坏代码、node --check 对大文件给假警报、占位符 {x} 与 ${} 混淆。
agent_created: true
---

# bundle-string-patch — 安全修改压缩 bundle 里的界面文案

改 minify 后的 JS bundle 里的界面文案，**默认会搞崩程序**。本文的每条规则都来自一次真实事故。

## 铁律：绝不能全局字符串替换

同一个英文词在 bundle 里有**两种身份**：

```js
children:"View Changes"        // UI 文本 → 可以翻
debugRerun(){...}              // 方法名 → 碰了白屏
"--vscode-inlineChat-border"   // CSS 变量 → 改了样式全丢
r[r.Failed=1]="失败"             // 枚举：左键是代码，右值才是文本
```

实测数据（Cursor 43MB bundle）：

| 词 | 出现次数 | 真实身份 |
|---|---|---|
| `Mode` | 18195 | 绝大多数是变量名 |
| `Agent` | 12540 | 同上 |
| `Plan` | 1751 | 同上 |
| `View Changes` | 3 | 3 处全是 UI 文本 |

**判据**：出现次数越多，越可能是标识符。UI 文案通常个位数。

## 三种安全形态（只改这些）

真正的 UI 文案只以这三种形式出现：

```js
// 1. UI 属性后面
children:"Text"   label:"Text"   title:"Text"   placeholder:"Text"
aria-label:"Text" message:"Text" tooltip:"Text"  description:"Text"

// 2. 本地化查表包装（Cursor 特有，wt = 查表函数）
wt(1234,"Text")

// 3. 对象/数组里的裸字符串
{title:"Text"}   ["Text","Text2"]
```

对应的正则（**关键：整个正则只能有 1 个捕获组**）：

```js
new RegExp(
  '(?<![-.\\w$])' +                       // 排除 CSS变量/方法调用/标识符片段
  '(?:(?:children|label|title|placeholder|description|message|aria-label|tooltip)\\s*:\\s*' +
  '|wt\\(\\d+\\s*,\\s*' +
  '|,\\s*)' +
  '(["\\\'\\])' + escapeRe(text) + '\\1' +  // ← 唯一的捕获组：引号
  '(?![\\w\\u4e00-\\u9fa5])',              // 后面不能接更长标识符
  'g'
);
// 替换：out.replace(re, (m, quote) => quote + zh + quote)
```

## 三个真实踩过的坑

### 坑 1：多捕获组错位 → 坏代码

```js
// ✗ 错误：三个分支各自带组，组号因分支而异
(keys + ')\\s*:\\s*(["\'])' + T + '\\1'   // group 2
'wt\\(\\d+,\\s*(["\'])' + T + '\\1'       // group 4  ← 错位！
```

症状：生成了 `title:"接受" selected action"` —— 字符串提前闭合，语法崩。

修法：把位置约束放进**非捕获组** `(?:...)`，只留一个真捕获组给引号。
反向引用编号也随之变化（引号变成 group 1，收尾就要写 `\1` 而不是 `\2`）。

### 坑 2：`node --check` 对大文件是假警报

```js
// 43MB 文件实测
spawnSync(node, ['--check', file])  // → status === null（解析器直接放弃）
// 但 stderr 里会给出看起来很真的 SyntaxError
```

**这是假警报。** 超过约 30-40MB 后 Node 解析器会放弃，给出的错误毫无意义。

替代方案：逐行 diff，只校验**实际改动的那些行**。

```js
const A = before.split('\n'), B = after.split('\n');
for (let i = 0; i < A.length; i++) {
  if (A[i] === B[i]) continue;          // 只看改动行
  if (quoteState(A[i]) !== quoteState(B[i])) problems.push(i);
}
function quoteState(s) {   // 返回 {n: 引号数, open: 未闭合的引号}
  let n = 0, open = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (open) { if (c === open) open = null; continue; }
    if (c === '"' || c === "'") { open = c; n++; }
  }
  return { n, open };
}
```

替换只发生在引号**内部**，不可能动引号本身，所以引号配对一致 = 安全。

### 坑 3：占位符形式

原文常是模板字符串：

```js
`New Agent in ${rs}`        // ← 反引号 + ${变量}
```

| 译文写法 | 结果 |
|---|---|
| `'在 {x} 中新建'` | ✗ 显示字面量 `{x}` |
| `` `在 ${rs} 中新建` `` | ✓ 正确 |

单独写一条模板字符串规则，不要和普通字符串混在同一个正则里：

```js
const re = /`([^`\\]*?)New Agent in\s*\$\{([^}]+)\}([^`]*)`/g;
out.replace(re, (m, pre, varName, post) => '`在 ${' + varName + '} 中新建`');
//                                        ↑ 复用原文的变量名，不要自己编
```

还要审计 `{0}` `{1}` 这类格式化占位符：

```js
const ph = s => (s.match(/\{[0-9]+\}/g) || []).sort().join(',');
if (ph(en) !== ph(zh)) console.warn('占位符不一致:', en);
```

## 强制工作流程

```
1. 探明结构      → 文案到底在哪个文件？走的是哪套本地化机制？
2. 全量抽取      → 先把候选文案抓出来看，别急着改
3. 上下文取证    → 打印每个词周围的 40 字符，确认是 UI 文本还是标识符
4. 干跑 + 人工过目 → 只报告不改文件
5. 内存演练      → 在内存里跑替换 + 结构校验，不落盘
6. 备份          → 复制一份 .bak
7. 带安全网写入   → 校验不过就放弃写回，绝不写坏文件
8. A/B 对照验证   → 改前后各启动一次，对比退出码
```

## 验证：退出码判断崩溃

```
退出码 = 0   → 正常退出（哪怕进程数是 0，也不一定是崩溃，可能是沙箱无桌面会话）
退出码 ≠ 0   → 崩溃，语法/结构坏了，立刻回滚
```

## ⚠️ A/B 对照实验的致命缺陷（2026-10-04 真实踩坑）

**不要用「自己启动程序看退出码」来验证。**

真实案例：改完 bundle 后 Cursor 白屏。做了 A/B 对照——

| 条件 | 退出码 | 进程数 |
|---|---|---|
| 改后 | 0 | 0 |
| 还原后 | 0 | 0 |

我据此得出"与汉化无关"。**这个结论是错的。**

错在哪：`exit=0` **不等于正常运行**。渲染进程崩溃时主进程照样返回 0。
更致命的是——**在无桌面会话的自动化环境里，两种情况都是"启动即退"，
对照实验毫无区分力**，它证明不了任何事。

### 正确做法：直接读产品自己的日志

```bash
# VS Code / Cursor / Electron 类产品
ls ~/AppData/Roaming/<Product>/logs/            # 按时间戳分目录
# 重点看这个（渲染进程=webview/界面，真出问题会记在这里）
<最新时间戳>/window*/renderer.log
<最新时间戳>/main.log
# 崩溃报告
~/AppData/Roaming/<Product>/Crashpad/reports/
```

判读要点：

- `renderer.log` 里**没有** SyntaxError / Uncaught → bundle 没崩，别再怀疑语法
- 满屏 `Transport down` / `No Connect transport provider` → **网络问题，不是你的补丁**
- `freeMemory=6.4%` 这类行 → 内存耗尽，界面停在白屏
- `Crashpad/reports/` 有 dmp 文件 → 真崩了

同时查系统资源：

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object @{n='总内存GB';e={[math]::Round($_.TotalVisibleMemorySize/1MB,2)}}
# 可用内存 / 页面文件使用率 / 进程总数
```

**内存不足 + Electron = 白屏**，且不产生任何崩溃日志。
遇到"界面一片空白"先查可用内存，再查网络，最后才怀疑自己改的文件。

## ⚠️ 先统计原生覆盖率（可能让整件事作废）

动手改之前，**先看目标文件里已经有多少目标语言**：

```js
const s = fs.readFileSync(target, 'utf8');
console.log('现有汉字数:', (s.match(/[\u4e00-\u9fa5]/g) || []).length);
```

2026-10-04 的实测教训：Cursor 3.22.12 的 bundle 里**原生已有 12796 个汉字**，
`新建智能体` 57 处、`已复制` 21 处、`更多操作` 4 处都在其中。
我辛苦 patch 出 244 处替换，**真正新增的只有 `查看更改` 3 处**。

⇒ 官方在持续汉化，patch 私有 bundle 追不上、收益极小、风险很高。
**动手前先算这笔账，别做无用功。**

## 恢复

```bash
cp <file>.zhbak <file>     # 还原
```

还原后必须验证真的还原了：

```js
const a = fs.readFileSync(f), b = fs.readFileSync(f + '.zhbak');
console.log('已完全还原:', a === b);
console.log('字节数:', Buffer.byteLength(a, 'utf8'));   // 别信 ls 的数字，那是 GBK 显示值
```

升级产品后补丁失效，重新跑一次即可。词表失效（提示"未匹配"）说明 UI 文案变了，需重新抽取。

## 通用检查清单

写文件**之前**：

- [ ] **统计目标文件里已有的目标语言字符数**（可能直接让整件事作废，见上）
- [ ] 词典里每个词都用 `indexOf` + 打印上下文核对过，是 UI 文本不是标识符
- [ ] 正则只有一个捕获组，反向引用编号正确
- [ ] 占位符 `${}` / `{0}` 全部原样保留（跑一遍审计脚本）
- [ ] 危险样本检查：`debugXxx` / `xxxInput1` / `--css-var` / `moduleName` 仍完好
- [ ] 目标文件编码是干净 UTF-8，无 BOM 损坏
- [ ] 备份已生成
- [ ] 目标程序**已完全退出**（任务管理器确认无残留进程）

写文件**之后**：

- [ ] 读 `logs/<最新时间戳>/window*/renderer.log` —— 确认没有 SyntaxError
- [ ] 查系统可用内存（低于 20% 就会白屏，与你的改动无关）
- [ ] 真实桌面环境下肉眼确认界面
- [ ] 准备一键还原：`node <script>.js --revert`
