# -*- coding: utf-8 -*-
"""从应用 profile 一键生成电商上架物料包。

用法:
    python gen_listing.py --profile profile.json --out ./listing-out
    python gen_listing.py --profile profile.json --out ./listing-out --strict-gates
"""

import argparse
import json
import os
import re
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import banned_words as bw  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SKILL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(SKILL_ROOT, "assets", "detail_page_template.html")

TITLE_CAP = 60          # 两平台标题上限实际接近：汉字权重 2，总权重 60 ≈ 30 个汉字
# 只扫「买家能看到的文案」。00 是内部交付说明、06 是报告本身（会引用违规词造成自命中）。
SCAN_FILES = ["01-淘宝上架.md", "02-拼多多上架.md",
              "03-详情页.html", "04-主图文案.md", "05-发货与售后.md"]


# ---------- 基础工具 ----------

def w(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def weight(s):
    """标题权重：汉字 2，ASCII 1。上限 60。"""
    return sum(2 if ord(c) > 127 else 1 for c in s)


def fmt_price(v):
    if isinstance(v, str):
        return v
    return f"{v:g}"


def as_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v]
    return list(v)


# ---------- 资质闸门 ----------

def gate_check(seller):
    s = seller or {}
    rows = []
    age = s.get("age")
    if age is None:
        age_ok = False
        age_txt = "未提供"
    else:
        age_ok = isinstance(age, int) and age >= 18
        age_txt = f"{age} 周岁" + ("" if age_ok else "（未满 18 周岁）")
    rows.append(("闸门 1 年龄", age_ok, age_txt + ("" if age_ok else "，需监护人实名开店")))

    id_ok = bool(s.get("has_id_card"))
    rows.append(("闸门 2-a 身份证", id_ok, "已具备" if id_ok else "缺失"))

    ph_ok = bool(s.get("has_phone"))
    rows.append(("闸门 2-b 手机号", ph_ok, "已具备" if ph_ok else "缺失，开店必需，无替代方案"))

    pay_ok = bool(s.get("has_bank_or_alipay"))
    rows.append(("闸门 3 收款账户", pay_ok, "已具备" if pay_ok else "缺失，货款须走实名账户"))

    store = bool(s.get("can_open_store"))
    rows.append(("可直接开店", store, "可以" if store else "不可以"))

    ok = all([age_ok, id_ok, ph_ok, pay_ok, store])
    return ok, rows


def render_gate_block(ok, rows):
    out = ["| 检查项 | 结果 | 说明 |", "|---|---|---|"]
    for name, passed, note in rows:
        out.append(f"| {name} | {'✅' if passed else '❌'} | {note} |")
    out.append("")
    if ok:
        out.append("**结论：三道闸门全部通过，可按本物料包直接上架。**")
    else:
        out.append("**结论：当前不具备开店条件 —— 物料仅供提前准备，现在去尝试注册/上架会卡在闸门上。**")
        out.append("")
        out.append("替代发行路径见 `references/compliance-gates.md` 第五节。首选：由监护人实名开店，本人做技术提供方。")
    return "\n".join(out)


# ---------- 关键词与标题 ----------

def derive_keywords(p):
    kw = dict(p.get("keywords") or {})
    platforms = as_list(p.get("platforms"))
    cat = p.get("category") or ""
    is_game = ("游戏" in cat) or ("game" in str(p.get("type", "")).lower())

    core = kw.get("core") or cat or p.get("app_name_cn") or p.get("app_name") or ""

    env = kw.get("env")
    if not env:
        if any("windows" in x.lower() or "win" in x.lower() for x in platforms) or not platforms:
            env = "PC电脑单机版" if is_game else "PC电脑版"
        else:
            env = "  ".join(platforms)

    diff = kw.get("diff") or ""
    scene = kw.get("scene") or ("独立游戏" if is_game else "")
    return {"core": core, "env": env, "diff": diff, "scene": scene,
            "_missing": [k for k in ("core", "env", "diff", "scene") if not kw.get(k)]}


