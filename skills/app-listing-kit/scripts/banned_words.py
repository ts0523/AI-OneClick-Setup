# -*- coding: utf-8 -*-
"""违规词库与扫描逻辑。

gen_listing.py 与 lint_listing.py 共用这一份，避免两处词表漂移。
"""

import re

# 扫 HTML 前先剥掉样式/脚本与标签，否则 CSS 里的 `width:100%` 之类会假阳性
_HTML_BLOCK = re.compile(r"<(style|script)\b[^>]*>.*?</\1\s*>", re.I | re.S)
_HTML_TAG = re.compile(r"<[^>]+>")


def strip_html(text):
    """只保留 HTML 的可见文本，避免 CSS / JS 触发假阳性。"""
    t = _HTML_BLOCK.sub(" ", text)
    t = _HTML_TAG.sub(" ", t)
    return t


def clean_for_scan(text, path=""):
    """按文件类型决定是否剥 HTML。"""
    if str(path).lower().endswith((".html", ".htm")):
        return strip_html(text)
    return text

# 《广告法》禁用极限词 + 平台常见判罚词
AD_LAW = [
    "最好", "最佳", "最优", "最强", "最低价", "最高级", "第一品牌", "全国第一",
    "全网第一", "首选", "顶级", "极致", "绝无仅有", "独一无二", "史无前例",
    "前所未有", "绝对", "100%", "全网最低", "全网最", "国家级", "世界级",
    "领导品牌", "王牌", "独家", "万能", "包治", "无效退款", "免费领",
    "仅此一次", "错过不再", "销量第一", "排名第一", "最便宜", "史上最",
]

# 虚拟商品高危词：涉盗版语义 / 平台重点打击
VIRTUAL_RISK = [
    "破解", "绿色免安装", "外挂", "辅助工具", "挂机脚本", "代练",
    "无限下载", "资源站", "盗版", "白嫖", "账号交易", "租号",
    "卡密解析", "注册机", "激活码生成器", "永久免费", "免费下载",
]

# 虚构数据：新应用没有销量与评价，出现即虚假宣传
FAKE_DATA_PATTERNS = [
    (r"已售\s*\d+", "虚构销量"),
    (r"销量\s*过?\s*\d+", "虚构销量"),
    (r"\d+\s*万?\s*\+?\s*(人|玩家|用户)\s*(已)?(购买|选择|使用|加入)", "虚构用户数"),
    (r"好评如潮", "虚构评价"),
    (r"好评率\s*\d+", "虚构评价"),
    (r"五星好评", "虚构评价"),
    (r"百万玩家", "虚构用户数"),
    # 「永久可重新下载」是合法表述，单独一个「永久」是无依据承诺
    (r"永久(?!可重新下载)", "无依据的永久承诺"),
]

# IP 风险：蹭他人作品名 / 傍名牌
IP_PATTERNS = [
    (r"[\u4e00-\u9fa5A-Za-z0-9]{2,10}同款", "蹭他人作品/品牌名（同款）"),
    (r"[\u4e00-\u9fa5A-Za-z0-9]{2,10}风格", "以他人作品风格作卖点"),
    (r"像[\u4e00-\u9fa5A-Za-z0-9]{2,10}一样", "类比他人作品"),
    (r"[\u4e00-\u9fa5A-Za-z0-9]{2,10}复刻", "复刻他人作品"),
    (r"[\u4e00-\u9fa5A-Za-z0-9]{2,10}同人", "同人（涉他人 IP）"),
]

# 命中后建议的替换写法
SUGGESTIONS = {
    "最好": "好用 / 表现出色",
    "最佳": "较优",
    "最强": "强劲",
    "首选": "推荐",
    "顶级": "高品质",
    "极致": "出色",
    "绝对": "（直接删除）",
    "100%": "（改用可核实的具体数字）",
    "独家": "（直接删除，无依据）",
    "万能": "（直接删除，无依据）",
    "免费领": "（删除，避免诱导）",
    "永久免费": "（删除；虚拟商品写「永久可重新下载」）",
    "免费下载": "（改为描述交付方式，如「购买后获取下载链接」）",
    "绿色免安装": "免安装",
    "破解": "（必须删除，涉盗版）",
    "外挂": "（必须删除）",
    "辅助工具": "辅助功能",
    "代练": "（必须删除）",
    "盗版": "（必须删除）",
    "永久": "永久可重新下载（限定说明范围）",
}


def scan(text):
    """扫描一段文本，返回命中列表。

    每项：{"level": "high|warn", "word": 命中词, "kind": 类别, "suggestion": 建议}
    """
    hits = []
    for w in AD_LAW:
        if w in text:
            hits.append({
                "level": "warn", "word": w, "kind": "广告法极限词",
                "suggestion": SUGGESTIONS.get(w, "（改用可核实的具体描述）"),
            })
    for w in VIRTUAL_RISK:
        if w in text:
            hits.append({
                "level": "high", "word": w, "kind": "虚拟商品高危词",
                "suggestion": SUGGESTIONS.get(w, "（必须删除）"),
            })
    for pat, kind in FAKE_DATA_PATTERNS:
        for m in re.finditer(pat, text):
            hits.append({
                "level": "high", "word": m.group(0), "kind": kind,
                "suggestion": "（新应用无此数据，删除）",
            })
    for pat, kind in IP_PATTERNS:
        for m in re.finditer(pat, text):
            hits.append({
                "level": "high", "word": m.group(0), "kind": kind,
                "suggestion": "（删除；只描述效果本身，不引他人作品）",
            })

    # 去重（同词同类别只留一条）
    seen, uniq = set(), []
    for h in hits:
        key = (h["level"], h["word"], h["kind"])
        if key not in seen:
            seen.add(key)
            uniq.append(h)
    return uniq


def scan_files(paths, read_text):
    """扫描多个文件。read_text(path) -> str。返回 {path: [hits]}。"""
    result = {}
    for p in paths:
        try:
            hits = scan(read_text(p))
            if hits:
                result[p] = hits
        except Exception:
            continue
    return result


def render_report(results):
    """把扫描结果渲染成 Markdown。results: {path: [hits]}"""
    if not results:
        return "# 风控扫描报告\n\n未发现违禁词、极限词、虚构数据或 IP 风险词。可以上架。\n"

    high = sum(1 for hits in results.values() for h in hits if h["level"] == "high")
    warn = sum(1 for hits in results.values() for h in hits if h["level"] == "warn")

    lines = [
        "# 风控扫描报告",
        "",
        f"**高危 {high} 处 · 需修改 {warn} 处**",
        "",
        "高危项必须改完再上架。警告项建议改。",
        "",
    ]
    for path, hits in results.items():
        name = path.replace("\\", "/").rsplit("/", 1)[-1]
        lines.append(f"## {name}")
        lines.append("")
        lines.append("| 级别 | 命中 | 类别 | 建议改法 |")
        lines.append("|---|---|---|---|")
        for h in hits:
            flag = "🔴 高危" if h["level"] == "high" else "🟡 警告"
            word = h["word"].replace("|", "\\|")
            lines.append(f"| {flag} | `{word}` | {h['kind']} | {h['suggestion']} |")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("改完重跑扫描，退出码为 0 才算通过。")
    return "\n".join(lines)
