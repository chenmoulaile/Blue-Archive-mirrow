#!/usr/bin/env python3
"""
抓取咖啡厅家具数据 -> data/furniture.json

kivo 的 /api/v1/data/items/?type=furniture 给出每件家具的名称、图标、
舒适度（furniture.comfort）以及偏好该家具的学生列表，正好够咖啡厅模块用。
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
API = "https://api.kivo.wiki/api/v1"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}


def get(url: str, retry: int = 3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if i == retry - 1:
                return None
    return None


def main() -> None:
    first = get(f"{API}/data/items/?page=1&page_size=100&type=furniture")
    if not first:
        raise SystemExit("接口不可用")
    max_page = first["data"]["max_page"]
    items = list(first["data"]["item"])
    for p in range(2, max_page + 1):
        d = get(f"{API}/data/items/?page={p}&page_size=100&type=furniture")
        if d:
            items += d["data"]["item"]
    print(f"列表 {len(items)} 件")

    def detail(it):
        d = get(f"{API}/data/items/{it['id']}")
        if not d:
            return None
        x = d["data"]
        f = x.get("furniture") or {}
        return {
            "id": x["id"],
            "name": x.get("name", ""),
            "icon": ("https:" + x["icon"]) if x.get("icon", "").startswith("//") else x.get("icon", ""),
            "rarity": x.get("rarity", 1),
            "description": x.get("description", ""),
            "comfort": f.get("comfort", 0),
            "liked_by": [s["id"] for s in (f.get("students") or [])],
        }

    with cf.ThreadPoolExecutor(8) as ex:
        rows = [r for r in ex.map(detail, items) if r]
    rows.sort(key=lambda r: (-r["comfort"], r["id"]))

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "furniture.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    total = sum(r["comfort"] for r in rows)
    print(f"✓ {len(rows)} 件家具，舒适度合计 {total} -> data/furniture.json")


if __name__ == "__main__":
    main()
