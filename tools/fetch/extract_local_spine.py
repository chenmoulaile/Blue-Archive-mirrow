#!/usr/bin/env python3
"""
从本地 Steam 版 Blue Archive 的 Addressables bundle 中提取记忆大厅 Spine 模型。

族模式（实测 D:/Steam/.../PUB/Resource/GameData/Windows，共 266 个 *_home- 族）：
  旧式: assets-_mx-spinelobbies-<char>_home-_mxdependency-<日期>[_NNN分片]_assets_all_<crc>.bundle
  新式: assets-_mx-spinelobbies-<char>_home-_mxdependency-<类型>-<日期>_assets_all_<crc>.bundle
        （类型 ∈ assets/textassets/textures/materials/timelines/prefabs/...，2026 起的新族）

版本判定（2026-11-05 全量实测，含 8 个多日期族逐 bundle 内容清点）：
  1. catalog 守卫：bundle 文件名出现在 catalog_Windows.bytes（CCDB
     "AddressablesMainContentCatalog"，正则可提取 25961 唯一名）= 生效/存活；
     不在 = 孤儿，剔除并记 problem。实测 1369 个 *_home bundle 全部在 catalog（孤儿 0）。
  2. 多日期族并集规则：族内出现多个日期集时（实测恰 8 族，每族 2 个日期），
     两个日期集不是互斥版本而是同一现行模型的互补部分——
       - skel/atlas 在最早的 2024-11-18 数字分片集里（新版日期集实测 0 个 TextAsset，
         只有 MonoBehaviour/Material/贴图）；
       - 但旧 atlas 的 page 名直接引用新版日期集里的贴图
         （ch0164/cherino/hihumi: *_home_2.png 只在 2025-07 集内；
          ch0232: *_home_2/_3.png 只在 2026-03-23 集内），
         缺了新版贴图 atlas 页就残缺。这正是两套都在 catalog 的原因：
         它们是同一现行模型的依赖。
     因此对多日期族提取「全部日期集的在 catalog bundle 之并集」；
     atlas page 解析不出贴图时脚本照常记 problem 兜底。

产物：
  resources/spine/<fam>/*.skel|*.atlas|*.png   客户端契约位置（SpineView 用
                                               @esotericsoftware/spine-webgl 4.2 加载，
                                               png 文件名必须与 atlas page 名一致）
  data/asset_map.json                          schema 对齐 build_asset_map.py：
                                               images / spines / character_spine / counts
                                               （另加 spine_meta 段存 bundle 溯源，
                                               前端不读；每族提取完即增量落盘）

用法（venv：D:/Bluearchive/.venv/Scripts/python.exe）：
  python tools/fetch/extract_local_spine.py                 # 提取默认 15 族
  python tools/fetch/extract_local_spine.py --families airi_home,fuuka_home
  python tools/fetch/extract_local_spine.py --list          # 只列族分类，不提取
  python tools/fetch/extract_local_spine.py --all-safe      # 提取全部 266 族（含多日期并集族）
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

RX_CAT_BUNDLE = re.compile(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle")


def load_catalog_names(catalog: Path) -> set[str]:
    """catalog_Windows.bytes 里出现过的 bundle 文件名（= 客户端认定的存活集）。"""
    return {m.group().decode() for m in RX_CAT_BUNDLE.finditer(catalog.read_bytes())}


def scan_families(gamedir: Path) -> dict[str, dict]:
    """返回 {fam: {"dates": {date: [bundle 名,...]}}}，日期集 = 该日期的全部分片。"""
    fams: dict[str, dict] = defaultdict(lambda: {"dates": defaultdict(list)})
    for p in gamedir.glob("assets-_mx-spinelobbies-*_home-*.bundle"):
        m = RX_OLD.match(p.name) or RX_NEW.match(p.name)
        if m:
            fams[m["fam"]]["dates"][m["date"]].append(p.name)
    return dict(fams)


def pick_bundles(fam: str, info: dict, cat_names: set[str]) -> tuple[list[str] | None, str, dict]:
    """族级选版：catalog 孤儿剔除 + 多日期族并集规则。

    返回 (bundles, 原因, meta)；bundles=None 表示该族不可提取。
    """
    dates: dict[str, list[str]] = {d: sorted(ns) for d, ns in info["dates"].items()}
    if not dates:
        return None, "no bundles matched", {}
    all_names = [n for d in sorted(dates) for n in dates[d]]
    excluded = [n for n in all_names if n not in cat_names]
    picked = [n for n in all_names if n in cat_names]
    meta: dict = {
        "dates": sorted(dates),
        "multi_date": len(dates) > 1,
        "bundles_all": len(all_names),
        "catalog_excluded": excluded,
    }
    if excluded:
        meta["reason"] = f"{len(excluded)} bundle(s) not in catalog_Windows.bytes excluded as orphan"
    if len(dates) > 1:
        meta["resolution"] = (
            "multi-date union: every date-set is live in catalog and they are complementary, "
            "not alternatives (skel/atlas live in the earliest set, newer date-sets carry extra "
            "atlas pages and/or prefab patches with zero TextAssets; measured 2026-11-05 on all "
            "8 multi-date families)"
        )
    if not picked:
        return None, "no in-catalog bundles", meta
    return picked, "", meta


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
    # bundles 已按文件名排序（ISO 日期字典序=时间序），同名 Texture2D 冲突时
    # 后载入者（更新日期）胜出，行为确定。
    for f in work_dir.glob("*"):
        f.unlink()
    srcs = [gamedir / b for b in sorted(bundles)]
    for src in srcs:
        shutil.copy2(src, work_dir / src.name)

    env = UnityPy.load(str(work_dir))
    skels: dict[str, bytes] = {}
    atlases: dict[str, bytes] = {}
    textures: dict[str, object] = {}
    dup_tex: list[str] = []
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
            if d.m_Name in textures:
                dup_tex.append(d.m_Name)
            textures[d.m_Name] = d
    if dup_tex:
        problems.append(f"{fam}: duplicate Texture2D name(s) across bundles, newest-date wins "
                        f"(copy order sorted): {sorted(set(dup_tex))}")

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
    # 主模型名缺失回退时（见下），回退 skel 直接用 fam 作 key。
    char = fam[: -len("_home")]
    home_low = f"{char}_home"

    def key_for(skel_name: str, fallback_main: bool = False) -> str:
        if fallback_main:
            return fam
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

    def build_entry(skel_name: str) -> tuple[dict | None, str]:
        """返回 (entry|None, 失败原因)；成功原因=''。"""
        stem = Path(skel_name).stem.lower()
        a_name = next((a for a in atlases if Path(a).stem.lower() == stem), None)
        if a_name is None:
            # 唯一性回退配对：族内恰 1 skel + 1 atlas 且 stem 对不上时，
            # 按唯一性配对（实测 ch9996_home：skel=CH9996_home.skel、
            # atlas=CH0996_home.atlas，名字错位是游戏数据本身的拼写差）。
            if len(atlases) == 1 and len(skels) == 1:
                a_name = next(iter(atlases))
                problems.append(
                    f"{fam}: skel '{skel_name}' paired with the family's single atlas "
                    f"'{a_name}' despite stem mismatch (naming typo in game data)")
            else:
                return None, f"no .atlas named like skel '{skel_name}' (have: {sorted(atlases)})"
        texs = []
        for page in page_map.get(a_name, []):
            p = written_png.get(page.lower())
            if p is None:
                return None, "page texture missing (problem already recorded)"
            texs.append(str(p.relative_to(REPO)).replace("\\", "/"))
        if not texs:
            return None, "atlas has no usable page"
        return {
            "skel": str((out_dir / skel_name).relative_to(REPO)).replace("\\", "/"),
            "atlas": str((out_dir / a_name).relative_to(REPO)).replace("\\", "/"),
            "textures": texs,
        }, ""

    # 主模型缺失时回退到最大的 skel（主模型远大于变体）。
    # 注意 main 必须是 skels 的真实键名（stem 反查），不能用 home_low 伪名——
    # 否则会对同一 skel 建两次条目/记两次 problem（上轮遗留 bug，2026-11-06 修复）。
    stem_to_skel = {Path(s).stem.lower(): s for s in skels}
    fallback_main = home_low not in stem_to_skel
    if fallback_main:
        problems.append(f"{fam}: no skel named like '{char}_home'; "
                        f"using largest of {sorted(skels)} as main")
    out_entries: dict[str, dict] = {}
    main = stem_to_skel.get(home_low) or max(skels, key=lambda n: len(skels[n]))
    order = [main] + sorted(s for s in skels if s != main)
    unpairable: list[str] = []
    for s_name in order:
        e, why = build_entry(s_name)
        if e:
            out_entries[key_for(s_name, fallback_main=(fallback_main and s_name == main))] = e
        elif why.startswith("no .atlas"):
            unpairable.append(s_name)
        # 其余失败原因（贴图缺失等）已记 problem，skel 保留在盘上供排查
    for s_name in unpairable:
        # 族内无任何可配 atlas 的 skel = 源 bundle 的开发残留
        # （实测 hare_home：分片 _002 同时含 Hare_home.skel 与 Hanako_home.skel，
        #   Hanako 模型在 hanako_home 族有自己的完整 atlas 集）。
        # 不跨族配对（避免拼接出错误模型），落盘文件删除并记录。
        stray = out_dir / s_name
        if stray.is_file():
            stray.unlink()
        problems.append(f"{fam}: stray skel '{s_name}' removed — no atlas in this family "
                        f"(cross-family pairing would fabricate a model; have: {sorted(atlases)})")
    if not out_entries:
        problems.append(f"{fam}: no (skel, atlas, textures) triple complete")
    meta["skels"] = sorted(skels)
    meta["atlases"] = sorted(atlases)
    meta["pages"] = page_map
    return {"entries": out_entries, "meta": meta}, problems


def load_asset_map(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def write_asset_map(path: Path, amap: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(amap, ensure_ascii=False, indent=1), encoding="utf-8")


def spine_files_on_disk() -> int:
    return sum(1 for _ in (REPO / "resources" / "spine").rglob("*") if _.is_file())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--gamedir", type=Path, default=GAME_DIR)
    ap.add_argument("--catalog", type=Path, default=CATALOG)
    ap.add_argument("--families", default="", help="逗号分隔的族名；空=默认 15 族")
    ap.add_argument("--all-safe", action="store_true", help="提取全部族（catalog 守卫 + 多日期并集）")
    ap.add_argument("--list", action="store_true", help="只列族分类")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gamedir: Path = args.gamedir
    catalog: Path = args.catalog
    if not catalog.is_file():
        print(f"FATAL catalog not found: {catalog}", file=sys.stderr)
        return 2
    cat_names = load_catalog_names(catalog)
    print(f"catalog={catalog} unique bundle names={len(cat_names)}")

    fams = scan_families(gamedir)
    targets: dict[str, list[str]] = {}
    unresolvable: dict[str, str] = {}
    fam_meta_pick: dict[str, dict] = {}
    for fam, info in sorted(fams.items()):
        picked, why, meta = pick_bundles(fam, info, cat_names)
        if picked is None:
            unresolvable[fam] = why
            fam_meta_pick[fam] = meta
        else:
            targets[fam] = picked
            fam_meta_pick[fam] = meta

    multi = {f: m for f, m in fam_meta_pick.items() if m.get("multi_date")}

    if args.list:
        named = {f: b for f, b in targets.items() if not re.match(r"^ch\d{4}_", f)}
        print(f"families={len(fams)} extractable={len(targets)} "
              f"unresolvable={len(unresolvable)} multi-date={len(multi)}")
        print(f"named-extractable={len(named)}")
        for f in sorted(named):
            tag = " multi-date" if f in multi else ""
            print(f"  {f}: {len(named[f])} bundles{tag}")
        if unresolvable:
            print("unresolvable:")
            for f, why in sorted(unresolvable.items()):
                print(f"  {f}: {why}")
        print("multi-date resolution:")
        for f, m in sorted(multi.items()):
            print(f"  {f}: dates={m['dates']} excluded={len(m['catalog_excluded'])}")
        return 0

    if args.all_safe:
        pass  # targets 已是全部可提取族
    else:
        want = [s.strip() for s in args.families.split(",") if s.strip()] or DEFAULT_FAMILIES
        unknown = [w for w in want if w not in targets]
        for u in unknown:
            print(f"SKIP {u}: {'unresolvable: ' + unresolvable[u] if u in unresolvable else 'not found on disk'}",
                  file=sys.stderr)
        targets = {w: targets[w] for w in want if w in targets}
    print(f"targets={len(targets)} families_total={len(fams)} unresolvable={len(unresolvable)} "
          f"multi-date={len(multi)}")

    amap_path = REPO / "data" / "asset_map.json"
    amap = load_asset_map(amap_path)
    amap.setdefault("images", {})
    amap.setdefault("character_spine", {})
    amap.setdefault("spines", {})
    amap.setdefault("spine_meta", {})

    problems: list[str] = []
    done = 0
    for fam, bundles in sorted(targets.items()):
        if args.dry_run:
            print(f"DRY {fam}: {len(bundles)} bundles -> {bundles[:2]} ...")
            continue
        out_dir = REPO / "resources" / "spine" / fam
        res, probs = extract_family(fam, bundles, gamedir, out_dir, WORK / fam)
        # 清掉该族旧键（条目 key 形如 fam 或 fam_<suffix>），防改名/删除后残留
        for k in [k for k in amap["spines"] if k == fam or k.startswith(fam + "_")]:
            del amap["spines"][k]
        amap["spines"].update(res["entries"])
        m = dict(fam_meta_pick[fam])
        m.update(res["meta"])
        amap["spine_meta"][fam] = m
        problems.extend(probs)
        done += 1
        n = len(list(out_dir.iterdir())) if out_dir.exists() else 0
        keys = ",".join(res["entries"]) or "-"
        print(f"OK {fam}: files={n} entries=[{keys}] problems={len(probs)}", flush=True)
        # 每族增量落盘：中途被杀也不丢进度
        if done % 5 == 0 or done == len(targets):
            amap["counts"] = {
                "images": len(amap.get("images", {})),
                "spines": len(amap["spines"]),
                "spine_families_extracted": len(amap["spine_meta"]),
                "spine_files_written": spine_files_on_disk(),
                "character_spine": len(amap.get("character_spine", {})),
            }
            amap["generated"] = {
                "by": "tools/fetch/extract_local_spine.py",
                "date": date.today().isoformat(),
                "game_dir": str(gamedir).replace("\\", "/"),
                "source": "assetbundle",
            }
            write_asset_map(amap_path, amap)

    if args.dry_run:
        print("dry-run: asset_map.json not written")
        return 0

    amap["counts"] = {
        "images": len(amap.get("images", {})),
        "spines": len(amap["spines"]),
        "spine_families_extracted": len(amap["spine_meta"]),
        "spine_files_written": spine_files_on_disk(),
        "character_spine": len(amap.get("character_spine", {})),
    }
    amap["generated"] = {
        "by": "tools/fetch/extract_local_spine.py",
        "date": date.today().isoformat(),
        "game_dir": str(gamedir).replace("\\", "/"),
        "source": "assetbundle",
    }
    write_asset_map(amap_path, amap)
    print(f"asset_map.json: spines={len(amap['spines'])} "
          f"spine_meta={len(amap['spine_meta'])} -> {amap_path}")
    print(f"families extracted this run={done} problems={len(problems)}")
    for p in problems:
        print(f"  PROBLEM: {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
