#!/usr/bin/env python3
"""ExcelDB 决策用中间产物：解析剧情/家具相关表 -> .scratch/exceldb/dump/*.json。

slot 映射取自 arisu-archive/plana-flatbuffers .schema/excel/*.fbs（Global/JP 当前版），
实测校验过的字段在 SCHEMAS 注明。输出不包含 key。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fb_reader import table_of  # noqa: E402

import sqlite3  # noqa: E402

DB = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
OUT = Path(r"D:/Bluearchive/.scratch/exceldb/dump")
OUT.mkdir(exist_ok=True)

SCEN_SCRIPT = [
    (i, n, t) for i, (n, t) in enumerate([
        ("group_id", "q"), ("selection_group", "q"), ("bgm_id", "q"), ("sound", "s"),
        ("transition", "I"), ("bg_name", "I"), ("bg_effect", "I"), ("popup_file_name", "s"),
        ("script_kr", "s"), ("text_jp", "s"), ("text_th", "s"), ("text_tw", "s"),
        ("text_en", "s"), ("voice_id", "I"), ("teen_mode", "b"),
    ])
]
SCENARIO_MODE = [
    (i, n, t) for i, (n, t) in enumerate([
        ("mode_id", "q"), ("mode_type", "b"), ("sub_type", "b"), ("display_volume_id", "s"),
        ("volume_id", "q"), ("chapter_id", "q"), ("episode_id", "q"), ("exposed_time", "s"),
        ("hide", "b"), ("open", "b"), ("is_continue", "b"), ("episode_continue_mode_id", "q"),
        ("front_scenario_group_id", "Vq"), ("strategy_id", "q"), ("ground_id", "q"),
        ("event_content_id", "q"), ("map_difficulty", "b"), ("recommend_level", "i"),
        ("collection_group_id", "q"),
    ])
]
BG_NAME = [
    (i, n, t) for i, (n, t) in enumerate([
        ("name", "I"), ("production_step", "b"), ("bg_file_name", "s"),
        ("bg_type", "b"), ("animation_root", "s"), ("animation_name", "s"),
    ])
]
BGM = [
    (0, "id", "q"), (2, "path", "Vs"),
]
CHAR_NAME = [
    (0, "character_name", "I"), (2, "name_kr", "s"), (4, "name_jp", "s"),
    (6, "name_th", "s"), (8, "name_tw", "s"), (10, "name_en", "s"),
    (13, "spine_prefab_name", "s"), (14, "small_portrait", "s"),
]
CONTENTS_SCENARIO = [
    (i, n, t) for i, (n, t) in enumerate([
        ("id", "I"), ("localize_id", "I"), ("display_order", "i"),
        ("scenario_content_type", "b"), ("scenario_group_id", "Vq"),
    ])
]
EVENT_SCENARIO = [
    (i, n, t) for i, (n, t) in enumerate([
        ("id", "q"), ("event_content_id", "q"), ("order", "q"), ("recollection_number", "q"),
        ("is_recollection", "b"), ("scenario_group_id", "Vq"), ("cleared_scenario_group_id", "q"),
    ])
]
FURNITURE = [
    # 显式 slot 序（fbs 含 check_floor_decoration 占 slot5，实测 prefab=16/icon=9/tier=8/comfort=24 对）
    (0, "id", "q"), (1, "production_step", "b"), (2, "rarity", "b"), (3, "category", "b"),
    (4, "sub_category", "b"), (6, "localize_etc_id", "I"), (8, "tier", "q"), (9, "icon", "s"),
    (10, "size_width", "i"), (11, "size_height", "i"), (16, "prefab", "s"),
    (21, "stackable_max", "q"), (23, "set_groudp_id", "q"), (24, "comfort_bonus", "q"),
]


def read_table(con, tbl, key_col, schema):
    """schema 元素为 (slot, name, typ)；Vq/Vs 为标量/字符串向量。"""
    rows = []
    for k, b in con.execute(f'SELECT "{key_col}", Bytes FROM "{tbl}" ORDER BY "{key_col}"'):
        t = table_of(b)
        rec = {key_col: k}
        for slot, name, typ in schema:
            try:
                if typ == "s":
                    rec[name] = t.string(slot)
                elif typ == "Vq":
                    rec[name] = t.vector(slot, "q")
                elif typ == "Vs":
                    rec[name] = t.string_vector(slot)
                else:
                    rec[name] = t.scalar(slot, typ)
            except Exception as e:
                rec[name] = f"<ERR {e}>"
        rows.append(rec)
    return rows


def main() -> None:
    con = sqlite3.connect(str(DB))
    jobs = [
        ("ScenarioScriptDBSchema", "GroupId", SCEN_SCRIPT, "scenario_script.json"),
        ("ScenarioModeDBSchema", "ModeId", SCENARIO_MODE, "scenario_mode.json"),
        ("ScenarioBGNameDBSchema", "Name", BG_NAME, "bg_name.json"),
        ("BGMDBSchema", "Id", BGM, "bgm.json"),
        ("ScenarioCharacterNameDBSchema", "CharacterName", CHAR_NAME, "character_name.json"),
        ("ContentsScenarioDBSchema", "Id", CONTENTS_SCENARIO, "contents_scenario.json"),
        ("EventContentScenarioDBSchema", "Id", EVENT_SCENARIO, "event_scenario.json"),
        ("FurnitureDBSchema", "Id", FURNITURE, "furniture.json"),
    ]
    for tbl, key, schema, out in jobs:
        rows = read_table(con, tbl, key, schema)
        (OUT / out).write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
        err = sum(1 for r in rows for v in r.values() if isinstance(v, str) and v.startswith("<ERR"))
        print(f"{tbl}: {len(rows)} rows err_fields={err} -> dump/{out}")


if __name__ == "__main__":
    main()
