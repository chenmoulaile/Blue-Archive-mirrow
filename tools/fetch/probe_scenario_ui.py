#!/usr/bin/env python3
"""
探针：在 uis-03_scenario-* 里找剧情 UI 原件（对话框底图 / 名字框 / 选项按钮 / 自动·快进·回看按钮）。

为什么单独探针
    第一轮在 `assets-_mx-uis-*` 的 18 个图集里只找到 `CardGame/CCG_Bg_Dialog`，
    那是卡牌游戏的对话框，不是剧情用的。剧情 UI 在 `uis-03_scenario-*` 的 prefab 里，
    精灵名未知，必须先列出来看。

做法
    加载整个 bundle 目录（UnityPy 单文件加载读不出 MonoBehaviour typetree），
    收集所有 NGUIAtlas 精灵（含 border），再统计 prefab 里 UISprite 的
    mSpriteName + mType，按关键词筛出候选。

用法
    .venv/Scripts/python.exe tools/fetch/probe_scenario_ui.py
    .venv/Scripts/python.exe tools/fetch/probe_scenario_ui.py --export   # 顺手导出候选精灵

产物
    deliverables/scenario-ui-probe.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE_DIR = ROOT / ".baad" / "cn" / "android" / "raw" / "bundles"
OUT = ROOT / "deliverables" / "scenario-ui-probe.json"
EXPORT_DIR = ROOT / "resources" / "ui" / "scenario"

TYPE_NAMES = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled", 4: "Advanced"}

# 候选关键词：剧情里会用到的东西
KEYWORDS = (
    "dialog", "text", "message", "window", "panel", "name", "choice",
    "auto", "skip", "log", "history", "button", "btn", "frame", "back",
)


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="探测剧情 UI 原件")
    ap.add_argument("--bundles", default=str(BUNDLE_DIR))
    ap.add_argument("--export", action="store_true")
    args = ap.parse_args()

    try:
        import UnityPy
    except ImportError:
        log("需要 UnityPy")
        sys.exit(1)

    bundle_dir = Path(args.bundles)
    log(f"加载 {bundle_dir} …")
    env = UnityPy.load(str(bundle_dir))

    # 1) 图集：精灵名 + border + 所在图集
    atlas_sprites: dict[str, dict] = {}
    atlas_sheets: dict[str, object] = {}
    textures: dict[str, object] = {}
    for obj in env.objects:
        if obj.type.name == "Texture2D":
            try:
                t = obj.read()
                textures[t.m_Name] = t
            except Exception:
                continue
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        sprites = tree.get("mSprites")
        if not isinstance(sprites, list) or not sprites:
            continue
        atlas = tree.get("m_Name") or "?"
        for sp in sprites:
            name = sp.get("name")
            if not name:
                continue
            border = [
                max(0, int(sp.get("borderLeft") or 0)),
                max(0, int(sp.get("borderTop") or 0)),
                max(0, int(sp.get("borderRight") or 0)),
                max(0, int(sp.get("borderBottom") or 0)),
            ]
            atlas_sprites[f"{atlas}/{name}"] = {
                "atlas": atlas,
                "name": name,
                "w": int(sp.get("width") or 0),
                "h": int(sp.get("height") or 0),
                "x": int(sp.get("x") or 0),
                "y": int(sp.get("y") or 0),
                "border": border,
            }

    # 2) prefab：UISprite 的 mSpriteName + mType
    usage: dict[str, Counter] = defaultdict(Counter)
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
        usage[name][TYPE_NAMES.get(mtype, str(mtype)) if isinstance(mtype, int) else str(mtype)] += 1

    # 3) 关键词筛选
    cands = []
    for key, sp in atlas_sprites.items():
        low = sp["name"].lower()
        if not any(k in low for k in KEYWORDS):
            continue
        counter = usage.get(sp["name"])
        cands.append(
            {
                "key": key,
                "size": [sp["w"], sp["h"]],
                "border": sp["border"],
                "has_border": any(sp["border"]),
                "usage": dict(counter) if counter else {},
                "sliced_count": (counter or {}).get("Sliced", 0),
            }
        )
    cands.sort(key=lambda c: (not c["has_border"], -c["sliced_count"], c["key"]))

    # 4) 导出候选（只导出有切边的，避免污染 ui 目录）
    exported = 0
    if args.export:
        from PIL import Image  # noqa: F401  (UnityPy 依赖已带)

        by_atlas: dict[str, list[dict]] = defaultdict(list)
        for c in cands:
            if c["has_border"]:
                by_atlas[c["key"].split("/", 1)[0]].append(c)
        for atlas, items in by_atlas.items():
            tex = textures.get(atlas)
            if tex is None:
                continue
            try:
                sheet = tex.image
            except Exception:
                continue
            EXPORT_DIR.mkdir(parents=True, exist_ok=True)
            for c in items:
                sp = atlas_sprites[c["key"]]
                x, y, w, h = sp["x"], sp["y"], sp["w"], sp["h"]
                safe = re.sub(r"[^0-9A-Za-z_.\-]+", "_", sp["name"]).strip("_")
                sheet.crop((x, y, x + w, y + h)).save(EXPORT_DIR / f"{atlas}__{safe}.png")
                exported += 1

    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "bundle_dir": str(bundle_dir),
        "atlas_count": len({k.split("/", 1)[0] for k in atlas_sprites}),
        "atlas_sprites": len(atlas_sprites),
        "uisprite_instances": sum(sum(c.values()) for c in usage.values()),
        "candidates": cands[:120],
        "candidate_count": len(cands),
        "exported": exported,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    log("")
    log(f"图集 {report['atlas_count']} 个 / 精灵 {report['atlas_sprites']} 个，"
        f"prefab 里 UISprite 实例 {report['uisprite_instances']} 个")
    log(f"关键词命中 {len(cands)} 个，前 12：")
    for c in cands[:12]:
        log(f"  {c['key']:<52} {c['size']} border={c['border']} sliced={c['sliced_count']}")
    if args.export:
        log(f"✓ 导出 {exported} 个候选到 {EXPORT_DIR.relative_to(ROOT)}")
    log(f"✓ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
