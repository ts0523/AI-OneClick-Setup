#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loc.py —— 项目中文汉化 + UI 自适应工具链（零第三方依赖）

子命令:
  scan      扫描项目, 抽取待翻译文本 -> .loc/strings.json
  glossary  抽取候选术语(专有名词/品牌词/缩写) -> .loc/glossary.json
  batch     把待翻清单切片 -> .loc/batch_01.json ... (供 AI 分批翻译)
  merge     合并已翻分片 -> .loc/translated.json
  predict   用内置/自定义词典做 Tier-A 直译 -> .loc/translated.json
  verify    批量化校验译文 -> .loc/verify.json
  apply     把译文写回源文件 (自动备份到 .loc/backup/)
  ui        UI 自适应: 依据文本显示宽度比调整尺寸类 CSS (字体/控件类型不变)
  report    汇总 -> .loc/report.md

通用参数:
  --root DIR   项目根目录 (默认当前目录)
  --dir  DIR   中间文件目录 (默认 <root>/.loc)
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import zlib
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

VERSION = 1

TEXT_EXT = {".html", ".htm", ".vue", ".svelte", ".md", ".markdown"}
# 引号扫描器对这一类语言同样成立（字符串字面量语法相近）；
# py/java/cs/go/rs/php 的 UI 文案常硬编码在源码里，纳入扫描范围。
JS_EXT = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
          ".py", ".java", ".kt", ".cs", ".go", ".rs", ".php", ".rb",
          ".c", ".cpp", ".cc", ".h", ".hpp", ".scala", ".dart", ".swift"}
JSON_EXT = {".json"}
CSS_EXT = {".css"}
SKIP_DIRS = {
    "node_modules", "dist", "build", "out", ".git", ".svn", ".hg", "vendor",
    "coverage", ".next", ".nuxt", ".cache", "__pycache__", ".loc", ".idea",
    ".vscode", "bin", "obj", "target", "docs", "venv", ".venv", "env",
}
SKIP_SUFFIX = (".min.js", ".min.css", ".map", ".lock", "-lock.json")
SKIP_NAME_PREFIX = ("package", "tsconfig", "jsconfig", "eslint", "prettier")

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
URL_RE = re.compile(r"(https?://|www\.|\w+@\w+\.\w+)", re.I)
ASSET_RE = re.compile(
    r"\.(png|jpe?g|svg|gif|webp|ico|css|s?css|js|mjs|ts|html?|json|mp3|wav|ogg|"
    r"ttf|otf|woff2?|glb|gltf|obj|fbx|bin|dat|csv|md|txt)$", re.I)
PATH_RE = re.compile(r"^[\w.~/\\-]*(/|\\)[\w.~/\\-]*$")
HEX_RE = re.compile(r"^(#|rgba?\(|hsl\()", re.I)
CONST_RE = re.compile(r"^[A-Z0-9_.\-]+$")
IDENT_RE = re.compile(r"^[a-zA-Z_$][\w$]*$")
JSON_SKIP_KEYS = {
    "id", "key", "type", "src", "href", "url", "link", "path", "file", "class",
    "className", "color", "icon", "version", "name", "value", "code", "lang",
    "locale", "target", "action", "event", "style", "image", "audio", "font",
    "css", "selector", "regex", "pattern", "format", "unit", "currency", "author",
}

CANVAS_HINT_RE = re.compile(r"(getContext\s*\(\s*['\"]2d|THREE\.|WebGLRenderer|canvas)", re.I)

# 双向互换方向 (scan 时由 --from 参数写入):
#   en = 英文项目汉化 -> 中文 (默认)
#   zh = 中文项目译回 -> 英文
FROM_LANG = "en"
TO_LANG = "zh-CN"


# ----------------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------------
def disp_width(s: str) -> int:
    """显示宽度: CJK/全角记 2, 其余记 1。用于估算中英文视觉长度差异。"""
    w = 0
    for ch in s:
        o = ord(ch)
        if (0x1100 <= o <= 0x115F or 0x2E80 <= o <= 0xA4CF or 0xAC00 <= o <= 0xD7A3
                or 0xF900 <= o <= 0xFAFF or 0xFE30 <= o <= 0xFE6F
                or 0xFF00 <= o <= 0xFF60 or 0xFFE0 <= o <= 0xFFE6
                or 0x20000 <= o <= 0x3FFFD):
            w += 2
        elif ch == "\t":
            w += 4
        elif ch == "\n":
            w += 0
        else:
            w += 1
    return w


def has_cjk(s: str) -> bool:
    return bool(CJK_RE.search(s))


def is_src_lang(s: str) -> bool:
    """字符串是否属于当前源语言（五语互换：zh-CN/en/ja/ko/fr 任一方向）。"""
    f = (FROM_LANG or "en").lower()
    if f.startswith("zh"):
        return has_cjk(s)
    if f.startswith("ja"):
        return bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff\uf900-\ufaff]", s))
    if f.startswith("ko"):
        return bool(re.search(r"[\uac00-\ud7af\u1100-\u11ff]", s))
    # fr 与 en 都是拉丁字母，无法靠字符集区分，统一收拉丁串（术语表兜歧义）
    if not re.search(r"[A-Za-z\u00c0-\u024f]", s):
        return False
    return not has_cjk(s)


