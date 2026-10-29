#!/usr/bin/env python3
"""
下载 Blue Archive 主题鼠标指针 -> resources/cursors/

来源：https://github.com/makipom/BlueArchive-Cursors （MIT License, Copyright (c) 2023 Maki）
指针图形本身衍生于《蔚蓝档案》的视觉风格，版权归 NAT GAMES / NEXON；
仓库以 MIT 发布的是这套指针文件本身，本项目按其许可原样使用并在此署名。

用法：python tools/fetch/fetch_cursors.py
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "resources" / "cursors"
# raw.githubusercontent.com 在本机网络下会被 403，改走 GitHub API 的原始内容接口
BASE = "https://api.github.com/repos/makipom/BlueArchive-Cursors/contents/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}

# 仓库根目录下的常规版指针（Millennium Edition 另有一套，此处用常规版）
FILES = [
    "normal.cur",
    "link.cur",
    "text.ani",
    "loading.ani",
    "background.ani",
    "move.cur",
    "help.cur",
    "pen.cur",
    "block.cur",
    "areaselect.cur",
    "alternativeselect.cur",
    "resizeNS.cur",
    "resizeWE.cur",
    "resizeDIAG1.cur",
    "resizeDIAG2.cur",
]

# 语义状态 -> 指针文件
CURSOR_MAP = {
    "default": "normal.cur",
    "pointer": "link.cur",
    "text": "text.ani",
    "wait": "loading.ani",
    "progress": "background.ani",
    "move": "move.cur",
    "help": "help.cur",
    "crosshair": "pen.cur",
    "not-allowed": "block.cur",
    "cell": "areaselect.cur",
    "copy": "alternativeselect.cur",
    "ns-resize": "resizeNS.cur",
    "ew-resize": "resizeWE.cur",
    "nwse-resize": "resizeDIAG1.cur",
    "nesw-resize": "resizeDIAG2.cur",
}


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    ok = 0
    for name in FILES:
        dest = DEST / name
        if dest.exists() and dest.stat().st_size > 0:
            ok += 1
            continue
        try:
            req = urllib.request.Request(
                BASE + name,
                headers={**UA, "Accept": "application/vnd.github.raw"},
            )
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            dest.write_bytes(data)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {name}: {e}")

    (DEST / "cursor-map.json").write_text(
        json.dumps(
            {
                "source": "https://github.com/makipom/BlueArchive-Cursors",
                "license": "MIT (Copyright (c) 2023 Maki)",
                "map": CURSOR_MAP,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"✓ 指针 {ok}/{len(FILES)} 个 -> resources/cursors/")


if __name__ == "__main__":
    main()
