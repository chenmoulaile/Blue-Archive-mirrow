#!/usr/bin/env python3
"""
home_spine 命名桥：把 data/students_slim.json 的 home_spine（显示名，如
Hoshino_home / CH0258_home_fix / Akari_home_Combined）改写成 data/asset_map.json
spines 段实际存在的族键（小写，如 hoshino_home / ch0258_home / akari_home）。

规则（实测 2026-11-07，对齐 spine_ref 轨的 case-insensitive / _HD 剥离规则）：
  1. v.lower() 直接命中 asset_map.spines 键          -> 用之
  2. v.lower() 命中磁盘已提取 home 族的 skel 叶名表   -> 映射到族键
     （叶名表由 resources/spine/*_home/*.skel 文件名构成；container 结构
       Assets/_MX/SpineLobbies/<Fam>/<子模型>/<叶>，叶名=skel 文件名，
       probe: .scratch/spr/probe_container.py 实测 ch0258_home/serika_home/akari_home）
  3. 依次剥离后缀 _fix / _Halofix / _Combined / 尾部 _ / _HD，每剥一层重试 1-2
  4. 仍无 -> 改写为 ""（LobbyPage.tsx:16 lobbyStudents 过滤空值、:40 falsy 不加载，
     即 0 死链；置空对象与依据见输出 report）

用法：python tools/fetch/bridge_home_spine.py [--dry-run]
只写 data/students_slim.json 的 home_spine 字段，其他字段原样保留。
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SLIM = REPO / "data" / "students_slim.json"
AMAP = REPO / "data" / "asset_map.json"
SPINE_DIR = REPO / "resources" / "spine"

SUFFIXES = ("_fix", "_halofix", "_combined")


def build_leaf_table(spine_keys: set[str]) -> dict[str, str]:
    """磁盘已提取 home 族的 skel 叶名(小写) -> 族键。"""
    leaf: dict[str, str] = {}
    for fam in sorted(spine_keys):
        d = SPINE_DIR / fam
        if not (fam.endswith("_home") and d.is_dir()):
            continue
        for f in d.iterdir():
            if f.suffix == ".skel":
                leaf.setdefault(f.stem.lower(), fam)
    return leaf


def resolve(value: str, keys: set[str], leaf: dict[str, str]) -> tuple[str | None, str]:
    """返回 (族键|None, 规则说明)。"""
    k = value.strip().lower()
    if k in keys:
        return k, "direct"
    if k in leaf:
        return leaf[k], "leaf"
    # 剥后缀，可叠加（如 xxx_home_fix / xxx_home_Halofix / 尾部 _）
    cur = k
    steps: list[str] = []
    while True:
        stripped = False
        for suf in SUFFIXES:
            if cur.endswith(suf):
                cur = cur[: -len(suf)]
                steps.append(f"strip{suf}")
                stripped = True
                break
        if not stripped and cur.endswith("_"):
            cur = cur.rstrip("_")
            steps.append("strip_")
            stripped = True
        if not stripped and cur.endswith("_hd"):
            cur = cur[:-3]
            steps.append("strip_hd")
            stripped = True
        if not stripped:
            return None, "unresolved"
        if cur in keys:
            return cur, "+".join(steps) + "->key"
        if cur in leaf:
            return leaf[cur], "+".join(steps) + "->leaf"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    amap = json.loads(AMAP.read_text(encoding="utf-8"))
    keys = set(amap["spines"])
    leaf = build_leaf_table(keys)
    slim = json.loads(SLIM.read_text(encoding="utf-8"))

    changes: list[dict] = []
    keep = 0
    for s in slim:
        v = s.get("home_spine")
        if not v:
            continue
        tgt, how = resolve(v, keys, leaf)
        newv = tgt or ""
        if newv == v:
            keep += 1
            continue
        changes.append({"id": s["id"], "given": s.get("given_name_en") or s.get("given_name"),
                        "old": v, "new": newv, "rule": how})
        s["home_spine"] = newv

    empty = [c for c in changes if not c["new"]]
    ok = [c for c in changes if c["new"]]
    print(f"home_spine 条目: {sum(1 for s in slim if s.get('home_spine') is not None and s['home_spine'] or s.get('home_spine') == '')} 含空")
    print(f"  改写->有效键: {len(ok)}  改写->空串: {len(empty)}  保持原值: {keep}")
    print("  规则分布:")
    from collections import Counter
    for rule, n in Counter(c["rule"] for c in changes).most_common():
        print(f"    {rule}: {n}")
    if empty:
        print(f"  置空清单（{len(empty)} 条，catalog 实测无对应 spine bundle）:")
        for c in empty:
            print(f"    id={c['id']} {c['given']}: {c['old']}")

    # exists 校验：改写后所有非空 home_spine 必须在 asset_map.spines
    dead = [s["id"] for s in slim if s.get("home_spine") and s["home_spine"] not in keys]
    print(f"exists 校验: 非空 home_spine={sum(1 for s in slim if s.get('home_spine'))} 死链={len(dead)} {dead}")

    if args.dry_run:
        print("dry-run: students_slim.json 未写入")
        return 0
    SLIM.write_text(json.dumps(slim, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"written: {SLIM} (无 BOM，保持原样)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
