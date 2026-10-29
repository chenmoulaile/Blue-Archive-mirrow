#!/usr/bin/env python3
"""
生成九宫格切边表 data/ui_nineslice.json

结论先说：**border 不在 UISprite 组件上，在图集的 mSprites 条目里。**
    NGUIAtlas.mSprites[i] = {name, x, y, width, height,
                             borderLeft, borderBottom, borderRight, borderTop,
                             paddingLeft, ...}
    UISprite（prefab 上的组件）只有 mSpriteName / mType / mAtlas，
    没有 border 字段（探针见 deliverables/prefab-border-probe.json）。

所以本脚本做两件事：
    1. 从 data/ui_atlas.json（由 import_ngui_atlas.py 生成，已带 border）取切边
    2. 扫 prefab bundle，统计每个 sprite 实际被当成什么 mType 用
       （Sliced / Simple / Tiled），取出现最多的那个作为 type
    合并写成 data/ui_nineslice.json。

用法
    .venv/Scripts/python.exe tools/fetch/import_ngui_nineslice.py
    .venv/Scripts/python.exe tools/fetch/import_ngui_nineslice.py --skip-prefabs   # 只导图集切边

产物
    data/ui_nineslice.json
        { "Common/Common_Btn_Blue": { "border": [12,12,12,12], "type": "Sliced",
                                      "source_prefab": "ui-_mxload-prefabs-...bundle" } }
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / ".baad" / "cn" / "android" / "raw" / "bundles"
ATLAS = ROOT / "data" / "ui_atlas.json"
OUT = ROOT / "data" / "ui_nineslice.json"

TYPE_NAMES = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled", 4: "Advanced"}


def log(msg: str) -> None:
    print(msg, flush=True)


def scan_prefabs(bundle_dir: Path) -> tuple[dict[str, Counter], dict[str, str]]:
    """返回 {sprite_name: Counter(type)} 与 {sprite_name: 第一个 Sliced 它的 bundle}"""
    import UnityPy

    types: dict[str, Counter] = defaultdict(Counter)
    source: dict[str, str] = {}
    files = sorted(bundle_dir.glob("*.bundle"))
    files = [p for p in files if p.name.startswith("ui-_mxload-prefabs")]
    log(f"扫描 {len(files)} 个 prefab bundle …")

    for i, path in enumerate(files, 1):
        try:
            env = UnityPy.load(str(path))
        except Exception:
            continue
        for obj in env.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            name = tree.get("mSpriteName")
            if not name:
                continue
            mtype = tree.get("mType")
            tname = TYPE_NAMES.get(mtype, f"type{mtype}") if isinstance(mtype, int) else str(mtype)
            types[name][tname] += 1
            if tname == "Sliced" and name not in source:
                source[name] = path.name
        if i % 100 == 0:
            log(f"  {i}/{len(files)}")
    return types, source


def main() -> None:
    ap = argparse.ArgumentParser(description="生成九宫格切边表")
    ap.add_argument("--bundles", default=str(DEFAULT_DIR))
    ap.add_argument("--atlas", default=str(ATLAS))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--skip-prefabs", action="store_true", help="不扫 prefab，type 一律按 Sliced")
    args = ap.parse_args()

    atlas_path = Path(args.atlas)
    if not atlas_path.exists():
        log(f"缺 {atlas_path}，先跑 npm run import:ui")
        sys.exit(1)
    sprites = json.loads(atlas_path.read_text(encoding="utf-8")).get("sprites") or {}

    types: dict[str, Counter] = {}
    source: dict[str, str] = {}
    if not args.skip_prefabs:
        bundle_dir = Path(args.bundles)
        if bundle_dir.is_dir():
            types, source = scan_prefabs(bundle_dir)
        else:
            log(f"bundle 目录不存在，跳过 prefab 扫描：{bundle_dir}")

    out: dict[str, dict] = {}
    with_border = 0
    for key, entry in sprites.items():
        if "/" not in key:
            continue  # 跳过语义别名，只记真实精灵
        border = entry.get("border")
        if not border:
            continue
        with_border += 1
        name = entry.get("sprite") or key.split("/", 1)[1]
        counter = types.get(name)
        if counter:
            tname = counter.most_common(1)[0][0]
        else:
            # 图集里有切边但没在任何 prefab 里出现，按 Sliced 记（NGUI 默认语义）
            tname = "Sliced"
        out[key] = {
            "border": border,
            "type": tname,
            "source_prefab": source.get(name),
        }

    Path(args.out).write_text(
        json.dumps(
            {
                "generated": datetime.now().isoformat(timespec="seconds"),
                "total": len(out),
                "source": "NGUIAtlas.mSprites[i].borderLeft/Bottom/Right/Top",
                "sprites": out,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    dist = Counter(v["type"] for v in out.values())
    log("")
    log(f"图集精灵 {len([k for k in sprites if '/' in k])} 个，其中带切边 {with_border} 个")
    log(f"类型分布：{dict(dist)}")
    log(f"✓ {Path(args.out).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