def build_titles(kw):
    core, env, diff, scene = kw["core"], kw["env"], kw["diff"], kw["scene"]
    # 三个候选给出真实差异，便于 A/B：品类优先 / 卖点前置 / 短版
    orders = [
        [core, env, diff, scene],
        [core, diff, env, scene],
        [core, env, diff],
    ]
    titles, seen = [], set()
    for order in orders:
        parts = []
        for piece in order:
            if not piece:
                continue
            trial = parts + [piece]
            if weight(" ".join(trial)) <= TITLE_CAP:
                parts = trial
        t = " ".join(parts).strip()
        if t and t not in seen and weight(t) <= TITLE_CAP:
            seen.add(t)
            titles.append(t)
    return titles


def render_titles(titles):
    if not titles:
        return "（无法生成标题 —— keywords 未提供，请补齐 profile.keywords 后重跑）"
    out = []
    for i, t in enumerate(titles):
        mark = " ← 推荐" if i == 0 else ""
        out.append(f"{i + 1}. `{t}`{mark}")
        out.append(f"   - 权重 {weight(t)}/60（约 {len(t.replace(' ', ''))} 字）")
    return "\n".join(out)


# ---------- 详情页 ----------

def split_feature(text):
    for sep in ("——", " — ", "：", ":", "，", ","):
        if sep in text:
            k, v = text.split(sep, 1)
            return k.strip(), v.strip()
    if len(text) > 14:
        return text[:14], text[14:]
    return text, ""


def build_detail_html(p, kw):
    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()

    features = as_list(p.get("features"))
    cards = []
    for feat in features[:4]:
        k, v = split_feature(feat)
        cards.append(f'      <div class="card"><div class="k">{k}</div>'
                     f'<div class="v">{v}</div></div>')
    if not cards:
        cards.append('      <div class="card"><div class="k">待补充核心功能</div>'
                     '<div class="v">请在 profile.features 中填写</div></div>')

    diffs = as_list(p.get("differentiators")) or features
    diff_html = "\n".join(f"      <li>{d}</li>" for d in diffs[:5]) or "      <li>待补充</li>"

    platforms = "、".join(as_list(p.get("platforms"))) or "以实际为准"
    specs = [
        ("应用名称", p.get("app_name_cn") or p.get("app_name") or ""),
        ("版本", p.get("version") or "1.0"),
        ("运行环境", platforms),
        ("语言", p.get("language") or "简体中文"),
        ("交付方式", p.get("delivery") or "网盘直链 / 卡密"),
        ("授权方式", "自研 / 自主知识产权"),
    ]
    for k, v in (p.get("specs") or {}).items():
        specs.append((k, v))
    spec_rows = "\n".join(f"      <tr><th>{k}</th><td>{v}</td></tr>" for k, v in specs)

    tiers = p.get("price_tiers") or []
    price_cards = []
    for i, t in enumerate(tiers):
        cls = "price-card hot" if i == 0 else "price-card"
        price_cards.append(
            f'      <div class="{cls}"><div class="tier">{t.get("name", "标准版")}</div>'
            f'<div class="num"><small>¥</small>{fmt_price(t.get("price", 0))}</div>'
            f'<div class="inc">{t.get("includes", "")}</div></div>'
        )
    if not price_cards:
        price_cards.append('      <div class="price-card hot"><div class="tier">标准版</div>'
                           '<div class="num"><small>¥</small>—</div>'
                           '<div class="inc">请在 profile.price_tiers 中填写</div></div>')

    delivery = p.get("delivery") or "网盘直链"
    steps = [
        ("下单支付", "拍下并完成付款，无需联系客服"),
        ("自动获取", f"系统即时发送{delivery}"),
        ("解压运行", "解压后双击主程序即可，无需安装"),
    ]
    steps_html = "\n".join(
        f'      <div class="step"><div class="n">{i + 1}</div>'
        f'<div class="t">{t}</div><div class="d">{d}</div></div>'
        for i, (t, d) in enumerate(steps)
    )

    faq = p.get("faq") or [
        ("下单后怎么拿到？", f"付款后系统自动发送{delivery}，不需要等客服在线。"),
        ("重装系统后还能下吗？", "可以。凭订单记录联系客服重新获取下载链接。"),
        ("配置达不到要求能退吗？", "虚拟商品一经发货不支持退款。购买前请先核对上方运行环境。"),
    ]
    if isinstance(faq, dict):
        faq = list(faq.items())
    faq_html = "\n".join(
        f'      <div><div class="q">{q}</div><div class="a">{a}</div></div>' for q, a in faq
    )

    badges = [x for x in [platforms if len(platforms) < 24 else None,
                          f"v{p.get('version') or '1.0'}",
                          p.get("language") or "简体中文"] if x]
    badges_html = "".join(f'<span class="badge">{b}</span>' for b in badges)

    repl = {
        "APP_NAME": p.get("app_name_cn") or p.get("app_name") or "",
        "ONE_LINER": p.get("one_liner") or "",
        "BADGES": badges_html,
        "FEATURE_CARDS": "\n".join(cards),
        "DIFF_LIST": diff_html,
        "SPEC_ROWS": spec_rows,
        "PRICE_CARDS": "\n".join(price_cards),
        "STEPS": steps_html,
        "FAQ_ITEMS": faq_html,
        "FOOTER_NOTE": (f"{p.get('app_name_cn') or p.get('app_name')} · "
                        f"由 {p.get('seller_name') or '独立开发者'} 独立开发<br>"
                        f"售后请联系店铺客服 · 虚拟商品一经发货不支持退款"),
    }
    for k, v in repl.items():
        tpl = tpl.replace("{{" + k + "}}", str(v))
    return tpl


