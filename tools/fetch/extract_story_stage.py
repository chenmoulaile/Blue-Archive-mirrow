#!/usr/bin/env python3
"""剧情演出层全量重生成驱动（S-1/S-2/S-3/S-4，2026-11-10 剧情数据师）。

职责（复用 extract_story_branches.ExcelConverter 的扩展 convert_group）：
  1. data/story_index.json 的 2276 条（bond 799 / event 1436 / group 41）全部重生成：
     - id -> (type, path, events) 沿用旧索引（reclass_story_index.py 2026-11-09 走查④后的
       分类口径：10/11 桶 820 条保持 type=event、path=/res/story/main/<gid>.json 不变）
     - title/nodes/lines/chars 以 ExcelDB 扩展转换结果刷新
     - 31 个 id 在 ExcelDB 无组（镜像 dump 独有的 CBT/旧版组，如 1012515）→ 旧文件旧条目
       原样保留，不伪造数据
  2. data/voice_needed.json：全部剧本行的唯一 voiceId -> KR/JP 语音路径（供网络轨下载）
  3. data/cg_needed.json：全部剧本行 popup_file_name 的唯一 CG 资源名

输出布局不变：resources/story/{根目录 bond+event, main/<gid>, event/<gid>, group/<gid>}.json
播放器契约：StoryPage 按 entry.path fetch（src/core/assets.ts:147 loadStoryFile），path 不动。

用法： D:/Bluearchive/.venv/Scripts/python.exe -I tools/fetch/extract_story_stage.py
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from extract_story_branches import DUMP, ExcelConverter, group_title  # noqa: E402

DATA_OUT = ROOT / "data"
STORY_OUT = ROOT / "resources" / "story"
TODAY = "2026-11-10"

# 本机 Steam 版客户端实测（2026-11-10，只读，未启动游戏本体）
KR_MAIN_MOLRU = Path(r"D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data"
                     r"/StreamingAssets/PUB/Resource/GameData/MediaResources/Audio/VOC_KR/KR_Main")


def kr_main_bytes() -> int:
    """KR_Main 分卷容器目录总字节（12 个 .molru，du -sb 实测 600,131,363）。"""
    if not KR_MAIN_MOLRU.exists():
        return 0
    return sum(p.stat().st_size for p in KR_MAIN_MOLRU.rglob("*") if p.is_file())
CG_PATH_PREFIX = "UIs/03_Scenario/04_ScenarioImage"


def main() -> None:
    old_index = json.loads((DATA_OUT / "story_index.json").read_text(encoding="utf-8"))
    old_by_id = {e["id"]: e for e in old_index}
    print(f"旧 story_index：{len(old_index)} 条")

    conv = ExcelConverter(DUMP)
    print(f"演出层映射：voice={len(conv.stage['voice'])} transition={len(conv.stage['transition'])} "
          f"bgEffect={len(conv.stage['bgEffect'])}")

    excel_groups = set(conv.groups)
    targets = []      # (gid, old_entry)
    preserved = []    # ExcelDB 无组的旧条目
    for e in old_index:
        gid = int(e["id"])
        if gid in excel_groups:
            targets.append((gid, e))
        else:
            preserved.append(e)
    print(f"重生成 {len(targets)} 集；ExcelDB 无组保留 {len(preserved)} 集：{[e['id'] for e in preserved]}")

    # ---- 1. 逐集重生成 ----
    stats_total: Counter = Counter()
    new_entries: list[dict] = []
    voice_hits = Counter()          # voiceId 行命中情况
    for gid, old in targets:
        etype = old["type"]
        rec, st = conv.convert_group(gid, etype)
        stats_total.update(st)
        # 标题：原镜像源集（bond 799 + event 根目录 230，path 不带子目录）沿用旧索引标题
        #（镜像 DataType=title 的 g_tw_cn 全名）；ExcelDB #title 是对话话题名（如 1000020
        # 「珍贵的」vs 镜像「提高工作热情的方法」），只用于镜像未覆盖的集
        if "/" not in old["path"].replace("/res/story/", "", 1):
            rec["title"] = old["title"] or rec["title"]
        # 落盘路径：沿用旧条目 path（/res/story/... -> resources/story/...）
        rel = old["path"].replace("/res/story/", "", 1)
        dst = STORY_OUT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        chars: list[str] = []
        lines = 0
        for nd in rec["nodes"]:
            if nd["op"] == "script":
                lines += 1
                if nd.get("speaker") and nd["speaker"] not in chars:
                    chars.append(nd["speaker"])
        entry = {
            "id": old["id"], "type": old["type"], "title": rec["title"],
            "summary": old.get("summary", ""), "path": old["path"],
            "nodes": len(rec["nodes"]), "lines": lines, "chars": chars,
        }
        if old.get("events"):
            entry["events"] = old["events"]
        new_entries.append(entry)

    # ---- 2. voice_needed.json（全 3410 组行级收集，含主线卷组） ----
    voices: dict[str, dict] = {}
    voice_lines = 0
    mapped = 0
    for gid, rows in conv.groups.items():
        for r in rows:
            vid = r.get("voice_id") or 0
            if not vid:
                continue
            voice_lines += 1
            key = str(vid)
            if key not in voices:
                vp = conv.stage["voice"].get(vid) or {}
                if vp:
                    mapped += 1
                voices[key] = {k: vp[k] for k in ("kr", "jp") if vp.get(k)}
    kr_size = kr_main_bytes()
    voice_needed = {
        "source": "ExcelDB ScenarioScriptDBSchema.voice_id -> VoiceDBSchema (fbs VoiceExcel: "
                  "Id/Nation_[JP=2,KR=4]/Path[]；tools/fetch/stage_lookup.py)",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "stats": {
            "voiceLines": voice_lines,
            "uniqueVoiceIds": len(voices),
            "mappedToPath": mapped,
            "unmappedVoiceIds": len(voices) - mapped,
            "krMainLocalBytes": kr_size,
            "estimatedKrVoiceTotal": f"国服(Steam)剧情语音 KR_Main 分卷容器实测 {kr_size:,} B ≈ {kr_size/2**20:.0f} MiB"
            if kr_size else "本机客户端容器不可读，未估算",
        },
        "downloadHint": {
            "kr": "Audio/VOC_KR/... -> CDN MediaResources/Audio/VOC_KR/... （resource-data.json 增量清单仅覆盖 1284 条）",
            "jp": "Audio/VOC_JP/... -> 同族 JP 路径（日服语音，可选）",
            "localClient": "本机 Steam 版 KR_Main 分卷容器 12 个（VOC_KR/KR_Main/*.molru，molru 容器内 Ogg 明文）",
        },
        "voices": dict(sorted(voices.items(), key=lambda kv: int(kv[0]))),
    }
    (DATA_OUT / "voice_needed.json").write_text(
        json.dumps(voice_needed, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- 3. cg_needed.json ----
    cgs: Counter = Counter()
    for rows in conv.groups.values():
        for r in rows:
            pn = (r.get("popup_file_name") or "").strip()
            if pn:
                cgs[pn] += 1
    cg_needed = {
        "source": "ExcelDB ScenarioScriptDBSchema.PopupFileName（3519 行 / 464 唯一）",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "resourcePath": f"{CG_PATH_PREFIX}/{{name}}.png（Nexon CDN 与本机 molru 容器均含此目录）",
        "stats": {"uniqueCg": len(cgs), "rows": sum(cgs.values())},
        "titleKind": [k for k in cgs if k.lower() == "popuptitle"],
        "cgs": [{"name": k, "rows": v} for k, v in sorted(cgs.items())],
    }
    (DATA_OUT / "cg_needed.json").write_text(
        json.dumps(cg_needed, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- 4. story_index 落盘（先备份） ----
    bak = DATA_OUT / f"story_index.json.bak-{TODAY}-story-data"
    if not bak.exists():
        shutil.copy2(DATA_OUT / "story_index.json", bak)
    final_index = new_entries + preserved
    (DATA_OUT / "story_index.json").write_text(
        json.dumps(final_index, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- 统计汇报 ----
    print("\n=== 节点统计 ===")
    print(dict(stats_total.most_common()))
    tc = Counter(e["type"] for e in final_index)
    print(f"story_index：{len(final_index)} 条（{dict(tc)}）")
    print(f"voice_needed：{len(voices)} 唯一 voiceId（行 {voice_lines}，路径命中 {mapped}）")
    print(f"cg_needed：{len(cgs)} 唯一 CG 名")
    print(f"备份：{bak}")


if __name__ == "__main__":
    main()
