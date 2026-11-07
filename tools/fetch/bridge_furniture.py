#!/usr/bin/env python3
"""ExcelDB FurnitureExcel 权威表 -> repo/data/furniture.json 桥接。

输入：
  .scratch/exceldb/dump/furniture.json       1056 条 {Id, icon(UIs/.../My_xxx), rarity, category, tier, comfort_bonus, localize_etc_id, ...}
  .scratch/exceldb/dump/localize_etc.json    5905 条 {key, name_tw, name_en, ...}
  repo/data/furniture.json                   1094 条 kivo 体系 {id, name, icon, rarity, description, comfort, liked_by}

桥接（ExcelDB localize_etc_id -> LocalizeEtc 官方名 1056/1056 全命中）：
  ExcelDB name_cn = t2s(NameTw)；game icon = resources/furniture/game/<My名>.png
  kivo 匹配 = 中文名 + rarity + comfort 三键；唯一才写 game_id/icon_game，不唯一保守跳过。
  桥不上的条目保留现状（任务约束）。

输出：repo/data/furniture.json 原地更新（git 已 checkpoint）+ 统计。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from opencc import OpenCC

ROOT = Path(r"D:/Bluearchive/repo")
DUMP = Path(r"D:/Bluearchive/.scratch/exceldb/dump")
GAME_ICON_DIR = ROOT / "resources" / "furniture" / "game"

cc = OpenCC("t2s")


def main() -> None:
    ex = json.loads((DUMP / "furniture.json").read_text(encoding="utf-8"))
    loc = {r["key"]: r for r in json.loads((DUMP / "localize_etc.json").read_text(encoding="utf-8"))}
    cur = json.loads((ROOT / "data" / "furniture.json").read_text(encoding="utf-8"))

    # ExcelDB 侧：Id -> {name_cn, my, rarity, comfort, icon_game}
    ex_rows = []
    have_icons = {p.stem for p in GAME_ICON_DIR.glob("*.png")}
    for r in ex:
        lid = r.get("localize_etc_id")
        l = loc.get(lid) if isinstance(lid, int) else None
        name_cn = cc.convert(l["name_tw"].strip()) if l and (l.get("name_tw") or "").strip() else ""
        name_en = (l.get("name_en") or "").strip() if l else ""
        my = (r.get("icon") or "").rsplit("/", 1)[-1]
        ex_rows.append({
            "game_id": r["Id"],
            "name_cn": name_cn,
            "name_en": name_en,
            "my": my,
            "icon_game": f"/res/furniture/game/{my}.png" if my in have_icons else "",
            "rarity": r.get("rarity"),
            "comfort": r.get("comfort_bonus"),
            "tier": r.get("tier"),
            "category": r.get("category"),
        })
    print(f"ExcelDB {len(ex_rows)} 条；官方 cn 名 {sum(1 for x in ex_rows if x['name_cn'])}；"
          f"本地图标 {sum(1 for x in ex_rows if x['icon_game'])}")

    # kivo 匹配：中文名索引
    by_name: dict[str, list[dict]] = {}
    for x in cur:
        by_name.setdefault(x.get("name", ""), []).append(x)

    matched = uniq = ambiguous = 0
    for row in ex_rows:
        if not row["name_cn"]:
            continue
        cands = by_name.get(row["name_cn"], [])
        if not cands:
            continue
        matched += 1
        # rarity+comfort 消歧
        strong = [c for c in cands
                  if c.get("rarity") == row["rarity"] and (c.get("comfort") or 0) == (row["comfort"] or 0)]
        if len(strong) == 1:
            c = strong[0]
        elif len(cands) == 1:
            c = cands[0]
        else:
            ambiguous += 1
            continue
        c["game_id"] = row["game_id"]
        c["name_en_game"] = row["name_en"]
        if row["icon_game"]:
            c["icon_game"] = row["icon_game"]
        uniq += 1

    print(f"kivo 匹配：命中名字 {matched}，唯一桥上 {uniq}，歧义跳过 {ambiguous}")
    (ROOT / "data" / "furniture.json").write_text(
        json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")
    print("✓ repo/data/furniture.json 已更新")


if __name__ == "__main__":
    main()
