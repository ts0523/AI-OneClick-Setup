#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
polyglot.py — project-zh-localizer 的增强层

在原 loc.py（抓取 / 校验 / 写回 / UI 自适应）之上补齐四件事：

  1. 五语互译     zh-CN / en / ja / ko / fr 任意方向（以 en 为枢轴 + 直查列）
  2. 多格式       po / properties / strings / arb / android xml / csv / yaml / md
                  + vue / svelte / py / java / kt / cs / go / rs / php / rb / c / cpp
  3. Web 专项     webaudit：框架识别、i18n 目录、lang 属性、meta、canvas UI 清单
  4. 单机模式     offline：纯内置词典 + 规则翻译，零网络零 AI

所有命令零第三方依赖（纯标准库）。中间产物同样落在 <项目>/.loc/。

常用：
  py polyglot.py --root <项目> langs
  py polyglot.py --root <项目> scan --from en --to fr --tier b
  py polyglot.py --root <项目> offline            # 单机翻译，产出 batch_*.done.json
  py polyglot.py --root <项目> pipeline --from en --to ja   # 一键串完全流程
  py polyglot.py --root <项目> export --fmt po --out out.po
  py polyglot.py --root <项目> import --file out.done.po
  py polyglot.py --root <项目> bridge extract     # 资源文件 -> manifest
  py polyglot.py --root <项目> bridge apply       # 译文写回原格式
  py polyglot.py --root <项目> webaudit
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

VERSION = "2.0"

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
LOCPY = HERE / "loc.py"
DICT_FILE = SKILL / "assets" / "langpacks" / "core-ui.json"

