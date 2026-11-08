#!/usr/bin/env python3
"""任务4：剧情分支扩展 + story_index 重建 + data/event_story_map.json。

分支模型（本会话实测，见 DataSupplyResult）：
  ExcelDB ScenarioScriptDBSchema（dump/scenario_script.json，388859 行）
    - 行序=播放序；组=group_id；主线桶 10/11、档案小剧场桶 70、活动小剧场桶 80、活动剧情桶 2
    - 选项行 script_kr 形如 '[s1] "文本1"\\n[s2] "文本2"'（text_tw 同构，繁中）
      → 一个 choice 节点 options:[{text(简中), nextGroup=str(N)}]
    - 选项后 selection_group==N 的连续行 = 分支 N 内容（节点打 branch:"N"），
      回到 selection_group==0 即汇合，线性继续
  镜像 dump（BA-Story-Translator，bond 770 + event 230）
    - DataType=='option' 行每行一个选项：Message 文本即选项文本，
      SelectionToGroup=目标分支号（-1 无）；分支行 SelectionGroup==G>0

分类（实测 event_scenario2.json 961 组引用，与 main 0 冲突）：
  bucket 10/11 → main（820）、bucket 70 → group（41）
  bucket 80（141 小剧场）与 bucket 2 镜像未覆盖的 122 集 → type=event，/res/story/event/<gid>.json
  bond/event 镜像集原位重建（路径 /res/story/<gid>.json 不变）

event_story_map：EventContentScenarioDBSchema（plana slot 序，984 行实测 0 err）给
  event_content_id → 有序剧集组；活动名/周期由剧集标题与 kivo event_timeline.json 模糊匹配
  （最长公共子串 ≥4，命中标注 mode/score，未命中如实 null）。
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

try:
    from opencc import OpenCC
    cc = OpenCC("t2s")
except Exception:  # pragma: no cover
    cc = None

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
DUMP = Path(r"D:/Bluearchive/.scratch/exceldb/dump")
MIRROR = Path(r"D:/Bluearchive/.scratch/story/mirror/data/story/normal")
STORY_OUT = ROOT / "resources" / "story"
DATA_OUT = ROOT / "data"

SPK_RE = re.compile(r"^(\d+);([^;]+);(\d+);(.*)$", re.S)
OPT_RE = re.compile(r"^\[s(\d*)\]\s*[「\"”]?(.*?)[」\"“]?\s*$")


def cn_of(rec: dict) -> str:
    for key in ("text_tw", "text_en", "text_jp"):
        v = rec.get(key)
        if v and v.strip():
            return cc.convert(v.strip()) if (key == "text_tw" and cc) else v.strip()
    return ""


def strip_opt_quotes(s: str) -> str:
    s = (s or "").strip()
    for a, b in (("「", "」"), ("『", "』"), ('"', '"'), ("“", "”"), ("\"", "\"")):
        if s.startswith(a) and s.endswith(b) and len(s) >= 2:
            return s[1:-1].strip()
    return s


def parse_options(script_kr: str, text_tw: str) -> list[dict]:
    """[sN] 行 -> [{n, text}]。文本优先 text_tw（繁转简），退 script_kr。
    单独 '[s]'（无编号）行 = 单选项伪选项（无分支，4374 处实测）。"""
    kr_lines = [l for l in (script_kr or "").splitlines() if l.strip().startswith("[s")]
    tw_lines = [l for l in (text_tw or "").splitlines() if l.strip().startswith("[s")]
    if not tw_lines:
        tw_lines = kr_lines
    opts = []
    for i, line in enumerate(tw_lines):
        m = OPT_RE.match(line.strip())
        if not m:
            continue
        n = m.group(1)
        text = strip_opt_quotes(m.group(2))
        if cc and text:
            text = cc.convert(text)
        opts.append({"n": n or str(i + 1), "text": text})
    if not opts:
        # 兜底：只从 kr 行取号
        for i, line in enumerate(kr_lines):
            m = OPT_RE.match(line.strip())
            if m:
                opts.append({"n": m.group(1) or str(i + 1), "text": ""})
    return opts


class ExcelConverter:
    """scenario_script.json -> 带分支的剧集节点（与 extract_exceldb_story.py 同源）。"""

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
                    disp = cc.convert(v.strip()) if (key == "name_tw" and cc) else v.strip()
                    break
            self.spk.setdefault(kr.strip(), disp or kr.strip())
        self.spk_keys = sorted(self.spk, key=len, reverse=True)
        self.groups: dict[int, list[dict]] = defaultdict(list)
        for r in self.script:
            self.groups[r["group_id"]].append(r)

    def spoken(self, kr_name: str) -> str:
        k = kr_name.strip()
        if k in self.spk:
            return self.spk[k]
        head = k.split(" ", 1)[0]
        if head in self.spk:
            return self.spk[head]
        for key in self.spk_keys:
            if k.startswith(key) and len(key) >= 2:
                return self.spk[key]
        if len(k) >= 3:
            cands = [key for key in self.spk_keys if key.startswith(k)]
            if len(cands) == 1:
                return self.spk[cands[0]]
        return k

    def convert_group(self, gid: int, etype: str) -> tuple[dict, Counter]:
        rows = self.groups[gid]
        nodes: list[dict] = []
        stats = Counter()
        title = ""
        i = 0
        n = len(rows)
        while i < n:
            r = rows[i]
            if r.get("bg_name"):
                bg = self.bg_name.get(r["bg_name"])
                if bg:
                    nodes.append({"op": "background", "bg": bg})
                    stats["bg"] += 1
            if r.get("bgm_id"):
                name = self.bgm.get(r["bgm_id"])
                if name:
                    nodes.append({"op": "bgm", "id": name})
                    stats["bgm"] += 1
            if r.get("sound"):
                nodes.append({"op": "se", "id": r["sound"]})
                stats["se"] += 1
            kr = r.get("script_kr") or ""
            if kr.strip():
                if kr.startswith("#title;"):
                    t = cn_of(r)
                    if t and not title:
                        title = t.splitlines()[0].strip()
                    stats["title"] += 1
                    i += 1
                    continue
                if kr.startswith("[s"):
                    opts = parse_options(kr, r.get("text_tw") or "")
                    node = {
                        "op": "choice",
                        "options": [
                            {"text": o["text"], "nextGroup": o["n"]} for o in opts
                        ],
                    }
                    if str(r.get("selection_group") or ""):
                        node["group"] = str(r["selection_group"])
                    nodes.append(node)
                    stats["choice"] += 1
                    stats["choice_options"] += len(opts)
                    i += 1
                    continue
                m = SPK_RE.match(kr)
                if m:
                    _tag, kr_name, seq, _body = m.groups()
                    text = cn_of(r).split("\n")[0].strip()
                    node = {"op": "script", "speaker": self.spoken(kr_name), "text": text}
                    node["spine"] = node["speaker"]
                    if seq:
                        node["sequence"] = seq
                    sg = r.get("selection_group") or 0
                    if sg:
                        node["branch"] = str(sg)
                        stats["branch_rows"] += 1
                    nodes.append(node)
                    stats["script"] += 1
                    i += 1
                    continue
                if kr.startswith("#"):
                    stats["cmd_skip"] += 1
                    i += 1
                    continue
                text = cn_of(r)
                if text:
                    node = {"op": "info", "text": text}
                    sg = r.get("selection_group") or 0
                    if sg:
                        node["branch"] = str(sg)
                        stats["branch_rows"] += 1
                    nodes.append(node)
                    stats["info"] += 1
                else:
                    stats["empty"] += 1
            else:
                stats["noop"] += 1
            i += 1

        rec = {
            "story_id": str(gid),
            "type": etype,
            "title": title or str(gid),
            "summary": "",
            "source_url": "ExcelDB.db ScenarioScriptDBSchema (Steam global, decrypted)",
            "nodes": nodes,
        }
        return rec, stats


def group_title(conv: ExcelConverter, gid: int) -> str:
    for r in conv.groups.get(gid, []):
        if (r.get("script_kr") or "").startswith("#title;"):
            t = cn_of(r)
            if t:
                return t.splitlines()[0].strip()
    return ""


# ---------------- 镜像（bond/event）重建 ----------------

def mirror_rebuild(index_namer_ok: bool = True) -> tuple[list[dict], Counter]:
    """从镜像 dump 重建 bond/event 文件（原位，路径不变），带分支字段。"""
    from extract_local_story import CharNamer, LANG_CHAIN, INVALID_TEXT, strip_html  # noqa: E402

    ext_bg_raw = json.loads((MIRROR.parent / "ext" / "bg.json").read_text(encoding="utf-8")) if (MIRROR.parent / "ext" / "bg.json").exists() else {}
    ext_bgm_raw = json.loads((MIRROR.parent / "ext" / "bgm.json").read_text(encoding="utf-8")) if (MIRROR.parent / "ext" / "bgm.json").exists() else {}
    ext_bg = {k: str(v["BGFileName"]).rsplit("/", 1)[-1]
              for k, v in ext_bg_raw.items() if isinstance(v, dict) and v.get("BGFileName")}
    ext_bgm = {k: str(v["Path"]).rsplit("/", 1)[-1]
               for k, v in ext_bgm_raw.items() if isinstance(v, dict) and v.get("Path")}
    index = json.loads((MIRROR.parent.parent / "common" / "index_scenario_char.json").read_text(encoding="utf-8"))
    students = json.loads((DATA_OUT / "students_full.json").read_text(encoding="utf-8"))
    namer = CharNamer(index, students)

    def pick_text(msg: dict) -> str:
        for k in LANG_CHAIN:
            v = msg.get(k)
            if isinstance(v, str) and v.strip() and not INVALID_TEXT.match(v.strip()):
                return v.strip()
        for k, v in msg.items():
            if isinstance(v, str) and v.strip() and not INVALID_TEXT.match(v.strip()):
                return v.strip()
        return ""

    stats = Counter()
    episodes = []
    files = sorted(MIRROR.glob("*.json"))
    for f in files:
        sid = f.stem
        raw = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(raw, list) or not raw:
            continue
        etype = "bond" if int(sid) < 2000000 else "event"
        title = sid
        for x in raw:
            if x.get("DataType") == "title":
                t = strip_html(pick_text(x.get("Message") or {}))
                if t:
                    title = t
                break
        ordered = sorted(raw, key=lambda x: (x.get("ActualPos", 0), x.get("AbsolutePos", 0)))
        nodes: list[dict] = []
        chars: list[str] = []
        lines = 0
        i = 0
        n = len(ordered)
        while i < n:
            x = ordered[i]
            dt = x.get("DataType")
            p = x.get("Payload") or {}
            if dt == "cmd":
                t = str(p.get("Type", "")).lower()
                pid = p.get("Id")
                if t == "bg":
                    name = ext_bg.get(str(pid))
                    if name:
                        nodes.append({"op": "background", "bg": name})
                elif t == "bgm":
                    name = ext_bgm.get(str(pid))
                    if name:
                        nodes.append({"op": "bgm", "id": name})
                elif t == "sound":
                    if pid:
                        nodes.append({"op": "se", "id": str(pid)})
                elif t in ("bgmstop", "bgm-stop"):
                    nodes.append({"op": "bgmStop"})
                else:
                    nodes.append({"op": f"cmd_{t or 'unknown'}", "id": str(pid)})
                i += 1
                continue
            if dt == "option":
                # 连续 option 行 = 一次选项；每行一个选项（Message.g_ko 即文本）
                opts = []
                sgn = x.get("SelectionGroup") or 0
                while i < n and ordered[i].get("DataType") == "option":
                    o = ordered[i]
                    opts.append({
                        "text": strip_opt_quotes(pick_text(o.get("Message") or {})),
                        "nextGroup": str(o.get("SelectionToGroup", "")) if o.get("SelectionToGroup", -1) != -1 else "",
                    })
                    i += 1
                node = {"op": "choice", "options": opts}
                if sgn:
                    node["group"] = str(sgn)
                nodes.append(node)
                stats["choice"] += 1
                stats["choice_options"] += len(opts)
                continue
            if dt == "speaker":
                text = pick_text(x.get("Message") or {})
                parts = (x.get("Script") or "").split(";")
                seq = parts[2].strip() if len(parts) >= 3 else None
                speaker = namer.get(int(x.get("CharacterId") or 0))
                node = {"op": "script", "speaker": speaker, "text": text, "spine": speaker}
                if seq and seq.strip():
                    node["sequence"] = seq.strip()
                sg = x.get("SelectionGroup") or 0
                if sg:
                    node["branch"] = str(sg)
                nodes.append(node)
                if speaker not in chars:
                    chars.append(speaker)
                lines += 1
                i += 1
                continue
            if dt in ("title", "place"):
                text = strip_html(pick_text(x.get("Message") or {}))
                if text:
                    nodes.append({"op": "info", "text": text})
                if x.get("PopupFileName"):
                    nodes.append({"op": "popup"})
                i += 1
                continue
            node = {"op": str(dt or "unknown")}
            for k, v in x.items():
                if k in ("Payload", "Message", "ActualPos", "AbsolutePos", "DataType") or v in (None, ""):
                    continue
                node[k] = v
            sg = x.get("SelectionGroup") or 0
            if sg:
                node["branch"] = str(sg)
            nodes.append(node)
            i += 1
        rec = {
            "story_id": sid,
            "type": etype,
            "title": title,
            "summary": "",
            "source_url": "https://github.com/dunuisancewang-lgtm/ba-story-assets data/story/normal/%s.json (BA-Story-Translator dump)" % sid,
            "nodes": nodes,
        }
        (STORY_OUT / f"{sid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        stats["script"] += lines
        episodes.append({
            "id": sid, "type": etype, "title": title, "summary": "",
            "path": f"/res/story/{sid}.json",
            "nodes": len(rec["nodes"]), "lines": lines, "chars": chars,
        })
    return episodes, stats


# ---------------- 活动映射 ----------------

def lcs_len(a: str, b: str) -> int:
    """最长公共子串长度。"""
    if not a or not b:
        return 0
    dp = [0] * (len(b) + 1)
    best = 0
    for ca in a:
        nd = [0] * (len(b) + 1)
        for j, cb in enumerate(b):
            if ca == cb:
                nd[j + 1] = dp[j] + 1
                best = max(best, nd[j + 1])
        dp = nd
    return best


GENERIC_EP = re.compile(r"^(序幕|序章|序|終章|终章|后日谈|事後談|番外|尾声|第?[0-9０-９]+话?話?|Epilogue|Prologue)$")


def clean_title(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"【|\[|】|\]|「|」|『|』|（|）|\(|\)|：|:|！|!|？|\?|、|，|,|。|\.|~|～|·|　|\s", "", s)
    for pre in ("限时活动", "限时复刻活动", "活动复刻", "签到活动", "限时复刻", "常设活动",
                "活动", "限时", "复刻", "常设", "部分活动复刻"):
        if s.startswith(pre):
            s = s[len(pre):]
    return s


def episode_tokens(title: str) -> set[str]:
    """剧集标题 -> 语义 token（去掉 序幕/第N话 这类通用前缀段）。"""
    toks = set()
    for seg in re.split(r"[;；]", title or ""):
        seg = clean_title(seg)
        if not seg or GENERIC_EP.match(seg):
            continue
        if len(seg) >= 3:
            toks.add(seg)
    return toks


def extract_candidates(title: str, summary: str) -> set[str]:
    """timeline 标题+摘要里 【】/《》/〔〕 内的候选活动名。"""
    cands = set()
    for src in (title or "", summary or ""):
        for m in re.finditer(r"【([^【】]{3,40})】|《([^《》]{3,40})》|〔([^〔〕]{3,40})〕", src):
            for g in m.groups():
                if g:
                    cands.add(clean_title(g))
    return {c for c in cands if len(c) >= 3}


def build_event_map(conv: ExcelConverter, timeline: list[dict]) -> tuple[dict, list[dict]]:
    es = json.loads((DUMP / "event_scenario2.json").read_text(encoding="utf-8"))
    by_ec = defaultdict(list)
    for r in es:
        by_ec[r["event_content_id"]].append(r)

    # timeline：CN 优先，JP 兜底；clean 标题索引
    tl = []
    for e in timeline:
        entry = {
            "id": e["id"], "line_type": e.get("line_type"), "title": e.get("title") or "",
            "clean": clean_title(e.get("title") or ""),
            "cands": extract_candidates(e.get("title") or "", e.get("body_summary") or ""),
            "start": e.get("start_time"), "end": e.get("end_time"),
            "image": e.get("image"), "url": e.get("url"),
        }
        tl.append(entry)

    events_out = []
    refs_by_group: dict[str, list[dict]] = defaultdict(list)
    matched = 0
    for ec in sorted(by_ec):
        rows = sorted(by_ec[ec], key=lambda r: r["order"])
        chapters = []
        for r in rows:
            gids = r.get("scenario_group_id") or []
            if not gids:
                continue
            g = gids[0]
            title = group_title(conv, g)
            in_index_bucket = g // 1000000
            if in_index_bucket in (10, 11):
                path = f"/res/story/main/{g}.json"
                idx_type = "main"
            else:
                path = f"/res/story/event/{g}.json"
                idx_type = "event"
            ch = {
                "storyId": str(g), "title": title, "order": r["order"],
                "isRecollection": bool(r["is_recollection"]),
                "path": path, "indexType": idx_type,
            }
            chapters.append(ch)
            refs_by_group.setdefault(str(g), []).append({"eventId": ec, "order": r["order"]})
        # 名称匹配：剧集 token vs timeline 候选名（LCS/短边 ≥0.6），全长 LCS 保底
        toks: set[str] = set()
        for ch in chapters:
            toks |= episode_tokens(ch["title"])
        best = None
        for t in tl:
            if t["line_type"] not in ("CN", "JP"):
                continue
            score = 0
            for tok in toks:
                for cand in t["cands"]:
                    l = lcs_len(tok, cand)
                    ratio = l / min(len(tok), len(cand))
                    if ratio >= 0.6:
                        score = max(score, l + 2)
                l2 = lcs_len(tok, t["clean"])
                if len(tok) >= 5 and l2 / len(tok) >= 0.8:
                    score = max(score, l2 + 1)
            if score and (best is None or score > best[0]):
                best = (score, t)
        name = None
        name_src = None
        period = None
        tl_id = None
        if best:
            score, t = best
            name = t["title"]
            tl_id = t["id"]
            period = {"start": t["start"], "end": t["end"]}
            name_src = "kivo_timeline"
            matched += 1
        events_out.append({
            "eventId": ec,
            "timelineId": tl_id,
            "name": name,
            "nameSource": name_src,
            "matchScore": best[0] if best else 0,
            "period": period,
            "chapters": chapters,
            "recollectionCount": sum(1 for c in chapters if c["isRecollection"]),
        })
    return {"source": "ExcelDB EventContentScenarioDBSchema (plana-flatbuffers slot, 984 rows)",
            "generated": datetime.now().isoformat(timespec="seconds"),
            "timelineSource": "data/event_timeline.json (kivo.wiki)",
            "events": events_out}, refs_by_group


def main() -> None:
    conv = ExcelConverter(DUMP)

    # 分类目标
    es = json.loads((DUMP / "event_scenario2.json").read_text(encoding="utf-8"))
    ev_refs = set()
    for r in es:
        ev_refs.update(r.get("scenario_group_id") or [])

    targets = []
    for gid in sorted(conv.groups):
        b = gid // 1000000
        if b in (10, 11):
            targets.append((gid, "main"))
        elif b == 70:
            targets.append((gid, "group"))
        elif b == 80:
            targets.append((gid, "event"))
        elif b == 2:
            mirror_has = (MIRROR / f"{gid}.json").exists()
            if not mirror_has:
                targets.append((gid, "event"))
        elif b == 90:
            targets.append((gid, "event"))  # 大型活动剧情（第N话 全域/大决戦），event_scenario 之外的独立活动剧情
    print(f"ExcelDB 目标：{Counter(t for _, t in targets)}")

    stats_total: Counter = Counter()
    excel_eps = []
    for gid, etype in targets:
        rec, st = conv.convert_group(gid, etype)
        out_dir = STORY_OUT / etype if etype in ("main", "group") else STORY_OUT / "event"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{gid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        stats_total.update(st)
        chars = []
        lines = 0
        for nd in rec["nodes"]:
            if nd["op"] == "script":
                lines += 1
                if nd["speaker"] not in chars:
                    chars.append(nd["speaker"])
        sub = f"{etype}/{gid}.json" if etype in ("main", "group") else f"event/{gid}.json"
        excel_eps.append({
            "id": str(gid), "type": etype, "title": rec["title"], "summary": "",
            "path": f"/res/story/{sub}",
            "nodes": len(rec["nodes"]), "lines": lines, "chars": chars,
        })

    print(f"ExcelDB 节点统计：{dict(stats_total)}")

    mirror_eps, mstats = mirror_rebuild()
    print(f"镜像重建：{Counter(e['type'] for e in mirror_eps)}，{dict(mstats)}")

    # story_index：镜像（bond/event 原位）+ ExcelDB（main/group/event）
    seen = set()
    index = []
    for e in mirror_eps + excel_eps:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        index.append(e)
    print(f"story_index 合计 {len(index)}（main={sum(1 for x in index if x['type']=='main')} "
          f"bond={sum(1 for x in index if x['type']=='bond')} event={sum(1 for x in index if x['type']=='event')} "
          f"group={sum(1 for x in index if x['type']=='group')}）")

    # 附加 events 引用标注
    timeline = json.loads((DATA_OUT / "event_timeline.json").read_text(encoding="utf-8"))
    emap, refs_by_group = build_event_map(conv, timeline)
    for e in index:
        refs = refs_by_group.get(e["id"])
        if refs:
            e["events"] = refs
    (DATA_OUT / "story_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    (DATA_OUT / "event_story_map.json").write_text(
        json.dumps(emap, ensure_ascii=False, indent=1), encoding="utf-8")
    named = sum(1 for x in emap["events"] if x["name"])
    print(f"event_story_map：{len(emap['events'])} 活动，命名 {named}，"
          f"章节总数 {sum(len(x['chapters']) for x in emap['events'])}")


if __name__ == "__main__":
    main()
