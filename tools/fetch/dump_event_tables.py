#!/usr/bin/env python3
"""重 dump 活动两表（字段序取 arisu-archive/plana-flatbuffers .schema/excel，2026-11 实测拉取）：
  EventContentScenarioDBSchema -> dump/event_scenario2.json  (984 行)
  EventContentSeasonDBSchema   -> dump/event_season2.json    (516 行)
旧 dump/event_scenario.json 的 slot 序与当前版不符（recollection_number 读成 2^56），弃用。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fb_reader import table_of  # noqa: E402
import sqlite3  # noqa: E402

DB = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
OUT = Path(r"D:/Bluearchive/.scratch/exceldb/dump")

EVENT_SCENARIO = [
    (0, "id", "q"), (1, "event_content_id", "q"), (2, "return_scenario_play", "b"),
    (3, "replay_display_group", "i"), (4, "order", "q"), (5, "recollection_number", "q"),
    (6, "is_recollection", "b"), (7, "is_meetup", "b"), (8, "is_omnibus", "b"),
    (9, "scenario_group_id", "Vq"), (10, "scenario_condition_type", "i"),
    (11, "condition_amount", "q"), (12, "condition_event_content_id", "q"),
    (13, "cleared_scenario_group_id", "q"), (14, "recollection_summary_localize_scenario_id", "I"),
    (15, "recollection_resource", "s"),
]
EVENT_SEASON = [
    (0, "event_content_id", "q"), (1, "original_event_content_id", "q"), (2, "is_return", "b"),
    (3, "name", "s"), (4, "event_content_type", "i"), (5, "open_condition_content", "i"),
    (6, "event_campaign_stage_id", "Vq"), (7, "scenario_mode_id", "Vq"),
    (8, "scenario_group_id", "Vq"), (9, "event_display", "b"), (10, "icon_order", "i"),
    (11, "sub_event_type", "i"), (12, "sub_event", "b"), (13, "event_item_id", "q"),
    (14, "main_event_id", "q"), (15, "event_change_open_condition", "q"),
    (16, "beforehand_exposed_time", "s"), (17, "event_content_open_time", "s"),
    (18, "event_content_close_note_time", "s"), (19, "event_content_close_time", "s"),
    (20, "extension_time", "s"), (21, "main_icon_parcel_path", "s"),
    (22, "sub_icon_parcel_path", "s"), (23, "beforehand_bg_image_path", "s"),
    (24, "minigame_prolog_scenario_group_id", "q"), (25, "beforehand_scenario_group_id", "Vq"),
]


def read_table(con, sql, schema):
    rows = []
    for k, b in con.execute(sql):
        t = table_of(b)
        rec = {"_key": k}
        for slot, name, typ in schema:
            try:
                if typ == "s":
                    rec[name] = t.string(slot)
                elif typ == "Vq":
                    rec[name] = t.vector(slot, "q")
                elif typ == "b":
                    rec[name] = t.scalar(slot, "b")
                elif typ == "i":
                    rec[name] = t.scalar(slot, "i")
                elif typ == "I":
                    rec[name] = t.scalar(slot, "I")
                else:
                    rec[name] = t.scalar(slot, "q")
            except Exception as e:
                rec[name] = f"<ERR {e}>"
        rows.append(rec)
    return rows


def main() -> None:
    con = sqlite3.connect(str(DB))
    jobs = [
        ("SELECT EventContentId, Bytes FROM EventContentScenarioDBSchema", EVENT_SCENARIO, "event_scenario2.json"),
        ("SELECT EventContentId, Bytes FROM EventContentSeasonDBSchema", EVENT_SEASON, "event_season2.json"),
    ]
    for sql, schema, out in jobs:
        rows = read_table(con, sql, schema)
        err = sum(1 for r in rows for v in r.values() if isinstance(v, str) and v.startswith("<ERR"))
        (OUT / out).write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
        print(f"{out}: {len(rows)} rows err={err}")


if __name__ == "__main__":
    main()