def pos_of(src: str, off: int):
    line = src.count("\n", 0, off) + 1
    col = off - (src.rfind("\n", 0, off) + 1)
    return line, col


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def write_text(p: Path, s: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8", newline="")


def load_json(p: Path, default=None):
    if not p.exists():
        return default
    try:
        return json.loads(read_text(p))
    except Exception as e:
        print(f"[warn] 无法解析 {p}: {e}", file=sys.stderr)
        return default


def dump_json(p: Path, obj):
    write_text(p, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def iter_files(root: Path, exts):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            if fn.endswith(SKIP_SUFFIX):
                continue
            low = fn.lower()
            if any(low.startswith(x) for x in SKIP_NAME_PREFIX):
                continue
            if Path(fn).suffix.lower() in exts:
                yield Path(dirpath) / fn


def rel(p: Path, root: Path) -> str:
    try:
        return str(p.relative_to(root)).replace("\\", "/")
    except Exception:
        return str(p)


def placeholders(s: str):
    """提取占位符/标签/转义, 用于译文一致性校验。"""
    out = []
    out += re.findall(r"\{[^{}]*\}", s)
    out += re.findall(r"%\d*\$?[sdf]", s)
    out += re.findall(r"\$\{[^}]*\}", s)
    out += re.findall(r"\$\d", s)
    out += [m.group(0).lower() for m in re.finditer(r"</?[a-zA-Z][^<>]*>", s)]
    out += re.findall(r"&[a-zA-Z#0-9]{2,8};", s)
    out += re.findall(r"\\[nrt]", s)
    return out


# ----------------------------------------------------------------------------
# scan: JS / TS 字符串扫描
# ----------------------------------------------------------------------------
def scan_js_strings(src: str):
    """状态机扫描字符串字面量, 跳过注释。yield (start, end, quote_kind)。"""
    i, n = 0, len(src)
    slc = blc = False
    q = None
    tpl = False
    start = 0
    while i < n:
        c = src[i]
        nxt2 = src[i:i + 2]
        if slc:
            if c == "\n":
                slc = False
            i += 1
            continue
        if blc:
            if nxt2 == "*/":
                blc = False
                i += 2
            else:
                i += 1
            continue
        if q:
            if c == "\\":
                i += 2
                continue
            if c == q:
                yield (start, i, q)
                q = None
            i += 1
            continue
        if tpl:
            if c == "\\":
                i += 2
                continue
            if nxt2 == "${":
                depth, j = 1, i + 2
                while j < n and depth:
                    if src[j] == "{":
                        depth += 1
                    elif src[j] == "}":
                        depth -= 1
                    elif src[j] in "\"'":
                        k = src.find(src[j], j + 1)
                        j = k + 1 if k > 0 else j + 1
                        continue
                    j += 1
                i = j
                continue
            if c == "`":
                yield (start, i, "`")
                tpl = False
            i += 1
            continue
        if nxt2 == "//":
            slc = True
            i += 2
            continue
        if nxt2 == "/*":
            blc = True
            i += 2
            continue
        if c in "\"'":
            q = c
            start = i + 1
            i += 1
            continue
        if c == "`":
            tpl = True
            start = i + 1
            i += 1
            continue
        i += 1


def js_verdict(s: str, prev: str, nxt: str):
    """返回 True (收录) / False (丢弃) / 'maybe' (存疑, 仅进样本池)。"""
    t = s.strip()
    if len(t) < 2:
        return False
    if FROM_LANG == "zh":
        # 中文项目 -> 英文: 收含中文的字符串 (中文字符串不可能是标识符/资源名, 直接收)
        if not has_cjk(t):
            return False
    else:
        # 英文项目 -> 中文: 只收纯英文, 跳过已含中文的
        if not re.search(r"[A-Za-z]", t) or has_cjk(t):
            return False
    if URL_RE.search(t) or HEX_RE.match(t) or PATH_RE.match(t):
        return False
    if ASSET_RE.search(t):
        return False
    if FROM_LANG == "en" and len(t.split()) == 1:
        if IDENT_RE.match(t) and nxt.strip().startswith(":"):
            return False
        if t.startswith((".", "#")) or t.endswith(")"):
            return False
        if CONST_RE.match(t) and not re.search(r"[a-z]", t):
            return "maybe"
        if IDENT_RE.match(t):
            # 单个标识符: 可能是枚举值也可能是 UI 词, 进存疑池
            return "maybe"
    if re.search(r"(require|import)\s*\(?\s*$", prev):
        return False
    if re.search(r"(case|switch)\s*$", prev):
        return False
    if re.match(r"^\d+(\.\d+)*$", t):
        return False
    if t.count(" ") >= 12:
        return False
    return True


# ----------------------------------------------------------------------------
# scan
# ----------------------------------------------------------------------------
ATTR_RE = re.compile(
    r"\b(placeholder|title|alt|aria-label|label)\s*=\s*(\"([^\"]*)\"|'([^']*)')")


def element_selector(masked: str, off: int):
    """向前回溯最近开标签, 生成 tag#id.class 形式的选择器。"""
    j = masked.rfind("<", 0, off)
    if j < 0:
        return None, None
    seg = masked[j:off]
    m = re.match(r"<\s*([a-zA-Z][\w-]*)", seg)
    if not m:
        return None, None
    tag = m.group(1).lower()
    cm = re.search(r"\bclass\s*=\s*(\"([^\"]*)\"|'([^']*)')", seg)
    classes = []
    if cm:
        classes = [c for c in (cm.group(2) or cm.group(3) or "").split() if c]
    im = re.search(r"\bid\s*=\s*(\"([^\"]*)\"|'([^']*)')", seg)
    sel = tag
    if im and im.group(2):
        sel += "#" + im.group(2)
    for c in classes[:3]:
        sel += "." + c
    return sel, {"tag": tag, "id": (im.group(2) if im else None), "classes": classes}


def blank_like(text: str) -> str:
    """等长打码但保留换行, 使行号/列号与原文件严格一致。"""
    return "".join(ch if ch == "\n" else " " for ch in text)


def scan_file(path: Path, root: Path, out, css_pool, skipped, canvas_files):
    rp = rel(path, root)
    src = read_text(path)
    ext = path.suffix.lower()

    if CANVAS_HINT_RE.search(src):
        canvas_files.append(rp)

    if ext in CSS_EXT:
        css_pool.append({"file": rp, "text": src, "kind": "file"})
        return

    if ext in JSON_EXT:
        scan_json_file(path, rp, src, out)
        return

    if ext in JS_EXT:
        scan_js_file(path, rp, src, out, skipped)
        return

    # ---- HTML 类 ----
    masked = src
    # script / style 块
    blocks = []
    for m in re.finditer(r"<(script|style)\b[^>]*>(.*?)</\1>", src, re.S | re.I):
        blocks.append((m.start(2), m.end(2), m.group(1).lower(), m.group(2)))
        span = blank_like(m.group(2))
        masked = masked[:m.start(2)] + span + masked[m.end(2):]
    for start, end, kind, body in blocks:
        if kind == "script":
            scan_js_file(path, rp, src, out, skipped, base=start, region=(start, end))
        else:
            css_pool.append({"file": rp, "text": body, "kind": "style-block", "base": start})

    # 注释
    masked = re.sub(r"<!--.*?-->", lambda m: blank_like(m.group(0)), masked, flags=re.S)

    # <html lang="xx">: 双语互换时必须同步语言标记 (自动处理, 不进翻译批次)
    for m in re.finditer(r"<html[^>]*\blang\s*=\s*([\"'])([\w-]+)\1", masked, re.I):
        cur = m.group(2)
        tgt_base = (TO_LANG or "").split("-")[0]
        if cur.split("-")[0].lower() == tgt_base.lower():
            continue
        line, col = pos_of(masked, m.start(2))
        it = mk_item(rp, line, col, "html-lang", cur, m.group(0)[:60], src, m.start(2))
        it["auto"] = True
        out.append(it)

    # 属性文案
    for m in ATTR_RE.finditer(masked):
        val = m.group(3) if m.group(3) is not None else m.group(4)
        if not val.strip() or "{{" in val:
            continue
        if not is_src_lang(val):
            if has_cjk(val) or re.search(r"[A-Za-z]", val):
                skipped.append({"file": rp, "text": val[:60], "reason": "already_translated"})
            continue
        line, col = pos_of(masked, m.start(3) if m.group(3) is not None else m.start(4))
        out.append(mk_item(rp, line, col, "html-attr", val, m.group(0)[:40], src, m.start(1)))

    # 文本节点
    for m in re.finditer(r">([^<>]*[A-Za-z][^<>]*)<", masked):
        t = m.group(1)
        raw = t.strip()
        if not raw or "{{" in raw or URL_RE.search(raw):
            continue
        off = m.start(1) + (len(t) - len(t.lstrip()))
        if not is_src_lang(raw):
            if has_cjk(raw) or re.search(r"[A-Za-z]", raw):
                skipped.append({"file": rp, "text": raw[:60], "reason": "already_translated"})
            continue
        line, col = pos_of(masked, off)
        sel, meta = element_selector(masked, m.start(1))
        it = mk_item(rp, line, col, "html-text", raw, masked[max(0, m.start(1) - 60):m.start(1)],
                     src, off)
        it["selector"] = sel
        it["el"] = meta
        out.append(it)

    # 内联 style
    for m in re.finditer(r'style\s*=\s*"([^"]*)"', masked):
        css_pool.append({"file": rp, "text": "inline{" + m.group(1) + "}", "kind": "inline",
                         "base": m.start(1), "selector_hint": None})


def mk_item(rp, line, col, itype, source, context, full_src, off):
    return {
        "id": f"{rp}:{line}:{col}:{zlib.crc32(source.encode('utf-8')) % 10000:04d}",
        "file": rp,
        "line": line,
        "col": col,
        "type": itype,
        "source": source,
        "src_width": disp_width(source),
        "context": (context or "")[-80:],
        "selector": None,
    }


def scan_js_file(path: Path, rp, src, out, skipped, base=0, region=None):
    for (s, e, q) in scan_js_strings(src):
        if region and not (region[0] <= s < region[1]):
            continue
        val = src[s:e]
        prev = src[max(0, s - 30):s]
        nxt = src[e:e + 12]
        v = js_verdict(val, prev, nxt)
        if v is False:
            continue
        if v == "maybe":
            skipped.append({"file": rp, "text": val[:60], "reason": "identifier_or_const"})
            continue
        line, col = pos_of(src, s)
        it = mk_item(rp, line, col, "js-string", val, prev, src, s)
        it["quote"] = q
        out.append(it)


def scan_json_file(path: Path, rp, src, out):
    try:
        data = json.loads(src)
    except Exception:
        return

    def walk(node, jpath):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str):
                    if k in JSON_SKIP_KEYS or str(k).startswith("_"):
                        continue
                    if len(v.strip()) < 2 or not is_src_lang(v):
                        continue
                    it = mk_item(rp, 0, 0, "i18n-json", v, "/".join(jpath + [str(k)]), src, 0)
                    it["json_path"] = jpath + [str(k)]
                    out.append(it)
                else:
                    walk(v, jpath + [str(k)])
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, jpath + [str(i)])

    walk(data, [])


