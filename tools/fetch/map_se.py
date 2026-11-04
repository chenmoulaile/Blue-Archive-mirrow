#!/usr/bin/env python3
"""
把剧情里的 SE 名字映射到实际提取到的 SFX 文件。

背景
    剧情数据里 `{op: "se", id: "SE_DoorOpen_01"}` 用的是游戏内的逻辑名；
    我们从 bundle 里提出来的是 `SFX_DoorOpen_01` 这类资源名，两套命名对不上。

规则
    1. 归一化：去掉 SE_ / SFX_ / FX_ 前缀，去掉结尾编号，转小写
    2. 归一化后完全相同 -> high
    3. 编辑距离 <= 2      -> medium
    4. 其余               -> 未匹配（写进 csv 工单）

用法
    .venv/Scripts/python.exe tools/fetch/map_se.py

产物
    data/se_map.json
    deliverables/se-unmatched.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STORY_DIR = ROOT / "resources" / "story"
SE_INDEX = ROOT / "data" / "se_index.json"
OUT = ROOT / "data" / "se_map.json"
CSV_OUT = ROOT / "deliverables" / "se-unmatched.csv"

PREFIX = re.compile(r"^(se_|sfx_|fx_)", re.I)
TRAILING_NUM = re.compile(r"[_\-]?\d+$")


def norm(name: str) -> str:
    s = PREFIX.sub("", name)
    s = TRAILING_NUM.sub("", s)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def edit_distance(a: str, b: str, limit: int = 3) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def collect_story_se() -> Counter:
    ids: Counter = Counter()
    if not STORY_DIR.is_dir():
        return ids
    for p in STORY_DIR.rglob("*.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        for node in data.get("nodes") or []:
            if node.get("op") == "se":
                sid = node.get("id") or node.get("name")
                if sid:
                    ids[str(sid)] += 1
    return ids


def main() -> None:
    ap = argparse.ArgumentParser(description="SE 名字映射")
    ap.add_argument("--story", default=str(STORY_DIR))
    ap.add_argument("--index", default=str(SE_INDEX))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    if not Path(args.index).exists():
        print("缺 data/se_index.json，先跑 tools/fetch/extract_local_se.py")
        return
    targets = list((json.loads(Path(args.index).read_text(encoding="utf-8")).get("files") or {}).keys())
    if not targets:
        print("se_index 是空的")
        return

    by_norm = {}
    for t in targets:
        by_norm.setdefault(norm(t), t)

    story_ids = collect_story_se()
    print(f"剧情里 {len(story_ids)} 个不同的 SE 名字，目标库 {len(targets)} 个文件")

    mapping: dict[str, dict] = {}
    unmatched: list[dict] = []
    for sid, count in story_ids.most_common():
        key = norm(sid)
        if key in by_norm:
            mapping[sid] = {"target": by_norm[key], "confidence": "high", "used": count}
            continue
        best, best_d = None, 99
        for k, t in by_norm.items():
            d = edit_distance(key, k, 2)
            if d < best_d:
                best, best_d = t, d
        if best and best_d <= 2:
            mapping[sid] = {"target": best, "confidence": "medium", "used": count, "distance": best_d}
        else:
            unmatched.append({"se": sid, "used": count})

    Path(args.out).write_text(
        json.dumps(
            {
                "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                "rule": "strip SE_/SFX_/FX_ prefix + trailing digits, lowercase; exact=high, editdist<=2=medium",
                "total_story_se": len(story_ids),
                "matched": len(mapping),
                "map": mapping,
                "unmatched": unmatched,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    with CSV_OUT.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["se_name", "used_in_story", "suggestion"])
        for u in unmatched:
            w.writerow([u["se"], u["used"], ""])

    hi = sum(1 for v in mapping.values() if v["confidence"] == "high")
    mid = len(mapping) - hi
    print(f"high {hi} / medium {mid} / 未匹配 {len(unmatched)}")
    print(f"✓ {Path(args.out).relative_to(ROOT)}")
    print(f"✓ {CSV_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
