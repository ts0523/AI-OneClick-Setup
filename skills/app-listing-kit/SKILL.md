---
name: app-listing-kit
description: 把本地做好的应用/游戏/软件/小工具，一键生成一整套可直接粘贴上架电商平台的物料包（淘宝 + 拼多多），含标题多候选、卖点、详情页 HTML、SKU 与价格梯度、主图文案脚本、自动发货话术、上架操作 checklist，并做违禁词/极限词/IP 风险词扫描与开店资质闸门校验。当用户说「一键上架」「放到淘宝卖」「拼多多上架」「应用售卖」「把游戏挂到电商」「生成商品详情页」「写商品标题」「卖我的软件」时使用。本 skill 只生成物料与校验，不代登录、不代提交、不操控任何平台后台。
agent_created: true
---

# 应用一键售卖物料生成器

把「应用成品 → 电商可粘贴上架物料包」这一步做到一键。

## 边界（先读，不可绕过）

**不要试图自动化平台后台。** 淘宝、拼多多均未对个人卖家开放商品发布 API，用脚本/插件操作卖家后台属违规，会导致封店与保证金扣除。本 skill 的产出物是**人可粘贴的文案与素材**，最后一步的提交由人手动完成。

**先过闸门再干活。** 生成物料前必须执行资质闸门检查（见 `references/compliance-gates.md`）。三道闸门（年龄 / 实名 / 收款）任一不过，`00-交付说明.md` 顶部会打印醒目结论，明确告知「不具备开店条件，物料仅供提前准备」。**不要跳过这一步直接带用户去注册**，那必然卡在实名环节。

需要硬拦截时加 `--strict-gates`：闸门不通过就只输出交付说明，不产出任何上架文案。

## 主流程

工作目录用绝对路径。Python 走 managed 版本，不要用裸 `python`。

```bash
PY="<python.exe 路径>"
KIT="<技能库>/app-listing-kit"

# 0) 只查闸门，不生成任何东西（拿不准时先跑这个）
"$PY" "$KIT/scripts/lint_listing.py" --profile profile.json --gates-only   # 退出码 2 = 闸门未过

# 1) 采集应用信息 → 写一份 profile.json（schema 见下，范例见 assets/profile.example.json）
# 2) 生成整套物料
"$PY" "$KIT/scripts/gen_listing.py" --profile profile.json --out ./listing-out

# 3) 违禁词 / 极限词 / 虚构数据 / IP 风险词扫描（生成后必跑，也可单独复检）
"$PY" "$KIT/scripts/lint_listing.py" --dir ./listing-out
```

`lint_listing.py` 退出码非 0 即存在必须修的高危词，修完重跑，不要带病交付。

退出码约定：`0` 干净 / `1` 有高危词 / `2` 闸门未通过 / `3` 用法或路径错误。


## profile.json schema

```json
{
  "app_name": "PixelWilderness",
  "app_name_cn": "像素荒野",
  "category": "像素风生存游戏",
  "platforms": ["Windows 10/11"],
  "version": "1.0",
  "one_liner": "零外部素材、纯代码生成的 2D 俯视像素生存游戏",
  "features": [
    "程序化生成的像素精灵，无任何第三方素材",
    "PCM 实时合成音效，体积小于 30MB",
    "本地存档，无需联网"
  ],
  "audience": ["单机游戏玩家", "像素风爱好者"],
  "price_tiers": [
    {"name": "标准版", "price": 12.9, "includes": "完整游戏本体"},
    {"name": "豪华版", "price": 24.9, "includes": "本体 + 开发者美术调色板 + 原声"}
  ],
  "delivery": "网盘直链 + 卡密自动发货",
  "has_ai_feature": false,
  "ai_byok": false,
  "ip_risk_notes": "全部素材与音效为程序化生成，无外部素材引用",
  "seller": {
    "age": null,
    "has_id_card": false,
    "has_phone": false,
    "has_bank_or_alipay": false,
    "can_open_store": false
  }
}
```

`seller` 段用于闸门判定。缺字段视为未通过，不要替用户假设「应该有吧」。

`price_tiers` 中 `price` 为元。`has_ai_feature` 为 true 时，另需 `ai_byok` 说明是否由买家自带 Key（见 compliance-gates 的 AI 产品合规段）。

## 产出物结构

```
listing-out/
├── 00-交付说明.md          总览 + 资质闸门结论 + 手动上架 checklist
├── 01-淘宝上架.md          标题候选 / 卖点 / 类目建议 / 属性填法 / 发货设置
├── 02-拼多多上架.md        同上（含两平台差异点）
├── 03-详情页.html          分屏详情页，浏览器打开可直接整页截图上传
├── 04-主图文案.md          5 张主图 + 白底图的文案与构图脚本
├── 05-发货与售后.md        自动发货话术 / 交付说明 / 售后 SOP
├── 06-风控报告.md          违禁词扫描结果 + 修改建议
└── listing.json            结构化数据，供后续复用
```

### 几个实现细节

- **扫描范围只含买家可见文案**（01–05）。`00-交付说明.md` 与 `06-风控报告.md` 是内部文档，会被排除——否则报告里引用的违规词会自我命中，交付说明里正常的「首选」也会误报。
- **扫 HTML 前会剥掉 `<style>` / `<script>` 和标签**，否则 CSS 的 `width:100%` 会命中极限词 `100%`（已踩过）。
- **标题权重算法**：汉字计 2、ASCII 计 1，上限 60。两平台上限实际接近（30 汉字 ≈ 60 字符），所以同一套标题通用。
- **详情页模板**在 `assets/detail_page_template.html`，750px 宽纯浅色版式。改样式直接改这个文件，不用动 Python。生成后浏览器打开整页截图即可上传。

## 参考文档（按需加载，不要一次性全读）

| 文件 | 何时读 |
|---|---|
| `references/compliance-gates.md` | **总是先读**。资质闸门、AI 产品合规、IP 风险、替代发行路径 |
| `references/copy-formulas.md` | 写标题/卖点/详情页时读。标题词序公式、分屏结构、定价策略 |
| `references/taobao-rules.md` | 生成淘宝物料时读。标题字数、图片规格、虚拟类目与发货要求 |
| `references/pdd-rules.md` | 生成拼多多物料时读。与淘宝的差异点、低价流量逻辑 |

## 硬规则

1. **不编造使用数据。** 新应用没有销量、没有评价，标题与详情页里不得出现「已售 1000+」「好评如潮」「百万玩家」这类虚构信息。这是虚假宣传，也是平台违规。
2. **不碰第三方 IP。** 应用内若存在任何第三方作品名、角色名、素材引用，必须先清掉再上架。搜索关键词里也不能蹭他人作品名。
3. **平台规则会变。** 本 skill 里的字数限制、保证金金额、类目名均为参考值，交付时必须注明「以后台当前实际要求为准」。
4. **交付时讲清取舍。** 生成器自动做的选择（默认价格、词序、类目）要在 `00-交付说明.md` 里列出来并注明可改。
