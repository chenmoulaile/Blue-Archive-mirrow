#!/usr/bin/env python3
"""MomoTalk 真实数据 -> data/momotalk/index.json + data/momotalk/<characterId>.json。

数据源（ExcelDB_decrypted.db，schema 对照 .scratch/story/stage/BlueArchive.fbs 6305-6440）：
  AcademyMessangerDBSchema    16105 条（一条一气泡；key=MessageGroupId 非唯一）
  AcademyFavorScheduleDBSchema 1120 条（好感度日程 -> 剧情触发 ScenarioSriptGroupId）
  CharacterDBSchema           slot36 = 小写开发者名（hina/aru/...）-> students_slim.home_spine 前缀

实测语义（Tools/fetch 会话抽样，见 DataSupplyResult）：
  MessageCondition: 0=None 1=FavorRankUp(ConditionValue=好感度等级) 2=AcademySchedule 3=Answer 4=Feedback
  MessageType:      1=Text 2=Image(ImagePath='UIs/03_Scenario/04_ScenarioImage/Mo_*')
  同一 MessageGroupId 内 Id 升序；连续的 cond=3 行 = 一次回复选项；
  cond=4 行 FeedbackTimeMillisec = 学生回信延迟；FavorScheduleId -> 剧情触发。
  NextGroupId 链到下一块；cond=1 行开启新解锁段。

输出 schema（data/momotalk/<characterId>.json）：
  { characterId, studentId, devName, name, avatar, messageCount, threads:[ {
      favorRank, messages:[ {kind:'text'|'image'|'answer', from, text, delayMs?,
                             image?, options?:[{text, feedbackDelayMs?, story?:{favorRank,scenarioGroup,path}}],
                             story?... } ] } ] }
简化：answer 选项的后续反馈合并进 option.feedback；story 触发挂在 option（真实游戏在回信后弹出剧情）。
无 BOM，json ensure_ascii=False。
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fb_reader import table_of  # noqa: E402
from extract_local_avatar import build_kivo_res  # noqa: E402  (CH0058 式 resname -> kivo id)

try:
    from opencc import OpenCC
    cc = OpenCC("t2s")
except Exception:  # pragma: no cover
    cc = None

DB = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "momotalk"

MSG_FIELDS = [
    "MessageGroupId", "Id", "CharacterId", "MessageCondition", "ConditionValue",
    "PreConditionGroupId", "PreConditionFavorScheduleId", "FavorScheduleId",
    "NextGroupId", "FeedbackTimeMillisec", "MessageType", "ImagePath",
    "MessageKR", "MessageJP", "MessageTH", "MessageTW", "MessageEN",
]
FS_FIELDS = [
    "Id", "CharacterId", "ScheduleGroupId", "OrderInGroup", "Location",
    "LocalizeScenarioId", "FavorRank", "SecretStoneAmount", "ScenarioSriptGroupId",
]


STR_SLOTS = {"ImagePath", "MessageKR", "MessageJP", "MessageTH", "MessageTW", "MessageEN"}
ENUM_SLOTS = {"MessageCondition", "MessageType"}


def read_row(t, fields):
    rec = {}
    for i, n in enumerate(fields):
        if n in STR_SLOTS:
            rec[n] = t.string(i)
        elif n in ENUM_SLOTS:
            rec[n] = t.scalar(i, "i")
        else:
            rec[n] = t.scalar(i, "q")
    return rec


# CharacterDBSchema slot36 读出的 devName 有错漏（实测）：
#   13009 'Tusbaki'(拼写错) 16014 'CH0077'(错位) 20004 'CH0061'(错位) 20058 'CH0076'(错位)
# 身份由各角色消息文本实证（椿/伊吹/一花/绘里香，见 DataSupplyResult），别名兜底：
ALIAS_DEV = {"tusbaki": "tsubaki", "ch0077": "ibuki", "ch0061": "ch0071", "ch0076": "erika"}
# 上列 devName 在 students_slim 的正确 home_spine 前缀 -> (studentId, name) 由下方 by_dev 匹配


def pick(rec) -> str:
    tw, en, jp, kr = rec["MessageTW"], rec["MessageEN"], rec["MessageJP"], rec["MessageKR"]
    if tw and cc:
        return cc.convert(tw).strip()
    if en:
        return en.strip()
    if jp:
        return jp.strip()
    return (kr or "").strip()


def story_path(gid: int) -> str:
    return f"/res/story/{gid}.json"


def main() -> None:
    con = sqlite3.connect(str(DB))

    # 消息按 (characterId, messageGroupId, id) 收
    msgs = []
    for (b,) in con.execute("SELECT Bytes FROM AcademyMessangerDBSchema"):
        t = table_of(b)
        r = read_row(t, MSG_FIELDS)
        msgs.append(r)
    print(f"AcademyMessangerDBSchema rows: {len(msgs)}")

    # FavorSchedule -> 剧情
    fs = {}
    for k, b in con.execute("SELECT Id, Bytes FROM AcademyFavorScheduleDBSchema"):
        t = table_of(b)
        r = read_row(t, FS_FIELDS)
        fs[r["Id"]] = r
    print(f"AcademyFavorScheduleDBSchema rows: {len(fs)}")

    # characterId -> devname（CharacterDBSchema slot36）
    dev = {}
    for k, b in con.execute("SELECT Id, Bytes FROM CharacterDBSchema"):
        try:
            s = table_of(b).string(36)
        except Exception:
            s = None
        if s:
            dev[k] = s
    print(f"CharacterDBSchema devnames: {len(dev)}")

    # students_slim：devname -> slim 条目（'ako' <- 'ako_home'）
    slim = json.loads((REPO / "data" / "students_slim.json").read_text(encoding="utf-8"))
    by_dev = {}
    for s in slim:
        hs = s.get("home_spine") or ""
        if hs.endswith("_home"):
            by_dev.setdefault(hs[: -len("_home")].lower(), s)
    kivo_res = build_kivo_res()

    def resolve_student(cid: int, dname: str):
        """characterId+devname -> students_slim 条目（实测映射链见 DataSupplyResult）。"""
        dl = (dname or "").lower()
        dl = ALIAS_DEV.get(dl, dl)
        if not dl:
            return None
        if dl in by_dev:
            return by_dev[dl]
        if re.match(r"^ch\d+$", dl):
            kid = kivo_res.get(dl)
            if kid is not None:
                return next((x for x in slim if x["id"] == kid), None)
        base = dl.split("_")[0]
        if base in by_dev:
            return by_dev[base]
        return None

    by_char: dict[int, list[dict]] = defaultdict(list)
    dropped = 0
    for r in msgs:
        if not r["CharacterId"]:
            dropped += 1  # 实测 CharacterId=0 的 120 行 MessageKR 全空，是占位行
            continue
        by_char[r["CharacterId"]].append(r)
    print(f"dropped placeholder rows (CharacterId=0, MessageKR empty): {dropped}")

    OUT.mkdir(parents=True, exist_ok=True)
    index_students = []
    total_threads = 0
    total_options = 0
    total_image = 0
    total_story = 0

    for cid in sorted(by_char):
        rows = sorted(by_char[cid], key=lambda r: (r["MessageGroupId"], r["Id"]))
        dname = dev.get(cid, "")
        s = resolve_student(cid, dname)
        # 分线程：cond=1 (FavorRankUp) 开新段
        threads: list[dict] = []
        cur: dict | None = None
        for r in rows:
            if r["MessageCondition"] == 1:
                cur = {"favorRank": r["ConditionValue"], "startGroup": r["MessageGroupId"], "_rows": []}
                threads.append(cur)
            if cur is None:
                continue  # 理论上首条必为 cond=1；实测校验
            cur["_rows"].append(r)

        out_threads = []
        for th in threads:
            items: list[dict] = []
            i = 0
            rs = th["_rows"]
            while i < len(rs):
                r = rs[i]
                if r["MessageCondition"] == 3:  # Answer：收集同组连续选项
                    opts = []
                    while i < len(rs) and rs[i]["MessageGroupId"] == r["MessageGroupId"] and rs[i]["MessageCondition"] == 3:
                        o = rs[i]
                        ent = {"text": pick(o), "nextGroup": o["NextGroupId"]}
                        opts.append(ent)
                        i += 1
                    total_options += len(opts)
                    items.append({"kind": "answer", "from": "teacher", "options": opts})
                    continue
                # 反馈/普通：学生气泡
                item: dict = {"kind": "image" if r["MessageType"] == 2 else "text",
                              "from": "student",
                              "text": pick(r)}
                if r["MessageType"] == 2:
                    item["image"] = r["ImagePath"]
                    total_image += 1
                if r["FeedbackTimeMillisec"]:
                    item["delayMs"] = r["FeedbackTimeMillisec"]
                if r["FavorScheduleId"]:
                    f = fs.get(r["FavorScheduleId"])
                    if f and f["ScenarioSriptGroupId"]:
                        item["story"] = {
                            "favorRank": f["FavorRank"],
                            "scenarioGroup": f["ScenarioSriptGroupId"],
                            "path": story_path(f["ScenarioSriptGroupId"]),
                        }
                        total_story += 1
                items.append(item)
                i += 1
            out_threads.append({"favorRank": th["favorRank"], "messages": items})

        rec = {
            "characterId": cid,
            "studentId": s["id"] if s else None,
            "devName": dname or None,
            "name": (s["name"] if s else dname or str(cid)),
            "avatar": s["avatar"] if s else None,
            "messageCount": len(rows),
            "threads": out_threads,
        }
        (OUT / f"{cid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        total_threads += len(out_threads)
        index_students.append({
            "characterId": cid,
            "studentId": rec["studentId"],
            "devName": rec["devName"],
            "name": rec["name"],
            "avatar": rec["avatar"],
            "messageCount": rec["messageCount"],
            "threads": len(out_threads),
            "file": f"/res/momotalk/{cid}.json",
        })

    index = {
        "source": "ExcelDB AcademyMessangerDBSchema(16105) + AcademyFavorScheduleDBSchema(1120), Steam global, decrypted",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "textLang": "zh-Hans=t2s(tw)>en>jp>kr",
        "kind": ["text", "image", "answer"],
        "students": index_students,
    }
    (OUT / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"students={len(index_students)} threads={total_threads} options={total_options} images={total_image} story_triggers={total_story}")
    mapped = sum(1 for x in index_students if x["studentId"])
    print(f"mapped to students_slim: {mapped}/{len(index_students)}")


if __name__ == "__main__":
    main()
