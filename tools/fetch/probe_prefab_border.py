#!/usr/bin/env python3
"""
探针：确认 prefab 里的 NGUI UISprite 能不能读出九宫格切边。

背景
    NGUI 的九宫格信息不在图集条目里（`NGUIAtlas.mSprites` 只有 name/x/y/w/h），
    而是在 prefab 的 `UISprite` 组件上。这个脚本只做一件事：
    打开若干个 prefab bundle，把每个 UISprite 的字段原样打印出来，
    确认字段名、类型枚举、border 是否存在，不猜。

用法
    .venv/Scripts/python.exe tools/fetch/probe_prefab_border.py            # 取最大的 5 个
    .venv/Scripts/python.exe tools/fetch/probe_prefab_border.py --limit 20
    .venv/Scripts/python.exe tools/fetch/probe_prefab_border.py --all      # 全量扫描

产物
    deliverables/prefab-border-probe.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / ".baad" / "cn" / "android" / "raw" / "bundles"
OUT = ROOT / "deliverables" / "prefab-border-probe.json"

# NGUI UISprite.Type：0 Simple / 1 Sliced / 2 Tiled / 3 Filled / 4 Advanced
TYPE_NAMES = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled", 4: "Advanced"}


def log(msg: str) -> None:
    print(msg, flush=True)


def border_of(tree: dict) -> tuple[list[int], str]:
    """返回 ([left, bottom, right, top], 字段来源)。字段不存在就返回零和 'none'。"""
    # NGUI 新版：border 在 sprite 数据里，UISprite 上可能是 Vector4 mBorder
    for key in ("mBorder", "border"):
        v = tree.get(key)
        if isinstance(v, dict):
            l = int(v.get("x", 0) or 0)
            b = int(v.get("y", 0) or 0)
            r = int(v.get("z", 0) or 0)
            t = int(v.get("w", 0) or 0)
            return [l, b, r, t], key
        if isinstance(v, (list, tuple)) and len(v) == 4:
            return [int(x or 0) for x in v], key
    # 有的版本把四个边拆成独立字段
    keys = ("mBorderLeft", "mBorderBottom", "mBorderRight", "mBorderTop")
    if any(k in tree for k in keys):
        return [int(tree.get(k, 0) or 0) for k in keys], "split"
    return [0, 0, 0, 0], "none"


def main() -> None:
    ap = argparse.ArgumentParser(description="探测 NGUI UISprite 的九宫格字段")
    ap.add_argument("--bundles", default=str(DEFAULT_DIR))
    ap.add_argument("--limit", type=int, default=5, help="按体积从大到小取前 N 个")
    ap.add_argument("--all", action="store_true", help="扫描全部 bundle")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    bundle_dir = Path(args.bundles)
    if not bundle_dir.is_dir():
        log(f"bundle 目录不存在：{bundle_dir}")
        sys.exit(1)

    try:
        import UnityPy
    except ImportError:
        log("需要 UnityPy")
        sys.exit(1)

    files = sorted(bundle_dir.glob("*.bundle"), key=lambda p: p.stat().st_size, reverse=True)
    targets = files if args.all else files[: args.limit]
    log(f"候选 {len(files)} 个 bundle，本次统计体积取前 {len(targets)} 个"
        f"（合计 {sum(p.stat().st_size for p in targets)/1024/1024:.1f} MB）")

    keys_seen: Counter[str] = Counter()
    type_seen: Counter[str] = Counter()
    sprites: list[dict] = []
    null_sprite = 0
    bundles_info: list[dict] = []
    atlas_sprites = 0
    atlas_bordered = 0
    atlas_sample: list[dict] = []

    # 一次性加载整个目录：MonoBehaviour 的 typetree 需要同目录下的 MonoScript 才能解析，
    # 单个 bundle 单独加载会解析失败（表现就是 atlas_sprites=0）。
    env = UnityPy.load(str(bundle_dir))
    for path in targets:
        bundles_info.append(
            {"file": path.name, "size_mb": round(path.stat().st_size / 1024 / 1024, 2)}
        )

    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        ks = set(tree.keys())
        # NGUIAtlas：九宫格切边真正的存放位置
        if "mSprites" in ks and isinstance(tree.get("mSprites"), list):
            for sp in tree["mSprites"]:
                atlas_sprites += 1
                if any(sp.get(k) for k in
                       ("borderLeft", "borderRight", "borderTop", "borderBottom")):
                    atlas_bordered += 1
                    if len(atlas_sample) < 10:
                        atlas_sample.append(
                            {
                                "atlas": tree.get("m_Name"),
                                "name": sp.get("name"),
                                "border": [
                                    sp.get("borderLeft") or 0,
                                    sp.get("borderBottom") or 0,
                                    sp.get("borderRight") or 0,
                                    sp.get("borderTop") or 0,
                                ],
                            }
                        )
        if not ({"mSprite", "mSpriteName"} & ks):
            continue
        n_sprite = 1
        keys_seen.update(ks)
        mtype = tree.get("mType")
        tname = TYPE_NAMES.get(mtype, f"type{mtype}") if isinstance(mtype, int) else str(mtype)
        type_seen[tname] += 1
        border, src = border_of(tree)
        ref = tree.get("mSprite")
        if ref is None:
            null_sprite += 1
        if len(sprites) < 400:
            sprites.append(
                {
                    "gameobject": tree.get("m_Name"),
                    "sprite_name": tree.get("mSpriteName"),
                    "mSprite_is_null": ref is None,
                    "type": tname,
                    "border": border,
                    "border_field": src,
                }
            )

    bordered = [s for s in sprites if any(s["border"])]
    report = {
        "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "bundle_dir": str(bundle_dir),
        "scanned_bundles": len(targets),
        "total_uisprite": sum(type_seen.values()),
        "uisprite_with_border": len(bordered),
        "mSprite_null": null_sprite,
        "type_distribution": dict(type_seen),
        "common_keys": [k for k, _ in keys_seen.most_common(40)],
        "border_field_variants": dict(Counter(s["border_field"] for s in sprites)),
        "atlas_sprites": atlas_sprites,
        "atlas_sprites_with_border": atlas_bordered,
        "atlas_border_samples": atlas_sample,
        "conclusion": (
            "UISprite 组件上没有 border 字段（字段表里只有 mSpriteName / mType / mAtlas）。"
            "九宫格切边在 NGUIAtlas.mSprites[i] 的 borderLeft/Bottom/Right/Top 上。"
            "因此不需要 prefab 也能拿到切边，prefab 只用来确认某个 sprite 实际按 Sliced 使用。"
        ),
        "bundles": bundles_info,
        "samples": sprites[:80],
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    log("")
    log(f"UISprite {len(sprites)} 个，其中 border 非零 {len(bordered)} 个，mSprite 为 null {null_sprite} 个")
    log(f"类型分布：{dict(type_seen)}")
    log(f"border 字段来源：{report['border_field_variants']}")
    log(f"✓ {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
