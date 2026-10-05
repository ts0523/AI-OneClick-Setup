---
name: vscode-webview-verify
description: 无头验证 VS Code 扩展 webview 的界面与交互，产出截图与断言结果。当需要「截图看看 webview 长什么样」「验证扩展的 webview 能不能跑」「webview 点了没反应怎么排查」「给扩展写无头测试」时使用。已解决：webview 不能直接开、CSS 要内联、__STATE__ 会被覆盖、script 段污染正则、Edge EBUSY、id 缺失导致全盘失效。
agent_created: true
---

# VS Code webview 无头验证

VS Code 扩展的 webview 无法脱离 VS Code 直接打开，但**完全可以脱离 VS Code 验证**——
把它当成一个普通网页，造一个自包含测试页丢进无头浏览器。
本 skill 给出可直接复制的两个测试台（渲染层 / 交互层）。

## ⭐⭐ 第 0 步：先核对 API 真的存在（能省掉几小时的运行时炸）

**在被要求做任何验证之前，先做这件事。**
曾凭印象写了 `vscode.window.createWebviewView()`，运行时报
`createWebviewView is not a function`，而**语法检查、静态检查、无头渲染、交互测试全都能过**。

### 查证方法

VS Code 自带权威类型定义，路径是：

```
<VSCode>/<commit>/resources/app/out/vscode-dts/vscode.d.ts
本机实例：D:/Microsoft VS Code/07f806f999/resources/app/out/vscode-dts/vscode.d.ts
```

⚠️ **commit 目录（`07f806f999`）在 `resources` 之上，是 VSCode 的一级子目录**，
不是 `resources/app/out` 下面的子目录。写查找逻辑时别找反了
（我第一次就找反了，白跑一轮）。

```bash
# 列出全部 webview 相关 API
grep -E "export function \w*[Ww]ebview" vscode.d.ts
```

### webview API 实际只有三个

| API | 用途 |
|---|---|
| `registerWebviewViewProvider(viewId, provider, options?)` | **侧边栏**（活动栏视图） |
| `createWebviewPanel(viewType, title, showOptions)` | 编辑器标签页 |
| `registerWebviewPanelSerializer(viewType, serializer)` | 恢复已关闭的面板 |

**没有 `createWebviewView`。** 写完代码后用这段自检兜底：

```js
const dts = fs.readFileSync(dtsPath, 'utf8');
const used = [...new Set([...ext.matchAll(/\bvscode\.(\w+)\.(\w+)\s*\(/g)].map(m => m[1]+'.'+m[2]))];
for (const full of used) {
  const api = full.split('.')[1];
  const exists = new RegExp('export (function|const|class|enum) ' + api + '\\b').test(dts)
    || new RegExp('\\b' + api + '\\s*[:(]').test(dts);
  ok('API 存在: ' + full, exists);
}
```

### ⭐ provider 模式 = 懒加载，`view` 会是 null

`registerWebviewViewProvider` 的 provider 是**懒加载**的：
只有用户真的点开那个视图，`resolveWebviewView` 才被调用。
**⇒ `activate()` 之后到用户点开之前，模块级 `view` 变量一直是 `null`。**

所以**每一次往 webview 发消息都必须判空**：

```js
function postState() {
  if (!view) return;                 // 判空
  try { view.webview.postMessage(...); } catch (e) { /* 正在销毁 */ }
}
```

流式回调里最容易漏，因为它在异步回调中，
`view.webview.postMessage` 抛的 TypeError 会**把整个请求打断**：

```js
const push = (m) => { if (!view) return; try { view.webview.postMessage(m); } catch (e) {} };
```

写自检检查这类保护时，**别只按行首匹配**——安全写法常常是
`if (view) await view.webview.postMessage(...)`（同行判空）
或 `if (!view) return;`（前一行判空），两种都要认。

## 核心认知

**webview 就是一段 HTML**，它依赖 VS Code 注入的只有三样东西：
1. CSS 变量（`--vscode-*`）用于配色
2. `acquireVsCodeApi()` 用于收发消息
3. 资源以 `vscode-resource:` 协议加载

把这三样在测试页里 mock 掉，就能在浏览器里完整跑起来。

