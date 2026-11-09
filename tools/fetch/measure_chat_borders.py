#!/usr/bin/env python3
"""
A-3/S-6 落地：给两张 ChatArchive 底板人工量出九宫格 border 并回填 data/ui_nineslice.json。

对象（StoryDialog.tsx:80-82 在用、ui_atlas.json 有记录但无 border）
    resources/ui/extra2/Scenario_Mode_Bg_3.png        1292x437  主线对话大底板
    resources/ui/extra2/Dialogue_Event_Background.png 1056x288  活动气泡/名字牌底板

这两张不是 NGUIAtlas 精灵（origin=assetbundle-via-ChatArchive，独立 Texture2D），
prefab 扫描拿不到 border，只能从原图量。测量全部算法化，规则如下（可复现）：

    radius   四角 alpha=0（圆角透明）。radius = 第一条「x=0 列变不透明(>=200)」的行号。
    band     描边带：从边向内逐像素走，直到颜色进入「内部参考色」（采样内部 60x40
             区域均值）的容差(ΔRGB 欧氏 <=18)。
    特征物   名字条 / 罗盘 / 爱心按「列差异占比」定位：一列内与参考色差 >30 的像素
             占比 sustained >20% 连续 8 列，视为特征物左缘；左 border 取名字条右缘，
             右 border 覆盖到装饰（罗盘/爱心）左缘，避免水平拉伸把装饰拉变形。
    最终     每边 border = max(radius, band, 特征物覆盖)，并保证 L+R < W、T+B < H。

用法
    .venv/Scripts/python.exe tools/fetch/measure_chat_borders.py [--dry-run]

产物
    data/ui_nineslice.json 追加两条（key 与 ui_atlas.json 完全一致，应用自动命中）
    .scratch/infra/chat_border_measure.json   测量明细
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
NINESLICE = ROOT / "data" / "ui_nineslice.json"
REPORT = ROOT.parent / ".scratch" / "infra" / "chat_border_measure.json"

TARGETS = [
    {
        "key": "ChatArchive/Scenario_Mode_Bg_3.png",
        "file": ROOT / "resources/ui/extra2/Scenario_Mode_Bg_3.png",
        "ref_region": (0.30, 0.20, 0.45, 0.30),  # 内部参考色采样区（比例）
        "feature_rows": (0.06, 0.70),  # 特征物扫描行范围（避开顶描边与底部横线）
        "left_feature": "name_strip",
        "right_feature": "compass",
    },
    {
        "key": "ChatArchive/Dialogue_Event_Background.png",
        "file": ROOT / "resources/ui/extra2/Dialogue_Event_Background.png",
        "ref_region": (0.25, 0.35, 0.45, 0.55),
        "feature_rows": (0.10, 0.90),
        "left_feature": None,
        "right_feature": "heart",
    },
]

TOL_BAND = 18.0  # 描边带：与参考色欧氏距离超过它算「还在带上」
TOL_FEATURE = 30.0  # 特征物：像素与参考色距离超过它算「特征像素」


def dist(a: np.ndarray, ref: np.ndarray) -> np.ndarray:
    return np.sqrt(((a.astype(float) - ref) ** 2).sum(axis=-1))


def measure_target(t: dict) -> dict:
    im = Image.open(t["file"]).convert("RGBA")
    arr = np.array(im)
    h, w = arr.shape[:2]
    rgb = arr[..., :3].astype(float)
    alpha = arr[..., 3]

    fx0, fy0, fx1, fy1 = t["ref_region"]
    ref = rgb[int(h * fy0):int(h * fy1), int(w * fx0):int(w * fx1)].reshape(-1, 3).mean(axis=0)

    # 圆角半径：第一行 alpha[x=0] >= 200
    radius = next((y for y in range(h) if alpha[y, 0] >= 200), 0)
    radius = max(radius, next((y for y in range(h) if alpha[y, w - 1] >= 200), 0))

    # 描边带：中行/中列从边向内走，直到贴上参考色
    mid_r, mid_c = h // 2, w // 2
    def band(seq) -> int:
        for i, px in enumerate(seq):
            if np.sqrt(((px - ref) ** 2).sum()) <= TOL_BAND:
                return i
        return len(seq)
    band_l = band(rgb[mid_r, :w // 2])
    band_r = band(rgb[mid_r, :w // 2 - 1:-1])
    band_t = band(rgb[:h // 2, mid_c])
    band_b = band(rgb[:h // 2 - 1:-1, mid_c])

    # 特征物（名字条/罗盘/爱心）：列差异占比找左右缘
    ry0, ry1 = int(h * t["feature_rows"][0]), int(h * t["feature_rows"][1])
    d = dist(rgb[ry0:ry1], ref)
    frac = (d > TOL_FEATURE).mean(axis=0)  # 每列特征像素占比
    thr = 0.2
    def feature_edge(rng) -> int | None:
        run = 0
        for x in rng:
            run = run + 1 if frac[x] > thr else 0
            if run >= 8:
                return x - run + 1
        return None
    left_feat = feature_edge(range(w // 2)) if t["left_feature"] else None
    right_feat = feature_edge(range(w - 1, w // 2, -1)) if t["right_feature"] else None

    L = max(radius, band_l, (left_feat or 0) + 1) if t["left_feature"] else max(radius, band_l)
    Rraw = max(radius, band_r, (w - right_feat) if right_feat else 0)
    T_ = max(radius, band_t)
    B = max(radius, band_b)
    # 保证中段存在
    if L + Rraw >= w:
        Rraw = w - L - 1
    if T_ + B >= h:
        T_ = min(T_, h - B - 1)

    return {
        "key": t["key"],
        "size": [w, h],
        "ref_rgb": [round(float(x), 1) for x in ref],
        "radius": radius,
        "band_ltrb": [band_l, band_t, band_r, band_b],
        "left_feature": t["left_feature"],
        "left_feature_edge_x": left_feat,
        "right_feature": t["right_feature"],
        "right_feature_edge_x": right_feat,
        "border_LTRB": [int(L), int(T_), int(Rraw), int(B)],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="量 ChatArchive 两张底板的九宫格 border")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    results = []
    for t in TARGETS:
        r = measure_target(t)
        results.append(r)
        print(f"{t['key']}: {r['size'][0]}x{r['size'][1]} radius={r['radius']} "
              f"band={r['band_ltrb']} {t['left_feature'] or '-'}_edge={r['left_feature_edge_x']} "
              f"{t['right_feature'] or '-'}_edge={r['right_feature_edge_x']} "
              f"-> border(L,T,R,B)={r['border_LTRB']}")

    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "method": "alpha 圆角半径 + 描边带(ΔRGB<=18) + 特征物列占比(>0.2 sustained 8 列)；每边取 max；LTRB",
        "targets": results,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ 明细 {REPORT}")

    if args.dry_run:
        return

    ns = json.loads(NINESLICE.read_text(encoding="utf-8"))
    sprites = ns.setdefault("sprites", {})
    for r in results:
        sprites[r["key"]] = {
            "border": r["border_LTRB"],
            "type": "Sliced",
            "source_prefab": None,
            "origin": "manual-measure-pillow",
            "measure": f"radius={r['radius']} band={r['band_ltrb']} right_feature_edge={r['right_feature_edge_x']}",
        }
    ns["total"] = len(sprites)
    ns["source"] = ns.get("source", "") + " + manual measure ChatArchive x2 (tools/fetch/measure_chat_borders.py)"
    NINESLICE.write_text(json.dumps(ns, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ 已回填 {NINESLICE}（total {ns['total']}）")


if __name__ == "__main__":
    main()
