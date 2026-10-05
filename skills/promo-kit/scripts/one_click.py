#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
one_click.py — 从「一个项目目录」到「可对外发布 + 可粘贴上架」的一键链路。

串起 promo-kit 与 app-listing-kit 两条流水线，中间不用人插手：

  1. scan_project  扫描项目事实
  2. gen_promo     生成推广物料（文案 / 定价 / 渠道 / 落地页）
  3. render_assets 本地渲染宣传图（0 积分）
  4. lint_promo    合规扫描（高危不为 0 就停）
  5. 由 facts 派生 profile.json
  6. gen_listing   生成淘宝 / 拼多多上架物料
  7. lint_listing  违禁词扫描（高危不为 0 就停）
  8. 汇总 dist/   落地页 + 宣传图 + 交付说明 + 人工待办清单

用法：
  python one_click.py --project <项目目录> --out ./ship
      [--set audience=像素风玩家] [--set delivery=网盘直链] [--set seller_name=你的署名]
      [--skip-promo] [--skip-listing] [--force]

退出码：0 全绿 / 1 有高危合规项 / 2 闸门未过但已产出 / 3 用法或路径错
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# 技能库根目录：本文件位于 <库根>/promo-kit/scripts/，往上两级即库根。
# 不要写死绝对路径 —— 库可能位于 <你的技能库> 或任何私有 skills 目录。
SKILLS = Path(__file__).resolve().parents[2]
PROMO = SKILLS / "promo-kit" / "scripts"
LIST = SKILLS / "app-listing-kit" / "scripts"


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout or "").strip().splitlines()
    for line in tail[-6:]:
        print("      " + line)
    if r.returncode != 0:
        for line in (r.stderr or "").strip().splitlines()[-4:]:
            print("      ! " + line)
    return r.returncode, r.stdout or ""


