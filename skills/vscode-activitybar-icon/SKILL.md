---
name: vscode-activitybar-icon
description: 做 VS Code 扩展的活动栏图标（viewsContainers.activitybar 的 icon）时，避免「扩展装了、容器也注册了，但活动栏看不见图标」。已解决：stroke 描边图标被 mask 吃掉、icon 路径写错、只画了描边没画填充、自检用字符串匹配抓不到。
agent_created: true
---

# VS Code 活动栏图标：为什么注册了却看不见

## 症状

扩展**已安装**、**已激活**、`viewsContainers` 声明正确、
`--list-extensions` 能看到、exthost.log 有激活记录 ——
**但活动栏就是没有那个图标**。

这种「全对但就是看不见」最容易让人怀疑是别的问题（Restricted Mode、
扩展没装、清单字段写错），实际上只需要改图标本身。

## 核心要求：必须是**实心剪影**，只认 `fill`

VS Code 对活动栏图标做 **mask 处理，只取 alpha 通道**。

```xml
<!-- ✗ 错：描边风格，细到 1.2px，被 mask 直接吃掉 -->
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="5" cy="5" r="2.4" stroke="currentColor" stroke-width="1.4"/>
  <path d="M6.6 6.6 L10.4 8.2" stroke="currentColor" stroke-width="1.2"/>
</svg>

<!-- ✓ 对：实心形状 + fill="currentColor" -->
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <g fill="currentColor">
    <circle cx="5" cy="5" r="3"/>
    <circle cx="12" cy="9.5" r="3"/>
  </g>
  <g fill="currentColor">
    <rect x="6.8" y="6.2" width="3.6" height="1.7" rx="0.85"
          transform="rotate(32 8.6 7.05)"/>
  </g>
</svg>
```

要点：
- **用 `fill="currentColor"`**，VS Code 会染色成当前主题的前景色
- **形状要有实心面积**，别靠细线
- **24×24**，viewBox 必写
- **必须有 `xmlns`**
- 至少 2~3 个图形元素，太简单会认不出来

连「连线」也要用**实心矩形 + transform 旋转**，而不是 `<path stroke>`：

```xml
<rect x="6.8" y="6.2" width="3.6" height="1.7" rx="0.85" transform="rotate(32 8.6 7.05)"/>
```

## 自检

```js
const svg = fs.readFileSync('media/activity-icon.svg', 'utf8');
ok('声明了 xmlns', /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(svg));
ok('有 viewBox', /viewBox\s*=/.test(svg));
ok('⭐ 有实际填充（只有 stroke 会渲染成空白）',
   /\bfill\s*=\s*["'](?!none)[^"']+/.test(svg));
ok('至少 2 个图形元素',
   (svg.match(/<(circle|rect|path|polygon|ellipse)\b/g) || []).length >= 2);
ok('用 currentColor（跟随主题）', /currentColor/.test(svg));
```

**再用无头浏览器看一眼渲染结果** —— 静态判定挡不住「有 fill 但面积太小」：

```js
const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#181818}
.box{width:48px;height:48px;background:#181818}
.box svg{width:24px;height:24px;display:block;margin:12px}
</style></head><body>
<div class="box">${svg.replace(/^<svg/, '<svg style="color:#C5C5C5"')}</div>
</body></html>`;
// --window-size=60,60 --screenshot=out.png
// PNG 明显小于 ~250 字节通常意味着画面接近空白
```

⚠️ Edge 不能并发跑（第二次 EBUSY）：串行 + 各自 `--user-data-dir` + 退避重试。
退避用的 `timeout.exe` 在沙箱里可能被拦，**要 try/catch 包住，失败也不能中断检查**。

## 其它会让图标消失的原因

| 原因 | 查法 |
|---|---|
| 图标路径不存在 | `fs.existsSync(path.join(ROOT, container.icon))` |
| 容器字段名写错 | 是 `activitybar`（小写 b），写成 `activityBar` 拿到 undefined |
| Restricted Mode | 见 `windows-bat-launcher` skill 的坑 4 |

**清单里的活动栏容器必须有 icon，否则 VS Code 拒绝注册**：

```js
ok('活动栏容器带了 icon', !!pkg.contributes.viewsContainers.activitybar[0].icon);
ok('icon 文件真实存在',
   fs.existsSync(path.join(ROOT, pkg.contributes.viewsContainers.activitybar[0].icon)));
```

## 写完清单后立刻核对字段名

```jsonc
"viewsContainers": {
  "activitybar": [        // ← 小写 b
    { "id": "myBar", "title": "My Bar", "icon": "media/icon.svg" }
  ]
}
```

`"icon"` 是**相对扩展根目录**的路径，不是相对 `media/`。
