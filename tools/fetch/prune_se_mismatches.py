#!/usr/bin/env python3
"""
se_map medium 级误配剔除：把人工判定为语义误配的 medium 条目从 data/se_map.json
移除，并同步追加到 deliverables/se-unmatched.csv（suggestion 列注明剔除原因与原目标）。

判定（实测 2026-11-07，7/7 全为编辑距离≤2 的巧合，无语义关联）：
  SE_Cartoon_01/02 -> SE_CarHorn_01  卡通滑稽音效 != 汽车喇叭
  SE_Radio_01      -> SE_Rain_01     收音机 != 雨声
  SE_Beep_01/02    -> SE_Bear_01     电子哔声 != 熊吼
  SE_Work_01       -> SE_Book_01     工作/劳动 != 翻书
  SE_Whale_01      -> SE_Shake_01    鲸/汽笛 != 摇晃
源名在本地 resources/se 无对应文件（Cartoon/Radio/Whale 零命中，Beep 仅
BeepScreen，Work 仅 FireWorks）——属于游戏引用了未随客户端分发的 SE。

用法：python tools/fetch/prune_se_mismatches.py [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SE_MAP = REPO / "data" / "se_map.json"
CSV_PATH = REPO / "deliverables" / "se-unmatched.csv"

# 人工判定：误配剔除（源名 -> 原误配目标）
MISMATCH = {
    "SE_Cartoon_01": "SE_CarHorn_01",
    "SE_Cartoon_02": "SE_CarHorn_01",
    "SE_Radio_01": "SE_Rain_01",
    "SE_Beep_01": "SE_Bear_01",
    "SE_Beep_02": "SE_Bear_01",
    "SE_Work_01": "SE_Book_01",
    "SE_Whale_01": "SE_Shake_01",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sm = json.loads(SE_MAP.read_text(encoding="utf-8"))
    m = sm["map"]
    removed = []
    for name, wrong in MISMATCH.items():
        e = m.get(name)
        if not e:
            print(f"skip {name}: not in se_map")
            continue
        assert e.get("confidence") == "medium", (name, e)
        assert e.get("target") == wrong, (name, e)
        removed.append((name, e["used"], wrong))
        del m[name]
    sm["matched"] = len(m)
    print(f"剔除 {len(removed)} 项: matched {sm['matched']} + {len(removed)} -> 全表 {sm['total_story_se']}")

    # CSV 同步：BOM 存在则保留（现文件带 BOM）
    raw = CSV_PATH.read_bytes()
    has_bom = raw[:3] == b"\xef\xbb\xbf"
    rows = list(csv.reader(raw.decode("utf-8-sig").splitlines()))
    header, body = rows[0], rows[1:]
    have = {r[0] for r in body}
    added = []
    for name, used, wrong in sorted(removed):
        if name in have:
            print(f"csv already has {name}")
            continue
        body.append([name, str(used), f"removed medium mismatch (editdist<=2 to {wrong}; 语义无关)"])
        added.append(name)
    body.sort(key=lambda r: r[0])
    print(f"csv 追加 {len(added)} 行: {added}")

    if args.dry_run:
        print("dry-run: 未写入")
        return 0
    SE_MAP.write_text(json.dumps(sm, ensure_ascii=False, indent=1), encoding="utf-8")
    text = "se_name,used_in_story,suggestion\n" + "\n".join(",".join(r) for r in body) + "\n"
    CSV_PATH.write_bytes((b"\xef\xbb\xbf" if has_bom else b"") + text.encode("utf-8"))
    print(f"written: {SE_MAP}")
    print(f"written: {CSV_PATH} (BOM 保持原样: {has_bom})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