# ---------- 各份 Markdown ----------

def render_feature_bullets(p):
    feats = as_list(p.get("features"))
    if not feats:
        return "1. 待补充（profile.features）"
    return "\n".join(f"{i + 1}. {f}" for i, f in enumerate(feats))


def render_price_table(p):
    tiers = p.get("price_tiers") or []
    if not tiers:
        return "| 标准版 | — | 待填写 |"
    rows = [f"| {t.get('name', '标准版')} | ¥{fmt_price(t.get('price', 0))} | {t.get('includes', '')} |"
            for t in tiers]
    return "| SKU 名称 | 价格 | 包含内容 |\n|---|---|---|\n" + "\n".join(rows)


def platform_doc(p, kw, titles, platform):
    name = p.get("app_name_cn") or p.get("app_name")
    if platform == "taobao":
        cap_note = "标题上限 30 个汉字（60 字符）。移动端会截断，前 15 字放最重要的词。"
        cat_hint = ("虚拟 / 软件类目在淘宝归属变化频繁。**发布前先在后台的类目选择页确认"
                    "该类目需要的资质与保证金**，不要凭经验猜。虚拟类目保证金通常显著高于实物类目。")
        ship = ("商品发布时选择「虚拟商品 / 自动发货」→ 上传卡密库（每行一条）或设置网盘链接模板 → "
                "买家付款后系统自动发送。网盘链接易被举报失效，建议准备 2–3 个备用链接写进自动回复。")
        extra = ("- 属性栏能填满就填满，它是检索字段的一部分\n"
                 "- 授权方式选「自研 / 自主知识产权」，语种填「简体中文」\n"
                 "- 发货时限：虚拟类目通常要求即时或 24 小时内，超时影响体验分")
    else:
        cap_note = "标题上限 60 字符（约 30 个汉字），与淘宝接近，同一套标题可直接复用。"
        cat_hint = ("拼多多虚拟商品需要提交资质。自研软件可提交**软件著作权登记证书**（如有）；"
                    "没有软著时按后台提示提交其它权属证明。软著是虚拟商品上架的硬通货，建议尽早申请。")
        ship = ("需在承诺时限内发货（通常 24 小时内，以后台为准），超时罚款。"
                "建议走自动发货，并把交付说明写进自动回复。")
        extra = ("- 属性词权重大，**必须全部填满**（拼多多推荐流会抓）\n"
                 "- 拼多多「仅退款」偏向买家，虚拟商品风险高 → 详情页**顶部**就要写明退款规则\n"
                 "- 比价激烈，定价过高会没流量")

    return f"""# {name} —— {platform_name(platform)}上架物料

> 生成时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}
> 平台规则会变，以下字数 / 保证金 / 类目名为参考值，**以后台当前实际要求为准**。

## 一、商品标题

{cap_note}

{render_titles(titles)}

## 二、商品卖点（当前 {len(as_list(p.get('features')))} 条，建议补足 5 条，用于副标题 / 属性 / 主图文案）

{render_feature_bullets(p)}

> 补第 2–5 条时按这个维度顺序写：差异化 → 技术亮点 → 上手成本 → 售后保障。
> 只写可核对的事实，不写感受，不写虚构数据。

## 三、类目与资质

{cat_hint}

- 类目建议方向：{p.get('category') or '（按后台可选范围）'}
- 类目最终选择以后台可选列表为准

## 四、属性填写

| 属性 | 填法 |
|---|---|
| 授权方式 | 自研 / 自主知识产权 |
| 版本类型 | 正式版 |
| 运行环境 | {'、'.join(as_list(p.get('platforms'))) or 'Windows'} |
| 语种 | 简体中文 |

{extra}

## 五、发货设置

{ship}

## 六、价格与 SKU

{render_price_table(p)}

## 七、发布前 checklist（人工逐条点）

- [ ] 标题已按 {('30 个汉字' if platform == 'taobao' else '60 字符')} 校验，前 15 字含核心词
- [ ] 主图 5 张齐全，第 1 张白底、留白充足
- [ ] 详情页图片已压缩，宽度 {'750px' if platform == 'taobao' else '750px'}
- [ ] 类目已选，且已确认该类目的资质与保证金要求
- [ ] 属性栏必填项全部填完
- [ ] 自动发货内容已自测（自己下一单，验证发出来的内容能正常使用）
- [ ] 标题与详情页已跑过违禁词扫描（见 `06-风控报告.md`）
- [ ] 售后联系方式已写入详情页
- [ ] 退款规则已明确并写在详情页显著位置
"""


