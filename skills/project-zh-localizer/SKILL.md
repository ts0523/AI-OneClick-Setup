---
name: project-zh-localizer
description: 项目一键多语本地化工具链，**五语（zh-CN / en / ja / ko / fr）任意双向互译**。抓取 HTML/JS/TS/Vue/Svelte/JSON/PO/properties/ARB/Android XML/YAML/CSV/Markdown 及 py/java/cs/go/rs/php 源码中的用户可见文案，提供 a/b/c/d 四档翻译精准度（a=词典直译，b=AI 逐批翻译，c=批量程序校验，d=AI 抽样复核），并支持**单机离线模式**（内置五语词典 + 规则，零网络零 AI）、**Web 专项审计**（i18n 框架识别、<html lang> 同步、canvas UI 清单）、译文写回前自动校验占位符/引号/术语一致性，并按文字显示宽度比自适应调整 UI 尺寸（宽度/内边距），同时严格保持字体族、控件类型、DOM 结构不变。当用户要求"汉化项目""翻译整个项目""多语互译""本地化 L10n""UI 翻译后适配""离线翻译"时使用本技能。
agent_created: true
---

# project-zh-localizer — 项目一键多语本地化（中英日）

对整个项目做语言本地化：抽取用户可见文案 → 翻译 → 校验 → 写回 → UI 自适应。
**方向可换**：`scan --from en --to zh-CN`（默认，英→中）、`--to ja`（英→日）、`scan --from zh --to en/ja`（中→英/日），整条流水线对称复用。

## 核心约束（每次都要守住）

1. **只翻用户可见文案**。代码标识符、className、资源路径、URL、颜色值、i18n JSON 的 key 一律不动。
2. **字体族（font-family）、控件类型（button 还是 button、input 还是 input）、DOM 结构与 class 一律不变**。UI 适配只调尺寸类数值（宽度/内边距/行高/必要时 font-size），并只按文字长度比扩，不重构。
3. **写回前必须备份**。原文件自动备份到 `<root>/.loc/backup/`，回滚 = 复制回来。
4. **占位符/引号安全**。译文必须保住 `{xxx}` `%s` `${}` `<b>` `&amp;` 等占位符和原引号风格；校验不过的条目不写回。
5. **AI 档位（b/c/d）会把源码文案发给第三方模型**。涉密或未公开项目改用 `polyglot.py offline` 单机模式；用 AI 档前先告知用户"哪些文本会被外发"。
6. **交付/开源前删掉 `<项目>/.loc/`**。`backup/` 里有原文全量副本，`strings.json` 里有全部文案，打包时会一起带走。

## 增强层 polyglot.py（五语 / 多格式 / Web / 单机）

`loc.py` 负责抓取·校验·写回·UI 适配，`polyglot.py` 负责语言、格式、Web 与单机翻译。
**两个脚本配合用，不要只用一个。**

```bash
PY="<python.exe 路径>"
POLY="<技能库>/project-zh-localizer/scripts/polyglot.py"

"$PY" -u "$POLY" --root <项目> langs                       # 看支持的语言与宽度倍率
"$PY" -u "$POLY" --root <项目> webaudit                    # Web 专项体检（先跑这个）
"$PY" -u "$POLY" --root <项目> pipeline --from en --to fr --mode offline   # ★ 一键全包
"$PY" -u "$POLY" --root <项目> bridge extract               # 资源文件（po/properties/arb/xml/csv/yaml）抽取
"$PY" -u "$POLY" --root <项目> bridge apply                 # 译文按 key 写回原格式
"$PY" -u "$POLY" --root <项目> export --fmt po --out out.po # 导出给人/第三方翻
"$PY" -u "$POLY" --root <项目> import --file out.po          # 翻完回填
"$PY" -u "$POLY" --root <项目> uifit --to ja --max-expand 2.2
```

### 五语互译

`zh-CN / en / ja / ko / fr` 任意 `--from A --to B`（A≠B）。词典以 en 为枢轴 + 直查列，
**任意两语互译都成立**（实测：同一份英文 UI 分别译出中/日/韩/法，覆盖率 93%，`<html lang>` 同步改写）。

宽度倍率（相对英文，UI 扩容预判用）：中 0.62 / 日 1.35 / 韩 1.25 / 法 1.28。
日语与法语**必然触发扩容**，`--max-expand` 提到 2.2，verify 用 `--max-ratio 3.0`。

### 单机模式（零网络、零 AI）

```bash
"$PY" -u "$POLY" --root <项目> offline --from en --to ja --strict --min-coverage 0.7
```

