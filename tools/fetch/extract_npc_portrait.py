#!/usr/bin/env python3
"""提取 NPC_Portrait_* 立绘（含 Arona/Plana）-> resources/npc_portrait/<Name>.png。

来源（复用 extract_local_avatar.py 实测结论）：
  uis-01_common-01_character-_mxload-* bundle 里的 Texture2D，
  同名纹理按 bundle 文件名日期 newest-wins。
上一轮实测 NPC_Portrait_* 共 239 个（学生头像任务当时跳过未提取）。

产物：
  resources/npc_portrait/<Name>.png          全量 NPC 立绘（239 个左右）
  D:/Bluearchive/.scratch/spr/npc_portrait_report.json  溯源报告（bundle/日期/尺寸）

用法：
  python tools/fetch/extract_npc_portrait.py           # 提取
  python tools/fetch/extract_npc_portrait.py --dry-run # 只统计不写图
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import UnityPy

GAME_DIR = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]
SCRATCH = Path("D:/Bluearchive/.scratch/spr")

RX_TARGET = re.compile(r"^uis-01_common-01_character-_mxload-")
RX_NPC = re.compile(r"^NPC_Portrait_(.+)$")

# 必提名单（任务书点名：抽卡演出与加载画面要用）
MUST = ("Arona", "Plana")


def bundle_date(fn: str) -> str:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", fn)
    return m.group(1) if m else "0000-00-00"


def load_catalog() -> set[str]:
    data = CATALOG.read_bytes()
    return {
        m.group().decode()
        for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", data)
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cat = load_catalog()
    bundles = sorted(n for n in os_listdir() if RX_TARGET.match(n))
    in_cat = [b for b in bundles if b in cat]
    orphans = [b for b in bundles if b not in cat]
    print(f"bundles={len(bundles)} in-catalog={len(in_cat)} orphans={len(orphans)}")
    for o in orphans:
        print(f"  ORPHAN (skipped): {o}")

    best: dict[str, tuple[str, str, object, tuple]] = {}
    scan_fail = 0
    for fn in in_cat:
        d = bundle_date(fn)
        env = UnityPy.load(str(GAME_DIR / fn))
        for obj in env.objects:
            if obj.type.name != "Texture2D":
                continue
            try:
                t = obj.read()
                nm = t.m_Name
            except Exception:
                scan_fail += 1
                continue
            if RX_NPC.match(nm):
                if nm not in best or d > best[nm][0]:
                    best[nm] = (d, fn, obj, getattr(t, "m_Width", 0), )

    names = sorted(best)
    missing_must = [x for x in MUST if not any(n == f"NPC_Portrait_{x}" for n in names)]
    print(f"NPC_Portrait unique: {len(names)}  scan_fail={scan_fail}")
    print(f"must-have missing: {missing_must or 'none'}")

    out_dir = REPO / "resources" / "npc_portrait"
    if args.dry_run:
        for n in names:
            print(" ", n, f"{best[n][3]}x")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "bundles": in_cat,
        "count": 0,
        "extracted": {},
        "decode_fail": [],
        "must_have": {x: f"NPC_Portrait_{x}" in best for x in MUST},
    }
    ok = 0
    for nm, (d, bundle, obj, _w) in sorted(best.items()):
        dst = out_dir / f"{nm}.png"
        try:
            img = obj.read().image
            img.save(dst)
        except Exception as e:  # noqa: BLE001
            report["decode_fail"].append(f"{nm}: {type(e).__name__}: {e}")
            continue
        ok += 1
        report["extracted"][nm] = {
            "file": f"resources/npc_portrait/{nm}.png",
            "w": img.width, "h": img.height,
            "date": d, "bundle": bundle,
        }
    report["count"] = ok
    SCRATCH.mkdir(parents=True, exist_ok=True)
    (SCRATCH / "npc_portrait_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"extracted={ok} decode_fail={len(report['decode_fail'])}")
    print(f"must-have: {report['must_have']}")
    return 0


def os_listdir():
    import os
    return os.listdir(GAME_DIR)


if __name__ == "__main__":
    sys.exit(main())
