#!/usr/bin/env python3
"""
从本地 Steam 版 Blue Archive 的 Addressables bundle 中提取记忆大厅 Spine 模型。

族模式（实测 D:/Steam/.../PUB/Resource/GameData/Windows，共 266 个 *_home- 族）：
  旧式: assets-_mx-spinelobbies-<char>_home-_mxdependency-<日期>[_NNN分片]_assets_all_<crc>.bundle
  新式: assets-_mx-spinelobbies-<char>_home-_mxdependency-<类型>-<日期>_assets_all_<crc>.bundle
        （类型 ∈ assets/textassets/textures/materials/timelines/prefabs/...，2026 起的新族）

版本判定（测绘结论 + 本轮实测）：
  catalog_Windows.bytes（CCDB "AddressablesMainContentCatalog"）中每个 bundle 文件名
  恰好出现 2 次（keys + internalIds，25961 唯一名 × 2 = 51922 处），次数无法区分
  新旧版本；磁盘冗余旧版仅是未清理存量。因此本脚本对族内每个逻辑分片（数字分片
  号或类型名）要求「磁盘上只有唯一日期版本」才提取；存在多日期版本的族一律跳过
  并记入 problems，绝不凭猜测选版本。

产物：
  resources/spine/<fam>/*.skel|*.atlas|*.png   客户端契约位置（SpineView 用
                                               @esotericsoftware/spine-webgl 4.2 加载，
                                               png 文件名必须与 atlas page 名一致）
  data/asset_map.json                          schema 对齐 build_asset_map.py：
                                               images / spines / character_spine / counts
                                               （另加 spine_meta 段存 bundle 溯源，
                                               前端不读）

用法（venv：D:/Bluearchive/.venv/Scripts/python.exe）：
  python tools/fetch/extract_local_spine.py                 # 提取默认 15 族
  python tools/fetch/extract_local_spine.py --families airi_home,fuuka_home
  python tools/fetch/extract_local_spine.py --list          # 只列族分类，不提取
  python tools/fetch/extract_local_spine.py --all-safe      # 提取全部无歧义族
"""
from __future__ import annotations

import argparse
import json
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
WORK = Path("D:/Bluearchive/.scratch/spine/work")

# 客户端演示用的族必须优先
DEFAULT_FAMILIES = [
    "airi_home", "fuuka_home", "shiroko_home", "hoshino_home", "serika_home",
    "nonomi_home", "ayane_home", "aru_home", "aris_home", "yuuka_home",
    "momoi_home", "kayoko_home", "kazusa_home", "ibuki_home", "haruka_home",
]

RX_OLD = re.compile(
    r"^assets-_mx-spinelobbies-(?P<fam>.+?_home)-_mxdependency-"
    r"(?P<date>\d{4}-\d{2}-\d{2})(?:_(?P<shard>\d{3}))?_assets_all_(?P<crc>\d+)\.bundle$"
)
RX_NEW = re.compile(
    r"^assets-_mx-spinelobbies-(?P<fam>.+?_home)-_mxdependency-"
    r"(?P<type>[a-z]+)-(?P<date>\d{4}-\d{2}-\d{2})_assets_all_(?P<crc>\d+)\.bundle$"
)

PAGE_EXT = (".png", ".webp", ".pvr", ".etc1", ".ktx", ".astc")


def scan_families(gamedir: Path) -> dict[str, dict]:
    """返回 {fam: {"old": {shard: {date: name}}, "new": {type: {date: name}}}}"""
    fams: dict[str, dict] = defaultdict(lambda: {"old": defaultdict(dict), "new": defaultdict(dict)})
    for p in gamedir.glob("assets-_mx-spinelobbies-*_home-*.bundle"):
        m = RX_OLD.match(p.name)
        if m:
            fams[m["fam"]]["old"][m["shard"] or "000"][m["date"]] = p.name
            continue
        m = RX_NEW.match(p.name)
        if m:
            fams[m["fam"]]["new"][m["type"]][m["date"]] = p.name
    return dict(fams)


def pick_bundles(fam: str, info: dict) -> tuple[list[str] | None, str]:
    """每逻辑分片取唯一日期版本；有歧义返回 None + 原因。"""
    picked: list[str] = []
    for layout in ("old", "new"):
        for key, dates in sorted(info[layout].items()):
            if len(dates) > 1:
                return None, f"shard '{layout}/{key}' has {len(dates)} date versions: {sorted(dates)}"
            picked.append(next(iter(dates.values())))
    if not picked:
        return None, "no bundles matched"
    return picked, ""


def atlas_pages(atlas_text: str) -> list[str]:
    """atlas 文本里的 page 文件名行（以贴图扩展名结尾的顶格行）。"""
    pages = []
    for line in atlas_text.splitlines():
        s = line.strip()
        if s.lower().endswith(PAGE_EXT) and not s.startswith("repeat"):
            pages.append(s)
    return pages