纯内置词典（`assets/langpacks/core-ui.json`，约 150 条高频 UI 词 × 5 语）+ 规则：
整句命中 → 去标点命中 → 拉丁语逐词（≥60% 命中才采用）→ CJK 最长匹配子串替换。
**命中率低于 70% 就别硬翻**，转 AI 档位或往词典补词（补词是最划算的：一条词五语受益）。
`offline-report.json` 会列出所有未命中条目与建议。

### Web 项目专项

`webaudit` 输出：i18n 框架（vue-i18n / react-i18next / next-intl / formatjs / lingui…）、
i18n 目录清单、缺 `<html lang>` 的 HTML 数、canvas/WebGL UI 文件清单。

**有 i18n 框架时优先翻 locale 文件**（`bridge extract` → 翻译 → `bridge apply`），
不要逐字改源码——那会把组件拆碎。`bridge` 支持 po / pot / properties / strings / arb /
Android strings.xml / csv / yaml，**保持原格式写回**。

### 多格式覆盖

- 文案类：`.html .htm .vue .svelte .md .js .jsx .ts .tsx .mjs .cjs`
- 源码类（引号扫描器通用）：`.py .java .kt .cs .go .rs .php .rb .c .cpp .h .hpp .scala .dart .swift`
- 资源类（bridge）：`.po .pot .properties .strings .arb .xml .csv .yaml .yml .json`
- 交换格式（export/import）：`json / po / csv / xliff`

## 环境注意（本机）

- Bash 工具 PATH 是坏的，跑脚本用绝对路径：
  `<python.exe 路径> <skill>/scripts/loc.py ...`
- 脚本零第三方依赖，纯标准库。

## 目录结构

```
project-zh-localizer/
├── SKILL.md                 ← 本文件
├── scripts/loc.py           ← 全流程 CLI（scan/glossary/batch/merge/predict/verify/apply/ui/report）
├── assets/builtin-dict.json     ← Tier-A 内置词典 en→zh（UI/游戏常用词，可扩充）
├── assets/builtin-dict-ja.json  ← Tier-A 内置词典 en→ja（predict 按 --to 自动选）
└── references/translation-prompt.md ← Tier-B/C/D 的 AI 翻译/复核提示词模板
```

## 流程总览

```
scan → glossary → [选档位 a/b/c/d] → verify → apply → ui → report
```

- 中间产物全部落在 `<项目>/.loc/`，不污染源码。
- `--from zh` 时同一条链反过来跑即可（scan 换参数，其余不变）。

---

## Step 0 — 选方向与档位

| 档位 | 精准度 | 流程 | 适用 |
|---|---|---|---|
| **a** | 词典直译 | `scan → predict → verify → apply` | 纯 UI 小项目，要求快，不求信达雅 |
| **b** | AI 逐批翻译 | `scan → glossary → batch → AI 翻译(分批) → merge → verify → apply` | 常规汉化，推荐起点 |
| **c** | b + 批量化校验 | 在 b 之后强化 `verify`：全部条目程序化检查（占位符/引号/一致性/溢出比），按 verify.json 修完再 apply | 正式交付 |
| **d** | c + AI 抽样复核 | 在 c 之上让 AI 按语境复核全部/抽样条目（长文案、一词多义、上下文歧义），修完再 apply | 最高质量（游戏剧情、产品文案） |

档位是"精准度可调"的旋钮：a 最快最糙，d 最慢最准。可以混合（例如 UI 按钮走 a、剧情文本走 d）。

## Step 1 — scan（抓取）

```bash
<py> <skill>/scripts/loc.py --root <项目> scan --from en --to zh-CN --tier b
# 日语: --to ja ; 中文项目反译: --from zh --to en
```

- 抓取范围：HTML 文本节点、`placeholder/title/alt/aria-label/label` 属性、`<script>` 内 JS 字符串、JS/TS/Vue/Svelte 文件、i18n JSON 的 value（自动跳过 key 类字段）。
- 自动跳过：标识符、资源路径、URL、颜色值、`case`/`require` 参数、纯符号。
- 存疑项（单个标识符、全大写常量）记入 `strings.json → skipped_samples`，需要时人工/AI 过目。
- 自动同步 `<html lang="...">`：scan 会把 lang 属性单独抽成 `html-lang` 条目，**不进翻译批次**，apply 时按 `--to` 自动改写（如 `lang="en"` → `lang="ja"`）。双语互换必须同步，否则断词/屏幕阅读器全错。
- 检测到 canvas/WebGL 绘制的 UI 会列在 `canvas_ui_files`——**这类 UI 的尺寸在绘制代码里，CSS 适配管不到，要单独调**。
- 输出 `.loc/strings.json`。

## Step 2 — glossary（术语，b/c/d 档）

```bash
<py> <skill>/scripts/loc.py --root <项目> glossary --top 60
```

