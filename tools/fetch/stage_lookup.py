#!/usr/bin/env python3
"""剧情演出层映射构建（S-1/S-2/S-3/S-4 数据轨，2026-11-10）。

从 ExcelDB_decrypted.db 直读四张表（BlueArchive.fbs slot 序，fb_reader 解析）：

  VoiceExcel (sqlite 表 VoiceDBSchema, 28329 行)
      slot0 UniqueId:long  slot1 Id:uint  slot2 Nation_:int[]  slot3 Path:string[]  slot4 Volume:float[]
      Nation: JP=2, KR=4（enum Nation 实测 BlueArchive.fbs:1658）
      → {Id: {"jp": "Audio/VOC_JP/JP_Main/Main_11000_001", "kr": "Audio/VOC_KR/KR_Main/11/Main_11000_001"}}
      实测 ScenarioScript.voice_id ∩ VoiceDBSchema.Id = 17569/17600 唯一值（probe5/probe6）

  ScenarioTransitionExcel (75 行)
      slot0 Name  slot1 TransitionOut  slot2 TransitionOutDuration  slot3 TransitionOutResource
      slot4 TransitionIn  slot5 TransitionInDuration  slot6 TransitionInResource
      In 类型实测分布：fade 17448 / bgoverlap 1283 / fade_white 1165 / 数字枚举 1..12 共 957
      → {Name: {"out","outDuration","outResource","in","inDuration","inResource"}}

  ScenarioBGEffectExcel (94 行)
      slot0 Name  slot1 Effect  slot2 Scroll(enum)
      Effect 名实测：BG_Dust_L / BG_Filter_Flashback_BG / BG_FocusLine / Shader_Gray / BG_Film_Grain …
      → {Name: {"effect","scroll"}}

  ScenarioEffectExcel (10 行)  slot0 效果名（Arona_Touch/P_Shot/…）→ {Name: effect}

用法：
    from stage_lookup import build_stage_maps
    maps = build_stage_maps(Path("D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db"))
    maps["voice"][1157998380]  -> {"jp": ..., "kr": ...}
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fb_reader import table_of  # noqa: E402

NATION_JP = 2
NATION_KR = 4


def build_voice_map(db: Path) -> dict[int, dict]:
    con = sqlite3.connect(str(db))
    out: dict[int, dict] = {}
    for key, blob in con.execute("SELECT Id, Bytes FROM VoiceDBSchema"):
        t = table_of(blob)
        nations = t.vector(2, "i")
        paths = t.string_vector(3)
        rec: dict = {}
        for n, p in zip(nations, paths):
            if not p:
                continue
            if n == NATION_JP:
                rec["jp"] = p
            elif n == NATION_KR:
                rec["kr"] = p
        if rec:
            out[int(key)] = rec
    con.close()
    return out


def build_transition_map(db: Path) -> dict[int, dict]:
    con = sqlite3.connect(str(db))
    out: dict[int, dict] = {}
    for key, blob in con.execute("SELECT Name, Bytes FROM ScenarioTransitionDBSchema"):
        t = table_of(blob)
        out[int(key)] = {
            "out": t.string(1) or "",
            "outDuration": t.scalar(2, "q"),
            "outResource": t.string(3) or "",
            "in": t.string(4) or "",
            "inDuration": t.scalar(5, "q"),
            "inResource": t.string(6) or "",
        }
    con.close()
    return out


def build_bg_effect_map(db: Path) -> dict[int, dict]:
    con = sqlite3.connect(str(db))
    out: dict[int, dict] = {}
    for key, blob in con.execute("SELECT Name, Bytes FROM ScenarioBGEffectDBSchema"):
        t = table_of(blob)
        out[int(key)] = {"effect": t.string(1) or "", "scroll": t.scalar(2, "b")}
    con.close()
    return out


def build_effect_map(db: Path) -> dict[int, str]:
    con = sqlite3.connect(str(db))
    out: dict[int, str] = {}
    for key, blob in con.execute("SELECT Name, Bytes FROM ScenarioEffectDBSchema"):
        t = table_of(blob)
        out[int(key)] = t.string(0) or ""
    con.close()
    return out


def build_stage_maps(db: Path) -> dict:
    """返回 {"voice","transition","bgEffect","effect"} 四张映射；db 不存在时全空。"""
    if not Path(db).exists():
        return {"voice": {}, "transition": {}, "bgEffect": {}, "effect": {}}
    return {
        "voice": build_voice_map(db),
        "transition": build_transition_map(db),
        "bgEffect": build_bg_effect_map(db),
        "effect": build_effect_map(db),
    }


if __name__ == "__main__":
    import json

    sys.stdout.reconfigure(encoding="utf-8")
    DB = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
    maps = build_stage_maps(DB)
    print({k: len(v) for k, v in maps.items()})
    v = maps["voice"].get(1157998380)
    print("voice 1157998380 ->", json.dumps(v, ensure_ascii=False))
    tr = next(iter(maps["transition"].items()))
    print("transition sample ->", tr[0], json.dumps(tr[1], ensure_ascii=False))
    be = next(iter(maps["bgEffect"].items()))
    print("bgEffect sample ->", be[0], json.dumps(be[1], ensure_ascii=False))
