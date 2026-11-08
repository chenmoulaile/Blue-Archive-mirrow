#!/usr/bin/env python3
"""主线剧情 卷→章→集 映射构建（2026-11-08 剧情分类还原轨）。

数据实证（本轨勘察结论，见 TrackResult）：
  1. story_index.json 的 main 820 集（1e6 桶 10=794 组 + 11=26 组）被
     EventContentScenarioDBSchema（slot9 ScenarioGroupId，shittim fbs 实测解码）
     的 819 个去重引用 + 1 个游离组 10000000 全量覆盖 —— 它们是【活动剧情】，
     不是主线卷章结构；此前把它当 main 是错分类（用户痛点"主线分类不对"的根因）。
  2. 真正的主线分卷/分章在 ScenarioModeDBSchema（ModeType=1 Main），
     VolumeId/ChapterId/EpisodeId + FrontScenarioGroupId/BackScenarioGroupId
     指向 ScenarioScriptDBSchema 的"遗留 5/6 位组 id"空间（1e6 桶 0），
     如 11010=Vol.1 第1話"歡迎來到對策委員會！"、101130=Vol.F 第13話"S.C.H.夏萊奪還作戰"。
     注意 .scratch/exceldb/dump/scenario_mode.json 是旧 slot 序的坏 dump
     （front 向量 <ERR>），本脚本按 BlueArchive_shittim.fbs 的 slot 直读 DB。
  3. 卷名（简中）：Vol.1 对策委员会篇 / Vol.2 发条花的帕凡舞曲篇 / Vol.3 伊甸园条约篇 /
     Vol.4 卡班诺的兔子篇 / Vol.5 百花缭乱篇 / Vol.6 奥利斯分校篇 / Vol.F 最终篇，
     与各卷首话标题实测互证（对策委员会/千年大赏/三一的叛徒/狐穴/花開/憎恨/夏萊奪還）。

输出：
  resources/story/main/episode/<mode_id>.json   每集合并 front+back 组的可播剧本
  data/main_story_map.json                      [{volume,label,name,chapters:[{chapter,name,episodes:[…]}]}]
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fb_reader import table_of  # noqa: E402
from extract_story_branches import DUMP, ExcelConverter  # noqa: E402  分支感知版转换（options+branch）

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(r"D:/Bluearchive/repo")
DB = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
OUT_MAP = ROOT / "data" / "main_story_map.json"
OUT_EPISODE = ROOT / "resources" / "story" / "main" / "episode"

# 卷名（来源与互证见文件头注释；nameEn 仅 Steam 截图可证的三卷 + Final，不杜撰）
VOLUME_NAMES: dict[int, dict[str, str]] = {
    0: {"label": "Vol.0", "name": "序章", "nameEn": "Prologue"},
    1: {"label": "Vol.1", "name": "对策委员会篇", "nameEn": "Foreclosure Task Force"},
    2: {"label": "Vol.2", "name": "发条花的帕凡舞曲篇", "nameEn": "Clockwork Flower Pavane"},
    3: {"label": "Vol.3", "name": "伊甸园条约篇", "nameEn": "Eden Treaty"},
    4: {"label": "Vol.4", "name": "卡班诺的兔子篇"},
    5: {"label": "Vol.5", "name": "百花缭乱篇"},
    6: {"label": "Vol.6", "name": "奥利斯分校篇"},
    100: {"label": "Vol.F", "name": "最终篇", "nameEn": "Final"},
}

# ScenarioModeExcel slot 序 = BlueArchive_shittim.fbs 实测（dump 旧序 front 向量 <ERR>）
MODE_FIELDS = [
    (0, "mode_id", "q"), (1, "mode_type", "b"), (2, "sub_type", "b"),
    (3, "display_volume_id", "s"), (4, "volume_id", "q"), (5, "chapter_id", "q"),
    (6, "episode_id", "q"), (8, "hide", "b"), (9, "open", "b"),
    (12, "is_continue", "b"), (14, "front", "Vq"), (20, "back", "Vq"),
]


def read_modes(con: sqlite3.Connection) -> list[dict]:
    rows = []
    for key, blob in con.execute("SELECT ModeId, Bytes FROM ScenarioModeDBSchema ORDER BY ModeId"):
        t = table_of(blob)
        rec = {"mode_id": key}
        for slot, name, typ in MODE_FIELDS:
            rec[name] = t.string(slot) if typ == "s" else (
                t.vector(slot, "q") if typ == "Vq" else t.scalar(slot, typ))
        rows.append(rec)
    return rows


def series_title(titles: list[str]) -> str:
    """Series2（副篇系列，ScenarioModeSubTypes Series2=3）的系列名：取集标题去掉
    「第N话;」前缀后的公共部分（如 首席行政官的假日）。推导不出返回空串。"""
    from collections import Counter

    tails = []
    for t in titles:
        tail = t.split(";", 1)[1].strip() if ";" in t else ""
        if tail:
            tails.append(tail)
    if not tails:
        return ""
    top, n = Counter(tails).most_common(1)[0]
    return top if n >= max(1, len(tails) // 2) else top


def main() -> None:
    conv = ExcelConverter(DUMP)  # scenario_script.json + bg/bgm/说话人映射（分支感知，同 extract_story_branches）
    con = sqlite3.connect(str(DB))
    modes = read_modes(con)
    mains = [m for m in modes if m["mode_type"] == 1]
    print(f"ScenarioMode main 集：{len(mains)}（mode_type=1）")

    OUT_EPISODE.mkdir(parents=True, exist_ok=True)
    volumes: dict[int, dict[int, list[dict]]] = {}
    missing_groups: list[int] = []
    empty_titles = 0

    for m in sorted(mains, key=lambda r: (r["volume_id"], r["chapter_id"], r["episode_id"])):
        vol, chap, ep = m["volume_id"], m["chapter_id"], m["episode_id"]
        groups = [g for g in (m["front"] or [])] + [g for g in (m["back"] or [])]
        if not groups:
            print(f"  警告 mode {m['mode_id']} 无 scenario group，跳过")
            continue
        nodes: list[dict] = []
        title = ""
        for gid in groups:
            if gid not in conv.groups:
                missing_groups.append(gid)
                continue
            rec, _ = conv.convert_group(gid, "main")
            for n in rec["nodes"]:
                if n.get("op") in ("script", "info") and isinstance(n.get("text"), str):
                    t = n["text"].replace("#n", "\n")
                    # 部分行 text_tw 把原行格式 'N;说话人;seq;正文' 原样带回（源数据带前缀，
                    # 实测 11060「3;茜香;13;怎么办…」），剥掉前缀才是正文
                    t = re.sub(r"^\d+;[^;]*;\d{1,3};", "", t)
                    n["text"] = t
            nodes.extend(rec["nodes"])
            # 转换器兜底会把无 #title 的组标题置成 str(gid)（如 Vol.0 序章），视为空
            t = rec["title"]
            if not title and t and t != str(gid):
                title = t
        if not title:
            empty_titles += 1
        lines = sum(1 for n in nodes if n.get("op") == "script")
        chars: list[str] = []
        for n in nodes:
            if n.get("op") == "script" and n.get("speaker") not in chars:
                chars.append(n["speaker"])
        story_id = str(m["mode_id"])
        rec_out = {
            "story_id": story_id,
            "type": "main",
            "title": title,
            "summary": "",
            "source_url": "ExcelDB.db ScenarioModeDBSchema(ModeType=1) front+back groups (Steam global, decrypted)",
            "nodes": nodes,
        }
        (OUT_EPISODE / f"{m['mode_id']}.json").write_text(
            json.dumps(rec_out, ensure_ascii=False, indent=1), encoding="utf-8")
        volumes.setdefault(vol, {}).setdefault((m["sub_type"], chap), []).append({
            "id": story_id,
            "episode": ep,
            "title": title,
            "path": f"/res/story/main/episode/{m['mode_id']}.json",
            "lines": lines,
            "groups": groups,
            "chars": chars,
        })

    out: list[dict] = []
    for vol in sorted(volumes):
        meta = VOLUME_NAMES.get(vol, {"label": f"Vol.{vol}", "name": f"Vol.{vol}"})
        chapters = []
        for (sub_type, chap) in sorted(volumes[vol]):
            eps = sorted(volumes[vol][(sub_type, chap)], key=lambda e: (e["episode"], e["id"]))
            first, last = eps[0]["episode"], eps[-1]["episode"]
            rng = f"第{first}-{last}話" if first != last else f"第{first}話"
            if sub_type == 2 or (vol == 0 and sub_type == 0):  # Series1=正篇；Vol.0 序章 sub_type=None 仍按正篇
                chapters.append({
                    "chapter": chap, "name": f"第{chap}章", "range": rng, "episodes": eps,
                })
            else:  # Series2 = 卷内副篇系列（如 Vol.1「首席行政官的假日」），系列名取自集标题
                chapters.append({
                    "chapter": chap,
                    "name": series_title([e["title"] for e in eps]) or f"第{chap}章",
                    "range": rng,
                    "side": True,
                    "episodes": eps,
                })
        out.append({
            "volume": vol,
            "label": meta["label"],
            "name": meta["name"],
            **({"nameEn": meta["nameEn"]} if "nameEn" in meta else {}),
            "chapters": chapters,
        })

    OUT_MAP.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    total_eps = sum(len(c["episodes"]) for v in out for c in v["chapters"])
    print(f"卷数：{len(out)}（{[v['label'] for v in out]}）")
    for v in out:
        eps = sum(len(c["episodes"]) for c in v["chapters"])
        print(f"  {v['label']} {v['name']}: {len(v['chapters'])} 章 {eps} 集")
    print(f"总集数：{total_eps}；缺组：{missing_groups}；空标题：{empty_titles}")
    zero = [e["id"] for v in out for c in v["chapters"] for e in c["episodes"] if e["lines"] == 0]
    print(f"0 句集（UI 不可播，列出不写入 map 之外的额外处理）：{len(zero)} {zero[:10]}")


if __name__ == "__main__":
    main()