生成 `.loc/glossary.json`：高频词/专有名词候选。人工或 AI 填写：
- `target`：约定译名；
- `keep: true`：品牌名/专有名词，**不翻译、原样保留**。

## Step 3 — 翻译（按档位分流）

### Tier a：词典直译

```bash
<py> <skill>/scripts/loc.py --root <项目> predict
```

内置词典 + glossary.json 命中的直接翻（UI 常用词覆盖率通常够小工具用），未命中的留给下一档。

### Tier b：AI 分批翻译

```bash
<py> <skill>/scripts/loc.py --root <项目> batch --size 60
```

生成 `.loc/batch_001.json...`。**由 AI（即当前会话）逐批翻译**：读 batch 文件，按 `references/translation-prompt.md` 的模板把 `items` 逐条补上 `target`，写成 `batch_001.done.json`（同目录、同结构，只加 target）。翻完合并：

```bash
<py> <skill>/scripts/loc.py --root <项目> merge
```

要点：
- 每批翻译时把 glossary.json 的术语表带进提示词；
- 译文长度尽量贴近原文显示宽度（中文通常是英文的 0.6~1.0 倍，超宽会撑破 UI）；
- 保留占位符与标点风格（句尾句号按目标语言习惯）。

### Tier c：批量化校验

```bash
<py> <skill>/scripts/loc.py --root <项目> verify --max-ratio 2.6 --min-ratio 0.3
```

程序化全量检查 `.loc/verify.json`：未翻译 / 占位符丢失 / 引号破坏 / 译文过长（UI 溢出风险）/ 相同原文不同译文 / 术语不一致。**fail 清零、warn 逐条过目后**才进 apply。

### Tier d：AI 确认

在 c 之后，把 verify.json 的 warn 项 + 长文案（≥3 词）抽样列表按 `references/translation-prompt.md` 的"复核模板"重新过一遍语境（按钮 or 标题？动词 or 名词？游戏内术语还是通用词？），修订后重新 merge → verify。

## Step 4 — apply（写回，先备份）

```bash
# 先演练，看替换统计不落盘
<py> <skill>/scripts/loc.py --root <项目> apply --dry-run
# 确认无误后真正写回（自动备份到 .loc/backup/）
<py> <skill>/scripts/loc.py --root <项目> apply
```

## Step 5 — ui（UI 自适应）

```bash
<py> <skill>/scripts/loc.py --root <项目> ui --min-ratio 1.12 --max-expand 1.8
```

- 对每条译文计算**显示宽度比** `ratio = 译文宽 / 原文宽`（中文按 2、英文按 1 计），超过阈值的元素才调。
- 通过 `strings.json` 里记录的 DOM 选择器（tag#id.class）匹配 CSS 规则，只调整：`width/min-width/max-width`、水平 `padding`、`line-height`、空间受限时微调 `font-size`（默认下限 12px，且可用 `--no-font-shrink` 禁掉）。
- **不动**：font-family / 字重 / 颜色 / display / position / height / border-radius / class / DOM 结构。
- 中文→英文/日文方向文字通常变宽，同样适用；反向（译文比原文短）默认只提示不收缩，加 `--allow-shrink` 才收缩。
- **日语比英文宽约 1.2~1.6 倍**，UI 扩容几乎必然触发；建议 `--max-expand 2.2`，verify 用 `--max-ratio 3.0`。
- 结果在 `.loc/ui-report.json`；canvas/WebGL UI 会单独列出提醒。

## Step 6 — report

```bash
<py> <skill>/scripts/loc.py --root <项目> report
```

汇总 `.loc/report.md`：扫描统计、校验通过率、UI 调整明细、备份位置。交付时把这个报告给用户看。

## 验收清单（每次交付前）

- [ ] `verify` 无 fail（warn 已解释或修复）
- [ ] `apply` 无定位失败条目
- [ ] 抽查 3~5 个改过的文件：引号没破、占位符还在、无乱码（UTF-8）
- [ ] `ui` 后 grep 一遍 font-family：与备份一致
- [ ] 有 canvas UI 的项目单独说明处理方式
- [ ] `.loc/` 已加入 .gitignore（若项目用 git）

## 回滚

```bash
cp -r <项目>/.loc/backup/* <项目>/   # 覆盖回原样
```

## 常见坑

- **Vue/React 模板语法** `{{ }}`、`{}` JSX 表达式不翻——scan 已自动跳过含 `{{` 的文本。
- **JS 字符串定位**：apply 按行号+列号精确替换，若用户在 scan 和 apply 之间手改过源文件，必须重新 scan。
- **JSON 写回**：i18n 文件按键路径写入，保持键顺序与格式（重新序列化会重排，属预期）。
- **中英混排文本**（已含中文又含英文）在 en 方向会被跳过并记为 `already_translated`，人工确认是否要重翻。