def platform_name(p):
    return {"taobao": "淘宝", "pdd": "拼多多"}[p]


def render_main_images(p):
    name = p.get("app_name_cn") or p.get("app_name")
    kw_line = p.get("one_liner") or ""
    platforms = "、".join(as_list(p.get("platforms"))) or "Windows"
    return f"""# {name} —— 主图文案与构图脚本

> 每张图给出文案 + 构图要点。第 1 张必须白底，平台有自动抠图要求。

## 图 1 · 白底主图

- **文案**：`{name}`（大字号）+ 一行副标 `{kw_line[:16]}`
- **构图**：纯白底。应用名占画面上方 1/3，居中。下方留 30% 空白。不要加边框和阴影。
- **字数纪律**：缩略图尺寸下超过 12 个字基本读不清，这里只放应用名 + 一行短副标。

## 图 2 · 真实运行画面

- **文案**：无（或仅右下角一个小标签 `实机截图`）
- **构图**：应用真实运行截图，**不要渲染图、不要概念图**。截图边缘加 1px 浅灰描边即可。

## 图 3 · 玩法亮点

- **文案**（竖排 3 条，每条 ≤ 10 字）：
  1. {as_list(p.get('features'))[0][:12] if as_list(p.get('features')) else '待补充'}
  2. {as_list(p.get('features'))[1][:12] if len(as_list(p.get('features'))) > 1 else '待补充'}
  3. {as_list(p.get('features'))[2][:12] if len(as_list(p.get('features'))) > 2 else '待补充'}
- **构图**：左侧放截图局部，右侧竖排三条文案，字号要大。留白比信息量重要。

## 图 4 · 配置要求

- **文案**：标题 `运行环境`
- **构图**：用表格，两列（最低 / 推荐）。
  - 系统：{platforms}
  - 其余按 `profile.specs` 实际填写
- **要点**：买家最大的顾虑是「我这台跑不跑得动」，这张图直接影响退货率。

## 图 5 · 交付说明

- **文案**：`拍下自动发货 · {p.get('delivery') or '网盘直链'} · 永久可重新下载`
- **构图**：三步图示（下单 → 自动发链接 → 解压即成），箭头连接。
- **要点**：这张图解决「买了怎么拿到」的顾虑，别省。
"""


