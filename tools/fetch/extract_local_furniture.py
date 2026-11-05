#!/usr/bin/env python3
"""
从本地 Steam 版 Blue Archive 的 Addressables bundle 提取咖啡厅家具图标。

来源（实测 2026-11-05，22 个 cafeitem bundle 全部在 catalog）：
  uis-01_common-16_cafeitem[-template]-_mxload-<日期>...bundle
  纹理名 My_<模板>（304x240），游戏内家具图标。
  photo_moviecg 族是照片 CG 不属家具图标，不处理。

id 映射困境（实测记录，见 problems）：
  客户端契约 resources/furniture/<kivo_id>.png（build_app_data.py:213，kivo item id 体系）。
  游戏 FurnitureExcel 在 Preload/TableBundles/{Excel.zip,ExcelDB.db}，均为加密
  （Excel.zip ZipCrypto 密码未知；ExcelDB.db 块加密，已知明文攻击未破），
  无法从本机得到 家具游戏Id -> Icon 直接表。
  退而求其次用 SchaleDB cn 家具表中文名 == kivo 家具中文名的唯一匹配做桥
  （实测 232/1094 唯一命中），SchaleDB Icon 字段（小写 my_*）casefold 对齐游戏纹理名。

产物：
  resources/furniture/game/<My名>.png          游戏内全量图标（304x240）
  resources/furniture/<kivo_id>.png            中文名桥唯一匹配的 kivo id 契约位
  D:/Bluearchive/.scratch/spr/furniture_report.json   溯源报告

用法（venv：D:/Bluearchive/.venv/Scripts/python.exe）：
  python tools/fetch/extract_local_furniture.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import UnityPy

GAME_DIR = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]
SCRATCH = Path("D:/Bluearchive/.scratch/spr")

RX_TARGET = re.compile(r"^uis-01_common-16_cafeitem(?:-template)?-_mxload-")


def bundle_date(fn: str) -> str:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", fn)
    return m.group(1) if m else "0000-00-00"


def load_catalog() -> set[str]:
    data = CATALOG.read_bytes()
    return {
        m.group().decode()
        for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", data)
    }


def norm(s: str) -> str:
    """中文名归一：NFC + 去空白 + 去全半角差异"""
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"\s+", "", s).replace("（", "(").replace("）", ")")


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

    # delta 收集 newest-wins
    best: dict[str, tuple[str, str, object]] = {}
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
            if not nm.lower().startswith("my_"):
                continue
            if nm not in best or d > best[nm][0]:
                best[nm] = (d, fn, obj)
    print(f"unique My_* textures: {len(best)}")
    by_cf = defaultdict(list)
    for nm in best:
        by_cf[nm.casefold()].append(nm)
    cf_amb = {k: v for k, v in by_cf.items() if len(v) > 1}
    if cf_amb:
        print(f"WARNING casefold collisions: {cf_amb}")

    # 中文名桥：SchaleDB cn name <-> kivo name 唯一
    schale = json.loads((SCRATCH / "schaledb_furniture_cn.json").read_text(encoding="utf-8"))
    kivo = json.loads((REPO / "data" / "furniture.json").read_text(encoding="utf-8"))
    game_by_name = defaultdict(list)
    for fid, f in schale.items():
        n = norm(f.get("Name") or "")
        if n:
            game_by_name[n].append((int(fid), f.get("Icon") or ""))
    kivo_by_name = defaultdict(list)
    for r in kivo:
        kivo_by_name[norm(r["name"])].append(r["id"])

    bridge: dict[int, str] = {}  # kivo_id -> game tex name
    amb_names = []
    for n, kids in kivo_by_name.items():
        gs = game_by_name.get(n)
        if not gs or len(kids) != 1 or len(gs) != 1:
            if gs and (len(kids) != 1 or len(gs) != 1):
                amb_names.append(n)
            continue
        gid, icon = gs[0]
        # Icon（小写 my_xxx）casefold 匹配游戏纹理
        hits = by_cf.get(icon.casefold()) or []
        if len(hits) == 1:
            bridge[kids[0]] = hits[0]
    print(f"bridge kivo_id -> My texture: {len(bridge)} (name-ambiguous skipped: {len(amb_names)})")

    out_main = REPO / "resources" / "furniture"
    out_game = REPO / "resources" / "furniture" / "game"
    report = {
        "generated": date.today().isoformat(),
        "bundles": in_cat,
        "orphans": orphans,
        "game_icons": {},
        "bridged": {},
        "problems": [],
    }
    counts = {"game": 0, "bridged": 0, "decode_fail": 0}
    if not args.dry_run:
        out_main.mkdir(parents=True, exist_ok=True)
        out_game.mkdir(parents=True, exist_ok=True)

    for nm, (d, bundle, obj) in sorted(best.items()):
        try:
            img = obj.read().image
        except Exception as e:  # noqa: BLE001
            counts["decode_fail"] += 1
            report["problems"].append(f"{nm}: decode failed {type(e).__name__}: {e}")
            continue
        if not args.dry_run:
            img.save(out_game / f"{nm}.png")
        report["game_icons"][nm] = {"date": d, "bundle": bundle}
        counts["game"] += 1

    for kivo_id, nm in sorted(bridge.items()):
        entry = best.get(nm)
        if entry is None:
            report["problems"].append(f"kivo {kivo_id}: bridged texture '{nm}' missing")
            continue
        try:
            img = entry[2].read().image
        except Exception as e:  # noqa: BLE001
            counts["decode_fail"] += 1
            report["problems"].append(f"kivo {kivo_id}: {nm} decode failed: {e}")
            continue
        if not args.dry_run:
            img.save(out_main / f"{kivo_id}.png")
        report["bridged"][str(kivo_id)] = {
            "file": f"resources/furniture/{kivo_id}.png", "texture": nm,
            "date": entry[0], "bundle": entry[1],
        }
        counts["bridged"] += 1

    n_kivo = len(kivo)
    report["problems"].append(
        f"游戏 FurnitureExcel 不可读（Excel.zip/ExcelDB.db 加密未破），"
        f"中文名桥唯一命中 {len(bridge)}/{n_kivo}；"
        f"其余 {n_kivo - len(bridge)} 个 kivo 家具 id 无游戏内图标映射，"
        f"契约位保留原网络版（若存在），游戏全量图标在 resources/furniture/game/")

    (SCRATCH / "furniture_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"game_icons={counts['game']} bridged={counts['bridged']} decode_fail={counts['decode_fail']}")
    print(f"problems={len(report['problems'])}")
    for p in report["problems"]:
        print(f"  PROBLEM: {p[:160]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
