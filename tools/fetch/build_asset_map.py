#!/usr/bin/env python3
"""
构建素材索引 asset_map.json，并统计剧情引用的资源覆盖率。

输出：
    data/asset_map.json      背景名 -> 文件路径、Spine 名 -> 文件组
    data/coverage.json       剧情里出现的 bg/bgm/se/spine 有多少能在本地找到

这一步是剧情播放器的前置条件：播放器拿到 {"op":"background","bg":"BG_MainOffice"}
时，需要立刻知道该加载哪张图。
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "resources"
DATA = ROOT / "data"
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def read_json(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def build():
    # ---- 背景 / CG 索引：文件名（不含扩展名）-> 相对路径
    images: dict[str, str] = {}
    dupes = 0
    for f in (RES / "images").rglob("*"):
        if f.is_file() and f.suffix.lower() in IMG_EXT:
            key = f.stem
            rel = str(f.relative_to(ROOT)).replace("\\", "/")
            if key in images:
                dupes += 1
                # 优先保留路径更短、更"通用"的那份
                if len(rel) < len(images[key]):
                    images[key] = rel
            else:
                images[key] = rel

    # ---- Spine 索引
    spines: dict[str, dict] = {}
    for d in (RES / "spine").iterdir() if (RES / "spine").exists() else []:
        if not d.is_dir():
            continue
        files = list(d.iterdir())
        skel = next((f for f in files if f.suffix == ".skel"), None)
        atlas = next((f for f in files if f.suffix == ".atlas"), None)
        if not (skel and atlas):
            continue
        spines[d.name] = {
            "skel": str(skel.relative_to(ROOT)).replace("\\", "/"),
            "atlas": str(atlas.relative_to(ROOT)).replace("\\", "/"),
            "textures": [
                str(f.relative_to(ROOT)).replace("\\", "/")
                for f in sorted(files)
                if f.suffix.lower() == ".png"
            ],
        }

    # ---- 剧情引用覆盖率
    refs = {"background": Counter(), "bgm": Counter(), "se": Counter(), "spine": Counter()}
    episodes = 0
    for f in (RES / "story").rglob("*.json"):
        rec = read_json(f, {}) or {}
        nodes = rec.get("nodes") or []
        if not nodes:
            continue
        episodes += 1
        for n in nodes:
            op = n.get("op")
            if op == "background" and n.get("bg"):
                refs["background"][n["bg"]] += 1
            elif op == "bgm" and n.get("id"):
                refs["bgm"][n["id"]] += 1
            elif op == "se" and n.get("id"):
                refs["se"][n["id"]] += 1
            elif op == "script" and n.get("spine"):
                refs["spine"][n["spine"]] += 1

    def cov(names: Counter, lookup: dict) -> dict:
        hit = [n for n in names if n in lookup]
        miss = [n for n in names if n not in lookup]
        return {
            "referenced": len(names),
            "resolved": len(hit),
            "missing": len(miss),
            "missing_top": [{"name": k, "uses": names[k]} for k in
                            sorted(miss, key=lambda x: -names[x])[:40]],
        }

    # Spine 的剧情引用名是角色显示名（Arona / Airi (Band)），本地文件是 CH0069_spr 这种，
    # 需要靠 students_full 建立 名字 -> spr 模型 的映射。变体（括号后缀）先按基础名兜底，
    # 精确的变体表留到 Phase 2 用皮肤名对照表补全。
    students = read_json(DATA / "students_full.json", []) or []
    spine_by_id = {s["id"]: s for s in read_json(DATA / "spine_index.json", []) or []}
    name_to_spine: dict[str, str] = {}
    for s in students:
        for label in (s.get("given_name_en"), s.get("given_name"), s.get("given_name_cn")):
            if not label:
                continue
            for sid in s.get("spine") or []:
                meta = spine_by_id.get(sid) or {}
                if meta.get("type") == "spr" and meta.get("name") in spines:
                    name_to_spine.setdefault(label.strip().lower(), meta["name"])
                    break

    def resolve_char(name: str) -> str | None:
        key = name.strip().lower()
        if key in name_to_spine:
            return name_to_spine[key]
        base = key.split("(")[0].strip()
        return name_to_spine.get(base)

    coverage = {
        "episodes": episodes,
        "background": cov(refs["background"], images),
        "bgm": {"referenced": len(refs["bgm"]), "note": "音频尚未抓取"},
        "se": {"referenced": len(refs["se"]), "note": "音频尚未抓取"},
        "spine_by_character": {
            "characters_referenced": len(refs["spine"]),
            "mapped": sum(1 for k in refs["spine"] if resolve_char(k)),
            "missing_top": [
                {"name": k, "uses": refs["spine"][k]}
                for k in sorted(
                    (k for k in refs["spine"] if not resolve_char(k)),
                    key=lambda x: -refs["spine"][x],
                )[:20]
            ],
        },
    }

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "asset_map.json").write_text(
        json.dumps(
            {
                "images": images,
                "spines": spines,
                "character_spine": name_to_spine,
                "counts": {
                    "images": len(images),
                    "image_dupes": dupes,
                    "spines": len(spines),
                    "characters_mapped": len(name_to_spine),
                },
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    (DATA / "coverage.json").write_text(
        json.dumps(coverage, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print(f"图片 {len(images)} 个键（重名 {dupes}）  Spine {len(spines)} 组  角色映射 {len(name_to_spine)}")
    print(f"剧情 {episodes} 集")
    b = coverage["background"]
    print(f"背景引用 {b['referenced']} 种 -> 命中 {b['resolved']}，缺失 {b['missing']}"
          f"（{b['resolved']/max(b['referenced'],1)*100:.1f}%）")
    if b["missing_top"]:
        print("  缺失最多：", ", ".join(f"{x['name']}({x['uses']})" for x in b["missing_top"][:8]))
    print(f"BGM 引用 {coverage['bgm']['referenced']} 种 / SE 引用 {coverage['se']['referenced']} 种（音频未抓）")
    s = coverage["spine_by_character"]
    print(f"角色 Spine 引用 {s['characters_referenced']} 人 -> 已映射 {s['mapped']}")


if __name__ == "__main__":
    build()
