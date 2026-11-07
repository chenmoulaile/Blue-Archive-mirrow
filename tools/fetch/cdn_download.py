# -*- coding: utf-8 -*-
"""从 Nexon 全球服 BA CDN (ba.dn.nexoncdn.co.kr) 批量下载剧情 BG 图与 BGM。

清单来源: .scratch/molru/resource-data.json (patch v1.1 version-check -> patch.resource_path)
输出:
  repo/resources/images/BG_*.jpg        (2375 张剧情背景)
  repo/resources/bgm/<id>.ogg           (385 首, id 来自 data/bgm_map.json 的 Theme_*/AMB_* 体系)
断点续传: 目标文件存在且大小与清单 resource_size 一致则跳过; .part 临时文件 + 原子改名。
并发 4, 失败重试 3 次。
"""
import json
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(r"D:/Bluearchive/repo")
MANIFEST = Path(r"D:/Bluearchive/.scratch/molru/resource-data.json")
BGM_MAP = ROOT / "data" / "bgm_map.json"
IMG_DIR = ROOT / "resources" / "images"
BGM_DIR = ROOT / "resources" / "bgm"
LOG = Path(r"D:/Bluearchive/.scratch/cdn_track/download_log.txt")
CDN_BASE = "https://ba.dn.nexoncdn.co.kr/1571873795/e55cf95d9e554905"

BG_MARK = "MediaResources/UIs/03_Scenario/01_Background/"  # 组不限 (GameData 2033+291, Preload 51)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BAAD/1.0"}


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def build_tasks():
    d = json.loads(MANIFEST.read_text(encoding="utf-8"))
    res = d["resources"]
    tasks = {}  # dst_path -> (url, expected_size, rel_path)

    # --- BG 背景 ---
    for r in res:
        p = r["resource_path"]
        if BG_MARK in p and p.lower().endswith(".jpg"):
            name = p.rsplit("/", 1)[-1]
            dst = IMG_DIR / name
            tasks[dst] = (f"{CDN_BASE}/{p}", r["resource_size"], p)
    n_bg = len(tasks)

    # --- BGM: id <- bgm_map.json ids[id].source 文件名 <-> CDN basename ---
    bgm_cdn = {
        r["resource_path"].rsplit("/", 1)[-1]: r
        for r in res
        if r["resource_path"].split("/")[1:4] == ["MediaResources", "Audio", "BGM"]
        and r["resource_path"].lower().endswith(".ogg")
    }
    m = json.loads(BGM_MAP.read_text(encoding="utf-8"))
    ids = m["ids"]
    n_bgm = 0
    for bid, meta in ids.items():
        src = meta.get("source", "") if isinstance(meta, dict) else ""
        base = src.rsplit("/", 1)[-1]
        r = bgm_cdn.get(base)
        if r is None:
            continue
        # 优先 GameData 组, 同名冲突时 GameData 覆盖 Preload
        dst = BGM_DIR / f"{bid}.ogg"
        tasks[dst] = (f"{CDN_BASE}/{r['resource_path']}", r["resource_size"], r["resource_path"])
        n_bgm += 1
    log(f"tasks: BG={n_bg} BGM={n_bgm} total={len(tasks)}")
    return tasks


def fetch(url: str, dst: Path, expected: int, rel: str) -> str:
    if dst.exists() and dst.stat().st_size == expected and expected > 0:
        return "skip"
    tmp = dst.with_suffix(dst.suffix + ".part")
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp, tmp.open("wb") as f:
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
    try:
        tmp.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
    return f"FAIL {rel}: {last_err}"


def main() -> int:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    BGM_DIR.mkdir(parents=True, exist_ok=True)
    tasks = build_tasks()
    ok = skip = fail = 0
    fails = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(fetch, u, p, s, rel): (p, rel) for p, (u, s, rel) in tasks.items()}
        done = 0
        for fut in as_completed(futs):
            done += 1
            r = fut.result()
            if r == "ok":
                ok += 1
            elif r == "skip":
                skip += 1
            else:
                fail += 1
                fails.append(r)
            if done % 100 == 0 or done == len(futs):
                log(f"progress {done}/{len(futs)} ok={ok} skip={skip} fail={fail} "
                    f"elapsed={time.time()-t0:.0f}s")
    log(f"DONE ok={ok} skip={skip} fail={fail} elapsed={time.time()-t0:.0f}s")
    if fails:
        (LOG.parent / "download_fails.txt").write_text("\n".join(fails), encoding="utf-8")
        log(f"failures written to {LOG.parent/'download_fails.txt'}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
