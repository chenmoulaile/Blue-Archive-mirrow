#!/usr/bin/env python3
"""
从国服 AssetBundle 里导出 NGUI 图集（真正的游戏内 UI 原件）。

为什么不是 UnityPy 的 Sprite
    《蔚蓝档案》用的是 **NGUI**，不是 UGUI。Bundle 里没有 Sprite 对象，
    只有：
      - Texture2D：一整张 2048×2048 的图集
      - MonoBehaviour(NGUIAtlas)：mSprites 数组，每项是 {name, x, y, width, height}
    所以「切图」= 按 mSprites 里的矩形从大图里裁。

数据来源
    .vendor/Blue-Archive-Asset-Downloader 下载的国服 bundle：
      ba-downloader assets download --region cn --resources bundle \\
          --filter "path~assets-_mx-uis" --workspace "E:/Blue archive/.baad"
    产物在 <workspace>/cn/android/raw/bundles/

用法
    .venv/Scripts/python.exe tools/fetch/import_ngui_atlas.py
    .venv/Scripts/python.exe tools/fetch/import_ngui_atlas.py --atlas Common,Emoji
    .venv/Scripts/python.exe tools/fetch/import_ngui_atlas.py --dry-run

产物
    resources/ui/<图集>/<精灵名>.png      每个精灵一张
    data/ui_atlas.json                    source="assetbundle"，含语义别名

语义别名
    前端用的是 icon_momotalk / nav_story 这类语义 key（见 src/pages/HomePage.tsx），
    这里把能确定的对应关系写死成 ALIASES，写进 ui_atlas.json。
    对不上的不猜，前端继续用 Glyph 兜底。

只读 bundle、产物写本项目；不下载、不解密数据库。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BUNDLES = ROOT / ".baad" / "cn" / "android" / "raw" / "bundles"
OUT_UI = ROOT / "resources" / "ui"
ATLAS_JSON = ROOT / "data" / "ui_atlas.json"

# 语义 key -> 图集/精灵名。只写确认存在的，脚本会校验并报告缺失。
ALIASES: dict[str, str] = {
    # 右侧功能列
    "icon_momotalk": "Common/Common_Icon_MoMoTalk",
    "icon_mission": "Common/Common_Icon_Mission",
    "icon_mail": "Common/Common_Icon_Mail",
    "icon_menu": "Common/Common_Icon_Menu_Small",
    "icon_cafe": "Common/Common_Icon_Cafe",
    "icon_student": "Common/Common_Icon_Student",
    "icon_gacha": "Common/Common_Icon_Gacha",
    "icon_formation": "Common/Common_Icon_CombatStyle",
    # 底部导航
    "nav_momotalk": "Common/Common_Icon_MoMoTalk",
    "nav_cafe": "Common/Common_Icon_Cafe",
    "nav_memorial": "Common/Common_Icon_MemoryLobby",
    "nav_gacha": "Common/Common_Icon_Gacha",
    "nav_story": "Common/Common_Icon_Dialog",
    # 顶部资源
    "icon_pyroxene": "Common/Common_Icon_Diamond",
    # 菜单弹窗
    "menu_option": "Common/Common_Icon_Option",
    "menu_account": "Common/Common_Icon_Setting_Account",
    "menu_equipment": "Common/Common_Icon_Inventory_Equip",
    "menu_item": "Common/Common_Icon_Inventory_NonEquip",
}

SAFE = re.compile(r"[^0-9A-Za-z_.\-]+")


def safe_name(name: str) -> str:
    return SAFE.sub("_", name).strip("_") or "unnamed"


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="导出 NGUI 图集精灵")
    ap.add_argument("--bundles", default=str(DEFAULT_BUNDLES), help="bundle 目录")
    ap.add_argument("--out", default=str(OUT_UI), help="PNG 输出目录")
    ap.add_argument("--atlas", default="all", help="图集名，逗号分隔；all 表示全部")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写文件")
    args = ap.parse_args()

    bundle_dir = Path(args.bundles)
    if not bundle_dir.is_dir():
        log(f"bundle 目录不存在：{bundle_dir}")
        log("先跑：ba-downloader assets download --region cn --resources bundle --filter \"path~assets-_mx-uis\"")
        sys.exit(1)

    try:
        import UnityPy
    except ImportError:
        log("需要 UnityPy：.venv/Scripts/python.exe -m pip install UnityPy")
        sys.exit(1)

    log(f"加载 {bundle_dir} …")
    env = UnityPy.load(str(bundle_dir))

    textures: dict[str, object] = {}
    atlas_trees: list[dict] = []
    for obj in env.objects:
        if obj.type.name == "Texture2D":
            try:
                t = obj.read()
                textures[t.m_Name] = t
            except Exception:
                continue
        elif obj.type.name == "MonoBehaviour":
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if "mSprites" in tree and tree.get("m_Name"):
                atlas_trees.append(tree)

    if not atlas_trees:
        log("没找到 NGUIAtlas（MonoBehaviour + mSprites），确认 bundle 目录对不对")
        sys.exit(1)

    want = None if args.atlas == "all" else {s.strip() for s in args.atlas.split(",") if s.strip()}
    out_root = Path(args.out)
    atlas_out: dict[str, dict] = {}
    total = 0
    missing_tex: list[str] = []
    skipped: list[str] = []

    for tree in atlas_trees:
        atlas = tree["m_Name"]
        if want is not None and atlas not in want:
            continue
        tex = textures.get(atlas)
        if tex is None:
            missing_tex.append(atlas)
            continue
        try:
            sheet = tex.image
        except Exception as e:  # noqa: BLE001
            log(f"  ! {atlas} 贴图解码失败：{e}")
            continue

        sw, sh = sheet.size
        dir_out = out_root / safe_name(atlas)
        if not args.dry_run:
            dir_out.mkdir(parents=True, exist_ok=True)
        used: set[str] = set()

        for sp in tree["mSprites"]:
            name = sp.get("name") or ""
            x, y = int(sp.get("x") or 0), int(sp.get("y") or 0)
            w, h = int(sp.get("width") or 0), int(sp.get("height") or 0)
            if not name or w <= 0 or h <= 0:
                skipped.append(f"{atlas}/{name or '?'}")
                continue
            if x < 0 or y < 0 or x + w > sw or y + h > sh:
                skipped.append(f"{atlas}/{name}(越界)")
                continue
            # 实测：UnityPy 读出的 Texture2D.image 已经是正向位图，
            # NGUI 存的 y 直接就是自上而下的偏移，不需要再做 sh-y-h 翻转。
            # （做翻转会切出错位的碎片，见 .tmp/crop_compare.png 的对比）
            box = (x, y, x + w, y + h)
            key = f"{atlas}/{name}"
            # 精灵名里的空格/符号会被归一成下划线，可能撞名，撞了就加序号
            base = safe_name(name)
            file_stem, n = base, 2
            while file_stem in used:
                file_stem = f"{base}_{n}"
                n += 1
            used.add(file_stem)
            file_name = f"{file_stem}.png"
            # 九宫格切边就在图集条目里（UISprite 组件上没有 border 字段）。
            # NGUI 顺序是 Left/Bottom/Right/Top，这里转成 CSS 的 [左, 上, 右, 下]。
            bl = max(0, int(sp.get("borderLeft") or 0))
            bb = max(0, int(sp.get("borderBottom") or 0))
            br = max(0, int(sp.get("borderRight") or 0))
            bt = max(0, int(sp.get("borderTop") or 0))
            # 少数条目有负数切边（NGUI 允许，CSS 不允许），一律夹到 0
            border = [bl, bt, br, bb] if any((bl, bt, br, bb)) else None
            entry = {
                "file": f"/res/ui/{safe_name(atlas)}/{file_name}",
                "w": w,
                "h": h,
                "origin": "assetbundle",
                "atlas": atlas,
                "sprite": name,
                **({"border": border} if border else {}),
            }
            if not args.dry_run:
                sheet.crop(box).save(dir_out / file_name)
            atlas_out[key] = entry
            total += 1

    # 语义别名：指向已导出的精灵，复制一份 entry（前端按语义 key 查）
    alias_hit, alias_miss = 0, []
    for alias, target in ALIASES.items():
        src = atlas_out.get(target)
        if src is None:
            alias_miss.append(f"{alias} -> {target}")
            continue
        atlas_out[alias] = {**src}
        alias_hit += 1

    real = [v for k, v in atlas_out.items() if "/" in k]
    log("")
    log(f"图集 {len({v['atlas'] for v in real})} 个，精灵 {len(real)} 个"
        f"（扫描 {total} 条，重名已合并）"
        f"{'（dry-run 未写文件）' if args.dry_run else f' -> {out_root}'}")
    log(f"语义别名 {alias_hit}/{len(ALIASES)} 命中")
    if alias_miss:
        log("  未命中（前端继续用 Glyph 兜底）：")
        for m in alias_miss:
            log(f"    {m}")
    if missing_tex:
        log(f"  缺贴图的图集：{missing_tex}")
    if skipped:
        log(f"  跳过 {len(skipped)} 个异常精灵，前 3：{skipped[:3]}")

    if args.dry_run:
        return

    # 合并写 ui_atlas.json：保留已有的字体表
    data = {}
    if ATLAS_JSON.exists():
        try:
            data = json.loads(ATLAS_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
    merged = dict(data.get("sprites") or {})
    merged.update(atlas_out)
    ATLAS_JSON.parent.mkdir(parents=True, exist_ok=True)
    ATLAS_JSON.write_text(
        json.dumps(
            {
                "source": "assetbundle",
                "generated": datetime.now().isoformat(timespec="seconds"),
                "sprites": merged,
                "fonts": data.get("fonts") or {},
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    log(f"✓ {ATLAS_JSON.relative_to(ROOT)} 已更新（{len(merged)} 条）")
    log("  重启客户端即可用真图标替换兜底样式。")


if __name__ == "__main__":
    main()
