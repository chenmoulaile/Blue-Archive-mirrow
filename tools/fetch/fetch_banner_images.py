#!/usr/bin/env python3
"""下载卡池公告图 -> resources/banners/{id}.{ext}，并把 banners.json 的 image 改成本地路径"""
from __future__ import annotations

import concurrent.futures as cf
import json
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RES = ROOT / "resources" / "banners"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}
lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0}


def dl(b: dict) -> str:
    url = b.get("image") or ""
    if not url.startswith("http"):
        return ""
    ext = url.rsplit(".", 1)[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "webp"):
        ext = "png"
    dest = RES / f"{b['id']}.{ext}"
    if dest.exists() and dest.stat().st_size > 0:
        with lock:
            stat["skip"] += 1
        return f"/res/banners/{b['id']}.{ext}"
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
            return f"/res/banners/{b['id']}.{ext}"
        except Exception:
            if i == 2:
                with lock:
                    stat["fail"] += 1
    return ""


def main() -> None:
    rows = json.loads((DATA / "banners.json").read_text(encoding="utf-8"))
    with cf.ThreadPoolExecutor(12) as ex:
        paths = list(ex.map(dl, rows))
    n = 0
    for b, p in zip(rows, paths):
        if p:
            b["image"] = p
            n += 1
    (DATA / "banners.json").write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"✓ 卡池图：新增 {stat['ok']} 跳过 {stat['skip']} 失败 {stat['fail']}，本地化 {n}/{len(rows)}")


if __name__ == "__main__":
    main()
