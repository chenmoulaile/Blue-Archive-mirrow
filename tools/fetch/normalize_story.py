#!/usr/bin/env python3
"""
剧情节点 JSON 归一化

抓取过程中先后用过两版解析器：早期版本每个节点带一份 raw 原始字段、选项标记写成 reply，
后来的版本改成 choice 且不再带 raw。本脚本把所有文件统一成同一套 schema：

    background  {op, bg}
    bgm         {op, id, name, volume}
    bgmStop     {op}
    se          {op, id, name}
    script      {op, speaker, text, spine, sequence, affiliation}
    info        {op, text}
    choice      {op, group}
    其它        {op, ...该类型的非序号字段}

顺便去掉冗余的 raw，文件体积能小一半以上。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STORY = ROOT / "resources" / "story"

KEEP = {
    "background": ["bg"],
    "bgm": ["id", "name", "volume"],
    "bgmStop": [],
    "se": ["id", "name"],
    "script": ["speaker", "text", "spine", "sequence", "affiliation"],
    "info": ["text"],
    "choice": ["group"],
}


def norm_node(n: dict) -> dict:
    op = n.get("op") or "unknown"
    if op == "reply":  # 旧版写法
        op = "choice"
    src = n.get("raw") or n
    if op in KEEP:
        out = {"op": op}
        for k in KEEP[op]:
            v = n.get(k, src.get(k))
            if v not in (None, ""):
                out[k] = v
        # bgm 的 id 字段在旧版里可能落在 bgm 键上
        if op == "bgm" and "id" not in out and src.get("bgm"):
            out["id"] = src["bgm"]
        return out
    # 未知类型：保留除 index/type/raw 外的全部字段，便于后续补解析
    out = {"op": op}
    for k, v in src.items():
        if k in ("index", "type", "raw") or v in (None, ""):
            continue
        out[k] = v
    return out


def main() -> None:
    files = list(STORY.rglob("*.json"))
    changed = 0
    before = after = 0
    empty = 0
    for f in files:
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        nodes = rec.get("nodes") or []
        before += f.stat().st_size
        rec["nodes"] = [norm_node(n) for n in nodes]
        if not rec["nodes"]:
            empty += 1
        txt = json.dumps(rec, ensure_ascii=False, indent=1)
        f.write_text(txt, encoding="utf-8")
        after += len(txt.encode("utf-8"))
        changed += 1
    print(f"归一化 {changed} 个文件，{before/1e6:.1f}MB -> {after/1e6:.1f}MB，空集 {empty}")


if __name__ == "__main__":
    main()
