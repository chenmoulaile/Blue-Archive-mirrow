#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
reclass_story_index.py — story_index main 段重分类为 event（2026-11-09 走查④）

实证链（历轮走查 + 本轮 node 复核）：
  * story_index.json 的 type=main 段（820 条，id 空间 10000000~10054120 / 11034010…）
    被 ExcelDB EventContentScenario 引用，是活动剧情错分类——见
    tools/fetch/build_main_story_map.py 头注与 src/pages/StoryPage.tsx:40。
  * 真主线在 data/main_story_map.json（8 卷 Vol.0~7，episode id 空间 11000 系列，
    来源 ScenarioModeDBSchema ModeType=1）。两套 id 空间零交集（本轮实测
    main_story_map 原文无 1xxxxxxxx 8 位 id），前端主线 tab 已自愈走 main_story_map
    卷章视图，不依赖 story_index 的 main 段。
  * 814/820 条 main 自带 events 字段（eventId 854/836/848… = EventContentScenario
    引用的活动归属）；与 event_story_map.json（近期 5 活动 142 章，storyId
    80000001+）的 eventId 交集实测 {810, 834}，storyId 交集 0 条。

做法：
  1. 收集 main_story_map 卷结构内全部 episode id + groups → 「真主线 id 集合」；
  2. type=main 且 id 不在集合 → type=event（events 字段原样保留）；
  3. 重分类后若 id 能对上 event_story_map 的章节 storyId 且无 events 字段，
     补 events=[{eventId, order}]（当前库内 0 条命中，逻辑保留给数据更新）；
  4. 备份原文件为同目录 story_index.json.bak-<日期>（已存在则不覆盖），
     落盘保持原格式（1 空格缩进、ensure_ascii=False、无 BOM）。
  5. 主线 tab / event_story_map 分组视图不受影响（见 StoryPage eventSections）。

用法： D:/Bluearchive/.venv/Scripts/python.exe -I tools/fetch/reclass_story_index.py
"""
import json
import shutil
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SI_PATH = REPO / "data" / "story_index.json"
MSM_PATH = REPO / "data" / "main_story_map.json"
ESM_PATH = REPO / "data" / "event_story_map.json"


def collect_main_ids(raw: str) -> set[str]:
    """main_story_map 卷结构内的全部 id（episode id + groups，统一字符串）"""
    msm = json.loads(raw)
    ids: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for key in ("id", "groups"):
                v = node.get(key)
                if v is None:
                    continue
                if key == "id":
                    ids.add(str(v))
                else:
                    ids.update(str(g) for g in v)
            for child in node.get("chapters") or []:
                walk(child)
            for child in node.get("episodes") or []:
                walk(child)

    if isinstance(msm, list):
        for vol in msm:
            walk(vol)
    else:
        for vol in msm.values():
            walk(vol)
    return ids


def collect_event_index(raw: str) -> dict[str, list[dict]]:
    """event_story_map 章节 storyId → [{eventId, order}]"""
    esm = json.loads(raw)
    idx: dict[str, list[dict]] = {}
    for ev in esm.get("events", []):
        for ch in ev.get("chapters", []):
            sid = str(ch.get("storyId", ""))
            if sid:
                idx.setdefault(sid, []).append(
                    {"eventId": ev.get("eventId"), "order": ch.get("order")}
                )
    return idx


def main() -> int:
    raw = SI_PATH.read_bytes()
    had_bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    entries = json.loads(text)

    main_ids = collect_main_ids(MSM_PATH.read_text(encoding="utf-8"))
    event_idx = collect_event_index(ESM_PATH.read_text(encoding="utf-8"))

    reclassed = 0
    kept_main = 0
    backfilled = 0
    for e in entries:
        if e.get("type") != "main":
            continue
        if str(e.get("id")) in main_ids:
            kept_main += 1
            continue
        e["type"] = "event"
        reclassed += 1
        evs = e.get("events")
        if not evs:
            hit = event_idx.get(str(e.get("id")))
            if hit:
                e["events"] = hit
                backfilled += 1

    # 备份（只备一次，防重复跑覆盖最初状态）
    backup = SI_PATH.with_suffix(f".json.bak-{date.today().isoformat()}")
    if not backup.exists():
        shutil.copyfile(SI_PATH, backup)

    out = json.dumps(entries, ensure_ascii=False, indent=1)
    SI_PATH.write_bytes(out.encode("utf-8"))  # JSON 无 BOM（保持原样）

    from collections import Counter

    buckets = Counter(e["type"] for e in entries)
    print(f"story_index 共 {len(entries)} 条，重分类前 main 段 {reclassed + kept_main} 条")
    print(f"  保留 main（id ∈ main_story_map 卷结构）: {kept_main}")
    print(f"  重分类 main → event                    : {reclassed}")
    print(f"  补 event_story_map 归属（无 events 字段）: {backfilled}")
    print(f"重分类后分布: {dict(sorted(buckets.items()))}")
    print(f"备份: {backup.name}  原文件 BOM: {'有' if had_bom else '无'}（写回无 BOM）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