## 六个必踩的坑

| 坑 | 症状 | 正解 |
|---|---|---|
| **没内联 CSS** | 排版全错（tab 竖排、没有 flex），误判成布局 bug | 把 `main.css` 读出来内联进 `<style>` |
| **预置 `window.__STATE__`** | 数据被 app.js 启动代码覆盖 | 脚本加载完后 `dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}))` |
| **没剥 `<script>` 段** | 源码里的 `class="gnode '"` 被正则当成真节点，计数虚高 | `dom.replace(/<script[\s\S]*?<\/script>/g,'')` 之后再统计 |
| **断言 `display:flex`** | 永远 false | Edge 把 style 抽进 CSSOM，HTML 里查不到；**改用截图肉眼确认** |
| **Edge 并发** | 第二次 `EBUSY` | 串行执行 + 各自 `--user-data-dir` + 退避重试 3 次 |
| **没有 error 捕获** | 脚本挂了只看到「没结果」 | `window.addEventListener('error',e=>__ERR__.push(...))`，结果一起落进 DOM |

## 渲染层测试台骨架

```js
const fs=require('fs'), path=require('path'), {execFileSync}=require('child_process');
const MEDIA='<项目>/media', OUT='<项目>/.verify';
fs.mkdirSync(OUT,{recursive:true});

// 1) mock VS Code 主题变量（必须给全，否则深色下看不清）
const VARS=`:root{
--vscode-foreground:#1f1f1f;--vscode-editor-background:#fff;
--vscode-sideBar-background:#f5f5f5;--vscode-panel-border:#d4d4d4;
--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;
--vscode-button-border:transparent;--vscode-button-secondaryBackground:#e8e8e8;
--vscode-button-secondaryForeground:#1f1f1f;--vscode-input-background:#fff;
--vscode-input-foreground:#1f1f1f;--vscode-input-border:#c8c8c8;
--vscode-list-hoverBackground:#e8f2fb;--vscode-focusBorder:#005fb8;
--vscode-editorWidget-background:#fff;--vscode-textCodeBlock-background:#f3f3f3;
--vscode-editorInfo-foreground:#378add;--vscode-editorWarning-foreground:#a85b00;
--vscode-font-family:"Segoe UI","Microsoft YaHei",sans-serif;
--vscode-editor-font-family:Consolas,monospace;}`;

// 2) 中文种子数据必须转 \uXXXX，不能用 base64（atob 是 Latin-1，中文全乱码）
const toAsciiJson=o=>JSON.stringify(o).replace(/[-￿]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

// 3) 组页：VARS + main.css + index.html 内联 + 三个脚本内联 + 启动派发
let page='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
 +'<style>'+VARS+'</style><style>'+css+'</style></head><body>'+bodyHtml
 +'<script>'+graphjs+'</script><script>'+panelsjs+'</script><script>'+appjs+'</script>'
 +'<script>window.addEventListener("load",function(){'
 +'window.dispatchEvent(new MessageEvent("message",{data:{type:"state",state:'+toAsciiJson(state)+'}}));'
 +'window.App.renderAll();window.App.fitToScreen();'
 +'});</script></body></html>';

// 4) 串行跑 Edge：先截图再 dump-dom，各自独立 profile
function runEdge(args){
  for(let i=0;i<3;i++){
    try{ return execFileSync(EDGE,args,{encoding:'utf8',maxBuffer:64*1024*1024,
      stdio:['ignore','pipe','pipe'],timeout:90000}); }
    catch(e){ if(i===2) return '';
      execFileSync('C:/Windows/System32/timeout.exe',['/t','2','/nobreak'],{stdio:'ignore'}); }
  }
}
runEdge(['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
  '--window-size=1500,950','--virtual-time-budget=4000',
  '--user-data-dir='+OUT+'/p1','--screenshot='+OUT+'/s.png',url]);
const dom=runEdge(['--headless=new','--disable-gpu','--no-sandbox',
  '--virtual-time-budget=4000','--user-data-dir='+OUT+'/p2','--dump-dom',url]);
```

## 交互层测试台骨架

在渲染层基础上加三样东西：

