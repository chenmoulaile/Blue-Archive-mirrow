# -*- coding: utf-8 -*-
"""生成 data/asset_map.cdn.json — CDN 下载的剧情 BG 背景图索引 side-file。

schema 对齐 build_asset_map.py 的 images 段:
  { "images": { "<stem 无扩展名>": "resources/images/<原名>" } }
不动 data/asset_map.json 本体（归并员负责折叠）。
仅索引 BG_*.jpg（本轮 CDN 下载产物），不碰 images/ 下其它来源文件。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(r"D:/Bluearchive/repo")
IMG_DIR = ROOT / "resources" / "images"
OUT = ROOT / "data" / "asset_map.cdn.json"
BG_RE = re.compile(r"^BG_.+\.jpg$", re.IGNORECASE)


def main() -> int:
    images: dict[str, str] = {}
    dupes = 0
    for f in sorted(IMG_DIR.glob("BG_*.jpg")):
        if not BG_RE.match(f.name):
            continue
        key = f.stem
        rel = f"resources/images/{f.name}"
        if key in images:
            dupes += 1
        images[key] = rel
    payload = {"images": images}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    print(f"asset_map.cdn.json: {len(images)} BG keys (dupes={dupes}) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
