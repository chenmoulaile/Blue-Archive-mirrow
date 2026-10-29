#!/usr/bin/env python3
"""
从游戏内截图里切 UI 原件（路径 2 兜底，不需要游戏本体）。

什么时候用它
    没有游戏安装 / 解包目录，但有游戏内 1920×1080 截图时，
    用这个脚本把对话框、按钮、底栏这些控件按矩形切出来，
    产物写 resources/ui/，并登记到 data/ui_atlas.json（origin = screenshot_crop）。
    这样界面上「有原件用原件」的逻辑就能跑起来，不需要改前端。

    ⚠️ 切图还原的是「截图里的像素」，不是原始图集：
       九宫格切边只能靠肉眼看、缩放后会糊；设置页与 README 都会注明这一点。

用法
    # 1. 生成一个区域模板，照着填坐标（坐标是截图里的像素，左上角原点）
    .venv/Scripts/python.exe tools/fetch/crop_ui.py --init

    # 2. 按模板切图
    .venv/Scripts/python.exe tools/fetch/crop_ui.py \
        --shot shots/lobby-1920x1080.png --regions tools/fetch/ui_regions.json

    # 只看会切出什么，不写文件
    .venv/Scripts/python.exe tools/fetch/crop_ui.py --shot ... --regions ... --dry-run

区域模板格式
    {
      "source_size": [1920, 1080],
      "sprites": {
        "ui_dialog_bg": { "rect": [120, 780, 1680, 240], "border": [40, 40, 40, 40] },
        "ui_choice_btn": { "rect": [560, 500, 800, 64] }
      }
    }
    rect   = [x, y, width, height]
    border = [left, top, right, bottom]，九宫格切边；不填表示整图拉伸

说明
    只读你提供的截图，产物全写 E 盘项目目录；不联网、不改游戏文件。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RES_UI = ROOT / "resources" / "ui"
DATA = ROOT / "data"
ATLAS = DATA / "ui_atlas.json"
DEFAULT_REGIONS = ROOT / "tools" / "fetch" / "ui_regions.json"

# 常见控件的位置估计值，只用来起模板；真实坐标必须按截图量
TEMPLATE = {
    "source_size": [1920, 1080],
    "sprites": {
        "ui_dialog_bg": {"rect": [115, 780, 1690, 250], "border": [42, 42, 42, 42]},
        "ui_nameplate": {"rect": [150, 742, 360, 58], "border": [28, 22, 28, 22]},
        "ui_choice_btn": {"rect": [560, 500, 800, 68], "border": [34, 30, 34, 30]},
        "ui_topbar": {"rect": [0, 0, 1920, 72]},
        "ui_side_btn": {"rect": [1816, 254, 76, 76]},
    },
}


def log(msg: str) -> None:
    print(msg, flush=True)


def init_regions(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        log(f"区域文件已存在，不覆盖：{path}")
        return
    path.write_text(json.dumps(TEMPLATE, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"✓ 已生成区域模板：{path}")
    log("  按截图量好 rect 再跑一次；不需要的条目直接删掉。")


def load_atlas() -> dict:
    if ATLAS.exists():
        try:
            return json.loads(ATLAS.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log(f"! {ATLAS.name} 解析失败，将重建")
    return {"source": "none", "sprites": {}, "fonts": {}}


def main() -> None:
    ap = argparse.ArgumentParser(description="从游戏截图切 UI 原件")
    ap.add_argument("--shot", help="游戏内截图路径（建议 1920×1080）")
    ap.add_argument("--regions", default=str(DEFAULT_REGIONS), help="区域 JSON")
    ap.add_argument("--init", action="store_true", help="生成区域模板后退出")
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    args = ap.parse_args()

    regions_path = Path(args.regions)

    if args.init:
        init_regions(regions_path)
        return

    if not args.shot:
        ap.print_help()
        sys.exit(1)

    shot_path = Path(args.shot)
    if not shot_path.exists():
        log(f"截图不存在：{shot_path}")
        sys.exit(1)
    if not regions_path.exists():
        log(f"区域文件不存在：{regions_path}（先跑 --init 生成模板）")
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        log("需要 Pillow：.venv/Scripts/python.exe -m pip install pillow")
        sys.exit(1)

    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    sprites_cfg: dict = regions.get("sprites") or {}
    if not sprites_cfg:
        log("区域文件里没有 sprites 条目")
        sys.exit(1)

    shot = Image.open(shot_path)
    sw, sh = shot.size
    src = regions.get("source_size") or [sw, sh]
    log(f"截图 {sw}×{sh}，区域按 {src[0]}×{src[1]} 标注")

    # 截图分辨率与标注基准不一致时等比缩放坐标，避免整体错位
    kx = sw / src[0] if src[0] else 1.0
    ky = sh / src[1] if src[1] else 1.0
    if abs(kx - 1) > 1e-3 or abs(ky - 1) > 1e-3:
        log(f"  坐标缩放系数 x{kx:.3f} y{ky:.3f}")

    atlas = load_atlas()
    atlas.setdefault("sprites", {})
    RES_UI.mkdir(parents=True, exist_ok=True)

    ok = 0
    for name, cfg in sprites_cfg.items():
        rect = cfg.get("rect")
        if not rect or len(rect) != 4:
            log(f"  跳过 {name}：rect 必须是 [x, y, w, h]")
            continue
        x, y, w, h = (int(round(v * k)) for v, k in zip(rect, (kx, ky, kx, ky)))
        if w <= 0 or h <= 0:
            log(f"  跳过 {name}：宽高必须为正")
            continue
        if x < 0 or y < 0 or x + w > sw or y + h > sh:
            log(f"  跳过 {name}：矩形越界 ({x},{y},{w},{h}) 超出 {sw}×{sh}")
            continue

        crop = shot.crop((x, y, x + w, y + h))
        border = cfg.get("border")
        if border and (len(border) != 4 or min(border) < 0):
            log(f"  ! {name} 的 border 非法，按整图拉伸处理")
            border = None
        if border:
            l, t, r, b = (int(v) for v in border)
            if l + r >= w or t + b >= h:
                log(f"  ! {name} 的九宫格切边超过图片尺寸，按整图拉伸处理")
                border = None

        entry = {
            "file": f"/res/ui/{name}.png",
            "w": w,
            "h": h,
            **({"border": [int(v) for v in border]} if border else {}),
            "origin": "screenshot_crop",
        }
        if args.dry_run:
            log(f"  [dry-run] {name}  {w}×{h}  {entry.get('border', '整图拉伸')}")
            ok += 1
            continue

        crop.save(RES_UI / f"{name}.png")
        atlas["sprites"][name] = entry
        ok += 1

    if args.dry_run:
        log(f"\n[dry-run] 会切 {ok} 个控件，未写任何文件")
        return

    # 有 assetbundle 原件时保留那个来源标记，否则整体标成截图切图
    origins = {v.get("origin") for v in atlas["sprites"].values()}
    atlas["source"] = "assetbundle" if "assetbundle" in origins else "screenshot_crop"
    atlas["generated"] = datetime.now().isoformat(timespec="seconds")
    atlas.setdefault("fonts", {})

    DATA.mkdir(parents=True, exist_ok=True)
    ATLAS.write_text(json.dumps(atlas, ensure_ascii=False, indent=1), encoding="utf-8")

    log(f"\n✓ 切出 {ok} 个控件 -> resources/ui/")
    log(f"✓ {ATLAS.relative_to(ROOT)} 已更新（source = {atlas['source']}）")
    log("  重启客户端即可替换兜底样式；README 已声明这是截图还原，非原始图集。")


if __name__ == "__main__":
    main()