def cmd_scan(args):
    global FROM_LANG, TO_LANG
    FROM_LANG = args.from_lang
    TO_LANG = args.to
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    loc.mkdir(parents=True, exist_ok=True)

    exts = TEXT_EXT | JS_EXT | JSON_EXT | CSS_EXT
    items, css_pool, skipped, canvas_files = [], [], [], []
    files = sorted(iter_files(root, exts))
    if args.include:
        inc = [x.strip().lower() for x in args.include.split(",")]
        files = [f for f in files if any(str(f).lower().endswith(x) for x in inc)]
    for f in files:
        scan_file(f, root, items, css_pool, skipped, canvas_files)

    # 去重
    seen, uniq = set(), []
    for it in items:
        k = (it["file"], it["line"], it["col"], it["source"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(it)

    data = {
        "version": VERSION,
        "root": str(root),
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "from": FROM_LANG,
        "to": TO_LANG,
        "target_lang": TO_LANG,
        "tier": args.tier,
        "stats": {
            "files_scanned": len(files),
            "items": len(uniq),
            "skipped_samples": len(skipped),
        },
        "items": uniq,
        "skipped_samples": skipped[:200],
        "canvas_ui_files": sorted(set(canvas_files)),
    }
    dump_json(loc / "strings.json", data)
    print(f"[scan] 文件 {len(files)} 个, 待翻条目 {len(uniq)} 条, 存疑样本 {len(skipped)} 条")
    print(f"[scan] 输出: {loc / 'strings.json'}")
    if data["canvas_ui_files"]:
        print(f"[scan] 检测到 canvas/WebGL 绘制 UI: {len(data['canvas_ui_files'])} 个文件 "
              f"(这类 UI 的尺寸在绘制代码里, CSS 适配管不到, 需单独处理)")
    by_type = {}
    for it in uniq:
        by_type[it["type"]] = by_type.get(it["type"], 0) + 1
    print(f"[scan] 类型分布: {by_type}")


# ----------------------------------------------------------------------------
# glossary
# ----------------------------------------------------------------------------
WORD_RE = re.compile(r"\b([A-Z][a-zA-Z0-9]{2,}|[A-Z]{2,6})\b")


def cmd_glossary(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    data = load_json(loc / "strings.json")
    if not data:
        print("[glossary] 缺少 .loc/strings.json, 请先运行 scan")
        return 2
    freq = {}
    if data.get("from") == "zh":
        # 中文方向: 抽高频中文词组做术语
        for it in data["items"]:
            for w in re.findall(r"[\u4e00-\u9fff]{2,6}", it["source"]):
                freq[w] = freq.get(w, 0) + 1
    else:
        for it in data["items"]:
            for w in WORD_RE.findall(it["source"]):
                if w.lower() in {"the", "and", "for", "you", "are", "with", "this", "that"}:
                    continue
                freq[w] = freq.get(w, 0) + 1
    old = load_json(loc / "glossary.json") or {"terms": []}
    exist = {t["source"] for t in old.get("terms", [])}
    terms = list(old.get("terms", []))
    for w, c in sorted(freq.items(), key=lambda kv: -kv[1])[:args.top]:
        if w in exist:
            continue
        terms.append({"source": w, "target": "", "keep": False, "note": f"出现 {c} 次"})
    dump_json(loc / "glossary.json", {"version": VERSION, "terms": terms})
    print(f"[glossary] 术语 {len(terms)} 条 -> {loc / 'glossary.json'} (target 留空待填/待 AI 填)")


# ----------------------------------------------------------------------------
# batch / merge
# ----------------------------------------------------------------------------
def cmd_batch(args):
    loc = Path(args.dir) if args.dir else Path(args.root).resolve() / ".loc"
    data = load_json(loc / "strings.json")
    if not data:
        print("[batch] 缺少 .loc/strings.json")
        return 2
    items = data["items"]
    n = max(1, args.size)
    chunks = [items[i:i + n] for i in range(0, len(items), n)]
    for i, ch in enumerate(chunks, 1):
        dump_json(loc / f"batch_{i:03d}.json", {
            "batch": i,
            "total_batches": len(chunks),
            "from": data.get("from", "en"),
            "target_lang": data.get("target_lang", "zh-CN"),
            "glossary": (load_json(loc / "glossary.json") or {}).get("terms", []),
            "items": [{"id": it["id"], "source": it["source"],
                       "context": it.get("context", ""), "type": it["type"]}
                      for it in ch if it.get("type") != "html-lang"],
        })
    print(f"[batch] 切成 {len(chunks)} 片, 每片 <= {n} 条 -> {loc}/batch_*.json")


def cmd_merge(args):
    loc = Path(args.dir) if args.dir else Path(args.root).resolve() / ".loc"
    merged = {}
    for p in sorted(loc.glob("batch_*.json")):
        if p.name.endswith(".done.json"):
            continue
        done = p.with_suffix("").with_name(p.stem + ".done.json")
        src = done if done.exists() else None
        if src is None:
            alt = loc / (p.stem + "_done.json")
            src = alt if alt.exists() else None
        if src is None:
            print(f"[merge] 跳过 {p.name} (无 .done 文件)")
            continue
        d = load_json(src) or {}
        for it in d.get("items", []):
            if it.get("target"):
                merged[it["id"]] = it["target"]
    # 独立成文件的完成批次：batch_001.done.json 与 batch_001_done.json 都认
    seen = set()
    for p in sorted(list(loc.glob("*.done.json")) + list(loc.glob("*_done.json"))):
        if p.name in seen:
            continue
        seen.add(p.name)
        d = load_json(p) or {}
        for it in d.get("items", []):
            if it.get("target"):
                merged[it["id"]] = it["target"]
    dump_json(loc / "translated.json", {
        "version": VERSION,
        "items": [{"id": k, "target": v} for k, v in merged.items()],
    })
    print(f"[merge] 合并译文 {len(merged)} 条 -> {loc / 'translated.json'}")


# ----------------------------------------------------------------------------
# predict (Tier A 词典直译)
# ----------------------------------------------------------------------------
def load_dict(path):
    d = load_json(Path(path)) or {}
    if isinstance(d, dict) and "entries" in d:
        d = d["entries"]
    return {str(k).lower(): v for k, v in d.items()}


def dict_translate(s, dic, from_lang="en"):
    key = s.strip().lower() if from_lang == "en" else s.strip()
    if key in dic:
        return dic[key], "exact"
    words = s.split()
    if from_lang != "zh" and 2 <= len(words) <= 4:
        parts = [dic.get(w.lower().strip(".,:!?"), None) for w in words]
        # 只有全部词都命中词典才逐词拼, 避免产出中英混杂的垃圾译文
        if parts and all(p is not None for p in parts):
            joined = "".join(parts)
            return (joined if has_cjk(joined) else " ".join(parts)), "wordwise"
    return None, "miss"


def cmd_predict(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    data = load_json(loc / "strings.json")
    if not data:
        print("[predict] 缺少 .loc/strings.json")
        return 2
    dic = load_dict(args.dict) if args.dict else None
    if dic is None:
        # 按目标语言选内置词典: ja -> builtin-dict-ja.json, 其余 -> builtin-dict.json
        to_lang = str(data.get("to") or data.get("target_lang") or "")
        name = "builtin-dict-ja.json" if to_lang.lower().startswith("ja") else "builtin-dict.json"
        dic = load_dict(Path(__file__).resolve().parent.parent / "assets" / name)
    if data.get("from") == "zh":
        # 双向互换: zh->en 时把内置词典反转 (中文 key -> 英文 value)
        dic = {v: k for k, v in dic.items()}
    gl = load_json(loc / "glossary.json") or {"terms": []}
    for t in gl.get("terms", []):
        if t.get("target") and t.get("source"):
            dic.setdefault(t["source"], t["target"])
    out, miss, modes = [], 0, {}
    from_lang = data.get("from", "en")
    for it in data["items"]:
        tg, mode = dict_translate(it["source"], dic, from_lang)
        modes[mode] = modes.get(mode, 0) + 1
        if tg:
            out.append({"id": it["id"], "target": tg, "mode": mode})
        else:
            miss += 1
    dump_json(loc / "translated.json", {"version": VERSION, "items": out})
    print(f"[predict] 词典覆盖 {len(out)} 条 (精确 {modes.get('exact', 0)} / 逐词 {modes.get('wordwise', 0)}), "
          f"未覆盖 {miss} 条 -> {loc / 'translated.json'}")


# ----------------------------------------------------------------------------
# verify
# ----------------------------------------------------------------------------
def cmd_verify(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    sdata = load_json(loc / "strings.json")
    tdata = load_json(loc / "translated.json")
    if not sdata or not tdata:
        print("[verify] 缺少 .loc/strings.json 或 .loc/translated.json")
        return 2
    tmap = {}
    for it in tdata.get("items", []):
        if it.get("target"):
            tmap[it["id"]] = it["target"]
    gl = {t["source"]: t for t in (load_json(loc / "glossary.json") or {"terms": []}).get("terms", [])
          if t.get("source")}

    issues, stats = [], {"total": sum(1 for i in sdata["items"] if i.get("type") != "html-lang"),
                         "translated": 0, "pass": 0, "warn": 0, "fail": 0}
    src2tgt = {}

    for it in sdata["items"]:
        iid = it["id"]
        src = it["source"]
        if it.get("type") == "html-lang":
            continue  # <html lang> 由 apply 自动同步, 不需要人工/AI 翻译
        tgt = tmap.get(iid)
        if not tgt:
            issues.append({"id": iid, "level": "fail", "code": "untranslated",
                           "msg": "未翻译", "source": src})
            stats["fail"] += 1
            continue
        stats["translated"] += 1
        level = "pass"

        def add(code, msg, lv="fail"):
            nonlocal level
            issues.append({"id": iid, "level": lv, "code": code, "msg": msg,
                           "source": src, "target": tgt})
            if lv == "fail":
                level = "fail"
            elif level != "fail":
                level = "warn"

        if tgt == src and (re.search(r"[A-Za-z]{3,}", src) or has_cjk(src)):
            add("unchanged", "译文与原文相同, 疑似漏翻")
        if sdata.get("from", "en") == "en":
            if not has_cjk(tgt) and re.search(r"[A-Za-z]{3,}", src):
                add("no_cjk", "译文不含 CJK 字符(中文/日文)", "warn")
        else:
            if has_cjk(tgt):
                add("has_cjk", "方向为 zh->en, 但译文仍含中文")
        ph_s, ph_t = sorted(placeholders(src)), sorted(placeholders(tgt))
        if ph_s != ph_t:
            add("placeholder", f"占位符不一致: 原文 {ph_s} vs 译文 {ph_t}")
        if src != src.strip() and tgt == tgt.strip() and (src.startswith(" ") or src.endswith(" ")):
            add("whitespace", "首尾空白丢失", "warn")
        if it.get("quote") == '"' and '"' in tgt:
            add("quote_break", "译文含未转义双引号, 会破坏字符串字面量")
        if it.get("quote") == "'" and "'" in tgt:
            add("quote_break", "译文含未转义单引号, 会破坏字符串字面量", "warn")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", tgt):
            add("control_char", "译文含控制字符")
        sw, tw = disp_width(src), disp_width(tgt)
        ratio = tw / sw if sw else 1.0
        if ratio > float(args.max_ratio):
            add("overflow_risk", f"译文显示宽度 {tw} vs 原文 {sw} (x{ratio:.2f}), 有撑破 UI 风险",
                "warn")
        if ratio < float(args.min_ratio) and sw >= 6:
            add("too_short", f"译文过短 ({tw} vs {sw}), 可能漏译", "warn")
        for term, meta in gl.items():
            if not meta.get("target"):
                continue
            if re.search(r"\b" + re.escape(term) + r"\b", src, re.I):
                if meta.get("keep"):
                    if term in tgt:
                        continue
                    add("glossary_keep", f"术语 '{term}' 标记为不翻译, 但译文中未保留原文", "warn")
                elif meta["target"] not in tgt:
                    add("glossary_miss", f"术语 '{term}' 未按术语表译为 '{meta['target']}'", "warn")
        if src in src2tgt and src2tgt[src] != tgt:
            add("inconsistent", f"相同原文有不同译文 (另一处为 '{src2tgt[src]}')", "warn")
        src2tgt[src] = tgt
        stats[level] = stats.get(level, 0) + 1

    ok = stats["pass"]
    dump_json(loc / "verify.json", {"version": VERSION, "stats": stats, "issues": issues})
    print(f"[verify] 总数 {stats['total']} / 已翻 {stats['translated']} / "
          f"通过 {ok} / 警告 {stats['warn']} / 失败 {stats['fail']}")
    print(f"[verify] 输出: {loc / 'verify.json'}")
    if issues:
        cnt = {}
        for i in issues:
            cnt[i["code"]] = cnt.get(i["code"], 0) + 1
        print(f"[verify] 问题分布: {cnt}")
    return 0


# ----------------------------------------------------------------------------
# apply
# ----------------------------------------------------------------------------
def backup(root: Path, loc: Path, rp: str):
    dst = loc / "backup" / rp
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(root / rp, dst)
    except Exception as e:
        print(f"[warn] 备份失败 {rp}: {e}", file=sys.stderr)


def cmd_apply(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    sdata = load_json(loc / "strings.json")
    tdata = load_json(loc / "translated.json")
    if not sdata or not tdata:
        print("[apply] 缺少 .loc/strings.json 或 .loc/translated.json")
        return 2
    tmap = {it["id"]: it["target"] for it in tdata.get("items", []) if it.get("target")}
    # <html lang="..."> 自动同步为目标语言, 不依赖人工译文
    to_lang = sdata.get("to") or sdata.get("target_lang") or "zh-CN"
    for it in sdata["items"]:
        if it.get("type") == "html-lang":
            tmap[it["id"]] = to_lang

    by_file, json_files = {}, set()
    for it in sdata["items"]:
        if it["id"] not in tmap:
            continue
        if it["type"] == "i18n-json":
            json_files.add(it["file"])
        else:
            by_file.setdefault(it["file"], []).append(it)

    changed, failed = 0, []
    for rp, items in by_file.items():
        p = root / rp
        if not p.exists():
            failed.append((rp, "文件不存在"))
            continue
        src = read_text(p)
        lines = src.splitlines(keepends=True)
        if not args.dry_run:
            backup(root, loc, rp)
        items.sort(key=lambda x: (x["line"], x["col"]), reverse=True)
        for it in items:
            li = it["line"] - 1
            if li >= len(lines):
                failed.append((rp, f"行号越界 {it['line']}"))
                continue
            line = lines[li]
            col = it["col"]
            s = it["source"]
            if line[col:col + len(s)] != s:
                k = line.find(s, max(0, col - 8))
                if k < 0:
                    failed.append((rp, f"L{it['line']} 定位失败: {s[:30]}"))
                    continue
                col = k
            lines[li] = line[:col] + tmap[it["id"]] + line[col + len(s):]
            changed += 1
        if not args.dry_run:
            write_text(p, "".join(lines))

    for rp in json_files:
        p = root / rp
        try:
            data = json.loads(read_text(p))
        except Exception as e:
            failed.append((rp, f"JSON 解析失败 {e}"))
            continue
        if not args.dry_run:
            backup(root, loc, rp)
        for it in sdata["items"]:
            if it["file"] != rp or it["type"] != "i18n-json" or it["id"] not in tmap:
                continue
            node = data
            path = it.get("json_path", [])
            try:
                for k in path[:-1]:
                    node = node[int(k)] if isinstance(node, list) else node[k]
                last = path[-1]
                if isinstance(node, list):
                    node[int(last)] = tmap[it["id"]]
                else:
                    node[last] = tmap[it["id"]]
                changed += 1
            except Exception as e:
                failed.append((rp, f"写入失败 {e}"))
        if not args.dry_run:
            dump_json(p, data)

    tag = "(dry-run) " if args.dry_run else ""
    print(f"[apply] {tag}替换 {changed} 处, 失败 {len(failed)} 处, 涉及文件 {len(by_file) + len(json_files)} 个")
    for f, r in failed[:15]:
        print(f"  [!] {f}: {r}")
    if not args.dry_run:
        print(f"[apply] 原文件已备份到 {loc / 'backup'}")
    return 0


# ----------------------------------------------------------------------------
# ui 自适应
# ----------------------------------------------------------------------------
SIZE_PROPS_WIDTH = {"width", "min-width", "max-width"}
SIZE_PROPS_PAD = {"padding-left", "padding-right"}
SIZE_PROPS_FONT = {"font-size", "line-height"}
KEEP_PROPS = {"font-family", "font-weight", "font-style", "color", "border-radius",
              "display", "position", "flex", "grid", "height", "border", "background"}

DECL_RE = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)")
NUM_RE = re.compile(r"(-?\d+(?:\.\d+)?)(px|pt)")


def fmt_px(v: float) -> str:
    """像素取整美化: >=8 四舍五入到整数, 小数保留 1 位。"""
    if abs(v) >= 8:
        return f"{int(round(v))}"
    return f"{round(v, 1):g}"


def adjust_decls(block: str, r: float, opts):
    """在声明块文本内做原地替换, 返回 (新文本, 变更列表)。只动尺寸类属性。"""
    changes = []
    out = block
    has_no_width = True
    for m in DECL_RE.finditer(block):
        if m.group(1).strip().lower() in SIZE_PROPS_WIDTH:
            has_no_width = False
    for m in reversed(list(DECL_RE.finditer(block))):
        prop = m.group(1).strip().lower()
        val = m.group(2)
        new_val = None
        reason = ""
        if prop in SIZE_PROPS_WIDTH:
            if r >= opts["min_ratio"]:
                def rep(mm):
                    v = float(mm.group(1))
                    nv = min(v * r, v * opts["max_expand"])
                    return fmt_px(max(nv, v)) + mm.group(2)
                cand = NUM_RE.sub(rep, val)
                if cand != val:
                    new_val, reason = cand, f"{prop} x{r:.2f}"
            elif r < 1.0 and opts["allow_shrink"]:
                def rep(mm):
                    v = float(mm.group(1))
                    nv = max(v * max(r, opts["min_shrink"]), 8)
                    return fmt_px(nv) + mm.group(2)
                cand = NUM_RE.sub(rep, val)
                if cand != val:
                    new_val, reason = cand, f"{prop} x{max(r, opts['min_shrink']):.2f}(收缩)"
        elif prop == "padding":
            parts = val.split()
            nums = [x for x in parts if NUM_RE.fullmatch(x)]
            if len(nums) == len(parts) and len(parts) in (2, 3, 4):
                def rep(mm, idx=[0]):
                    v = float(mm.group(1))
                    is_h = (len(parts) == 4 and idx[0] in (1, 3)) or (len(parts) == 2 and idx[0] == 1) \
                           or (len(parts) == 3 and idx[0] == 1)
                    idx[0] += 1
                    if not is_h or r < opts["min_ratio"]:
                        return mm.group(0)
                    return fmt_px(min(v * r, v * opts["max_expand"])) + mm.group(2)
                cand = NUM_RE.sub(rep, val)
                if cand != val:
                    new_val, reason = cand, f"padding 水平方向 x{r:.2f}"
        elif prop in SIZE_PROPS_PAD:
            def rep(mm):
                v = float(mm.group(1))
                return fmt_px(min(v * r, v * opts["max_expand"])) + mm.group(2)
            cand = NUM_RE.sub(rep, val)
            if cand != val and r >= opts["min_ratio"]:
                new_val, reason = cand, f"{prop} x{r:.2f}"
        elif prop == "font-size" and opts["font_shrink"] and has_no_width and r > opts["shrink_trigger"]:
            # 只有"无宽度属性可扩"的纯文本容器才缩字号, 宽度本来能扩的不许缩
            def rep(mm):
                v = float(mm.group(1))
                f = max(1.0 / r, opts["min_font_factor"])
                nv = max(v * f, opts["min_font_px"])
                return fmt_px(nv) + mm.group(2)
            cand = NUM_RE.sub(rep, val)
            if cand != val:
                new_val, reason = cand, f"无宽度可扩, font-size 微调 (r={r:.2f})"
        elif prop == "line-height" and r >= opts["min_ratio"] and re.match(r"^\s*\d+(\.\d+)?\s*$", val):
            v = float(val.strip())
            if v < 2.0:
                new_val, reason = f"{round(min(v + 0.1, 2.0), 2):g}", "CJK 行高 +0.1"
        if new_val is not None:
            s, e = m.start(2), m.end(2)
            out = out[:s] + new_val + out[e:]
            changes.append({"prop": prop, "from": val.strip(), "to": new_val.strip(), "reason": reason})
    return out, changes


def adjust_css_text(css_text: str, r: float, opts):
    """倒序处理各声明块, 返回 (新文本, 变更列表)。"""
    changes, out = [], css_text
    try:
        blocks = list(re.finditer(r"\{([^{}]*)\}", css_text))
    except Exception:
        return out, changes
    for m in reversed(blocks):
        new_block, ch = adjust_decls(m.group(1), r, opts)
        if ch:
            out = out[:m.start(1)] + new_block + out[m.end(1):]
            for c in ch:
                c["block"] = m.group(1)[:60]
            changes.extend(ch)
    return out, changes


def sel_tokens(sel: str):
    m = re.match(r"^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)", sel or "")
    if not m:
        return set(), None
    toks = set()
    if m.group(1):
        toks.add(m.group(1).lower())
    if m.group(2):
        toks.add(m.group(2))
    for c in re.findall(r"\.[\w-]+", m.group(3) or ""):
        toks.add(c)
    return toks, (m.group(1) or None)


def rule_matches(rule_sel: str, el_tokens: set):
    """复合/后代选择器按最后一段匹配元素 (无 DOM 解析的近似:
    '#menu .btn' 视为作用于 .btn 元素)。多个并列选择器任一命中即命中。"""
    for group in re.split(r",", rule_sel):
        parts = [p for p in re.split(r"\s+|>|~|\+", group.strip()) if p]
        if not parts:
            continue
        toks, _ = sel_tokens(parts[-1])
        toks = {t for t in toks if t}
        if toks and toks.issubset(el_tokens):
            return True
    return False


def cmd_ui(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    sdata = load_json(loc / "strings.json")
    tdata = load_json(loc / "translated.json")
    if not sdata or not tdata:
        print("[ui] 缺少 .loc/strings.json 或 .loc/translated.json")
        return 2
    tmap = {it["id"]: it["target"] for it in tdata.get("items", []) if it.get("target")}
    opts = {
        "min_ratio": float(args.min_ratio),
        "max_expand": float(args.max_expand),
        "allow_shrink": args.allow_shrink,
        "min_shrink": 0.8,
        "font_shrink": not args.no_font_shrink,
        "shrink_trigger": float(args.shrink_trigger),
        "min_font_factor": 0.85,
        "min_font_px": 12.0,
    }

    # 1. 收集需要适配的条目
    targets = []
    for it in sdata["items"]:
        tgt = tmap.get(it["id"])
        if not tgt:
            continue
        sw, tw = disp_width(it["source"]), disp_width(tgt)
        if sw <= 0:
            continue
        r = tw / sw
        if it["source"] == tgt:
            continue
        targets.append({"id": it["id"], "file": it["file"], "selector": it.get("selector"),
                        "type": it["type"], "source": it["source"], "target": tgt,
                        "src_w": sw, "tgt_w": tw, "ratio": round(r, 3)})

    # 2. 收集 CSS
    css_files = {}
    for p in iter_files(root, CSS_EXT):
        css_files[rel(p, root)] = read_text(p)
    for p in iter_files(root, TEXT_EXT):
        rp = rel(p, root)
        src = read_text(p)
        for m in re.finditer(r"<style[^>]*>(.*?)</style>", src, re.S | re.I):
            css_files[f"{rp}#style{m.start(1)}"] = m.group(1)

    # 3. 按文件聚合需要处理的 ratio (取该 selector 命中项的最大 ratio)
    file_rules = {}  # css_key -> {rule_selector: ratio}
    unmatched = []
    for t in targets:
        if not t["selector"]:
            unmatched.append({"id": t["id"], "file": t["file"], "reason": "无 DOM 选择器(JS 字符串)",
                              "ratio": t["ratio"]})
            continue
        el_tokens, _ = sel_tokens(t["selector"])
        hit = False
        matched_no_need = False
        for key, css in css_files.items():
            f = key.split("#")[0]
            for rm in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
                if rule_matches(rm.group(1), el_tokens):
                    if t["ratio"] >= opts["min_ratio"] or opts["allow_shrink"]:
                        # ratio 初值必须为 0: 收缩方向要用最小可用比, 初值 1.0 会吃掉收缩
                        file_rules.setdefault(key, {}).setdefault(
                            rm.group(1).strip(), {"ratio": 0.0, "items": []})
                        fr = file_rules[key][rm.group(1).strip()]
                        fr["ratio"] = max(fr["ratio"], t["ratio"])
                        fr["items"].append(t["id"])
                        hit = True
                    else:
                        matched_no_need = True
        if not hit:
            unmatched.append({"id": t["id"], "file": t["file"], "selector": t["selector"],
                              "reason": ("已匹配 CSS 但译文更短, 无需扩容" if matched_no_need
                                         else "未找到匹配 CSS 规则"),
                              "ratio": t["ratio"]})

    # 4. 应用调整
    changes, ff_before, ff_after = [], {}, {}
    for key, rules in file_rules.items():
        css = css_files[key]
        ff_before[key] = re.findall(r"font-family\s*:\s*[^;]+", css)
        new_css = css
        for rm in reversed(list(re.finditer(r"([^{}]+)\{([^{}]*)\}", css))):
            sel = rm.group(1).strip()
            if sel not in rules:
                continue
            r = rules[sel]["ratio"]
            nb, ch = adjust_decls(rm.group(2), r, opts)
            if ch:
                new_css = new_css[:rm.start(2)] + nb + new_css[rm.end(2):]
                for c in ch:
                    c.update({"css": key, "selector": sel, "ratio": round(r, 2),
                              "items": rules[sel]["items"][:5]})
                changes.extend(ch)
        css_files[key] = new_css
        ff_after[key] = re.findall(r"font-family\s*:\s*[^;]+", new_css)

    font_unchanged = all(ff_before[k] == ff_after[k] for k in ff_before)
    if not args.dry_run and changes:
        for key, text in css_files.items():
            if "#style" in key:
                rp, off = key.split("#style")
                p = root / rp
                src = read_text(p)
                backup(root, loc, rp)
                out, last = [], 0
                for m in re.finditer(r"(<style[^>]*>)(.*?)(</style>)", src, re.S | re.I):
                    k2 = f"{rp}#style{m.start(2)}"
                    out.append(src[last:m.start(2)])
                    out.append(css_files.get(k2, m.group(2)))
                    last = m.end(2)
                out.append(src[last:])
                write_text(p, "".join(out))
            else:
                p = root / key
                backup(root, loc, key)
                write_text(p, text)

    rep = {
        "version": VERSION,
        "opts": opts,
        "targets": targets,
        "changes": changes,
        "unmatched": unmatched,
        "font_family_unchanged": font_unchanged,
        "canvas_ui_files": sdata.get("canvas_ui_files", []),
        "note_canvas": ("检测到 canvas/WebGL 绘制的 UI, 其尺寸写在绘制代码里, "
                        "CSS 适配无法覆盖, 需按同样的宽度比手动/AI 调整绘制参数"),
    }
    dump_json(loc / "ui-report.json", rep)
    print(f"[ui] 待适配条目 {len(targets)} / 实际调整 {len(changes)} 处 / "
          f"未匹配 {len(unmatched)} 条")
    print(f"[ui] font-family 保持不变: {font_unchanged}  |  控件类型/class/结构: 未改动")
    print(f"[ui] 输出: {loc / 'ui-report.json'}")
    if sdata.get("canvas_ui_files"):
        print(f"[ui] 注意: {len(sdata['canvas_ui_files'])} 个文件用 canvas/WebGL 画 UI, "
              f"需单独调整绘制尺寸")
    return 0


# ----------------------------------------------------------------------------
# report
# ----------------------------------------------------------------------------
def cmd_report(args):
    root = Path(args.root).resolve()
    loc = Path(args.dir) if args.dir else root / ".loc"
    s = load_json(loc / "strings.json") or {}
    v = load_json(loc / "verify.json") or {}
    u = load_json(loc / "ui-report.json") or {}
    uich = u.get("changes", [])
    lines = []
    A = lines.append
    A("# 项目汉化报告\n")
    A(f"- 项目根目录: `{root}`")
    direction = f"{s.get('from', 'en')} -> {s.get('target_lang', 'zh-CN')}"
    A(f"- 方向: {direction} (双向互换: scan --from zh 可把中文项目译回英文)")
    A(f"- 档位: Tier {str(s.get('tier', 'c')).upper()}")
    A(f"- 生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    st = s.get("stats", {})
    A(f"## 1. 扫描\n- 扫描文件 {st.get('files_scanned', 0)} 个, 抽取条目 {st.get('items', 0)} 条\n")
    if v:
        vs = v.get("stats", {})
        A("## 2. 翻译校验\n")
        A(f"| 指标 | 数量 |\n|---|---|\n| 总条目 | {vs.get('total', 0)} |"
          f"\n| 已翻译 | {vs.get('translated', 0)} |\n| 通过 | {vs.get('pass', 0)} |"
          f"\n| 警告 | {vs.get('warn', 0)} |\n| 失败 | {vs.get('fail', 0)} |\n")
        fails = [i for i in v.get("issues", []) if i["level"] == "fail"][:20]
        if fails:
            A("### 失败项 (前 20)\n")
            A("| 原文 | 译文 | 问题 |\n|---|---|---|")
            for i in fails:
                A(f"| {i.get('source', '')[:40]} | {i.get('target', '')[:40]} | {i['code']}: {i['msg'][:50]} |")
            A("")
    if u:
        A("## 3. UI 自适应\n")
        A(f"- 参与适配条目: {len(u.get('targets', []))}")
        A(f"- 实际调整: {len(uich)} 处")
        A(f"- 未匹配 CSS: {len(u.get('unmatched', []))} 条")
        A(f"- **font-family 保持不变: {u.get('font_family_unchanged')}** (控件类型/class/结构同样未改)\n")
        if uich:
            A("| 文件 | 选择器 | 属性 | 原值 | 新值 | 原因 |\n|---|---|---|---|---|---|")
            for c in uich[:30]:
                A(f"| {c.get('css', '')} | `{c.get('selector', '')}` | {c.get('prop', '')} | "
                  f"{c.get('from', '')} | {c.get('to', '')} | {c.get('reason', '')} |")
            A("")
        if u.get("canvas_ui_files"):
            A("### canvas / WebGL UI 提示\n")
            A("以下文件的 UI 由绘制代码生成, CSS 适配管不到, 需按宽度比手动改绘制参数:\n")
            for f in u["canvas_ui_files"][:10]:
                A(f"- `{f}`")
            A("")
    A("## 4. 备份与回滚\n")
    A(f"- 原文件备份: `{loc / 'backup'}` (apply 与 ui 首次修改前自动备份)")
    A("- 回滚: 把 backup 中对应文件复制回原路径即可\n")
    write_text(loc / "report.md", "\n".join(lines) + "\n")
    print(f"[report] -> {loc / 'report.md'}")
    return 0


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="项目汉化 + UI 自适应工具链")
    ap.add_argument("--root", default=".", help="项目根目录")
    ap.add_argument("--dir", default=None, help="中间文件目录 (默认 <root>/.loc)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("scan", help="扫描抽取待翻译文本 (--from en|zh 决定方向)")
    p.add_argument("--from", dest="from_lang", default="en",
                   choices=["en", "zh", "zh-CN", "ja", "ko", "fr"],
                   help="源语言: en=英文项目汉化, zh/zh-CN=中文项目译回, ja/ko/fr=对应语言译出 (五语互换)")
    p.add_argument("--to", default="zh-CN")
    p.add_argument("--tier", default="c", choices=["a", "b", "c", "d"])
    p.add_argument("--include", default=None, help="只扫描这些后缀, 逗号分隔, 如 .html,.js")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("glossary", help="抽取候选术语")
    p.add_argument("--top", type=int, default=60)
    p.set_defaults(func=cmd_glossary)

    p = sub.add_parser("batch", help="切片待翻清单")
    p.add_argument("--size", type=int, default=60)
    p.set_defaults(func=cmd_batch)

    p = sub.add_parser("merge", help="合并译文分片")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("predict", help="Tier-A 词典直译")
    p.add_argument("--dict", default=None)
    p.set_defaults(func=cmd_predict)

    p = sub.add_parser("verify", help="批量化校验译文")
    p.add_argument("--max-ratio", default="2.6")
    p.add_argument("--min-ratio", default="0.3")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("apply", help="写回译文")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("ui", help="UI 自适应")
    p.add_argument("--min-ratio", default="1.12", help="宽度比超过该值才扩容")
    p.add_argument("--max-expand", default="1.8", help="单次扩容上限倍数")
    p.add_argument("--allow-shrink", action="store_true", help="允许中文更短时收缩宽度")
    p.add_argument("--no-font-shrink", action="store_true", help="禁止调整 font-size")
    p.add_argument("--shrink-trigger", default="1.35")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_ui)

    p = sub.add_parser("report", help="生成汇总报告")
    p.set_defaults(func=cmd_report)

    args = ap.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
