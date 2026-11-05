#!/usr/bin/env python3
"""
从本地 Steam 版 Blue Archive 的 Addressables bundle 提取学生立绘 Spine（spr）件套。

族模式（实测 2026-11-05：622 族 2512 bundle 共 0.72 GiB，全部在 catalog）：
  assets-_mx-spinecharacters-<fam>-_mxdependency-<日期>[_NNN分片]_assets_all_<crc>.bundle
  （fam 形如 airi_spr / CH0058_spr；与上轮 spinelobbies-<x>_home 同构）

版本判定：对族内每个数字分片要求「磁盘上只有唯一日期版本」才提取
（fam_struct.py 实测 622 族全部 safe、0 歧义）；catalog 判据二次过滤。

产物：
  resources/spine/<fam>/*.skel|*.atlas|*.png
  data/asset_map.spr.json   side-file 索引（不动 asset_map.json 本体）：
      images  段 schema 对齐 build_asset_map.py（key=文件 stem，value=repo 相对路径），
              收纳本轮 avatar / furniture 落盘的 PNG（由 --emit-map 扫描）
      spines  段 schema 同 build_asset_map.py（skel/atlas/textures）
      spine_meta 段存 bundle 溯源（前端不读）

用法（venv：D:/Bluearchive/.venv/Scripts/python.exe）：
  python tools/fetch/extract_local_spr.py --list          # 族分类统计
  python tools/fetch/extract_local_spr.py --families a,b  # 指定族
  python tools/fetch/extract_local_spr.py --all-safe      # 全部无歧义族（默认行为即此）
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import UnityPy

GAME_DIR = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]
SCRATCH = Path("D:/Bluearchive/.scratch/spr")
WORK = Path("D:/Bluearchive/.scratch/spr/work_spr")

RX = re.compile(
    r"^assets-_mx-spinecharacters-(?P<fam>.+?_spr)-_mxdependency-"
    r"(?P<rest>.+)_assets_all_(?P<crc>\d+)\.bundle$"
)
RX_SHARD = re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})(?:_(?P<shard>\d{3}))?$")
RX_TYPED = re.compile(r"^(?P<type>[a-z]+)-(?P<date>\d{4}-\d{2}-\d{2})$")
PAGE_EXT = (".png", ".webp", ".pvr", ".etc1", ".ktx", ".astc")


def load_catalog() -> set[str]:
    data = CATALOG.read_bytes()
    return {
        m.group().decode()
        for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", data)
    }


def scan_families(gamedir: Path, cat: set[str]) -> tuple[dict, dict]:
    """返回 (safe, ambiguous)：safe[fam] = [bundle...]; ambiguous[fam] = 原因"""
    fams: dict[str, dict[str, dict[str, str]]] = defaultdict(lambda: defaultdict(dict))
    for p in gamedir.glob("assets-_mx-spinecharacters-*_spr-*.bundle"):
        m = RX.match(p.name)
        if not m:
            continue
        rest = m["rest"]
        ms, mt = RX_SHARD.match(rest), RX_TYPED.match(rest)
        if ms:
            shard, d = ms["shard"] or "000", ms["date"]
        elif mt:
            shard, d = mt["type"], mt["date"]
        else:
            shard, d = rest, "?"
        fams[m["fam"]][shard][d] = p.name
    safe, amb = {}, {}
    for fam, shards in sorted(fams.items()):
        bad = [f"{s}:{sorted(d)}" for s, d in shards.items() if len(d) > 1]
        if bad:
            amb[fam] = bad
            continue
        picked = [next(iter(d.values())) for _, d in sorted(shards.items())]
        picked = [b for b in picked if b in cat]
        if not picked:
            amb[fam] = "all bundles not in catalog"
            continue
        safe[fam] = picked
    return safe, amb


def atlas_pages(atlas_text: str) -> list[str]:
    pages = []
    for line in atlas_text.splitlines():
        s = line.strip()
        if s.lower().endswith(PAGE_EXT) and not s.startswith("repeat"):
            pages.append(s)
    return pages


def skel_version(head: bytes) -> str:
    m = re.search(rb"\d+\.\d+\.\d+", head[:64])
    return m.group().decode() if m else "?"


def extract_family(fam: str, bundles: list[str], out_dir: Path, work_dir: Path) -> tuple[dict, list[str]]:
    problems: list[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    for f in work_dir.glob("*"):
        f.unlink()
    for b in bundles:
        dst = work_dir / b
        try:
            os.link(GAME_DIR / b, dst)  # 同盘硬链接，省复制
        except OSError:
            shutil.copy2(GAME_DIR / b, dst)

    env = UnityPy.load(str(work_dir))
    skels: dict[str, bytes] = {}
    atlases: dict[str, bytes] = {}
    textures: dict[str, object] = {}
    for obj in env.objects:
        if obj.type.name == "TextAsset":
            d = obj.read()
            data = d.m_Script
            if isinstance(data, str):
                data = data.encode("utf-8", "surrogateescape")
            low = d.m_Name.lower()
            if low.endswith((".skel", ".skel.bytes")):
                skels[d.m_Name] = data
            elif low.endswith((".atlas", ".atlas.txt")):
                atlases[d.m_Name] = data
        elif obj.type.name == "Texture2D":
            try:
                d = obj.read()
                textures[d.m_Name] = d
            except Exception:
                pass

    for a_name, a_data in atlases.items():
        (out_dir / a_name).write_bytes(a_data)

    written_png: dict[str, Path] = {}
    page_map: dict[str, list[str]] = {}
    for a_name, a_data in atlases.items():
        pages = atlas_pages(a_data.decode("utf-8", "replace"))
        page_map[a_name] = pages
        for page in pages:
            key = page.lower()
            if key in written_png:
                continue
            tex = textures.get(Path(page).stem) or next(
                (t for n, t in textures.items() if n.lower() == Path(page).stem.lower()), None
            )
            if tex is None:
                problems.append(f"{fam}: atlas '{a_name}' page '{page}' no Texture2D")
                continue
            try:
                img = tex.image
            except Exception as e:  # noqa: BLE001
                problems.append(f"{fam}: Texture2D '{tex.m_Name}' decode failed: {type(e).__name__}: {e}")
                continue
            dst = out_dir / page
            img.save(dst)
            written_png[key] = dst

    written_skel: dict[str, Path] = {}
    versions: dict[str, str] = {}
    for s_name, data in skels.items():
        dst = out_dir / s_name
        dst.write_bytes(data)
        written_skel[s_name] = dst
        versions[s_name] = skel_version(data[:64])
        if not versions[s_name].startswith("4.2"):
            problems.append(f"{fam}: skel '{s_name}' version {versions[s_name]} != 4.2.x")

    if not skels:
        problems.append(f"{fam}: no .skel TextAsset")
        return {"entries": {}, "meta": {"bundles": sorted(bundles), "types": "no-skel"}}, problems

    def build_entry(skel_name: str) -> dict | None:
        stem = Path(skel_name).stem.lower()
        a_name = next((a for a in atlases if Path(a).stem.lower() == stem), None)
        if a_name is None:
            problems.append(f"{fam}: no .atlas for skel '{skel_name}' (have {sorted(atlases)})")
            return None
        texs = []
        for page in page_map.get(a_name, []):
            p = written_png.get(page.lower())
            if p is None:
                return None
            texs.append(str(p.relative_to(REPO)).replace("\\", "/"))
        if not texs:
            return None
        return {
            "skel": str((out_dir / skel_name).relative_to(REPO)).replace("\\", "/"),
            "atlas": str((out_dir / a_name).relative_to(REPO)).replace("\\", "/"),
            "textures": texs,
        }

    entries: dict[str, dict] = {}
    for s_name in sorted(skels):
        e = build_entry(s_name)
        if e:
            key = Path(s_name).stem.lower()
            entries[key] = e
    if not entries:
        problems.append(f"{fam}: no complete (skel, atlas, textures) triple")
    meta = {
        "bundles": sorted(bundles),
        "skel_versions": versions,
        "skels": sorted(skels),
        "atlases": sorted(atlases),
        "pages": page_map,
    }
    return {"entries": entries, "meta": meta}, problems


def build_character_spine(spines: dict) -> dict[str, str]:
    """显示名(小写) -> spr 模型名。逻辑对齐 build_asset_map.py:101-112，仅限本地已有的 spr 条目。"""
    spine_idx = {
        x["id"]: x
        for x in json.loads((REPO / "data" / "spine_index.json").read_text(encoding="utf-8"))
    }
    students = json.loads((REPO / "data" / "students_full.json").read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for s in students:
        labels = [s.get(k) for k in ("given_name_en", "given_name", "given_name_cn")]
        for sid in s.get("spine") or []:
            meta = spine_idx.get(sid) or {}
            if meta.get("type") != "spr":
                continue
            name = (meta.get("name") or "")
            key = name.lower()
            if key not in spines:
                # HD 变体回退基础名（如 ayane_spr_HD -> ayane_spr）
                if key.endswith("_hd") and key[:-3] in spines:
                    name = name[:-3]
                    key = key[:-3]
                else:
                    continue
            for label in labels:
                if label and label.strip().lower() not in out:
                    out[label.strip().lower()] = key
            break  # 该学生第一个可用 spr 即可
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--families", default="", help="逗号分隔族名；空=全部 safe 族")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--reindex-only", action="store_true",
                    help="不重提取，只重建 data/asset_map.spr.json")
    args = ap.parse_args()

    if args.reindex_only:
        out = REPO / "data" / "asset_map.spr.json"
        amap = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
        spines = amap.get("spines", {})
        images: dict[str, str] = {}
        dupes = 0
        IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
        for sub in ("avatar", "avatar/game", "furniture/game"):
            d = REPO / "resources" / sub
            if not d.exists():
                continue
            for f in sorted(d.iterdir()):
                if f.is_file() and f.suffix.lower() in IMG_EXT and f.stem not in images:
                    images[f.stem] = f"resources/{sub}/{f.name}"
        furn_main = REPO / "resources" / "furniture"
        if furn_main.exists():
            for f in sorted(furn_main.iterdir()):
                if f.is_file() and f.suffix.lower() in IMG_EXT and f.name[0].isdigit():
                    key = f.stem
                    if key in images:
                        amap.setdefault("counts", {}).setdefault("furniture_bridged_prefixed", {})[key] = f"furniture/{key}"
                        images[f"furniture/{key}"] = f"resources/furniture/{f.name}"
                    else:
                        images[key] = f"resources/furniture/{f.name}"
        cs = build_character_spine(spines)
        amap["images"] = images
        amap["spines"] = spines
        amap["character_spine"] = cs
        amap["counts"] = {
            **amap.get("counts", {}),
            "images": len(images),
            "image_dupes": dupes,
            "spines": len(spines),
            "characters_mapped": len(cs),
        }
        out.write_text(json.dumps(amap, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"reindex: images={len(images)} spines={len(spines)} character_spine={len(cs)} -> {out}")
        return 0

    cat = load_catalog()
    safe, amb = scan_families(GAME_DIR, cat)
    print(f"families total on disk: safe={len(safe)} ambiguous={len(amb)}")

    if args.list:
        for f in sorted(safe)[:20]:
            print(f"  {f}: {len(safe[f])} bundles")
        print("...")
        for f, why in sorted(amb.items())[:10]:
            print(f"  AMB {f}: {why}")
        return 0

    if args.families:
        want = [s.strip() for s in args.families.split(",") if s.strip()]
        missing = [w for w in want if w not in safe]
        for u in missing:
            print(f"SKIP {u}: {'ambiguous' if u in amb else 'not found'}", file=sys.stderr)
        targets = {w: safe[w] for w in want if w in safe}
    else:
        targets = dict(safe)
    print(f"targets={len(targets)}")

    spines: dict[str, dict] = {}
    spine_meta: dict[str, dict] = {}
    problems: list[str] = []
    file_count = 0
    for i, (fam, bundles) in enumerate(sorted(targets.items()), 1):
        out_dir = REPO / "resources" / "spine" / fam
        if args.dry_run:
            print(f"DRY {fam}: {len(bundles)} bundles")
            continue
        res, probs = extract_family(fam, bundles, out_dir, WORK / fam)
        spines.update(res["entries"])
        spine_meta[fam] = res["meta"]
        problems.extend(probs)
        n = len(list(out_dir.iterdir())) if out_dir.exists() else 0
        file_count += n
        if i % 25 == 0 or i == len(targets):
            print(f"[{i}/{len(targets)}] {fam}: files={n} entries={len(res['entries'])} cum_problems={len(problems)}", flush=True)

    if args.dry_run:
        print("dry-run: index not written")
        return 0

    # ---- side-file 索引（不动 asset_map.json 本体）
    images: dict[str, str] = {}
    dupes = 0
    IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    for sub, dest_prefix in (("avatar", "avatar/"), ("avatar/game", "avatar/game/"),
                             ("furniture/game", "furniture/game/")):
        d = REPO / "resources" / sub
        if not d.exists():
            continue
        for f in sorted(d.iterdir()):
            if f.is_file() and f.suffix.lower() in IMG_EXT:
                key = f.stem
                if key in images:
                    dupes += 1
                    continue
                images[key] = f"resources/{sub}/{f.name}"

    # 家具桥接 <kivo_id>.png：key 与头像数字冲突时加 furniture/ 前缀
    furn_main = REPO / "resources" / "furniture"
    av_keys = set(images)
    bridged = {}
    if furn_main.exists():
        for f in sorted(furn_main.iterdir()):
            if f.is_file() and f.suffix.lower() in IMG_EXT and f.name[0].isdigit():
                key = f.stem
                if key in av_keys:
                    images[f"furniture/{key}"] = f"resources/furniture/{f.name}"
                    bridged[key] = f"furniture/{key}"
                else:
                    images[key] = f"resources/furniture/{f.name}"

    amap = {
        "images": images,
        "spines": spines,
        "character_spine": {},
        "spine_meta": spine_meta,
        "counts": {
            "images": len(images),
            "image_dupes": dupes,
            "spines": len(spines),
            "spr_families": len(spine_meta),
            "spr_files": file_count,
            "furniture_bridged_prefixed": bridged,
        },
        "generated": {
            "by": "tools/fetch/extract_local_spr.py",
            "date": date.today().isoformat(),
            "game_dir": str(GAME_DIR).replace("\\", "/"),
            "source": "assetbundle",
        },
    }
    out = REPO / "data" / "asset_map.spr.json"
    out.write_text(json.dumps(amap, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"asset_map.spr.json: images={len(images)} spines={len(spines)} -> {out}")
    print(f"files written={file_count} problems={len(problems)}")
    for p in problems[:30]:
        print(f"  PROBLEM: {p}")
    (SCRATCH / "spr_extract_report.json").write_text(
        json.dumps({"problems": problems, "families": list(spine_meta)}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
