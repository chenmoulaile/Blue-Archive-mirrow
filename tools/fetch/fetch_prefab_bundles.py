#!/usr/bin/env python3
"""
下载 Nexon KR CDN 的 ui-_mxload-prefabs bundle 群（A-3 九宫格 border 批量解析的原料）。

背景
    本机 .baad/ 的国服 bundle 已被清理，data/ui_nineslice.json 的 474 条 border
    是 2026-11-05 从旧图集导出的快照；11-08 重生成 ui_atlas.json（2536 条）时
    border 字段没有跟过来。要补全 border 需要重新扫 NGUIAtlas 所在的 prefab bundle。
    Nexon CDN 免鉴权（base 见 CDN_BASE），resource-data.json 清单在本机
    .scratch/molru/resource-data.json（patch_version 1718，38176 条）。
    其中 resource_path 形如 GameData/iOS/ui-_mxload-prefabs-*_assets_all_*.bundle
    的共 769 个、约 103 MB。URL 拼法与 .scratch/net2/dl_uis.py 相同：
    {CDN_BASE}/{resource_path}，带浏览器 UA。

断点续传
    目标存在且大小 == resource_size 就跳过；.part + 原子改名；并发 4、重试 3 次。

用法
    .venv/Scripts/python.exe tools/fetch/fetch_prefab_bundles.py           # 全量 769
    .venv/Scripts/python.exe tools/fetch/fetch_prefab_bundles.py --limit 2 # 冒烟

产物
    .scratch/infra/prefab_bundles/*.bundle
    .scratch/infra/prefab_fetch_result.json
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT.parent / ".scratch" / "molru" / "resource-data.json"
DST = ROOT.parent / ".scratch" / "infra" / "prefab_bundles"
RESULT = ROOT.parent / ".scratch" / "infra" / "prefab_fetch_result.json"
CDN_BASE = "https://ba.dn.nexoncdn.co.kr/1571873795/e55cf95d9e554905"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BAAD/1.0"}


def fetch(url: str, dst: Path, expected: int) -> str:
    if dst.exists() and dst.stat().st_size == expected and expected > 0:
        return "skip"
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".bundle.part")
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as f:
                while True:
                    chunk = resp.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
            if tmp.stat().st_size != expected:
                raise IOError(f"size mismatch {tmp.stat().st_size} != {expected}")
            tmp.replace(dst)
            return "ok"
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * (attempt + 1))
    tmp.unlink(missing_ok=True)
    return f"FAIL: {last_err}"


def main() -> None:
    ap = argparse.ArgumentParser(description="下载 KR CDN prefab bundle 群")
    ap.add_argument("--limit", type=int, default=0, help="只下前 N 个（冒烟用）")
    args = ap.parse_args()

    d = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    tasks = []
    for r in d["resources"]:
        p = r["resource_path"]
        name = p.rsplit("/", 1)[-1]
        if name.startswith("ui-_mxload-prefabs-") and p.startswith("GameData/iOS/"):
            tasks.append((f"{CDN_BASE}/{p}", DST / name, r["resource_size"]))
    if args.limit:
        tasks = tasks[: args.limit]
    total_mb = sum(sz for _, _, sz in tasks) / 1048576
    print(f"plan: {len(tasks)} bundles, {total_mb:.1f} MB -> {DST}", flush=True)

    stats = {"ok": 0, "skip": 0, "fail": []}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(fetch, u, dst, sz): (u, dst) for u, dst, sz in tasks}
        for i, fut in enumerate(as_completed(futs), 1):
            r = fut.result()
            if r.startswith("FAIL"):
                u, dst = futs[fut]
                stats["fail"].append({"file": dst.name, "err": r})
            elif r == "ok":
                stats["ok"] += 1
            else:
                stats["skip"] += 1
            if i % 100 == 0:
                print(f"  {i}/{len(futs)} ok={stats['ok']} skip={stats['skip']} fail={len(stats['fail'])}", flush=True)

    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done: ok={stats['ok']} skip={stats['skip']} fail={len(stats['fail'])}")
    print(f"result -> {RESULT}")


if __name__ == "__main__":
    main()
