#!/usr/bin/env python3
"""
本地剧情数据导入：社区 dump（BA-Story-Translator 格式）→ 客户端节点图 JSON。

数据源（一次性 clone/下载到 .scratch/story/mirror，非本工具职责）：
    https://github.com/dunuisancewang-lgtm/ba-story-assets
    data/story/normal/<scenario_id>.json   每集节点数组（含分支选项与多语言）
    data/story/ext/bg.json, bgm.json       数字资产 ID -> 名字映射
    data/common/index_scenario_char.json   剧集/角色索引

输出（客户端契约，见 src/types.ts StoryFile/StoryEntry、src/core/assets.ts）：
    resources/story/<id>.json   StoryFile {story_id,type,title,summary,source_url,nodes[]}
    data/story_index.json       StoryEntry[] {id,type,title,summary,path,nodes,lines,chars}

节点类型语义对照 docs/asset-pipeline.md §3.2：
    cmd bg      -> background {bg}          数字 Id 经 bg.json 映射为 BG_xxx
    cmd bgm     -> bgm {id}                 数字 Id 经 bgm.json 映射为 Theme_xx
    cmd sound   -> se {id}                  已是 SE_xxx 逻辑名
    speaker     -> script {speaker,text,spine,sequence}
    option      -> choice {group}           选项文本已在线性展开的后续 script 节点里
    title/place -> info {text}
    其余        -> {op: <原 DataType>, ...} 兜底保留
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
MIRROR = Path(r"D:/Bluearchive/.scratch/story/mirror/data")
STORY_OUT = ROOT / "resources" / "story"
DATA_OUT = ROOT / "data"

SOURCE_REPO = "https://github.com/dunuisancewang-lgtm/ba-story-assets"

# 多语言取值链：社区简中 -> 官方简中(繁转简) -> 繁中 -> 英文 -> 日文
LANG_CHAIN = ["c_cn", "g_tw_cn", "g_tw", "g_en", "g_ja"]
INVALID_TEXT = re.compile(r"^\[.*(not found|none).*\]$", re.I)

# 剧集类型判定（实测镜像分布：1M 段=单主角+老师的羁绊结构，2M 段=活动/mini；
# 主线与社团剧情不在本镜像，由 wiki 管线补齐后再覆盖分类）
def guess_type(sid: str) -> str:
    n = int(sid)
    if n < 2000000:
        return "bond"
    return "event"


def pick_text(msg: dict) -> tuple[str, str]:
    """按 LANG_CHAIN 取文本，返回 (文本, 命中的语言键)。"""
    if not isinstance(msg, dict):
        return "", ""
    for k in LANG_CHAIN:
        v = msg.get(k)
        if isinstance(v, str) and v.strip() and not INVALID_TEXT.match(v.strip()):
            return v, k
    # 全缺时退回任意非空
    for k, v in msg.items():
        if isinstance(v, str) and v.strip() and not INVALID_TEXT.match(v.strip()):
            return v, k
    return "", ""


def strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


class CharNamer:
    """CharacterId -> 显示名。
    index_scenario_char.json: {<CharacterNameHash>: {Name: {g_tw_cn/g_tw/g_en/g_ja/...}, SmallPortrait, ...}}"""

    NAME_CHAIN = ["g_tw_cn", "g_tw", "g_en", "g_ja"]

    def __init__(self, index: dict, students: list):
        self.by_id: dict[int, str] = {}
        self._load_index(index)
        self._load_students(students)

    def _load_index(self, index: dict):
        if not isinstance(index, dict):
            return
        for k, v in index.items():
            try:
                cid = int(k)
            except ValueError:
                continue
            if not isinstance(v, dict):
                continue
            names = v.get("Name")
            if isinstance(names, dict):
                for lang in self.NAME_CHAIN:
                    s = names.get(lang)
                    if isinstance(s, str) and s.strip() and not INVALID_TEXT.match(s.strip()):
                        self.by_id[cid] = s.strip()
                        break

    def _load_students(self, students: list):
        for s in students:
            name = (s.get("given_name_cn") or s.get("given_name_en")
                    or s.get("given_name") or s.get("name") or "")
            for dev in s.get("character_datas") or []:
                cid = dev.get("character_id") or dev.get("dev_id") or dev.get("id")
                if isinstance(cid, int) and name and cid not in self.by_id:
                    self.by_id[cid] = name

    def get(self, cid: int) -> str:
        if cid in self.by_id:
            return self.by_id[cid]
        if cid <= 0:
            return "Sensei"
        return f"CH{cid}"


def parse_script_meta(script: str) -> tuple[str | None, str | None]:
    """原始行 '3;아루;03;텍스트...' -> (spine=아루?, sequence=03)。
    wiki 契约里 spine 是角色名，这里第 2 段是韩文名，保留作 spine，第 3 段作 sequence。"""
    if not script:
        return None, None
    parts = script.split(";")
    spine = parts[1].strip() if len(parts) >= 2 and parts[1].strip() else None
    seq = parts[2].strip() if len(parts) >= 3 and parts[2].strip() else None
    return spine, seq


def convert_episode(sid: str, raw: list, namer: CharNamer, bg_map: dict, bgm_map: dict,
                    type_of: str, title: str, summary: str) -> dict:
    nodes_out: list[dict] = []
    missing_bg: Counter = Counter()
    missing_bgm: Counter = Counter()
    chars: list[str] = []
    lang_used: Counter = Counter()
    lines = 0

    ordered = sorted(raw, key=lambda x: (x.get("ActualPos", 0), x.get("AbsolutePos", 0)))
    for x in ordered:
        dt = x.get("DataType")
        p = x.get("Payload") or {}
        if dt == "cmd":
            t = str(p.get("Type", "")).lower()
            pid = p.get("Id")
            if t == "bg":
                name = bg_map.get(str(pid)) or bg_map.get(pid)
                if name:
                    nodes_out.append({"op": "background", "bg": str(name)})
                else:
                    missing_bg[str(pid)] += 1
            elif t == "bgm":
                name = bgm_map.get(str(pid)) or bgm_map.get(pid)
                if name:
                    nodes_out.append({"op": "bgm", "id": str(name)})
                else:
                    missing_bgm[str(pid)] += 1
            elif t == "sound":
                if pid:
                    nodes_out.append({"op": "se", "id": str(pid)})
            elif t == "bgmstop" or t == "bgm-stop":
                nodes_out.append({"op": "bgmStop"})
            else:
                nodes_out.append({"op": f"cmd_{t or 'unknown'}", "id": str(pid)})
        elif dt == "speaker":
            text, lang = pick_text(x.get("Message") or {})
            lang_used[lang] += 1
            _, seq = parse_script_meta(x.get("Script") or "")
            speaker = namer.get(int(x.get("CharacterId") or 0))
            node = {"op": "script", "speaker": speaker, "text": text}
            # dump 的 Script 第 2 段是韩文名，wiki 契约里 spine 是可查名——用与 speaker 一致的显示名
            node["spine"] = speaker
            if seq:
                node["sequence"] = seq
            nodes_out.append(node)
            if speaker not in chars:
                chars.append(speaker)
            lines += 1
        elif dt == "option":
            # 选项节点：group 记录分支组（优先指向的组号），选项文本在线性展开的后续 script 里
            grp = x.get("SelectionToGroup")
            if not grp or int(grp) < 0:
                grp = x.get("SelectionGroup")
            nodes_out.append({"op": "choice", "group": str(grp or "")})
        elif dt in ("title", "place"):
            text, lang = pick_text(x.get("Message") or {})
            nodes_out.append({"op": "info", "text": strip_html(text)})
            lang_used[lang] += 1
            if x.get("PopupFileName"):
                nodes_out.append({"op": "popup"})
        else:
            node = {"op": str(dt or "unknown")}
            for k, v in x.items():
                if k in ("Payload", "Message", "ActualPos", "AbsolutePos", "DataType") or v in (None, ""):
                    continue
                node[k] = v
            nodes_out.append(node)

    rec = {
        "story_id": sid,
        "type": type_of,
        "title": title,
        "summary": summary,
        "source_url": f"{SOURCE_REPO} data/story/normal/{sid}.json (BA-Story-Translator dump)",
        "nodes": nodes_out,
    }
    meta = {
        "chars": chars,
        "lines": lines,
        "lang": dict(lang_used),
        "missing_bg": dict(missing_bg),
        "missing_bgm": dict(missing_bgm),
    }
    return rec, meta


def main() -> None:
    ap = argparse.ArgumentParser(description="BA-Story-Translator dump -> 客户端剧情 JSON")
    ap.add_argument("--mirror", default=str(MIRROR))
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 集（调试）")
    args = ap.parse_args()

    mirror = Path(args.mirror)
    src = mirror / "story" / "normal"
    if not src.is_dir():
        print(f"镜像未就位：{src} 不存在（先跑 .scratch/story/fetch_mirror.py）")
        sys.exit(1)

    def load_json(p: Path, default=None):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return default

    ext_bg_raw = load_json(mirror / "story" / "ext" / "bg.json", {}) or {}
    ext_bgm_raw = load_json(mirror / "story" / "ext" / "bgm.json", {}) or {}
    # bg: {hash: {BGFileName: "UIs/03_Scenario/01_Background/BG_xxx", BGType: "Image"}} -> hash -> BG_xxx
    ext_bg = {}
    for k, v in ext_bg_raw.items():
        if isinstance(v, dict) and v.get("BGType") == "Image" and v.get("BGFileName"):
            ext_bg[str(k)] = str(v["BGFileName"]).rsplit("/", 1)[-1]
    # bgm: {id: {Path: "Audio/BGM/Theme_01"}} -> id -> Theme_01
    ext_bgm = {}
    for k, v in ext_bgm_raw.items():
        if isinstance(v, dict) and v.get("Path"):
            ext_bgm[str(k)] = str(v["Path"]).rsplit("/", 1)[-1]
    index = load_json(mirror / "common" / "index_scenario_char.json", {}) or {}
    students = load_json(DATA_OUT / "students_full.json", []) or []
    namer = CharNamer(index, students)
    print(f"bg 映射 {len(ext_bg)} 条，bgm 映射 {len(ext_bgm)} 条，角色映射 {len(namer.by_id)} 条")

    STORY_OUT.mkdir(parents=True, exist_ok=True)
    episodes: list[dict] = []
    lang_total: Counter = Counter()
    bg_miss_total: Counter = Counter()
    bgm_miss_total: Counter = Counter()
    type_count: Counter = Counter()

    files = sorted(src.glob("*.json"))
    if args.limit:
        files = files[: args.limit]
    for f in files:
        sid = f.stem
        raw = load_json(f)
        if not isinstance(raw, list) or not raw:
            continue
        type_of = guess_type(sid)
        # 剧集标题：节点流里的 title 节点（DataType='title'）
        title, summary = sid, ""
        for x in raw:
            if x.get("DataType") == "title":
                t, _ = pick_text(x.get("Message") or {})
                t = strip_html(t)
                if t:
                    title = t
                break
        rec, meta = convert_episode(sid, raw, namer, ext_bg, ext_bgm, type_of, title, summary)
        (STORY_OUT / f"{sid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        lang_total.update(meta["lang"])
        bg_miss_total.update(meta["missing_bg"])
        bgm_miss_total.update(meta["missing_bgm"])
        type_count[type_of] += 1
        episodes.append({
            "id": sid,
            "type": type_of,
            "title": title,
            "summary": summary,
            "path": f"/res/story/{sid}.json",
            "nodes": len(rec["nodes"]),
            "lines": meta["lines"],
            "chars": meta["chars"],
        })

    DATA_OUT.mkdir(parents=True, exist_ok=True)

    # ---- 合并 wiki 管线产物（resources/story/<type>/<slug>.json）----
    # 镜像 dump 已覆盖 bond/event（简中+含分支，质量更高），wiki 只补 main/group（英译单路径）
    wiki_files = [f for f in sorted(STORY_OUT.glob("[a-z]*/*.json"))
                  if f.parent.name in ("main", "group")]
    wiki_added = 0
    for f in wiki_files:
        rec = load_json(f)
        if not isinstance(rec, dict) or not rec.get("nodes"):
            continue
        sid = str(rec.get("story_id") or f.stem)
        etype = f.parent.name if f.parent.name in ("main", "bond", "event", "group") else "event"
        chars: list[str] = []
        lines = 0
        for n in rec["nodes"]:
            if n.get("op") == "script":
                lines += 1
                sp = n.get("speaker")
                if sp and sp not in chars:
                    chars.append(sp)
        episodes.append({
            "id": sid,
            "type": etype,
            "title": rec.get("title") or f.stem,
            "summary": rec.get("summary") or "",
            "path": f"/res/story/{f.parent.name}/{f.name}",
            "nodes": len(rec["nodes"]),
            "lines": lines,
            "chars": chars,
        })
        wiki_added += 1

    (DATA_OUT / "story_index.json").write_text(
        json.dumps(episodes, ensure_ascii=False, indent=1), encoding="utf-8")

    total_nodes = sum(e["nodes"] for e in episodes)
    total_lines = sum(e["lines"] for e in episodes)
    print(f"\n剧集 {len(episodes)} 集（{dict(type_count)}），节点 {total_nodes}，台词 {total_lines}")
    print(f"语言命中：{dict(lang_total)}")
    if bg_miss_total:
        print(f"BG 未映射 {len(bg_miss_total)} 种（{sum(bg_miss_total.values())} 次），top："
              + ", ".join(f"{k}({v})" for k, v in bg_miss_total.most_common(6)))
    if bgm_miss_total:
        print(f"BGM 未映射 {len(bgm_miss_total)} 种（{sum(bgm_miss_total.values())} 次），top："
              + ", ".join(f"{k}({v})" for k, v in bgm_miss_total.most_common(6)))
    print(f"✓ resources/story/（{len(files)} 文件 + wiki {wiki_added} 集）")
    print(f"✓ data/story_index.json（{len(episodes)} 条）")


if __name__ == "__main__":
    main()