def render_delivery(p):
    name = p.get("app_name_cn") or p.get("app_name")
    delivery = p.get("delivery") or "网盘直链"
    tiers = p.get("price_tiers") or [{"name": "标准版", "includes": "完整版"}]
    tier_lines = "\n".join(f"- **{t.get('name')}**：{t.get('includes', '')}" for t in tiers)
    combo_lines = "\n".join(
        "【" + str(t.get("name")) + "】" + str(t.get("includes", "")) for t in tiers
    )
    return f"""# {name} —— 发货与售后

## 一、自动发货消息模板

### 标准版

```
您好，感谢购买【{name}】！

【下载】{{{{download_url}}}}
【提取码】{{{{extract_code}}}}
【版本】v{p.get('version') or '1.0'}

安装：解压后双击主程序即可，无需安装。
运行环境：{'、'.join(as_list(p.get('platforms'))) or 'Windows'}

注意：虚拟商品一经发货不支持退款。
链接失效请直接回复本消息，客服会补发。祝玩得开心！
```

### 组合 / 豪华版

```
您好，感谢购买【{name}】！

{combo_lines}

【下载】{{{{download_url}}}}
【提取码】{{{{extract_code}}}}

注意：虚拟商品一经发货不支持退款。
```

## 二、交付说明（写进详情页）

{tier_lines}

交付方式：{delivery}
发货时限：付款后即时自动发送（备用链接见自动回复）

## 三、售后 SOP

| 场景 | 处理方式 |
|---|---|
| 链接失效 | 立即补发备用链接，不追问原因 |
| 解压报错 | 先问系统版本与解压工具，多为杀软误报，指导加白名单 |
| 程序打不开 | 确认运行库与系统版本是否满足；确认是否被安全软件拦截 |
| 要求退款（已发货） | 按详情页规则说明虚拟商品不支持退款；确有质量问题则全额退，别纠缠 |
| 要求退款（未发货） | 立即同意，虚拟商品不值得为几块钱收差评 |

**原则**：虚拟商品的差评成本远高于单价。小额纠纷一律快速了结，把时间花在产品上。

## 四、必须准备的东西

- [ ] 2–3 个备用下载链接（网盘链接会被举报失效）
- [ ] 卡密库（如走卡密发货），每行一条
- [ ] 自动回复话术已配置并自测
- [ ] 售后联系方式（旺旺 / 微信）已写入详情页
"""