```js
// 1) 错误落进 DOM
window.__LOG__=[]; window.__ERR__=[];
window.addEventListener('error',e=>window.__ERR__.push(e.message+' @'+(e.lineno||'?')));

// 2) reset() 前置 —— ⭐ 最容易造成「假失败」的一环
function reset(){
  var root=window.__STATE__.graph;
  var exp=window.GraphEngine.expandToDepth(root,3); exp.add(root.id);
  window.App.state.expanded=exp;
  window.App.state.query='';
  window.App.state.showSubviews=true;
  window.App.renderGraph();
}

// 3) ⭐ 每次 renderGraph 都会重建 SVG 节点，旧引用立刻失效。
//    每一步都必须重新 query，不能把上一步的元素存着复用。
var el=document.querySelector('.gsubview[data-view="note"]');
if(el) el.dispatchEvent(new MouseEvent('click',{bubbles:true}));

// 4) 结果落进 DOM
var box=document.createElement('div'); box.id='__RESULTS__';
box.textContent=JSON.stringify(window.__LOG__); document.body.appendChild(box);
```

## 断言数据来源要「真」

不要用假数据造测试页——**直接 require 扩展的真实数据层**：

```js
const { scanWorkspace, annotate } = require('<项目>/lib/scanner.js');
const scan = scanWorkspace(target, { exclude: [], maxFiles: 4000 });
annotate(scan.nodes[0]);
```

这样测的是真实数据结构，而不是「我以为的数据结构」。

## ⭐⭐ 静态自检必须拦的一类 bug

`bind()` 里引用一个不存在的 id → 抛异常 → **后面所有监听器都没绑上**
→ 整个界面变成死的、点了没反应。**语法检查和编译全都通过，只有交互层能抓到。**

两条对策，都要写：
1. 产品侧：所有绑定走安全包装，元素缺失只跳过这一个
   ```js
   function on(id, ev, fn){
     const el=document.getElementById(id);
     if(!el){ console.warn('元素不存在，跳过绑定：'+id); return false; }
     el.addEventListener(ev,fn); return true;
   }
   ```
2. 自检侧：校验每个 `getElementById` 的 id 都有出处
   ```js
   const htmlIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
   const panelIds=new Set([...panels.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
   for(const id of appIds) ok('id 有出处:'+id, htmlIds.has(id)||panelIds.has(id));
   ```
   ⚠️ 面板内容是运行时 `innerHTML` 生成的，`noteText`/`chatInput` 这类 id
   **只存在于 panels.js 产出的 HTML 里**，所以要同时查两个来源。

**验证自检本身有效**：故意注入一个已知 bug 跑一遍，确认能报出来。

## SVG / webview 布局三个通用坑

1. **svg 固定 `height:100%` 会裁掉超出内容且滚不动**。
   `#wrap{overflow:auto}` + JS 设 `svg` 的 `width/height/viewBox` = 内容尺寸×缩放+pan。
2. **`fitToScreen` 别把高度也当约束**。树纵向长、容器比它高时会被压到 20%。
   只按宽度适配 + 夹下限（如 0.55），纵向靠滚动。
3. **容器能滚之后别再劫持滚轮**：`if(!e.ctrlKey) return;` 交给容器滚。

## 检查清单

- [ ] **API 名字在官方 vscode.d.ts 里真的存在**（第 0 步，最容易漏也最致命）
- [ ] 侧边栏用 `registerWebviewViewProvider`（不是不存在的 `createWebviewView`）
- [ ] 每次 `view.webview.postMessage` 前都判空了
- [ ] CSS 内联了吗
- [ ] 用 `MessageEvent` 派发数据，不是预置全局
- [ ] 断言前剥了 `<script>`
- [ ] Edge 串行 + 独立 profile + 退避重试
- [ ] `window.addEventListener('error')` 落进 DOM
- [ ] 交互层每段有 `reset()` 前置
- [ ] 每步重新 query 元素，不用旧引用
- [ ] 种子数据来自真实数据层
- [ ] 静态自检校验了 id 出处
- [ ] 注入 bug 验证过自检有效
- [ ] 截图肉眼确认过（样式类问题只能看图）