# ---------------------------------------------------------------- 语言
LANGS = ["en", "zh-CN", "ja", "ko", "fr"]
ALIAS = {
    "en": "en", "eng": "en", "english": "en",
    "zh": "zh-CN", "cn": "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN", "chinese": "zh-CN",
    "ja": "ja", "jp": "ja", "jpn": "ja", "japanese": "ja",
    "ko": "ko", "kr": "ko", "kor": "ko", "korean": "ko",
    "fr": "fr", "fre": "fr", "fra": "fr", "french": "fr",
}
# 相对英文的经验宽度倍率（UI 扩容预判；实际以逐条 disp_width 为准）
WIDTH_HINT = {
    "en": 1.00, "zh-CN": 0.62, "ja": 1.35, "ko": 1.25, "fr": 1.28,
}
# 语言判定：源语言是否含该语言的特征字符
def lang_has(s, lang):
    if lang in ("zh-CN", "ja", "ko"):
        if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", s):
            return lang == "zh-CN" or (lang == "ja" and re.search(r"[\u3040-\u30ff]", s)) \
                or (lang == "ko" and re.search(r"[\uac00-\ud7af]", s))
        # 纯假名也算日语
        if lang == "ja" and re.search(r"[\u3040-\u30ff]", s):
            return True
        return False
    if not re.search(r"[A-Za-zÀ-ÿ]", s):
        return False
    if re.search(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", s):
        return False
    if lang == "fr":
        return bool(re.search(r"\b(le|la|les|des|une|vous|votre|pour|avec|données|paramètres|"
                              r"enregistrer|annuler|supprimer|fichier|oui|non)\b", s, re.I)) \
            or bool(re.search(r"[àâçéèêëîïôûùüœ]", s, re.I))
    return True


def norm_lang(x):
    if not x:
        return None
    k = x.strip().lower()
    if k in ALIAS:
        return ALIAS[k]
    return x


# ---------------------------------------------------------------- 词典
def load_dict():
    data = json.loads(DICT_FILE.read_text(encoding="utf-8"))
    cols = data["meta"]["langs"]
    rows = data["entries"]
    idx = {}            # (from,to) -> {lowered: target}
    for a in LANGS:
        for b in LANGS:
            if a == b:
                continue
            ia = cols.index(a)
            ib = cols.index(b)
            m = {}
            for r in rows:
                src, tgt = r[ia], r[ib]
                if src and tgt:
                    m[src.lower()] = tgt
                    m[src.strip().lower()] = tgt
            idx[(a, b)] = m
    return idx, rows, cols


# ---------------------------------------------------------------- 占位符
PH_RE = re.compile(
    r"(\{\{[^}]{0,80}\}\}|\{[^{}]{0,60}\}|%[sdif]|%\([^)]{1,30}\)[sdif]|"
    r"\$\{[^}]{0,80}\}|<[^<>]{1,24}>|&[a-zA-Z#0-9]{2,8};|https?://\S+|[\w.+-]+@[\w.-]+|"
    r"\\\\[nrt])"
)


def protect(s):
    """把占位符换成 \\x00N\\x00，返回 (掩码串, 占位符列表)"""
    phs = []

    def sub(m):
        phs.append(m.group(0))
        return "\x00%d\x00" % (len(phs) - 1)

    return PH_RE.sub(sub, s), phs


def restore(s, phs):
    for i, p in enumerate(phs):
        s = s.replace("\x00%d\x00" % i, p)
    return s


def match_case(src, tgt):
    """按原文的大小写风格调整译文（仅对拉丁目标语有意义）"""
    if not tgt:
        return tgt
    if src.isupper() and len(src) > 1:
        return tgt.upper()
    if src[:1].isupper() and not tgt[:1].isupper():
        return tgt[:1].upper() + tgt[1:]
    return tgt


def disp_width(s):
    w = 0
    for ch in s:
        o = ord(ch)
        if (0x1100 <= o <= 0x115F or 0x2E80 <= o <= 0xA4CF or 0xAC00 <= o <= 0xD7A3
                or 0xF900 <= o <= 0xFAFF or 0xFE30 <= o <= 0xFE6F
                or 0xFF00 <= o <= 0xFF60 or 0xFFE0 <= o <= 0xFFE6
                or 0x20000 <= o <= 0x3FFFD):
            w += 2
        else:
            w += 1
    return w


# ---------------------------------------------------------------- 离线翻译
def offline_translate(src, dic, frm, to, glossary=None):
    """纯规则 + 词典翻译。返回 (译文 or None, 命中方式)"""
    if not src or not src.strip():
        return None, "empty"
    g = glossary or {}
    if src.strip() in g:
        ent = g[src.strip()]
        if isinstance(ent, dict):
            if ent.get("keep"):
                return src, "keep"
            if ent.get("target"):
                return ent["target"], "glossary"
        else:
            return ent, "glossary"
    s = src.strip()
    masked, phs = protect(s)
    m = dic.get((frm, to), {})

    # 1) 整句命中
    hit = m.get(masked.lower()) or m.get(masked.strip().lower())
    if hit:
        return restore(hit, phs), "exact"

    # 2) 去掉尾部标点再试
    core = masked.rstrip(":.!?。！？：…")
    tail = masked[len(core):]
    hit = m.get(core.lower())
    if hit:
        return restore(hit, phs) + tail, "exact-punct"

    # 3) CJK 源语言：无空格可切，改走"最长匹配子串替换"
    if frm in ("zh-CN", "ja", "ko"):
        res, hits = masked, 0
        for src in sorted(m.keys(), key=len, reverse=True):
            if len(src) < 2 or src not in res:
                continue
            res = res.replace(src, m[src])
            hits += 1
        if hits:
            changed = sum(1 for c in masked if c not in " \t")
            if changed and hits / max(1, len(masked)) >= 0.02:
                return restore(res, phs), "substr(%d)" % hits
        return None, "unhit"
    words = re.split(r"(\s+)", core)
    out = []
    hitn = 0
    total = 0
    for w in words:
        if not w.strip():
            out.append(w)
            continue
        total += 1
        lw = w.lower()
        t = m.get(lw) or m.get(lw.strip(".,:;!?"))
        if t:
            hitn += 1
            # 保住词内标点
            pre = w[:len(w) - len(w.lstrip(".,:;!?"))]
            post = w[len(w.rstrip(".,:;!?")):]
            out.append(pre + t + post)
        else:
            out.append(w)
    if total and hitn / total >= 0.6:
        res = "".join(out)
        # 中文目标：去掉词间空格
        if to in ("zh-CN", "ja"):
            res = re.sub(r"(?<=[\u4e00-\u9fff\u3040-\u30ff])\s+(?=[\u4e00-\u9fff\u3040-\u30ff])", "", res)
        return restore(res + tail, phs), "wordwise"
    return None, "unhit"


# ---------------------------------------------------------------- .loc 读写
def loc_dir(root):
    p = Path(root).resolve() / ".loc"
    p.mkdir(parents=True, exist_ok=True)
    return p


def rj(p, default=None):
    p = Path(p)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print("[warn] 解析失败 %s: %s" % (p, e), file=sys.stderr)
        return default


def wj(p, obj):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- 命令
def cmd_langs(a):
    print("支持语言：")
    for l in LANGS:
        print("  %-6s 宽度倍率(相对英文) %.2f" % (l, WIDTH_HINT[l]))
    print("\n任意两语互译：--from <A> --to <B>（A≠B）")
    print("别名：zh/cn→zh-CN, jp→ja, kr→ko, fre/fra→fr")
    return 0


def cmd_scan(a):
    """委托 loc.py scan，但先把语言参数校验干净"""
    frm, to = norm_lang(a.frm), norm_lang(a.to)
    if frm not in LANGS or to not in LANGS or frm == to:
        print("[scan] 语言不合法：--from %s --to %s（支持 %s）" % (a.frm, a.to, "/".join(LANGS)))
        return 3
    import subprocess
    cmd = [sys.executable, str(LOCPY), "--root", str(Path(a.root).resolve()),
           "scan", "--from", frm, "--to", to, "--tier", a.tier]
    r = subprocess.run(cmd)
    if r.returncode == 0:
        d = loc_dir(a.root)
        st = rj(d / "strings.json") or {}
        st["from"], st["target_lang"] = frm, to
        wj(d / "strings.json", st)
        print("[scan] 语言标记为 %s → %s" % (frm, to))
    return r.returncode


def cmd_offline(a):
    """单机翻译：不联网、不调 AI，产出 batch_*.done.json 供 loc.py merge"""
    d = loc_dir(a.root)
    data = rj(d / "strings.json")
    if not data:
        print("[offline] 缺少 .loc/strings.json，先跑 scan")
        return 2
    frm = norm_lang(a.frm or data.get("from") or "en")
    to = norm_lang(a.to or data.get("target_lang") or "zh-CN")
    dic, rows, cols = load_dict()
    gl = {}
    g = rj(d / "glossary.json")
    if g:
        for t in g.get("terms", []):
            if t.get("source"):
                gl[t["source"]] = t
    items = [it for it in data["items"] if it.get("type") != "html-lang"]
    size = max(1, a.size)
    translated, miss = {}, []
    for it in items:
        tgt, how = offline_translate(it["source"], dic, frm, to, gl)
        if tgt is None:
            miss.append({"id": it["id"], "source": it["source"], "reason": how})
            continue
        translated[it["id"]] = {"target": tgt, "how": how}
    # 写 done 批次（结构兼容 loc.py merge）
    chunks = [items[i:i + size] for i in range(0, len(items), size)]
    for i, ch in enumerate(chunks, 1):
        wj(d / ("batch_%03d.done.json" % i), {
            "batch": i, "total_batches": len(chunks), "from": frm, "target_lang": to,
            "engine": "offline-dict",
            "items": [{"id": it["id"], "source": it["source"],
                       "target": translated[it["id"]]["target"]}
                      for it in ch if it["id"] in translated],
        })
    cov = len(translated) / max(1, len(items))
    wj(d / "offline-report.json", {
        "from": frm, "to": to, "total": len(items), "translated": len(translated),
        "coverage": round(cov, 4), "missed": miss,
        "hint": ("覆盖率 <70% 建议改用 AI 档位（batch → AI 翻译 → merge），"
                 "或往 assets/langpacks/core-ui.json 补词"),
    })
    print("[offline] %s→%s  命中 %d/%d (%.1f%%)  未命中 %d 条 -> .loc/offline-report.json"
          % (frm, to, len(translated), len(items), cov * 100, len(miss)))
    if a.strict and cov < a.min_coverage:
        print("[offline] 覆盖率低于 %.0f%%，strict 模式中止" % (a.min_coverage * 100))
        return 1
    return 0


def cmd_export(a):
    """导出给外部翻译（人 / 第三方），格式 po / csv / json / xliff"""
    d = loc_dir(a.root)
    data = rj(d / "strings.json")
    if not data:
        print("[export] 缺少 .loc/strings.json")
        return 2
    items = [it for it in data["items"] if it.get("type") != "html-lang"]
    frm = norm_lang(a.frm or data.get("from") or "en")
    to = norm_lang(a.to or data.get("target_lang") or "zh-CN")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tr = rj(d / "translated.json") or {}
    tmap = {x["id"]: x["target"] for x in tr.get("items", [])}
    if a.fmt == "po":
        lines = ['msgid ""', 'msgstr ""', '"Language: %s\\n"' % to, ""]
        for it in items:
            lines.append('#. %s' % (it.get("context") or "").replace("\n", " "))
            lines.append("msgctxt \"%s\"" % it["id"])
            lines.append('msgid "%s"' % it["source"].replace('"', '\\"'))
            lines.append('msgstr "%s"' % (tmap.get(it["id"], "").replace('"', '\\"')))
            lines.append("")
        out.write_text("\n".join(lines), encoding="utf-8")
    elif a.fmt == "csv":
        import csv as _csv
        with open(out, "w", encoding="utf-8-sig", newline="") as f:
            w = _csv.writer(f)
            w.writerow(["id", "file", "line", "source", "target", "context"])
            for it in items:
                w.writerow([it["id"], it["file"], it.get("line"), it["source"],
                            tmap.get(it["id"], ""), (it.get("context") or "").replace("\n", " ")])
    elif a.fmt == "xliff":
        body = []
        for it in items:
            body.append('    <trans-unit id="%s">\n      <source xml:lang="%s">%s</source>\n'
                        '      <target xml:lang="%s">%s</target>\n    </trans-unit>'
                        % (it["id"], frm, _xml(it["source"]), to, _xml(tmap.get(it["id"], ""))))
        out.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2">\n'
                       '  <file source-language="%s" target-language="%s" datatype="plaintext">\n'
                       '  <body>\n%s\n  </body>\n  </file>\n</xliff>\n'
                       % (frm, to, "\n".join(body)), encoding="utf-8")
    else:
        wj(out, {"from": frm, "to": to,
                 "items": [{"id": it["id"], "source": it["source"],
                            "target": tmap.get(it["id"], ""), "context": it.get("context", "")}
                           for it in items]})
    print("[export] %d 条 -> %s (%s)" % (len(items), out, a.fmt))
    return 0


