#!/usr/bin/env python3
"""
从本地 Steam 版 Blue Archive 的 Addressables bundle 提取学生头像。

来源（实测 2026-11-05，catalog 25961 名全部命中）：
  uis-01_common-01_character-_mxload-<日期>[_NNN分片]_assets_all_<crc>.bundle
  （13 个 bundle 全部在 catalog，增量批次：老 bundle 存量 + 新日期增补，
    同名 Texture2D 按文件名日期 newest-wins）

纹理命名（probe 实测 833 个唯一名）：
  Student_Portrait_<DevName>          252x204 主头像
  Student_Portrait_<DevName>_Small    182x144 小头像（桃信用，本任务归档 game/）
  NPC_Portrait_<名>                   239 个，客户端不用，跳过

映射链（全本地，实测 585/594 命中）：
  Student_Portrait_CH0058 -> resname CH0058 -> spine_index(CH0058_spr/_home)
  -> students_full.spine 引用 -> kivo 学生 id -> resources/avatar/<id>.png

产物：
  resources/avatar/<kivo_id>.png       客户端契约位（build_app_data.py:35）
  resources/avatar/game/<原名>.png     无法映射或 Small 变体的归档
  D:/Bluearchive/.scratch/spr/avatar_report.json   溯源报告

用法（venv：D:/Bluearchive/.venv/Scripts/python.exe）：
  python tools/fetch/extract_local_avatar.py            # 全量提取
  python tools/fetch/extract_local_avatar.py --dry-run  # 只统计不写图
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date
from pathlib import Path

import UnityPy

GAME_DIR = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]
SCRATCH = Path("D:/Bluearchive/.scratch/spr")

RX_TARGET = re.compile(r"^uis-01_common-01_character-_mxload-")
RX_STUDENT = re.compile(r"^Student_Portrait_(.+)$")


def bundle_date(fn: str) -> str:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", fn)
    return m.group(1) if m else "0000-00-00"


def build_kivo_res() -> dict[str, int]:
    """resname(lower) -> kivo 学生 id（students_full.spine -> spine_index.name 去后缀）"""
    spine_idx = {
        x["id"]: x
        for x in json.loads((REPO / "data" / "spine_index.json").read_text(encoding="utf-8"))
    }
    students = json.loads((REPO / "data" / "students_full.json").read_text(encoding="utf-8"))
    res: dict[str, int] = {}
    for s in students:
        for sid in s.get("spine") or []:
            meta = spine_idx.get(sid) or {}
            name = meta.get("name", "")
            for suf in ("_spr_HD", "_spr", "_home_CN", "_home"):
                if name.endswith(suf):
                    rn = name[: -len(suf)].lower()
                    # 同一 resname 多 kivo id 时保留第一个（实测 multi 都是同 id 重复）
                    res.setdefault(rn, s["id"])
                    break
    return res


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
    bundles = sorted(n for n in os.listdir(GAME_DIR) if RX_TARGET.match(n))
    in_cat = [b for b in bundles if b in cat]
    orphans = [b for b in bundles if b not in cat]
    print(f"bundles={len(bundles)} in-catalog={len(in_cat)} orphans={len(orphans)}")
    for o in orphans:
        print(f"  ORPHAN (skipped): {o}")

    kivo_res = build_kivo_res()
    print(f"kivo resnames: {len(kivo_res)}")

    # delta 收集：同名纹理按日期 newest-wins
    best: dict[str, tuple[str, str, object]] = {}  # tex name -> (date, bundle, obj)
    for fn in in_cat:
        d = bundle_date(fn)
        env = UnityPy.load(str(GAME_DIR / fn))
        for obj in env.objects:
            if obj.type.name != "Texture2D":
                continue
            try:
                nm = obj.read().m_Name
            except Exception:
                continue
            if nm not in best or d > best[nm][0]:
                best[nm] = (d, fn, obj)

    out_main = REPO / "resources" / "avatar"
    out_game = REPO / "resources" / "avatar" / "game"
    report = {
        "generated": date.today().isoformat(),
        "bundles": in_cat,
        "orphans": orphans,
        "mapped": {},
        "archived": {},
        "npc_skipped": [],
        "problems": [],
    }
    counts = {"main": 0, "game": 0, "npc": 0, "decode_fail": 0}

    if not args.dry_run:
        out_main.mkdir(parents=True, exist_ok=True)
        out_game.mkdir(parents=True, exist_ok=True)

    for nm, (d, bundle, obj) in sorted(best.items()):
        m = RX_STUDENT.match(nm)
        if not m:
            if nm.startswith("NPC_Portrait_"):
                counts["npc"] += 1
                report["npc_skipped"].append(nm)
            continue
        is_small = nm.endswith("_Small")
        x = m.group(1).lower()
        if is_small:
            x = x[: -len("_small")]  # 原名后缀为准，避免非贪婪歧义
        x_nosm = x
        kivo_id = kivo_res.get(x_nosm)
        try:
            img = obj.read().image
        except Exception as e:  # noqa: BLE001
            counts["decode_fail"] += 1
            report["problems"].append(f"{nm}: decode failed {type(e).__name__}: {e}")
            continue
        if kivo_id is not None and not is_small:
            dst = out_main / f"{kivo_id}.png"
            report["mapped"][nm] = {
                "file": f"resources/avatar/{kivo_id}.png", "kivo_id": kivo_id,
                "date": d, "bundle": bundle,
            }
            counts["main"] += 1
        else:
            reason = "small_variant" if is_small else "no_mapping"
            dst = out_game / f"{nm}.png"
            entry = {"file": f"resources/avatar/game/{nm}.png", "reason": reason,
                     "date": d, "bundle": bundle}
            report["archived"][nm] = entry
            counts["game"] += 1
            if reason == "no_mapping":
                report["problems"].append(
                    f"{nm}: resname '{x_nosm}' not in spine_index (no kivo id)")
        if not args.dry_run:
            img.save(dst)

    (SCRATCH / "avatar_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"mapped={counts['main']} archived_game={counts['game']} "
          f"npc_skipped={counts['npc']} decode_fail={counts['decode_fail']}")
    print(f"problems={len(report['problems'])}")
    for p in report["problems"][:12]:
        print(f"  PROBLEM: {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
