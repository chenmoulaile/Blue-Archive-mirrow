#!/usr/bin/env python3
"""
A-3 落地：批量提取 NGUI 九宫格切边，合并写回 data/ui_nineslice.json。

背景
    《蔚蓝档案》UI 是 NGUI：九宫格 border 存在 NGUIAtlas MonoBehaviour 的
    mSprites[i].borderLeft/Bottom/Right/Top 上（probe_prefab_border.py 已证），
    UISprite 组件只有 mSpriteName / mType（Sliced 等使用方式）。
    旧管线（import_ngui_atlas.py / import_ngui_nineslice.py）从国服 bundle
    提了 474 条 border；2026-11-08 增补 ui_atlas.json 时 39 条 ChatArchive
    精灵（Scenario_Mode_Bg_3 等）没有 border —— 对话框底板整图拉伸变形（S-6）。

    2026-11 实测（本轮，探针输出见 .scratch/infra/）：
    - border 只在 assets-_mx-uis-atlas-* / assets-_mx-uis-* 这两组 bundle 里
      （国服快照 .scratch/ui-atlas-stage 21 个 + KR CDN 同名 77 个，两边扫出的
      都是同 15 个图集 / 300 条带 border 精灵）；
    - ui-_mxload-prefabs-* 769 个 bundle 只有 UISprite 组件
      （244336 个），NGUIAtlas 为 0 —— prefab 群只提供 mType 使用证据；
    - Common/Combat/SpecialOperation 图集的 MonoBehaviour 在 KR CDN 各组
      （prefab/uis/uis-01_common/assets-_mx-uis）均扫不到，其 158 条 border
      仍由既有 474 条快照承载，无损失。

本脚本做三件事
    1. 整目录加载三处 bundle：atlas 两处收 border，prefab 群收 mType 计数
    2. 与既有 data/ui_nineslice.json 合并：
       - 既有 key 保持不变（对齐本地 CN 素材），冲突只记录不覆盖
       - 新 key 且 border 非零 → 追加；type 取该 sprite 出现最多的 mType，
         无 prefab 使用记录按 NGUI 默认记 Sliced
    3. 统计与清单：新命中数 / 其中能在 data/ui_atlas.json 立即生效数 /
       冲突清单 / 解析不到的精灵清单（prefab 里按 Sliced 用但任何 border 记录都没有）

用法
    .venv/Scripts/python.exe tools/fetch/import_nineslice_borders.py [--dry-run]

产物
    data/ui_nineslice.json（合并后）
    .scratch/infra/nineslice_merge_report.json
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# border 来源：国服 atlas bundle 快照（与本地 PNG 同源）+ KR CDN assets-_mx-uis* 全量
ATLAS_CN_DIR = ROOT.parent / ".scratch" / "ui-atlas-stage"
ATLAS_KR_DIR = ROOT.parent / ".scratch" / "infra" / "uis_atlas_kr"
# type 使用证据来源：KR prefab bundle 群（只有 UISprite 组件，无 border）
BUNDLE_DIR = ROOT.parent / ".scratch" / "infra" / "prefab_bundles"
NINESLICE = ROOT / "data" / "ui_nineslice.json"
ATLAS = ROOT / "data" / "ui_atlas.json"
REPORT = ROOT.parent / ".scratch" / "infra" / "nineslice_merge_report.json"

TYPE_NAMES = {0: "Simple", 1: "Sliced", 2: "Tiled", 3: "Filled", 4: "Advanced"}


def log(msg: str) -> None:
    print(msg, flush=True)


def scan_dir(bundle_dir: Path, want_borders: bool) -> tuple[dict[str, list[int]], dict[str, Counter], dict[str, str], int, int]:
    """返回 (border 表 {atlas/sprite: [L,T,R,B]}, mType 计数, border 来源 atlas, NGUIAtlas 数, UISprite 数)。"""
    import UnityPy

    borders: dict[str, list[int]] = {}
    border_src: dict[str, str] = {}
    types: dict[str, Counter] = defaultdict(Counter)
    files = sorted(bundle_dir.glob("*.bundle"))
    log(f"整目录加载 {bundle_dir}（{len(files)} 个 bundle，{sum(p.stat().st_size for p in files)/1048576:.1f} MB）…")
    env = UnityPy.load(str(bundle_dir))

    n_atlas = n_uisprite = 0
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        ks = set(tree.keys())
        # NGUIAtlas：mSprites[i].borderLeft/Bottom/Right/Top（切边真身）
        if want_borders and "mSprites" in ks and isinstance(tree.get("mSprites"), list):
            atlas_name = tree.get("m_Name") or ""
            n_atlas += 1
            for sp in tree["mSprites"]:
                if not isinstance(sp, dict):
                    continue
                name = sp.get("name")
                if not name:
                    continue
                bl = max(0, int(sp.get("borderLeft") or 0))
                bb = max(0, int(sp.get("borderBottom") or 0))
                br = max(0, int(sp.get("borderRight") or 0))
                bt = max(0, int(sp.get("borderTop") or 0))
                if (bl, bb, br, bt) == (0, 0, 0, 0):
                    continue
                key = f"{atlas_name}/{name}"
                val = [bl, bt, br, bb]  # 存 LTRB，与 data/ui_atlas.json 的 border 约定一致
                if key not in borders:
                    borders[key] = val
                    border_src[key] = atlas_name
        # UISprite：使用方式证据
        if {"mSprite", "mSpriteName"} & ks:
            name = tree.get("mSpriteName")
            if name:
                n_uisprite += 1
                mtype = tree.get("mType")
                tname = TYPE_NAMES.get(mtype, f"type{mtype}") if isinstance(mtype, int) else str(mtype)
                types[name][tname] += 1
    log(f"  -> NGUIAtlas {n_atlas} 个 / UISprite {n_uisprite} 个 / 带 border 精灵 {len(borders)} 个")
    return borders, types, border_src, n_atlas, n_uisprite


def main() -> None:
    ap = argparse.ArgumentParser(description="批量提取 NGUI border 合并进 ui_nineslice.json")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写 data/ui_nineslice.json")
    args = ap.parse_args()

    dirs_borders = [d for d in (ATLAS_CN_DIR, ATLAS_KR_DIR) if d.is_dir()]
    if not dirs_borders:
        log("border 来源目录都不存在：先备好 .scratch/ui-atlas-stage 或跑 fetch 脚本")
        raise SystemExit(1)

    ns = json.loads(NINESLICE.read_text(encoding="utf-8"))
    existing: dict[str, dict] = ns.get("sprites", {})
    atlas_keys = set(
        json.loads(ATLAS.read_text(encoding="utf-8")).get("sprites", {}).keys()
    )

    borders: dict[str, list[int]] = {}
    border_src: dict[str, str] = {}
    types: dict[str, Counter] = defaultdict(Counter)
    stats = []
    for d in dirs_borders:
        b, t, src, na, nu = scan_dir(d, want_borders=True)
        stats.append({"dir": str(d), "ngui_atlas": na, "uisprite": nu, "bordered": len(b)})
        for k, v in b.items():
            borders.setdefault(k, v)
            border_src.setdefault(k, src[k])
        for k, c in t.items():
            types[k] += c
    b, t, src, na, nu = scan_dir(BUNDLE_DIR, want_borders=False)
    stats.append({"dir": str(BUNDLE_DIR), "ngui_atlas": na, "uisprite": nu, "bordered": len(b)})
    for k, c in t.items():
        types[k] += c

    added: dict[str, dict] = {}
    conflicts: list[dict] = []
    for key, val in borders.items():
        if key in existing:
            old = existing[key].get("border")
            if old and old != val:
                conflicts.append({"key": key, "existing": old, "rescan": val, "action": "keep_existing"})
            continue
        name = key.split("/", 1)[1] if "/" in key else key
        counter = types.get(name)
        tname = counter.most_common(1)[0][0] if counter else "Sliced"
        added[key] = {
            "border": val,
            "type": tname,
            "source_prefab": None,
            "source_atlas": border_src.get(key),
            "origin": "ngui-atlas-rescan-2026-11",
        }

    # 解析不到的精灵：prefab 里按 Sliced 用、但既有表与新扫描都没有 border
    covered = set(existing) | set(added)
    unresolved = sorted(
        name
        for name, counter in types.items()
        if "Sliced" in counter and name not in covered
    )

    merged = {**existing, **added}
    in_atlas = sorted(k for k in added if k in atlas_keys)
    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "sources": stats,
        "existing_total": len(existing),
        "rescan_bordered_sprites": len(borders),
        "added_total": len(added),
        "added_in_atlas_immediately_usable": len(in_atlas),
        "added_in_atlas_keys": in_atlas,
        "conflicts": conflicts,
        "unresolved_sliced_count": len(unresolved),
        "unresolved_sliced": unresolved,
        "note": "border 序 LTRB；既有 key 保持 CN 基线，冲突仅记录不覆盖；unresolved=Sliced 使用但无边框记录（ChatArchive 39 条由 measure_chat_borders.py 单独量）",
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    log("")
    log(f"既有 {len(existing)} 条 / 重扫出带 border {len(borders)} 条")
    log(f"新增 {len(added)} 条（其中 key 命中 data/ui_atlas.json、可立即生效 {len(in_atlas)} 条）")
    log(f"border 冲突 {len(conflicts)} 条（保留既有值，详见报告）")
    log(f"Sliced 使用但解析不到 border 的精灵 {len(unresolved)} 个")
    if not args.dry_run:
        out = {
            "generated": datetime.now().isoformat(timespec="seconds"),
            "total": len(merged),
            "source": ns.get("source", "") + " + NGUIAtlas rescan (CN atlas-stage + KR assets-_mx-uis)",
            "sprites": merged,
        }
        NINESLICE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"[ok] 已写 {NINESLICE}（total {len(merged)}）")
    else:
        log("dry-run：未写文件")
    log(f"[ok] 报告 {REPORT}")


if __name__ == "__main__":
    main()