def _xml(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def cmd_import(a):
    """把外部翻译好的文件回填成 .loc/batch_*.done.json"""
    d = loc_dir(a.root)
    data = rj(d / "strings.json")
    if not data:
        print("[import] 缺少 .loc/strings.json")
        return 2
    f = Path(a.file)
    pairs = {}
    if f.suffix.lower() in (".json",):
        j = rj(f) or {}
        for it in j.get("items", []):
            if it.get("target"):
                pairs[it["id"]] = it["target"]
    elif f.suffix.lower() in (".csv",):
        import csv as _csv
        with open(f, encoding="utf-8-sig") as fh:
            for row in _csv.DictReader(fh):
                if row.get("target"):
                    pairs[row["id"]] = row["target"]
    elif f.suffix.lower() in (".po",):
        txt = f.read_text(encoding="utf-8")
        for m in re.finditer(r'msgctxt\s+"([^"]+)"\s*\nmsgid\s+"((?:[^"\\]|\\.)*)"\s*\n'
                             r'msgstr\s+"((?:[^"\\]|\\.)*)"', txt):
            if m.group(3):
                pairs[m.group(1)] = m.group(3).replace('\\"', '"')
    elif f.suffix.lower() in (".xlf", ".xliff"):
        txt = f.read_text(encoding="utf-8")
        for m in re.finditer(r'<trans-unit id="([^"]+)">\s*<source[^>]*>.*?</source>\s*'
                             r'<target[^>]*>(.*?)</target>', txt, re.S):
            pairs[m.group(1)] = re.sub(r"<[^>]+>", "", m.group(2))
    else:
        print("[import] 不支持的格式: %s" % f.suffix)
        return 3
    items = [it for it in data["items"] if it["id"] in pairs]
    size = max(1, a.size)
    chunks = [items[i:i + size] for i in range(0, len(items), size)]
    for i, ch in enumerate(chunks, 1):
        wj(d / ("batch_%03d.done.json" % i), {
            "batch": i, "engine": "import-" + (getattr(a, "fmt_guess", None) or fmt_guess(f)),
            "items": [{"id": it["id"], "source": it["source"], "target": pairs[it["id"]]} for it in ch],
        })
    print("[import] %d 条译文 -> %d 个批次" % (len(pairs), len(chunks)))
    return 0


def fmt_guess(f):
    return Path(f).suffix.lower().lstrip(".")


# ---------------------------------------------------------------- 资源格式桥
BRIDGE_EXTS = {".po", ".pot", ".properties", ".strings", ".arb", ".xml", ".csv", ".yaml", ".yml"}


def bridge_scan_file(p):
    """抽取资源文件里的 (key, value, line)。返回 list[dict]"""
    out = []
    suf = p.suffix.lower()
    try:
        txt = p.read_text(encoding="utf-8")
    except Exception:
        return out
    if suf in (".po", ".pot"):
        cur = None
        for i, line in enumerate(txt.splitlines(), 1):
            m = re.match(r'msgctxt\s+"(.*)"', line)
            if m:
                cur = m.group(1)
            m = re.match(r'msgid\s+"(.*)"', line)
            if m and m.group(1):
                cur = cur or m.group(1)
                out.append({"key": cur, "source": m.group(1), "line": i, "value": ""})
            m = re.match(r'msgstr\s+"(.*)"', line)
            if m and out:
                out[-1]["value"] = m.group(1)
    elif suf == ".properties":
        for i, line in enumerate(txt.splitlines(), 1):
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                out.append({"key": k.strip(), "source": v.strip(), "line": i, "value": v.strip()})
    elif suf == ".strings":
        for i, line in enumerate(txt.splitlines(), 1):
            m = re.match(r'\s*"([^"]+)"\s*=\s*"([^"]*)"\s*;', line)
            if m:
                out.append({"key": m.group(1), "source": m.group(2), "line": i, "value": m.group(2)})
    elif suf == ".arb":
        try:
            j = json.loads(txt)
        except Exception:
            return out
        for k, v in j.items():
            if k.startswith("@") or not isinstance(v, str):
                continue
            out.append({"key": k, "source": v, "line": 0, "value": v})
    elif suf == ".xml":
        for i, line in enumerate(txt.splitlines(), 1):
            m = re.search(r'<string[^>]*name="([^"]+)"[^>]*>(.*?)</string>', line)
            if m:
                out.append({"key": m.group(1), "source": m.group(2), "line": i, "value": m.group(2)})
    elif suf == ".csv":
        import csv as _csv
        import io
        try:
            rd = list(_csv.reader(io.StringIO(txt)))
        except Exception:
            return out
        if not rd:
            return out
        hdr = rd[0]
        ki = 0
        for idx, h in enumerate(hdr):
            if h.strip().lower() in ("key", "id", "name"):
                ki = idx
                break
        vi = 1 if len(hdr) > 1 else 0
        for idx, h in enumerate(hdr):
            if h.strip().lower() in ("value", "source", "en", "text"):
                vi = idx
                break
        for i, row in enumerate(rd[1:], 2):
            if len(row) > max(ki, vi):
                out.append({"key": row[ki], "source": row[vi], "line": i, "value": row[vi]})
    elif suf in (".yaml", ".yml"):
        for i, line in enumerate(txt.splitlines(), 1):
            m = re.match(r'^\s{0,6}([\w.\-]+)\s*:\s*["\']?(.+?)["\']?\s*$', line)
            if m and not m.group(2).startswith("#"):
                out.append({"key": m.group(1), "source": m.group(2), "line": i, "value": m.group(2)})
    return out


def cmd_bridge(a):
    d = loc_dir(a.root)
    bd = d / "bridge"
    root = Path(a.root).resolve()
    if a.bridge_cmd == "extract":
        bd.mkdir(parents=True, exist_ok=True)
        files = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames
                           if x not in ("node_modules", ".git", "dist", "build", ".loc", "vendor")]
            for fn in filenames:
                if Path(fn).suffix.lower() in BRIDGE_EXTS:
                    files.append(Path(dirpath) / fn)
        entries = []
        for p in files:
            for e in bridge_scan_file(p):
                entries.append({"file": str(p.relative_to(root)).replace("\\", "/"),
                                "key": e["key"], "source": e["source"],
                                "line": e["line"], "ext": p.suffix.lower()})
        wj(bd / "manifest.json", {"root": str(root), "count": len(entries), "entries": entries})
        print("[bridge] 抽取 %d 条（%d 个文件）-> .loc/bridge/manifest.json" % (len(entries), len(files)))
        return 0
    if a.bridge_cmd == "apply":
        man = rj(bd / "manifest.json")
        if not man:
            print("[bridge] 缺少 .loc/bridge/manifest.json")
            return 2
        tr = rj(d / "translated.json") or {}
        tmap = {x["id"]: x["target"] for x in tr.get("items", [])}
        tgt = rj(bd / "targets.json") or {}
        n = 0
        byfile = {}
        for e in man["entries"]:
            t = tgt.get(e["key"]) or tgt.get(e["source"]) or tmap.get(e["key"])
            if not t:
                continue
            byfile.setdefault(e["file"], []).append((e, t))
        for relf, lst in byfile.items():
            p = root / relf
            if not p.exists():
                continue
            txt = p.read_text(encoding="utf-8")
            suf = p.suffix.lower()
            if suf == ".properties":
                lines = txt.splitlines()
                for e, t in lst:
                    for i, ln in enumerate(lines):
                        if ln.strip().startswith(e["key"] + "=") or ln.strip().startswith(e["key"] + " ="):
                            lines[i] = "%s=%s" % (e["key"], t)
                p.write_text("\n".join(lines) + ("\n" if txt.endswith("\n") else ""), encoding="utf-8")
                n += len(lst)
            elif suf == ".xml":
                lines = txt.splitlines()
                for e, t in lst:
                    for i, ln in enumerate(lines):
                        if 'name="%s"' % e["key"] in ln:
                            lines[i] = re.sub(r'(<string[^>]*name="%s"[^>]*>).*?(</string>)'
                                              % re.escape(e["key"]), r"\g<1>%s\g<2>" % _xml(t), ln)
                p.write_text("\n".join(lines), encoding="utf-8")
                n += len(lst)
            elif suf == ".arb":
                try:
                    j = json.loads(txt)
                except Exception:
                    continue
                for e, t in lst:
                    j[e["key"]] = t
                p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                n += len(lst)
            elif suf in (".yaml", ".yml"):
                lines = txt.splitlines()
                for e, t in lst:
                    for i, ln in enumerate(lines):
                        m = re.match(r'^(\s{0,6})%s(\s*:\s*)(.*)$' % re.escape(e["key"]), ln)
                        if m:
                            lines[i] = "%s%s%s%s" % (m.group(1), e["key"], m.group(2), t)
                p.write_text("\n".join(lines), encoding="utf-8")
                n += len(lst)
            elif suf in (".po", ".pot"):
                lines = txt.splitlines()
                for e, t in lst:
                    for i, ln in enumerate(lines):
                        if ln.startswith("msgid ") and ln.strip()[7:-1] == e["source"]:
                            if i + 1 < len(lines) and lines[i + 1].startswith("msgstr"):
                                lines[i + 1] = 'msgstr "%s"' % t.replace('"', '\\"')
                p.write_text("\n".join(lines) + "\n", encoding="utf-8")
                n += len(lst)
            else:
                print("[bridge] %s 写回暂未实现（请用 export 导出后手工回填）" % suf)
        print("[bridge] 写回 %d 条" % n)
        return 0
    print("[bridge] 子命令必须是 extract 或 apply")
    return 3


