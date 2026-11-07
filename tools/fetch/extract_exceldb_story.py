#!/usr/bin/env python3
"""ExcelDB ScenarioScript -> 客户端剧情 JSON（main/group），重建 story_index。

数据源（.scratch/exceldb/dump/*.json，由 dump_exceldb_tables.py 生成）：
  scenario_script.json  388859 行（GroupId, selection_group, bgm_id, sound, bg_name, script_kr, text_jp/th/tw/en, voice_id）
  bg_name.json          Name(uint) -> bg_file_name 'UIs/03_Scenario/01_Background/BG_xxx'
  bgm.json              Id -> ['Audio/BGM/Theme_xx']
  character_name.json   name_kr -> name_tw/name_en 显示名映射

分层（实测 3410 组 1e6 桶语义，见 TrackResult）：
  main  = 桶 10（10xxxxxx 主线各卷各章）+ 桶 11（Final 篇）
  group = 桶 70（Group Story 档案小剧场）
  bond/event 已由镜像 dump 覆盖（extract_local_story.py），本脚本不碰。

ScriptKr 语法（与 mirror dump 同源对齐验证，见 golden_test）：
  '#title;X'            -> info（标题）
  'N;韩名;seq;文本\\n#N;...'  -> script（后续 #N; 行为角色动画指令，忽略）
  '[sN] "..." / [s]'    -> choice（text_tw 内同行含全部选项的对应翻译）
  '#wait;N' 等          -> 忽略
语言：cn = opencc(t2s)(text_tw)；空则 en；空则 jp。
输出：
  repo/resources/story/main/<gid>.json  {story_id,type,title,summary,source_url,nodes[]}
  repo/resources/story/group/<gid>.json
  repo/data/story_index.json            保留 bond/event 条目，main/group 以本脚本产物替换
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from opencc import OpenCC

ROOT = Path(r"D:/Bluearchive/repo")
DUMP = Path(r"D:/Bluearchive/.scratch/exceldb/dump")
STORY_OUT = ROOT / "resources" / "story"
DATA_OUT = ROOT / "data"

MAIN_BUCKETS = {10, 11}
GROUP_BUCKETS = {70}

cc = OpenCC("t2s")

SPK_RE = re.compile(r"^(\d+);([^;]+);(\d+);(.*)$", re.S)
OPT_RE = re.compile(r"^\[s(\d*)\]\s*[「\"](.*)[」\"]$", re.S)


def cn_of(rec: dict) -> str:
    """cn = t2s(tw) > en > jp。"""
    for key in ("text_tw", "text_en", "text_jp"):
        v = rec.get(key)
        if v and v.strip():
            return cc.convert(v.strip()) if key == "text_tw" else v.strip()
    return ""


class Converter:
    def __init__(self, dump: Path):
        self.script = json.loads((dump / "scenario_script.json").read_text(encoding="utf-8"))
        self.bg_name = {}
        for r in json.loads((dump / "bg_name.json").read_text(encoding="utf-8")):
            p = r.get("bg_file_name") or ""
            if p:
                self.bg_name[r["Name"]] = p.rsplit("/", 1)[-1]
        self.bgm = {}
        for r in json.loads((dump / "bgm.json").read_text(encoding="utf-8")):
            paths = r.get("path") or []
            if paths:
                self.bgm[r["Id"]] = paths[0].rsplit("/", 1)[-1]
        self.spk = {}
        for r in json.loads((dump / "character_name.json").read_text(encoding="utf-8")):
            kr = r.get("name_kr")
            if not kr:
                continue
            disp = None
            for key in ("name_tw", "name_en", "name_jp"):
                v = r.get(key)
                if v and v.strip():
                    disp = cc.convert(v.strip()) if key == "name_tw" else v.strip()
                    break
            self.spk.setdefault(kr.strip(), disp or kr.strip())
        self.spk_keys = sorted(self.spk, key=len, reverse=True)
        self.groups: dict[int, list[dict]] = defaultdict(list)
        for r in self.script:
            self.groups[r["group_id"]].append(r)

    def convert_group(self, gid: int, etype: str) -> tuple[dict, Counter]:
        rows = self.groups[gid]
        nodes: list[dict] = []
        stats = Counter()
        title = ""

        def spoken(kr_name: str) -> str:
            k = kr_name.strip()
            if k in self.spk:
                return self.spk[k]
            # 变体名（'네루 교복'/'나구사ND'）：取第一个词，再退最长 kr 前缀
            head = k.split(" ", 1)[0]
            if head in self.spk:
                return self.spk[head]
            for key in self.spk_keys:
                if k.startswith(key) and len(key) >= 2:
                    return self.spk[key]
            # 简称（'미사카' -> '미사카 미코토'）：k 是表内名的唯一前缀
            if len(k) >= 3:
                cands = [key for key in self.spk_keys if key.startswith(k)]
                if len(cands) == 1:
                    return self.spk[cands[0]]
            return k

        for r in rows:
            if r.get("bg_name"):
                bg = self.bg_name.get(r["bg_name"])
                if bg:
                    nodes.append({"op": "background", "bg": bg})
                    stats["bg"] += 1
                else:
                    stats["bg_missing"] += 1
            if r.get("bgm_id"):
                name = self.bgm.get(r["bgm_id"])
                if name:
                    nodes.append({"op": "bgm", "id": name})
                    stats["bgm"] += 1
                else:
                    stats["bgm_missing"] += 1
            if r.get("sound"):
                nodes.append({"op": "se", "id": r["sound"]})
                stats["se"] += 1
            kr = r.get("script_kr") or ""
            if not kr.strip():
                continue
            if kr.startswith("#title;"):
                t = cn_of(r)
                if t and not title:
                    title = t.splitlines()[0].strip()
                stats["title"] += 1
                continue
            if kr.startswith("[s"):
                m = OPT_RE.match(kr.splitlines()[0])
                grp = str(r.get("selection_group") or (m.group(1) if m else "") or "")
                nodes.append({"op": "choice", "group": grp})
                stats["choice"] += 1
                continue
            m = SPK_RE.match(kr)
            if m:
                _tag, kr_name, seq, _body = m.group(1), m.group(2), m.group(3), m.group(4)
                text = cn_of(r).split("\n")[0].strip()
                node = {"op": "script", "speaker": spoken(kr_name), "text": text}
                node["spine"] = spoken(kr_name)
                if seq:
                    node["sequence"] = seq
                nodes.append(node)
                stats["script"] += 1
                continue
            if kr.startswith("#"):
                stats["cmd_skip"] += 1
                continue
            text = cn_of(r)
            if text:
                nodes.append({"op": "info", "text": text})
                stats["info"] += 1
            else:
                stats["empty"] += 1

        rec = {
            "story_id": str(gid),
            "type": etype,
            "title": title or str(gid),
            "summary": "",
            "source_url": "ExcelDB.db ScenarioScriptDBSchema (Steam global, decrypted)",
            "nodes": nodes,
        }
        return rec, stats


def main() -> None:
    conv = Converter(DUMP)
    targets = []
    for gid in sorted(conv.groups):
        b = gid // 1000000
        if b in MAIN_BUCKETS:
            targets.append((gid, "main"))
        elif b in GROUP_BUCKETS:
            targets.append((gid, "group"))
    print(f"目标剧集：main={sum(1 for _, t in targets if t == 'main')} group={sum(1 for _, t in targets if t == 'group')}")

    stats_total: Counter = Counter()
    episodes = []
    for gid, etype in targets:
        rec, st = conv.convert_group(gid, etype)
        out_dir = STORY_OUT / etype
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{gid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        stats_total.update(st)
        chars = []
        lines = 0
        for n in rec["nodes"]:
            if n["op"] == "script":
                lines += 1
                if n["speaker"] not in chars:
                    chars.append(n["speaker"])
        episodes.append({
            "id": str(gid),
            "type": etype,
            "title": rec["title"],
            "summary": "",
            "path": f"/res/story/{etype}/{gid}.json",
            "nodes": len(rec["nodes"]),
            "lines": lines,
            "chars": chars,
        })

    # story_index：保留 bond/event，替换 main/group
    old = json.loads((DATA_OUT / "story_index.json").read_text(encoding="utf-8"))
    kept = [e for e in old if e["type"] in ("bond", "event")]
    new_index = kept + episodes
    (DATA_OUT / "story_index.json").write_text(json.dumps(new_index, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"节点统计：{dict(stats_total)}")
    print(f"story_index：bond/event 保留 {len(kept)}，main/group 重建 {len(episodes)}，合计 {len(new_index)}")


if __name__ == "__main__":
    main()
