#!/usr/bin/env python3
"""
生成客户端用的精简数据（体积从 31MB 压到 1MB 级别）

  data/students_slim.json   学生精简信息 + 本地头像路径
  data/story_index.json     2479 集剧情索引（含文件路径、节点数、出场角色）
  data/banners.json         卡池整形（类型判定 + UP 角色解析）
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RES = ROOT / "resources"


def read(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def build_students() -> None:
    full = read(DATA / "students_full.json", []) or []
    spine_idx = {x["id"]: x for x in (read(DATA / "spine_index.json", []) or [])}
    out = []
    for s in full:
        avatar_rel = ""
        # 头像抓取时按 学生ID.png 命名
        cand = RES / "avatar" / f"{s['id']}.png"
        if cand.exists():
            avatar_rel = f"/res/avatar/{s['id']}.png"

        lobby_rel = ""
        lobby = (s.get("recollection_lobby_image") or "")
        if lobby:
            name = lobby.rsplit("/", 1)[-1]
            cand2 = RES / "lobby" / name
            if cand2.exists():
                lobby_rel = f"/res/lobby/{name}"

        # 解析出回忆大厅 / 立绘的模型名，界面直接按名字加载
        home_spine = ""
        spr_spine = ""
        for sid in s.get("spine") or []:
            meta = spine_idx.get(sid)
            if not meta:
                continue
            if meta["type"] == "home" and not home_spine:
                home_spine = meta["name"]
            elif meta["type"] == "spr" and not spr_spine:
                spr_spine = meta["name"]

        cds = s.get("character_datas") or []
        rarity = max([c.get("rarity") or 1 for c in cds], default=1)
        limited = any(bool(c.get("limited")) for c in cds)

        # 语音目录名与 fetch_voices.py 保持一致：姓名 + 可选皮肤后缀
        vdir = f"{s.get('family_name','')}{s.get('given_name','')}".strip()
        if s.get("skin"):
            vdir += f"_{s['skin']}"
        voices = []
        for v in s.get("voice") or []:
            if v.get("category") != "lobby":
                continue
            f = (v.get("file") or "").rsplit("/", 1)[-1]
            if f:
                voices.append(
                    {"file": f, "desc": v.get("description", ""), "path": f"/res/voice/{vdir}/{f}"}
                )

        out.append(
            {
                "id": s["id"],
                "name": f"{s.get('family_name','')}{s.get('given_name','')}".strip(),
                "name_en": f"{s.get('family_name_en','')} {s.get('given_name_en','')}".strip(),
                "given": s.get("given_name", ""),
                "given_en": s.get("given_name_en", ""),
                "skin": s.get("skin", ""),
                "avatar": avatar_rel,
                "lobby": lobby_rel,
                "spine": s.get("spine") or [],
                "home_spine": home_spine,
                "spr_spine": spr_spine,
                "voices": voices,
                "school": s.get("school"),
                "signature": s.get("momo_talk_signature", ""),
                "intro": (s.get("introduction_cn") or s.get("introduction") or "")[:400],
                "is_npc": bool(s.get("is_npc")),
                "birthday": s.get("birthday", ""),
                "rarity": rarity,
                "limited": limited,
            }
        )
    (DATA / "students_slim.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = (DATA / "students_slim.json").stat().st_size
    print(f"✓ students_slim {len(out)} 名 / {size/1024:.0f} KB（头像 {sum(1 for x in out if x['avatar'])} 个）")


def build_story_index() -> None:
    rows = []
    for f in sorted((RES / "story").rglob("*.json")):
        rec = read(f, {}) or {}
        nodes = rec.get("nodes") or []
        if not nodes:
            continue
        chars = Counter()
        for n in nodes:
            if n.get("op") == "script" and n.get("spine"):
                chars[n["spine"]] += 1
        rows.append(
            {
                "id": rec.get("story_id", f.stem),
                "type": rec.get("type", f.parent.name),
                "title": rec.get("title", f.stem),
                "summary": (rec.get("summary") or "")[:300],
                "path": "/res/story/" + str(f.relative_to(RES / "story")).replace("\\", "/"),
                "nodes": len(nodes),
                "lines": sum(1 for n in nodes if n.get("op") == "script"),
                "chars": [c for c, _ in chars.most_common(6)],
            }
        )
    rows.sort(key=lambda r: (r["type"], r["id"]))
    (DATA / "story_index.json").write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    by = Counter(r["type"] for r in rows)
    print(f"✓ story_index {len(rows)} 集 {dict(by)} / {(DATA/'story_index.json').stat().st_size/1024:.0f} KB")


UP_RE = re.compile(r'全新3★成员[“"「]?([^”"」，,、]{1,12})[”"」]?登场')
UP_RE2 = re.compile(r'([^，,。\s]{2,10})[（(]?全新[）)]?3★')


def classify(title: str, summary: str) -> str:
    t = title
    if "复刻" in t:
        return "rerun"
    if "限定" in t or "限时" in t:
        return "limited"
    if "FES" in t.upper() or "庆典" in t or "特别" in t:
        return "fes"
    if "新手" in t or "开局" in t:
        return "starter"
    return "normal"


def build_banners() -> None:
    raw = read(DATA / "gacha_banners.json", []) or []
    students = read(DATA / "students_slim.json", []) or []

    # 用已知学生名做匹配，比正则猜引号可靠得多（日服/国服/国际服措辞各不相同）
    names: list[tuple[str, str]] = []
    for s in students:
        for key in ("given", "given_en"):
            n = (s.get(key) or "").strip()
            if len(n) >= 2:
                names.append((n, s["name"]))
    # 长名字优先，避免「爱丽丝」被「爱丽」截断
    names.sort(key=lambda x: -len(x[0]))

    def find_up(text: str) -> str:
        if "★3" not in text and "3★" not in text and "三星" not in text:
            return ""
        for raw_name, full in names:
            if raw_name in text:
                return full or raw_name
        return ""

    rows = []
    for b in raw:
        summary = re.sub(r"\s+", " ", b.get("body_summary") or "")
        up = ""
        m = UP_RE.search(summary)
        if m:
            up = m.group(1).strip()
        if not up:
            up = find_up(summary)
        rows.append(
            {
                "id": b["id"],
                "server": b.get("line_type", "JP"),
                "title": b.get("title", ""),
                "type": classify(b.get("title", ""), summary),
                "up": up,
                "start": b.get("start_time", 0),
                "end": b.get("end_time", 0),
                "image": b.get("image", ""),
                "summary": summary[:300],
                "source_url": b.get("url", "") or "https://kivo.wiki/timeline",
            }
        )
    rows.sort(key=lambda r: r["start"])
    (DATA / "banners.json").write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    by = Counter(r["type"] for r in rows)
    print(f"✓ banners {len(rows)} 个 {dict(by)}，解析出 UP 角色 {sum(1 for r in rows if r['up'])} 个")


def localize_furniture() -> None:
    """把家具图标 URL 换成本地 /res/furniture/{id}.png"""
    rows = read(DATA / "furniture.json", []) or []
    n = 0
    for r in rows:
        if (RES / "furniture" / f"{r['id']}.png").exists():
            r["icon"] = f"/res/furniture/{r['id']}.png"
            n += 1
    (DATA / "furniture.json").write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"✓ 家具图标本地化 {n}/{len(rows)}")


if __name__ == "__main__":
    build_students()
    build_story_index()
    build_banners()
    localize_furniture()
