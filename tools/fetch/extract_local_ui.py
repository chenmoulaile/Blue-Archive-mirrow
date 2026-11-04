#!/usr/bin/env python3
"""
从本机 Steam 版《蔚蓝档案》解出 UI 图集精灵，产出客户端可用的 UI 素材。

数据源（两路，均为只读）：
  A. NGUI 图集（addressables bundle）
     <GameData/Windows>/assets-_mx-uis-atlas-*.bundle
     - 每个日期版本拆 3 片：assets(_000 或 -assets-)=MonoBehaviour(NGUIAtlas)、
       materials(_001/-materials-)、textures(_002/-textures-)
     - 磁盘上冗余多日期版本；同名对象按 (日期, 分片) 取最新
       （catalog 去重规则的保守近似；实测 15 个图集每个只出现一次）
     - NGUIAtlas.mSprites[i] = {name, x, y, width, height,
       borderLeft, borderRight, borderBottom, borderTop, ...}
     - NGUI 的 y 是自上而下偏移，直接 crop((x, y, x+w, y+h))，不做 texH-y-h 翻转
       （tools/fetch/import_ngui_atlas.py:166-169 已实测结论）
  B. PC 内置 UGUI Sprite（Steam 版特有）
     <BlueArchive_Data>/resources.assets
     - 主 UI 图集 Common（4096x2048，第二页名为 "Common 1"）以 UGUI Sprite
       对象形式内置（424 个），另有 ~250 个独立小贴图 sprite
       （AccountSettings_*/按钮/指示条/登录按钮等）
     - 走 UnityPy SpriteHelper 导出：贴图解码在 assets_file 级缓存（同一张
       4096x2048 只解一次），tight packing 自动按 mesh 渲染/遮罩，自带上下翻转
     - 九宫格来自 Sprite.m_Border，Unity 顺序 (x,y,z,w)=(L,B,R,T)，转 CSS [左,上,右,下]

流程
    A/B 各自收集精灵条目 -> 合并 -> 语义别名（复用 import_ngui_atlas.ALIASES）
    -> 合并写 data/ui_atlas.json（保留已有条目与 fonts）
    -> 子进程调 import_ngui_nineslice.py 全新生成 data/ui_nineslice.json
       （扫 <GameData>/ui-_mxload-prefabs-* 的 UISprite.mSpriteName/mType）

用法
    .venv/Scripts/python.exe tools/fetch/extract_local_ui.py            # 全量
    .venv/Scripts/python.exe tools/fetch/extract_local_ui.py --dry-run  # 只统计
    可选：--game-dir / --builtin / --skip-ngui / --skip-ugui
          --skip-nineslice / --no-prefab-scan

产物
    resources/ui/<图集>/<精灵>.png
    data/ui_atlas.json       source="assetbundle"
    data/ui_nineslice.json
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import UnityPy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DEFAULT_GAME_DIR = Path(
    "D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets"
    "/PUB/Resource/GameData/Windows"
)
DEFAULT_STAGE = ROOT.parent / ".scratch" / "ui-atlas-stage"
OUT_UI = ROOT / "resources" / "ui"
ATLAS_JSON = ROOT / "data" / "ui_atlas.json"

# NGUI 图集 bundle 文件名 -> (日期, 分片序号)，用于同名对象 newest-wins
DATE_RE = re.compile(r"_mxdependency-(?:[a-z]+-)?(\d{4}-\d{2}-\d{2})(?:_(\d{3}))?_")
# UGUI 图集页 "Common 1" -> "Common"
PAGE_SUFFIX_RE = re.compile(r"\s+\d+$")

sys.path.insert(0, str(HERE))  # -I 隔离模式下脚本目录不在 sys.path
from import_ngui_atlas import ALIASES, safe_name  # noqa: E402  (同目录复用)


def log(msg: str) -> None:
    print(msg, flush=True)


def date_key(bundle_name: str) -> tuple:
    m = DATE_RE.search(bundle_name)
    if not m:
        return ("0000-00-00", 0)
    return (m.group(1), int(m.group(2) or 0))


def strip_page_suffix(tex_name: str) -> str:
    return PAGE_SUFFIX_RE.sub("", tex_name)


def border_css(bl: float, bb: float, br: float, bt: float) -> list[int] | None:
    """NGUI (L,B,R,T) 或 Unity m_Border 换算成 CSS [左, 上, 右, 下]，负值夹 0。"""
    l, b, r, t = (max(0, round(v)) for v in (bl, bb, br, bt))
    return [l, t, r, b] if any((l, t, r, b)) else None


def iter_bundle_objects(env: UnityPy.environment.Environment):
    """yield (bundle 文件名, ObjectReader)。目录加载后经 bundle.files[CAB] 归属。"""
    cab_to_bundle: dict[str, str] = {}
    for bname, bf in env.files.items():
        for cab, sf in (getattr(bf, "files", None) or {}).items():
            if hasattr(sf, "objects"):
                cab_to_bundle[cab] = bname
    for obj in env.objects:
        cab = getattr(getattr(obj, "assets_file", None), "name", "")
        yield cab_to_bundle.get(cab, ""), obj


def put_entry(
    atlas_out: dict, used: dict[str, set], atlas: str, sprite: str,
    img, out_root: Path, dry_run: bool, extra: dict | None = None,
) -> bool:
    """写一张精灵 PNG 并登记条目；同图集内重名自动加序号。"""
    base = safe_name(sprite)
    stem, n = base, 2
    while stem in used[atlas]:
        stem = f"{base}_{n}"
        n += 1
    used[atlas].add(stem)
    file_name = f"{stem}.png"
    entry = {
        "file": f"/res/ui/{safe_name(atlas)}/{file_name}",
        "w": img.size[0],
        "h": img.size[1],
        "origin": "assetbundle",
        "atlas": atlas,
        "sprite": sprite,
    }
    if extra:
        entry.update(extra)
    if not dry_run:
        dir_out = out_root / safe_name(atlas)
        dir_out.mkdir(parents=True, exist_ok=True)
        img.save(dir_out / file_name)
    atlas_out[f"{atlas}/{sprite}"] = entry
    return True


# ---------------------------------------------------------------- A. NGUI 图集


def extract_ngui(game_dir: Path, stage_dir: Path, out_root: Path, dry_run: bool):
    bundles = sorted(game_dir.glob("assets-_mx-uis-atlas-*.bundle"))
    if not bundles:
        log(f"[ngui] 没找到 assets-_mx-uis-atlas-*.bundle：{game_dir}")
        return {}, {"bundles": 0, "atlases": 0, "sprites": 0, "skipped": [], "fail": []}

    # 暂存到同一目录再整目录 load（MonoScript/外部引用才解析得出，见 AGENTS.md）
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True, exist_ok=True)
    for p in bundles:
        shutil.copy2(p, stage_dir / p.name)
    log(f"[ngui] {len(bundles)} 个图集 bundle -> 暂存 {stage_dir}")

    env = UnityPy.load(str(stage_dir))

    atlas_newest: dict[str, tuple] = {}  # 图集名 -> (date_key, tree)
    tex_newest: dict[str, tuple] = {}    # 贴图名 -> (date_key, obj)
    for bname, obj in iter_bundle_objects(env):
        dk = date_key(bname)
        if obj.type.name == "MonoBehaviour":
            try:
                tree = obj.read_typetree()
            except Exception as e:  # noqa: BLE001
                log(f"  ! typetree 读取失败 {bname}: {e}")
                continue
            name = tree.get("m_Name")
            if "mSprites" in tree and name:
                if name not in atlas_newest or dk > atlas_newest[name][0]:
                    atlas_newest[name] = (dk, tree)
        elif obj.type.name == "Texture2D":
            try:
                t = obj.read()
                if t.m_Name not in tex_newest or dk > tex_newest[t.m_Name][0]:
                    tex_newest[t.m_Name] = (dk, obj)
            except Exception:
                continue

    atlas_out: dict[str, dict] = {}
    used: dict[str, set] = {}
    skipped: list[str] = []
    missing_tex: list[str] = []
    total = 0
    for atlas in sorted(atlas_newest):
        _, tree = atlas_newest[atlas]
        hit = tex_newest.get(atlas)
        if hit is None:
            missing_tex.append(atlas)
            continue
        try:
            sheet = hit[1].read().image
        except Exception as e:  # noqa: BLE001
            log(f"  ! {atlas} 贴图解码失败：{e}")
            continue
        sw, sh = sheet.size
        used[atlas] = set()
        n_before = len(atlas_out)
        for sp in tree["mSprites"] or []:
            name = sp.get("name") or ""
            x, y = int(sp.get("x") or 0), int(sp.get("y") or 0)
            w, h = int(sp.get("width") or 0), int(sp.get("height") or 0)
            if not name or w <= 0 or h <= 0:
                skipped.append(f"{atlas}/{name or '?'}")
                continue
            if x < 0 or y < 0 or x + w > sw or y + h > sh:
                skipped.append(f"{atlas}/{name}(越界)")
                continue
            img = sheet.crop((x, y, x + w, y + h))  # y 自上而下，不翻转
            border = border_css(
                sp.get("borderLeft") or 0, sp.get("borderBottom") or 0,
                sp.get("borderRight") or 0, sp.get("borderTop") or 0,
            )
            put_entry(atlas_out, used, atlas, name, img, out_root, dry_run,
                      {"border": border} if border else None)
        total += len(atlas_out) - n_before

    stats = {
        "bundles": len(bundles),
        "atlases": len([a for a in atlas_newest if a not in missing_tex]),
        "sprites": total,
        "skipped": skipped,
        "missing_tex": missing_tex,
    }
    log(f"[ngui] 图集 {stats['atlases']} 个，精灵 {total} 个"
        + (f"，缺贴图 {missing_tex}" if missing_tex else "")
        + (f"，跳过 {len(skipped)}" if skipped else ""))
    return atlas_out, stats


# ------------------------------------------------------- B. PC 内置 UGUI Sprite


def extract_ugui(builtin: Path, out_root: Path, dry_run: bool):
    env = UnityPy.load(str(builtin))
    tex_name_by_pid: dict[int, str] = {}
    for obj in env.objects:
        if obj.type.name == "Texture2D":
            try:
                tex_name_by_pid[obj.path_id] = obj.read().m_Name
            except Exception:
                continue

    atlas_out: dict[str, dict] = {}
    used: dict[str, set] = {}
    fail: list[str] = []
    no_tex: list[str] = []
    scanned = 0
    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue
        try:
            s = obj.read()
        except Exception as e:  # noqa: BLE001
            fail.append(f"<read {e}>")
            continue
        name = s.m_Name or ""
        tex_pid = s.m_RD.texture.path_id if s.m_RD.texture else None
        tex_name = tex_name_by_pid.get(tex_pid)
        if not tex_name:
            no_tex.append(name or f"pid:{tex_pid}")
            continue
        scanned += 1
        try:
            img = s.image  # tight packing 按 mesh 渲染/遮罩，结果已翻正
        except Exception as e:  # noqa: BLE001
            fail.append(f"{name or tex_name}: {e}")
            continue
        if img is None or img.size[0] <= 0 or img.size[1] <= 0:
            fail.append(f"{name or tex_name}: 空图像")
            continue
        atlas = strip_page_suffix(tex_name)
        used.setdefault(atlas, set())
        b = s.m_Border
        border = border_css(b.x, b.y, b.z, b.w) if b else None
        put_entry(atlas_out, used, atlas, name, img, out_root, dry_run,
                  {"border": border} if border else None)

    stats = {"scanned": scanned, "sprites": len(atlas_out), "fail": fail, "no_tex": no_tex}
    log(f"[ugui] 扫描 Sprite {scanned} 个 -> 条目 {stats['sprites']} 个（同名同图集已合并）"
        + (f"，导出失败 {len(fail)}" if fail else "")
        + (f"，缺贴图引用 {len(no_tex)}" if no_tex else ""))
    return atlas_out, stats


# ----------------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser(description="Steam 本地包 -> 客户端 UI 素材")
    ap.add_argument("--game-dir", default=str(DEFAULT_GAME_DIR),
                    help="GameData/Windows 目录（NGUI 图集 bundle 与 prefab 扫描来源）")
    ap.add_argument("--builtin", default=None,
                    help="内置 resources.assets 路径（默认从 --game-dir 上溯推导）")
    ap.add_argument("--out", default=str(OUT_UI), help="PNG 输出目录")
    ap.add_argument("--stage", default=str(DEFAULT_STAGE), help="NGUI bundle 暂存目录")
    ap.add_argument("--atlas-json", default=str(ATLAS_JSON))
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写任何文件")
    ap.add_argument("--skip-ngui", action="store_true")
    ap.add_argument("--skip-ugui", action="store_true")
    ap.add_argument("--skip-nineslice", action="store_true")
    ap.add_argument("--no-prefab-scan", action="store_true",
                    help="nineslice 不扫 ui-_mxload-prefabs-*（type 一律按 Sliced）")
    args = ap.parse_args()

    game_dir = Path(args.game_dir)
    # GameData/Windows -> 上溯 4 级 = BlueArchive_Data
    builtin = Path(args.builtin) if args.builtin else game_dir.parents[4] / "resources.assets"
    out_root = Path(args.out)

    if not args.skip_ngui and not game_dir.is_dir():
        log(f"游戏 bundle 目录不存在：{game_dir}")
        sys.exit(1)
    if not args.skip_ugui and not builtin.is_file():
        log(f"内置 resources.assets 不存在：{builtin}（可用 --builtin 指定）")
        sys.exit(1)

    atlas_out: dict[str, dict] = {}
    ngui_stats: dict = {}
    ugui_stats: dict = {}
    if not args.skip_ngui:
        atlas_out, ngui_stats = extract_ngui(
            game_dir, Path(args.stage), out_root, args.dry_run)
    if not args.skip_ugui:
        ugui_out, ugui_stats = extract_ugui(builtin, out_root, args.dry_run)
        clash = set(atlas_out) & set(ugui_out)
        if clash:
            log(f"[merge] NGUI/UGUI 同名条目 {len(clash)} 个，以 UGUI 导出为准：{sorted(clash)[:5]}")
        atlas_out.update(ugui_out)

    # 语义别名：指向已导出的精灵（对不上的不猜，前端继续 Glyph 兜底）
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
    log(f"合计：图集 {len({v['atlas'] for v in real})} 个，精灵 {len(real)} 个"
        f"（语义别名 {alias_hit}/{len(ALIASES)} 命中）")
    if alias_miss:
        log("  别名未命中（Glyph 兜底）：")
        for m in alias_miss:
            log(f"    {m}")
    if args.dry_run:
        log("(dry-run：未写任何文件)")
        return

    # 合并写 ui_atlas.json：保留已有条目（同名覆盖）与 fonts
    atlas_json = Path(args.atlas_json)
    data = {}
    if atlas_json.exists():
        try:
            data = json.loads(atlas_json.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
    merged = dict(data.get("sprites") or {})
    merged.update(atlas_out)
    atlas_json.parent.mkdir(parents=True, exist_ok=True)
    atlas_json.write_text(
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
    log(f"[ok] {atlas_json} 已更新（共 {len(merged)} 条，本次新增/覆盖 {len(atlas_out)} 条）")

    if args.skip_nineslice:
        return
    cmd = [sys.executable, str(HERE / "import_ngui_nineslice.py"),
           "--bundles", str(game_dir), "--atlas", str(atlas_json)]
    if args.no_prefab_scan:
        cmd.append("--skip-prefabs")
    log(f"[nineslice] {' '.join(cmd)}")
    r = subprocess.run(cmd)
    if r.returncode != 0:
        log(f"[nineslice] 退出码 {r.returncode}，可用 --skip-nineslice 跳过")


if __name__ == "__main__":
    main()