def rj(p):
    p = Path(p)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def derive_profile(facts, promo_json):
    """从 facts.json 派生 app-listing-kit 的 profile.json"""
    pricing = {}
    if promo_json:
        pricing = promo_json.get("pricing") or promo_json.get("price") or {}
    tiers = []
    if isinstance(pricing, dict) and pricing.get("tiers"):
        for t in pricing["tiers"]:
            tiers.append({
                "name": t.get("name") or t.get("tier"),
                "price": t.get("price"),
                "includes": t.get("includes") or t.get("include") or "",
            })
    if not tiers:
        tiers = [
            {"name": "标准版", "price": 12.9, "includes": "完整本体（价格待你按定价方案调整）"},
            {"name": "支持版", "price": 24.9, "includes": "本体 + 后续更新（价格待调整）"},
        ]
    seller = facts.get("seller") or {}
    return {
        "app_name": facts.get("project_name") or "my-app",
        "app_name_cn": facts.get("project_name_cn") or facts.get("readme_title") or "",
        "category": facts.get("category") or facts.get("project_type") or "",
        "platforms": facts.get("platforms") or [],
        "version": "1.0",
        "one_liner": facts.get("one_liner") or "",
        "features": facts.get("features") or [],
        "audience": facts.get("audience") or [],
        "price_tiers": tiers,
        "delivery": facts.get("delivery") or "",
        "has_ai_feature": bool(facts.get("has_ai_feature")),
        "ai_byok": False,
        "ip_risk_notes": "由 one_click.py 从 facts 派生；IP 风险以 promo 扫描结果为准",
        "seller": {
            "age": seller.get("age"),
            "has_id_card": bool(seller.get("has_id_card")),
            "has_phone": bool(seller.get("has_phone")),
            "has_bank_or_alipay": bool(seller.get("has_bank_or_alipay")),
            "can_open_store": bool(seller.get("has_id_card") and seller.get("has_phone")
                                  and seller.get("has_bank_or_alipay")),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--set", action="append", default=[], help="k=v，覆盖 facts 字段，可重复")
    ap.add_argument("--skip-promo", action="store_true")
    ap.add_argument("--skip-listing", action="store_true")
    ap.add_argument("--force", action="store_true", help="有高危也继续")
    a = ap.parse_args()

    proj = Path(a.project).resolve()
    out = Path(a.out).resolve()
    if not proj.exists():
        print("[one_click] 项目不存在: %s" % proj)
        return 3
    work = out / "_work"
    dist = out / "dist"
    work.mkdir(parents=True, exist_ok=True)
    dist.mkdir(parents=True, exist_ok=True)

    PY = sys.executable
    rc_high = 0
    gates_ok = True

    # 1. 扫描
    print("[1/8] 扫描项目 …")
    rc, _ = run([PY, "-u", str(PROMO / "scan_project.py"), "--path", str(proj),
                 "--out", str(work / "facts.json")])
    if rc != 0:
        print("[one_click] 扫描失败（可能命中第三方 IP 名，先清掉再跑）")
        if not a.force:
            return 1
    facts = rj(work / "facts.json") or {}
    for kv in a.set:
        if "=" in kv:
            k, v = kv.split("=", 1)
            facts[k] = v
    (work / "facts.json").write_text(json.dumps(facts, ensure_ascii=False, indent=2),
                                     encoding="utf-8")
    missing = facts.get("missing_fields", [])
    if missing:
        print("      仍需人工补: %s" % "、".join(str(x) for x in missing))

    promo_out = work / "promo-out"
    promo_json = None
    if not a.skip_promo:
        # 2. 生成物料
        print("[2/8] 生成推广物料 …")
        cmd = [PY, "-u", str(PROMO / "gen_promo.py"), "--facts", str(work / "facts.json"),
               "--out", str(promo_out)]
        for kv in a.set:
            cmd += ["--set", kv]
        rc, _ = run(cmd)
        if rc != 0:
            print("      gen_promo 返回 %d（多半含高危词，看 08-合规扫描.md）" % rc)
        promo_json = rj(promo_out / "promo.json")

        # 3. 宣传图
        print("[3/8] 渲染宣传图（本地 0 积分）…")
        run([PY, "-u", str(PROMO / "render_assets.py"), "--dir", str(promo_out)])

        # 4. 合规
        print("[4/8] 推广物料合规扫描 …")
        rc, _ = run([PY, "-u", str(PROMO / "lint_promo.py"), "--dir", str(promo_out),
                     "--facts", str(work / "facts.json")])
        if rc == 1:
            rc_high = 1
            print("      ✗ 有高危合规项，必须修完再发")
            if not a.force:
                print("[one_click] 中止。改完文案重跑本命令即可。")
                return 1

    # 5. 派生 profile
    print("[5/8] 派生上架 profile …")
    profile = derive_profile(facts, promo_json)
    (work / "profile.json").write_text(json.dumps(profile, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    s = profile.get("seller", {})
    if not (s.get("has_id_card") and s.get("has_phone") and s.get("has_bank_or_alipay")):
        gates_ok = False
        print("      ⚠ 收款闸门未过：物料照常生成，但**暂不具备开店条件**")

    listing_out = work / "listing-out"
    if not a.skip_listing:
        print("[6/8] 生成上架物料 …")
        run([PY, "-u", str(LIST / "gen_listing.py"), "--profile", str(work / "profile.json"),
             "--out", str(listing_out)])
        print("[7/8] 上架文案违禁词扫描 …")
        rc, _ = run([PY, "-u", str(LIST / "lint_listing.py"), "--dir", str(listing_out)])
        if rc == 1:
            rc_high = 1
            print("      ✗ 有高危违禁词，必须修")
            if not a.force:
                return 1
        elif rc == 2:
            gates_ok = False

    # 8. 汇总 dist
    print("[8/8] 汇总 dist/ …")
    landing = None
    if (promo_out / "04-落地页.html").exists():
        landing = promo_out / "04-落地页.html"
    elif (promo_out / "04-landing.html").exists():
        landing = promo_out / "04-landing.html"
    if landing:
        shutil.copy(landing, dist / "index.html")
    shots = promo_out / "06-宣传图"
    if shots.exists():
        (dist / "宣传图").mkdir(exist_ok=True)
        for p in sorted(shots.glob("*.png")):
            shutil.copy(p, dist / "宣传图" / p.name)
    for name in ["00-交付说明.md", "01-核心文案.md", "02-定价方案.md", "03-渠道文案.md"]:
        if (promo_out / name).exists():
            shutil.copy(promo_out / name, out / ("promo-" + name))
    if (listing_out / "03-详情页.html").exists():
        shutil.copy(listing_out / "03-详情页.html", out / "上架-详情页.html")
    for name in ["01-淘宝上架.md", "02-拼多多上架.md", "04-主图文案.md", "05-发货与售后.md"]:
        if (listing_out / name).exists():
            shutil.copy(listing_out / name, out / ("上架-" + name))

    todo = []
    todo.append("1. 打开 dist/index.html 过一遍落地页，确认文案与署名")
    if not gates_ok:
        todo.append("2. ⚠ 收款闸门未过：先解决实名 / 收款渠道（监护人代开、闲鱼、爱发电、免费+捐赠）")
    todo.append("3. 上架：把「上架-01/02」里的标题与卖点粘进平台后台（**必须手动**，脚本不碰后台）")
    todo.append("4. 主图：按「上架-04-主图文案.md」做图，或用 dist/宣传图 里的现成图")
    todo.append("5. 发布落地页：dist/ 是纯静态目录，可整目录部署")
    if facts.get("missing_fields"):
        todo.append("6. 补 facts 缺失字段再重跑：%s" % "、".join(map(str, facts["missing_fields"])))
    (out / "剩余人工步骤.md").write_text(
        "# 剩余人工步骤\n\n" + "\n".join(todo) + "\n\n"
        "---\n生成时间：" + __import__("time").strftime("%Y-%m-%d %H:%M:%S") + "\n"
        "合规状态：" + ("全绿" if rc_high == 0 else "有高危项，未修完") + "\n"
        "收款闸门：" + ("通过" if gates_ok else "未通过") + "\n", encoding="utf-8")

    print("\n[one_click] 完成 → %s" % out)
    print("  落地页：%s" % (dist / "index.html"))
    print("  人工清单：%s" % (out / "剩余人工步骤.md"))
    print("  合规：%s ｜ 收款闸门：%s" % ("全绿" if rc_high == 0 else "有高危",
                                    "通过" if gates_ok else "未过"))
    return 1 if rc_high else (0 if gates_ok else 2)


if __name__ == "__main__":
    sys.exit(main())
