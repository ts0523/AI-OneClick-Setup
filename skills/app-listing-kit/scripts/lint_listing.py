# -*- coding: utf-8 -*-
"""违禁词扫描 / 资质闸门自检。

用法:
    # 扫描已生成的物料目录，并刷新 06-风控报告.md
    python lint_listing.py --dir ./listing-out

    # 只查资质闸门，不生成任何东西
    python lint_listing.py --profile profile.json --gates-only

退出码: 0 = 干净, 1 = 存在高危词, 2 = 闸门未通过, 3 = 用法错误
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import banned_words as bw  # noqa: E402
from gen_listing import gate_check, render_gate_block  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SCAN_EXT = (".md", ".html", ".htm")
# 只扫「买家能看到的文案」：00 是内部交付说明，06 是报告本身（引用违规词会自命中）
SKIP = {"06-风控报告.md", "00-交付说明.md"}


def collect(target_dir):
    files = []
    for root, _dirs, names in os.walk(target_dir):
        for n in names:
            if n in SKIP:
                continue
            if n.lower().endswith(SCAN_EXT):
                files.append(os.path.join(root, n))
    return sorted(files)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="待扫描的物料目录")
    ap.add_argument("--profile", help="profile.json，用于闸门自检")
    ap.add_argument("--gates-only", action="store_true", help="只跑闸门检查")
    ap.add_argument("--no-write", action="store_true", help="不写回风控报告")
    args = ap.parse_args()

    if not args.dir and not args.profile:
        ap.error("至少提供 --dir 或 --profile 之一")

    gate_ok = True
    if args.profile:
        import json
        with open(args.profile, encoding="utf-8") as f:
            p = json.load(f)
        gate_ok, rows = gate_check(p.get("seller"))
        print("=== 资质闸门 ===")
        for name, passed, note in rows:
            print(f"  {'PASS' if passed else 'FAIL'}  {name}：{note}")
        print(f"  → {'通过' if gate_ok else '未通过'}")
        if args.gates_only:
            if not gate_ok:
                print("\n闸门未通过。不要生成上架物料，改走替代发行路径"
                      "（见 references/compliance-gates.md 第五节）。")
                return 2
            return 0

    if not args.dir:
        return 0 if gate_ok else 2

    if not os.path.isdir(args.dir):
        print(f"目录不存在：{args.dir}")
        return 3

    files = collect(args.dir)
    if not files:
        print(f"{args.dir} 下没有可扫描的文件。")
        return 3

    results = {}
    for fp in files:
        try:
            with open(fp, encoding="utf-8") as f:
                hits = bw.scan(bw.clean_for_scan(f.read(), fp))
        except Exception:
            continue
        if hits:
            results[fp] = hits

    print(f"=== 违禁词扫描（{len(files)} 个文件） ===")
    if not results:
        print("  未发现违禁词、极限词、虚构数据或 IP 风险词。")
    for fp, hits in results.items():
        rel = os.path.relpath(fp, args.dir)
        print(f"\n  [{rel}]")
        for h in hits:
            flag = "高危" if h["level"] == "high" else "警告"
            print(f"    - {flag}  `{h['word']}`  ({h['kind']}) → {h['suggestion']}")

    if not args.no_write:
        out = os.path.join(args.dir, "06-风控报告.md")
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(bw.render_report(results))
        print(f"\n报告已写入 {out}")

    high = sum(1 for hs in results.values() for h in hs if h["level"] == "high")
    warn = sum(1 for hs in results.values() for h in hs if h["level"] == "warn")
    print(f"\n合计：高危 {high} 处，警告 {warn} 处")
    if high:
        print("高危项必须改完再上架。")
        return 1
    if not gate_ok:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
