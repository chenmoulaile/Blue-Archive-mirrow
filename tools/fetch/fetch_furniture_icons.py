#!/usr/bin/env python3
"""下载家具图标 -> resources/furniture/{id}.png（咖啡厅摆放界面用）"""
from __future__ import annotations

import concurrent.futures as cf
import json
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RES = ROOT / "resources" / "furniture"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}
lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0}


def dl(item: dict) -> None:
    url = item.get("icon") or ""
    if not url:
        return
    dest = RES / f"{item['id']}.png"
    if dest.exists() and dest.stat().st_size > 0:
        with lock:
            stat["skip"] += 1
        return
    RES.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if not data:
                raise RuntimeError("empty")
            dest.write_bytes(data)
            with lock:
                stat["ok"] += 1
            return
        except Exception:
            if i == 2:
                with lock:
                    stat["fail"] += 1


def main() -> None:
    items = json.loads((DATA / "furniture.json").read_text(encoding="utf-8"))
    with cf.ThreadPoolExecutor(12) as ex:
        list(ex.map(dl, items))
    print(f"✓ 家具图标：新增 {stat['ok']} 跳过 {stat['skip']} 失败 {stat['fail']}")


if __name__ == "__main__":
    main()
