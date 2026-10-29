#!/usr/bin/env python3
"""
探针：SE 音效到底在不在 bundle 里。

已知
    Media/audio/ 只有 voc_jp、voc_cn、bgm、videos 四个目录，没有 se/。
    所以音效要么在 bundle 的 AudioClip 里，要么根本没有单独资源。

用法
    .venv/Scripts/python.exe tools/fetch/probe_se.py
    .venv/Scripts/python.exe tools/fetch/probe_se.py --export   # 顺手导出到 resources/se

产物
    deliverables/se-probe.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / ".baad" / "cn" / "android" / "raw" / "bundles"
OUT = ROOT / "deliverables" / "se-probe.json"
SE_DIR = ROOT / "resources" / "se"


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="探测 bundle 里的 AudioClip")
    ap.add_argument("--bundles", default=str(DEFAULT_DIR))
    ap.add_argument("--export", action="store_true", help="导出到 resources/se")
    args = ap.parse_args()

    try:
        import UnityPy
    except ImportError:
        log("需要 UnityPy")
        sys.exit(1)

    bundle_dir = Path(args.bundles)
    if not bundle_dir.is_dir():
        log(f"目录不存在：{bundle_dir}")
        sys.exit(1)

    log(f"加载 {bundle_dir} …")
    env = UnityPy.load(str(bundle_dir))

    clips: list[dict] = []
    names: Counter[str] = Counter()
    prefix: Counter[str] = Counter()
    exported = 0

    for obj in env.objects:
        if obj.type.name != "AudioClip":
            continue
        try:
            clip = obj.read()
        except Exception:
            continue
        name = clip.m_Name or f"clip_{obj.path_id}"
        names[name] += 1
        head = name.split("_")[0]
        prefix[head] += 1
        samples = getattr(clip, "samples", None) or {}
        size = sum(len(v) for v in samples.values())
        clips.append({"name": name, "bytes": size, "files": list(samples.keys())[:3]})

        if args.export and samples:
            SE_DIR.mkdir(parents=True, exist_ok=True)
            for fname, data in samples.items():
                ext = Path(fname).suffix or ".wav"
                (SE_DIR / f"{name}{ext}").write_bytes(data)
            exported += 1

    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "bundle_dir": str(bundle_dir),
        "audio_clips": len(clips),
        "unique_names": len(names),
        "name_prefixes": dict(prefix.most_common(20)),
        "samples": clips[:60],
        "exported": exported if args.export else 0,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    log("")
    log(f"AudioClip {len(clips)} 个，去重名字 {len(names)} 个")
    log(f"前缀分布：{dict(prefix.most_common(10))}")
    if clips:
        log(f"样例：{[c['name'] for c in clips[:10]]}")
    if args.export:
        log(f"✓ 导出 {exported} 个到 resources/se/")
    log(f"✓ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