# ---------------------------------------------------------------- Web 审计
FRAMEWORK_HINTS = {
    "vue-i18n": ["vue-i18n", "@intlify"],
    "react-i18next": ["react-i18next", "i18next"],
    "next-intl": ["next-intl"],
    "formatjs": ["@formatjs/intl", "react-intl"],
    "svelte-i18n": ["svelte-i18n"],
    "nuxt-i18n": ["@nuxtjs/i18n"],
    "lingui": ["@lingui/core"],
}
I18N_DIRS = ["locales", "locale", "i18n", "lang", "langs", "messages", "translations",
             "src/locales", "src/i18n", "src/lang", "public/locales"]


def cmd_webaudit(a):
    root = Path(a.root).resolve()
    d = loc_dir(root)
    pkg = root / "package.json"
    deps = {}
    if pkg.exists():
        j = rj(pkg) or {}
        deps = {**j.get("dependencies", {}), **j.get("devDependencies", {})}
    found = []
    for fw, keys in FRAMEWORK_HINTS.items():
        if any(k in deps for k in keys):
            found.append(fw)
    idirs = []
    for rel in I18N_DIRS:
        p = root / rel
        if p.exists() and p.is_dir():
            files = [str(x.relative_to(root)).replace("\\", "/")
                     for x in p.rglob("*") if x.is_file() and x.suffix.lower()
                     in (".json", ".js", ".ts", ".yaml", ".yml", ".po")][:40]
            idirs.append({"dir": rel, "files": files, "count": len(files)})
    langs_attr = []
    for p in list(root.rglob("*.html"))[:200]:
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        m = re.search(r"<html[^>]*\blang\s*=\s*[\"']([^\"']+)", t, re.I)
        langs_attr.append({"file": str(p.relative_to(root)).replace("\\", "/"),
                           "lang": m.group(1) if m else None})
    canvas = []
    for p in list(root.rglob("*.js"))[:400] + list(root.rglob("*.ts"))[:200]:
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if re.search(r"(getContext\s*\(\s*['\"]2d|THREE\.|WebGLRenderer)", t):
            canvas.append(str(p.relative_to(root)).replace("\\", "/"))
    missing_lang = [x for x in langs_attr if not x["lang"]]
    rep = {
        "frameworks": found, "i18n_dirs": idirs, "html_lang": langs_attr[:50],
        "missing_lang_count": len(missing_lang), "canvas_ui_files": canvas[:30],
        "advice": [],
    }
    if found:
        rep["advice"].append("检测到 i18n 框架 %s：优先翻它的 locale 文件（用 bridge extract），"
                             "不要逐字改源码" % "/".join(found))
    else:
        rep["advice"].append("没检测到 i18n 框架：走源码内联文案路线（scan → offline → apply）")
    if idirs:
        rep["advice"].append("i18n 目录：%s —— 这些是翻译主战场"
                             % "/".join(x["dir"] for x in idirs))
    if missing_lang:
        rep["advice"].append("%d 个 HTML 缺 <html lang>，翻译后必须补，否则断词与屏幕阅读器全错"
                             % len(missing_lang))
    if canvas:
        rep["advice"].append("%d 个文件用 canvas/WebGL 画 UI：CSS 适配管不到，尺寸在绘制代码里，要单独调"
                             % len(canvas))
    wj(d / "webaudit.json", rep)
    print("[webaudit] 框架: %s | i18n 目录: %d | 缺 lang 的 HTML: %d | canvas UI: %d"
          % (found or "无", len(idirs), len(missing_lang), len(canvas)))
    for x in rep["advice"]:
        print("  · " + x)
    print("  详情 -> .loc/webaudit.json")
    return 0