def render_readme(p, ok, gate_md, files, scan_summary, kw):
    name = p.get("app_name_cn") or p.get("app_name")
    warn = []
    if kw["_missing"]:
        warn.append(f"- `profile.keywords` 缺少：{'、'.join(kw['_missing'])}。"
                    "标题由默认规则拼出，**建议补齐后重跑**，标题质量直接决定搜索流量。")
    if not p.get("price_tiers"):
        warn.append("- `profile.price_tiers` 未填，价格表为占位符。")
    if not p.get("features"):
        warn.append("- `profile.features` 未填，卖点与详情页功能卡片为占位符。")
    if p.get("has_ai_feature") and not p.get("ai_byok"):
        warn.append("- **应用含 AI 功能但非自带 Key（BYOK）形态** → 当前不具备上架条件。"
                    "自行转发 AI 请求等于成为生成式 AI 服务提供者，需算法备案与内容安全审核，个人办不了。"
                    "改为让买家填自己的 baseURL / model / key。")
    warn_md = "\n".join(warn) if warn else "- 无"

    return f"""# {name} —— 上架物料交付说明

生成时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}

## ⚠️ 资质闸门检查（先看这一段）

{gate_md}

## 一、本包含哪些文件

| 文件 | 用途 |
|---|---|
| `01-淘宝上架.md` | 淘宝标题 / 卖点 / 类目 / 属性 / 发货设置 + checklist |
| `02-拼多多上架.md` | 拼多多同上（已标出两平台差异） |
| `03-详情页.html` | 浏览器打开 → 整页截图 → 缩到 750px 宽 → 切图上传 |
| `04-主图文案.md` | 5 张主图的文案与构图脚本 |
| `05-发货与售后.md` | 自动发货话术 / 交付说明 / 售后 SOP |
| `06-风控报告.md` | 违禁词 / 极限词 / 虚构数据 / IP 风险词扫描结果 |
| `listing.json` | 结构化数据，供后续复用或改版 |

## 二、还缺什么（不补会影响转化）

{warn_md}

## 三、需要你手动做的（无法自动化）

1. 按 `03-详情页.html` 截图并切图，按 `04-主图文案.md` 做 5 张主图
2. 登录卖家后台，**手动**创建商品并粘贴文案
3. 配置自动发货内容并自测一单
4. 逐条过 checklist

> 不要用脚本或插件去操作卖家后台。平台无个人商品发布 API，自动化属违规，代价是封店 + 扣保证金。

## 四、风控扫描结果

{scan_summary}

## 五、自动做的取舍（不合适就说，改起来很快）

- 标题生成了 3 个候选，第 1 个标记为推荐（词序按品类词前置）
- 详情页第 1 屏已替换为应用真实截图占位框，**必须换成实机截图**
- 价格表中第 1 个 SKU 标为「主推」
- 配置要求、版本号取自 profile，未做任何推断
- 平台规则类数字（字数、保证金、类目名）均为参考值，**以后台当前实际要求为准**

## 六、上架之后

- 跑一单自己的商品，验证自动发货内容确实可用
- 前 3 条评价对转化影响最大，用真实反馈引导
- 平台规则变动频繁，每季度复查一次类目与资质要求
"""


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True, help="profile.json 路径")
    ap.add_argument("--out", default="./listing-out", help="输出目录")
    ap.add_argument("--strict-gates", action="store_true",
                    help="闸门不通过时直接拒绝生成（只输出交付说明）")
    args = ap.parse_args()

    with open(args.profile, encoding="utf-8") as f:
        p = json.load(f)

    os.makedirs(args.out, exist_ok=True)

    ok, rows = gate_check(p.get("seller"))
    gate_md = render_gate_block(ok, rows)

    if args.strict_gates and not ok:
        path = os.path.join(args.out, "00-交付说明.md")
        w(path, f"# 资质闸门未通过，已停止生成\n\n{gate_md}\n")
        print("闸门未通过，--strict-gates 已中止生成。详见 " + path)
        return 2

    kw = derive_keywords(p)
    titles = build_titles(kw)
    name = p.get("app_name_cn") or p.get("app_name")

    w(os.path.join(args.out, "01-淘宝上架.md"), platform_doc(p, kw, titles, "taobao"))
    w(os.path.join(args.out, "02-拼多多上架.md"), platform_doc(p, kw, titles, "pdd"))
    w(os.path.join(args.out, "03-详情页.html"), build_detail_html(p, kw))
    w(os.path.join(args.out, "04-主图文案.md"), render_main_images(p))
    w(os.path.join(args.out, "05-发货与售后.md"), render_delivery(p))

    # 扫描（跳过 06 自身，报告里会引用违规词造成自命中）
    results = {}
    for fn in SCAN_FILES:
        fp = os.path.join(args.out, fn)
        if os.path.exists(fp):
            with open(fp, encoding="utf-8") as f:
                hits = bw.scan(bw.clean_for_scan(f.read(), fp))
            if hits:
                results[fp] = hits
    report = bw.render_report(results)
    w(os.path.join(args.out, "06-风控报告.md"), report)

    high = sum(1 for hs in results.values() for h in hs if h["level"] == "high")
    warn = sum(1 for hs in results.values() for h in hs if h["level"] == "warn")
    scan_summary = (f"扫描 {len(SCAN_FILES)} 个产出文件："
                    f"**高危 {high} 处，需修改 {warn} 处**。详见 `06-风控报告.md`。"
                    if (high or warn) else
                    f"扫描 {len(SCAN_FILES)} 个产出文件：未发现违禁词、极限词、虚构数据或 IP 风险词。")

    w(os.path.join(args.out, "00-交付说明.md"),
      render_readme(p, ok, gate_md, None, scan_summary, kw))

    with open(os.path.join(args.out, "listing.json"), "w", encoding="utf-8") as f:
        json.dump({"profile": p, "keywords": kw, "titles": titles,
                   "gate_passed": ok, "generated_at": datetime.datetime.now().isoformat()},
                  f, ensure_ascii=False, indent=2)

    print(f"已生成 → {os.path.abspath(args.out)}")
    for fn in ["00-交付说明.md", "01-淘宝上架.md", "02-拼多多上架.md",
               "03-详情页.html", "04-主图文案.md", "05-发货与售后.md",
               "06-风控报告.md", "listing.json"]:
        print("  " + fn)
    print(f"\n闸门：{'通过' if ok else '未通过（物料仅供提前准备）'}")
    print(f"风控：高危 {high} / 警告 {warn}")
    return 1 if high else 0


if __name__ == "__main__":
    sys.exit(main())
