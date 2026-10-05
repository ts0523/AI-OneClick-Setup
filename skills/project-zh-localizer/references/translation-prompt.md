# AI 翻译 / 复核提示词模板（Tier B / C / D 用）

## Tier-B 逐批翻译模板

读入 `.loc/batch_XXX.json` 后，按下述要求为每个 item 产出 `target`，写出到 `.loc/batch_XXX.done.json`（保持原 JSON 结构，只在每个 item 上加 `"target"` 字段）。

```
你是本地化翻译。把下列 UI 文案从{源语言}译为{目标语言}（{目标语言名}）。

规则:
1. 只输出翻译结果填入 target，不改动 id/source/context。
2. 术语表（必须遵守；keep=true 的条目原样保留英文不译）:
{术语表 JSON}
3. 保留全部占位符与内联标签: {xxx}、%s、${xxx}、<b>...</b>、&amp; 等原样搬到译文。
4. 译文显示宽度尽量不超过原文的 1.3 倍（按钮/标签尤其如此）；能用 2 个字就不用 4 个字。
5. 结合 context（前后代码片段）判断词性: 按钮文案用动词短语；标题用名词短语；
   游戏术语按术语表。
6. 标点风格: 英译中用全角标点；句尾句号能省则省（UI 惯例）。
7. 拿不准的条目把 target 留空字符串，并在该 item 加 "note": "不确定原因"，
   交给后续复核，不要硬翻。

待翻译条目:
{items JSON}
```

产出格式示例:

```json
{
  "batch": 1,
  "items": [
    {"id": "index.html:12:8:0042", "source": "Start Game", "target": "开始游戏"},
    {"id": "game.js:88:20:1107", "source": "Loading {name}...", "target": "正在加载 {name}…", "note": ""}
  ]
}
```

## Tier-C 校验修复模板（面向 verify.json 的 fail/warn）

```
以下是程序化校验发现的问题条目。逐条给出修正后的译文:
- placeholder 类: 把丢失的占位符补回译文原位;
- quote_break 类: 改用中文引号「」或转义，确保写回后字符串字面量合法;
- overflow_risk 类: 缩短译文（同义更短词），而不是改 UI;
- inconsistent 类: 相同 source 必须统一成同一个译文，取更准确的那个;
- glossary_miss 类: 按术语表改译。

问题条目:
{verify.json 中 level != pass 的条目}
```

修完后把修正写回对应 batch 的 done 文件（或直接改 translated.json），重新 `merge → verify` 直到无 fail。

## Tier-D AI 复核模板（语境确认）

对以下两类条目逐条复核，输出"维持 / 修改为 X"的结论:

```
你是资深本地化审校。逐条复核下列译文，判断:
1. 词性是否符合使用场景（按钮=动词短语，标题=名词短语，提示=完整句）;
2. 术语是否与术语表一致;
3. 是否存在过度直译（如 "Save" 译成"保存"没问题，"Save Changes" 译成"保存改变"就是错）;
4. 显示宽度比是否在 0.5~1.5 之间（超出会撑破或留白过多）;
5. 一词多义是否按 context 选对了义项。

每行输出: [维持|修改] <id> <最终译文> （修改时附一句理由）

条目（含 context）:
{抽样条目}
```

抽样建议: 全部 fail/warn 条目 + 长文案（≥3 词）随机抽 20% + 按钮类全部。

## 日语方向注意（--to ja）

- 日文 UI 惯例：按钮用「〜する」形或名词（「開始」/「ゲームスタート」），句尾不加句号，
  全角标点（、。「」…）；敬体（です・ます）用于面向用户的提示，游戏内短文案可用体言止め。
- 片假名外来语要保持一致性：同一项目里 saving/load 要么全用片假名「セーブ/ロード」，
  要么全用汉字「保存/読み込み」，不要混用——写进 glossary.json 强制统一。
- 日文比英文宽约 1.2~1.6 倍：译文务必精简（能省助词就省），UI 溢出风险比中文高得多。
- 撥音・促音（っ）不影响宽度计算，脚本按 CJK=2 宽估算，长句仍需人工/Tier-D 复核。
- Tier-A 词典 `assets/builtin-dict-ja.json` 已覆盖常用 UI/游戏词；`predict` 会按 `--to ja`
  自动选它。未覆盖的走 b/c/d 档。
- zh→ja 方向：scan 用 `--from zh`，但注意汉字在两种语言里都存在，纯汉字串无法自动区分
  中日文；若项目里混有已有的日文文案，先在 glossary 里标注或人工剔除再扫。

## 双向互换注意（zh→en 反向）

- `scan --from zh --to en` 后，batch 文件里 source 是中文、target 应为英文；
- 术语表方向对调：source=中文术语，target=英文约定名；
- 英文 UI 惯例: 按钮首字母大写（"Start Game" 而非 "start game"），句尾标点可留；
- 英文通常比中文宽，verify 的 overflow 阈值可放宽到 --max-ratio 3.0，
  ui 步骤的扩容上限可给到 --max-expand 2.2。