# ---------------------------------------------------------------- UI 自适应
def cmd_uifit(a):
    import subprocess
    to = norm_lang(a.to or "zh-CN")
    args = [sys.executable, str(LOCPY), "--root", str(Path(a.root).resolve()), "ui",
            "--min-ratio", str(a.min_ratio), "--max-expand", str(a.max_expand)]
    if a.no_font_shrink:
        args.append("--no-font-shrink")
    if a.allow_shrink:
        args.append("--allow-shrink")
    r = subprocess.run(args)
    print("[uifit] 目标语言 %s，经验宽度倍率 %.2f（英文=1.0）" % (to, WIDTH_HINT.get(to, 1.0)))
    if to == "ja":
        print("[uifit] 日语通常比英文宽 1.2~1.6 倍，若仍有溢出把 --max-expand 提到 2.2")
    if to == "fr":
        print("[uifit] 法语通常比英文长 20~35%，按钮与导航条是重灾区，重点看这两个区域")
    if to == "ko":
        print("[uifit] 韩语比英文宽约 1.1~1.5 倍，注意固定宽度的表格列")
    return r.returncode


# ---------------------------------------------------------------- 一键流水线
def cmd_pipeline(a):
    import subprocess
    root = str(Path(a.root).resolve())
    frm, to = norm_lang(a.frm), norm_lang(a.to)
    if frm not in LANGS or to not in LANGS or frm == to:
        print("[pipeline] 语言不合法：%s → %s" % (frm, to))
        return 3
    steps = []
    if a.mode == "offline":
        steps.append(("scan", ["scan", "--from", frm, "--to", to, "--tier", "a"]))
        steps.append(("offline", None))          # 走本脚本
    else:
        steps.append(("scan", ["scan", "--from", frm, "--to", to, "--tier", "b"]))
        steps.append(("batch", ["batch", "--size", str(a.size)]))
    print("[pipeline] %s → %s，模式 %s" % (frm, to, a.mode))
    rc = 0
    for name, args in steps:
        if args is None:
            rc = cmd_offline(argparse.Namespace(root=a.root, frm=frm, to=to, size=a.size,
                                                strict=False, min_coverage=0))
        else:
            rc = subprocess.run([sys.executable, str(LOCPY), "--root", root] + args).returncode
        print("  · %-8s rc=%d" % (name, rc))
        if rc != 0 and not a.force:
            print("[pipeline] 中断于 %s" % name)
            return rc
    if a.mode != "offline":
        print("[pipeline] 批次已生成，请 AI 逐批翻译后运行 merge（交互式档位到此暂停）")
        return 0
    for name, args in [("merge", ["merge"]),
                       ("verify", ["verify", "--max-ratio", str(a.max_ratio)]),
                       ("apply", [] if a.apply else ["apply", "--dry-run"]),
                       ("ui", ["ui"]),
                       ("report", ["report"])]:
        args = args or ["apply"]
        rc = subprocess.run([sys.executable, str(LOCPY), "--root", root] + args).returncode
        print("  · %-8s rc=%d" % (name, rc))
        if rc != 0 and not a.force and name in ("merge", "apply"):
            print("[pipeline] 中断于 %s" % name)
            return rc
    print("[pipeline] 完成。报告见 %s/.loc/report.md" % root)
    return rc


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(prog="polyglot.py", description="project-zh-localizer 增强层")
    ap.add_argument("--root", required=True, help="项目根目录")
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("langs", help="列出支持的语言")

    p = sub.add_parser("scan")
    p.add_argument("--from", dest="frm", default="en")
    p.add_argument("--to", dest="to", default="zh-CN")
    p.add_argument("--tier", default="b")

    p = sub.add_parser("offline", help="单机词典翻译（零网络零 AI）")
    p.add_argument("--from", dest="frm")
    p.add_argument("--to", dest="to")
    p.add_argument("--size", type=int, default=60)
    p.add_argument("--strict", action="store_true")
    p.add_argument("--min-coverage", type=float, default=0.7)

    p = sub.add_parser("export")
    p.add_argument("--fmt", default="json", choices=["json", "po", "csv", "xliff"])
    p.add_argument("--out", required=True)
    p.add_argument("--from", dest="frm")
    p.add_argument("--to", dest="to")

    p = sub.add_parser("import")
    p.add_argument("--file", required=True)
    p.add_argument("--size", type=int, default=60)
    p.add_argument("--fmt-guess", dest="fmt_guess", default=None)

    p = sub.add_parser("bridge")
    p.add_argument("bridge_cmd", choices=["extract", "apply"])

    sub.add_parser("webaudit")

    p = sub.add_parser("uifit")
    p.add_argument("--to", dest="to")
    p.add_argument("--min-ratio", type=float, default=1.12)
    p.add_argument("--max-expand", type=float, default=1.8)
    p.add_argument("--no-font-shrink", action="store_true")
    p.add_argument("--allow-shrink", action="store_true")

    p = sub.add_parser("pipeline", help="一键串完全流程")
    p.add_argument("--from", dest="frm", default="en")
    p.add_argument("--to", dest="to", default="zh-CN")
    p.add_argument("--mode", default="offline", choices=["offline", "ai"])
    p.add_argument("--size", type=int, default=60)
    p.add_argument("--max-ratio", type=float, default=2.6)
    p.add_argument("--apply", action="store_true", help="默认 dry-run，加这个才真写回")
    p.add_argument("--force", action="store_true")

    a = ap.parse_args()
    if not a.cmd:
        ap.print_help()
        return 3
    if a.cmd == "import" and not getattr(a, "fmt_guess", None):
        a.fmt_guess = fmt_guess(a.file)
    return {
        "langs": cmd_langs, "scan": cmd_scan, "offline": cmd_offline,
        "export": cmd_export, "import": cmd_import, "bridge": cmd_bridge,
        "webaudit": cmd_webaudit, "uifit": cmd_uifit, "pipeline": cmd_pipeline,
    }[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