def skel_version(head: bytes) -> str:
    """.skel 头 8 字节 hash 后是版本字符串（如 4.2.33）。只读头，不解析内容。"""
    m = re.search(rb"\d+\.\d+\.\d+", head[:64])
    return m.group().decode() if m else "?"


def extract_family(fam: str, bundles: list[str], gamedir: Path, out_dir: Path,
                   work_dir: Path) -> tuple[dict, list[str]]:
    """提取单族，返回 (asset_map 条目 + 元数据, problems)。"""
    problems: list[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    # UnityPy 坑规避：把同批 bundle 复制进同一临时目录再 load(目录)，
    # 保证 MonoScript/引用解析一致（TextAsset/Texture2D 本身是内置类型）。
    for f in work_dir.glob("*"):
        f.unlink()
    srcs = [gamedir / b for b in bundles]
    for src in srcs:
        shutil.copy2(src, work_dir / src.name)

    env = UnityPy.load(str(work_dir))
    skels: dict[str, bytes] = {}
    atlases: dict[str, bytes] = {}
    textures: dict[str, object] = {}
    type_count: dict[str, int] = defaultdict(int)
    for obj in env.objects:
        type_count[obj.type.name] += 1
        if obj.type.name == "TextAsset":
            d = obj.read()
            name = d.m_Name
            data = d.m_Script
            if isinstance(data, str):
                data = data.encode("utf-8", "surrogateescape")
            low = name.lower()
            if low.endswith((".skel", ".skel.bytes")):
                skels[name] = data
            elif low.endswith((".atlas", ".atlas.txt")):
                atlases[name] = data
        elif obj.type.name == "Texture2D":
            d = obj.read()
            textures[d.m_Name] = d

    # atlas 落盘：字节原样（内含 CRLF 与 page 名，spine-webgl 相对 atlas 解析 page）
    written_atlas: dict[str, Path] = {}
    for a_name, a_data in atlases.items():
        dst = out_dir / a_name
        dst.write_bytes(a_data)
        written_atlas[a_name] = dst

    # png 落盘：文件名 = atlas page 名（spine-webgl 相对 atlas 解析，大小写敏感）
    written_png: dict[str, Path] = {}  # lower(page) -> path
    page_map: dict[str, list[str]] = {}  # atlas name -> pages
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
                problems.append(f"{fam}: atlas '{a_name}' page '{page}' has no matching Texture2D "
                                f"(have: {sorted(textures)})")
                continue
            try:
                img = tex.image
            except Exception as e:  # noqa: BLE001
                problems.append(f"{fam}: Texture2D '{tex.m_Name}' decode failed: {type(e).__name__}: {e}")
                continue
            dst = out_dir / page
            img.save(dst)
            written_png[key] = dst

    # skel 落盘（二进制原样，不解析）
    written_skel: dict[str, Path] = {}
    versions: dict[str, str] = {}
    for s_name, data in skels.items():
        dst = out_dir / s_name
        dst.write_bytes(data)
        written_skel[s_name] = dst
        versions[s_name] = skel_version(data[:64])
        if not versions[s_name].startswith("4.2"):
            problems.append(f"{fam}: skel '{s_name}' version {versions[s_name]} is not 4.2.x "
                            f"(client spine-webgl is 4.2)")

    # 索引条目：族内每个有同配 .atlas 的 skel 都建条目。key 规则：
    #   <char>_home  -> fam            （主模型，客户端演示用）
    #   <char>_Scene -> fam_scene
    #   其他后缀      -> fam_<后缀>     （如 Hoshino_home_background -> hoshino_home_background）
    char = fam[: -len("_home")]
    home_low = f"{char}_home"

    def key_for(skel_name: str) -> str:
        stem = Path(skel_name).stem.lower()
        if stem == home_low:
            return fam
        if stem == f"{char}_scene":
            return f"{fam}_scene"
        suffix = stem[len(home_low) + 1:] if stem.startswith(home_low + "_") else stem
        return f"{fam}_{suffix}" if suffix else fam

    meta: dict = {"bundles": sorted(bundles), "skel_versions": versions,
                  "types": dict(type_count)}
    if not skels:
        problems.append(f"{fam}: no .skel TextAsset found")
        return {"entries": {}, "meta": meta}, problems

    def build_entry(skel_name: str) -> dict | None:
        stem = Path(skel_name).stem.lower()
        a_name = next((a for a in atlases if Path(a).stem.lower() == stem), None)
        if a_name is None:
            problems.append(f"{fam}: no .atlas named like skel '{skel_name}' (have: {sorted(atlases)})")
            return None
        texs = []
        for page in page_map.get(a_name, []):
            p = written_png.get(page.lower())
            if p is None:
                return None  # problem already recorded
            texs.append(str(p.relative_to(REPO)).replace("\\", "/"))
        if not texs:
            return None
        return {
            "skel": str((out_dir / skel_name).relative_to(REPO)).replace("\\", "/"),
            "atlas": str((out_dir / a_name).relative_to(REPO)).replace("\\", "/"),
            "textures": texs,
        }

    # 主模型缺失时回退到最大的 skel（主模型远大于变体）
    if home_low not in {Path(s).stem.lower() for s in skels}:
        problems.append(f"{fam}: no skel named like '{char}_home'; "
                        f"using largest of {sorted(skels)} as main")
    out_entries: dict[str, dict] = {}
    main = (home_low if home_low in {Path(s).stem.lower() for s in skels}
            else max(skels, key=lambda n: len(skels[n])))
    order = [main] + sorted(s for s in skels if s != main)
    for s_name in order:
        e = build_entry(s_name)
        if e:
            out_entries[key_for(s_name)] = e
    if not out_entries:
        problems.append(f"{fam}: no (skel, atlas, textures) triple complete")
    meta["skels"] = sorted(skels)
    meta["atlases"] = sorted(atlases)
    meta["pages"] = page_map
    return {"entries": out_entries, "meta": meta}, problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--gamedir", type=Path, default=GAME_DIR)
    ap.add_argument("--catalog", type=Path, default=CATALOG)
    ap.add_argument("--families", default="", help="逗号分隔的族名；空=默认 15 族")
    ap.add_argument("--all-safe", action="store_true", help="提取全部无版本歧义族")
    ap.add_argument("--list", action="store_true", help="只列族分类")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gamedir: Path = args.gamedir
    fams = scan_families(gamedir)

    ambiguous: dict[str, str] = {}
    safe: dict[str, list[str]] = {}
    for fam, info in sorted(fams.items()):
        picked, why = pick_bundles(fam, info)
        if picked is None:
            ambiguous[fam] = why
        else:
            safe[fam] = picked

    if args.list:
        named = {f: b for f, b in safe.items() if not re.match(r"^ch\d{4}_", f)}
        print(f"families={len(fams)} safe={len(safe)} ambiguous={len(ambiguous)}")
        print(f"named-safe={len(named)}")
        for f in sorted(named):
            print(f"  {f}: {len(named[f])} bundles")
        print("ambiguous:")
        for f, why in sorted(ambiguous.items()):
            print(f"  {f}: {why}")
        return 0

    if args.all_safe:
        targets = dict(safe)
    else:
        want = [s.strip() for s in args.families.split(",") if s.strip()] or DEFAULT_FAMILIES
        unknown = [w for w in want if w not in safe]
        for u in unknown:
            print(f"SKIP {u}: {'ambiguous: ' + ambiguous[u] if u in ambiguous else 'not found on disk'}",
                  file=sys.stderr)
        targets = {w: safe[w] for w in want if w in safe}
    print(f"targets={len(targets)} safe_total={len(safe)} ambiguous={len(ambiguous)}")

    spines: dict[str, dict] = {}
    spine_meta: dict[str, dict] = {}
    problems: list[str] = []
    file_count = 0
    for fam, bundles in sorted(targets.items()):
        if args.dry_run:
            print(f"DRY {fam}: {len(bundles)} bundles -> {bundles[:2]} ...")
            continue
        out_dir = REPO / "resources" / "spine" / fam
        res, probs = extract_family(fam, bundles, gamedir, out_dir, WORK / fam)
        spines.update(res["entries"])
        spine_meta[fam] = res["meta"]
        problems.extend(probs)
        n = len(list(out_dir.iterdir())) if out_dir.exists() else 0
        file_count += n
        keys = ",".join(res["entries"]) or "-"
        print(f"OK {fam}: files={n} entries=[{keys}] problems={len(probs)}")

    if args.dry_run:
        print("dry-run: asset_map.json not written")
        return 0

    amap_path = REPO / "data" / "asset_map.json"
    amap = {}
    if amap_path.exists():
        try:
            amap = json.loads(amap_path.read_text(encoding="utf-8"))
        except Exception:
            amap = {}
    amap.setdefault("images", {})
    amap.setdefault("character_spine", {})
    amap["spines"] = {**amap.get("spines", {}), **spines}
    amap["spine_meta"] = {**amap.get("spine_meta", {}), **spine_meta}
    amap["counts"] = {
        "images": len(amap.get("images", {})),
        "spines": len(amap["spines"]),
        "spine_families_extracted": len(spine_meta),
        "spine_files_written": file_count,
        "character_spine": len(amap.get("character_spine", {})),
    }
    amap["generated"] = {
        "by": "tools/fetch/extract_local_spine.py",
        "date": date.today().isoformat(),
        "game_dir": str(gamedir).replace("\\", "/"),
        "source": "assetbundle",
    }
    amap_path.parent.mkdir(parents=True, exist_ok=True)
    amap_path.write_text(json.dumps(amap, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"asset_map.json: spines={len(amap['spines'])} -> {amap_path}")
    print(f"files written={file_count} problems={len(problems)}")
    for p in problems:
        print(f"  PROBLEM: {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
