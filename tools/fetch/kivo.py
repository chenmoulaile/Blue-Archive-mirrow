#!/usr/bin/env python3
"""
kivo.wiki 素材抓取工具（纯标准库，可断点续传）

数据源：https://api.kivo.wiki/api/v1/  （基沃托斯古书馆公开 API）
静态资源：https://static.kivo.wiki/

用法：
    python kivo.py meta                          # 抓取全部元数据到 data/
    python kivo.py spine --type home             # 下载全部回忆大厅 Spine（434）
    python kivo.py spine --type spr --limit 50   # 下载前 50 个立绘 Spine
    python kivo.py gallery --albums 1,2,83       # 下载指定相册图片
    python kivo.py gallery --albums all          # 下载全部 36 个相册（约 19k 图）
    python kivo.py voice --limit 20              # 下载指定学生语音
    python kivo.py status                        # 查看本地已下载统计

所有素材版权归 NAT GAMES / NEXON 所有，仅限个人学习与非商业同人使用。
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.kivo.wiki/api/v1"
STATIC = "https://static.kivo.wiki"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RES = ROOT / "resources"

_lock = threading.Lock()
_stat = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0}


def log(msg: str) -> None:
    with _lock:
        print(msg, flush=True)


def http_json(url: str, retry: int = 4) -> dict:
    """带指数退避的 JSON 请求。"""
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.8 * (2**i) + random.random())
    raise RuntimeError(f"请求失败 {url}: {last}")


def http_download(url: str, dest: Path, retry: int = 3) -> bool:
    """下载单个文件，已存在且非空则跳过。返回是否真的下载了。"""
    if dest.exists() and dest.stat().st_size > 0:
        with _lock:
            _stat["skip"] += 1
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://kivo.wiki/"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if not data:
                raise RuntimeError("空响应")
            tmp.write_bytes(data)
            tmp.replace(dest)
            with _lock:
                _stat["ok"] += 1
                _stat["bytes"] += len(data)
            return True
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (2**i) + random.random())
    with _lock:
        _stat["fail"] += 1
    log(f"  ✗ {url} ({last})")
    return False


def norm(url: str) -> str:
    """把 //static.kivo.wiki/... 补全为 https。"""
    if url.startswith("//"):
        return "https:" + url
    return url


def safe_name(s: str) -> str:
    """把 URL 路径转成本地安全路径（保留中文）。"""
    return urllib.parse.unquote(s).replace("\\", "/")


def rel_from_static(url: str) -> str:
    """//static.kivo.wiki/images/gallery/1.xxx/a.jpg -> images/gallery/1.xxx/a.jpg"""
    u = norm(url)
    prefix = STATIC + "/"
    if u.startswith(prefix):
        return safe_name(u[len(prefix):])
    return safe_name(urllib.parse.urlparse(u).path.lstrip("/"))


def parallel(fn, items, workers: int, label: str) -> None:
    total = len(items)
    done = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(fn, it) for it in items]
        for f in cf.as_completed(futs):
            done += 1
            if done % 50 == 0 or done == total:
                el = time.time() - t0
                rate = done / el if el > 0 else 0
                eta = (total - done) / rate if rate > 0 else 0
                log(
                    f"  {label} {done}/{total}  成功{_stat['ok']} 跳过{_stat['skip']} "
                    f"失败{_stat['fail']}  {_stat['bytes']/1e6:.1f}MB  "
                    f"{rate:.1f}/s  ETA {eta/60:.1f}min"
                )


# ---------------------------------------------------------------- 元数据


def fetch_meta() -> None:
    DATA.mkdir(parents=True, exist_ok=True)

    log("→ Spine 索引")
    first = http_json(f"{API}/data/spines/?page=1&page_size=100")
    max_page = first["data"]["max_page"]
    spines = list(first["data"]["spine"])
    for p in range(2, max_page + 1):
        spines += http_json(f"{API}/data/spines/?page={p}&page_size=100")["data"]["spine"]
    (DATA / "spine_index.json").write_text(
        json.dumps(spines, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"  {len(spines)} 条")

    log("→ 画廊索引")
    g = http_json(f"{API}/galleries/?page=1&page_size=100")["data"]
    albums = g["gallery"]
    details = []

    def one(a):
        d = http_json(f"{API}/galleries/{a['id']}")["data"]
        return {
            "id": a["id"],
            "title": a["title"],
            "introduction": d.get("introduction", ""),
            "categories": [
                {
                    "name": c.get("name", ""),
                    "introduction": c.get("introduction", ""),
                    "images": [norm(i["image"]) for i in (c.get("images") or [])],
                }
                for c in (d.get("categorys") or [])
            ],
        }

    with cf.ThreadPoolExecutor(6) as ex:
        details = list(ex.map(one, albums))
    (DATA / "gallery_index.json").write_text(
        json.dumps(details, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"  {len(details)} 个相册 / {sum(len(c['images']) for a in details for c in a['categories'])} 张图")

    log("→ 学生资料")
    s0 = http_json(f"{API}/data/students/?page=1&page_size=50")["data"]
    students = list(s0["students"])
    for p in range(2, s0["max_page"] + 1):
        students += http_json(f"{API}/data/students/?page={p}&page_size=50")["data"]["students"]
    (DATA / "students_list.json").write_text(
        json.dumps(students, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"  {len(students)} 名学生（列表）")

    log("→ 学生详情（含 spine / 语音 / 家具 / 礼物）")
    ids = [s["id"] for s in students]

    def detail(i):
        try:
            return http_json(f"{API}/data/students/{i}")["data"]
        except Exception:
            return None

    with cf.ThreadPoolExecutor(6) as ex:
        full = [d for d in ex.map(detail, ids) if d]
    (DATA / "students_full.json").write_text(
        json.dumps(full, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"  {len(full)} 条详情")

    log("→ 卡池 / 活动时间线")
    for t, fname in (("Gacha", "gacha_banners.json"), ("Event", "event_timeline.json")):
        page, rows, maxp = 1, [], 1
        while page <= maxp:
            d = http_json(f"{API}/timeline/?page={page}&page_size=100&type={t}")["data"]
            rows += d["timeline"]
            maxp = d["max_page"]
            page += 1
        for r in rows:
            r["image"] = norm(r.get("image") or "")
            r["source_url"] = "https://kivo.wiki/timeline"
        (DATA / fname).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"  {t}: {len(rows)} 条 -> {fname}")

    log("→ 全量时间线（含主线/维护/直播等）")
    page, rows, maxp = 1, [], 1
    while page <= maxp:
        d = http_json(f"{API}/timeline/?page={page}&page_size=100")["data"]
        rows += d["timeline"]
        maxp = d["max_page"]
        page += 1
    for r in rows:
        r["image"] = norm(r.get("image") or "")
    (DATA / "timeline_all.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"  {len(rows)} 条")

    log("✓ 元数据完成")


# ---------------------------------------------------------------- Spine


def fetch_spine(types: list[str], limit: int | None) -> None:
    idx = json.loads((DATA / "spine_index.json").read_text(encoding="utf-8"))
    sel = [s for s in idx if s["type"] in types]
    if limit:
        sel = sel[:limit]
    log(f"→ Spine 下载：{len(sel)} 个模型（type={types}）")

    detail_cache = DATA / "spine_detail.json"
    cache = json.loads(detail_cache.read_text(encoding="utf-8")) if detail_cache.exists() else {}

    def one(s):
        key = str(s["id"])
        if key not in cache:
            try:
                cache[key] = http_json(f"{API}/data/spines/{s['id']}")["data"]
            except Exception:
                return
        d = cache[key]
        files = [d["skel_file"], d["atlas_file"], *d.get("images", [])]
        for f in files:
            http_download(norm(f), RES / "spine" / rel_from_static(f).split("/", 1)[1])

    parallel(one, sel, workers=8, label="spine")
    detail_cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    log(f"✓ Spine 完成：{_stat['ok']} 文件 / {_stat['bytes']/1e6:.1f} MB，失败 {_stat['fail']}")


# ---------------------------------------------------------------- 画廊


def fetch_gallery(albums: list[str]) -> None:
    idx = json.loads((DATA / "gallery_index.json").read_text(encoding="utf-8"))
    if albums and albums[0] == "all":
        sel = idx
    else:
        want = {int(a) for a in albums}
        sel = [a for a in idx if a["id"] in want]
    imgs = [u for a in sel for c in a["categories"] for u in c["images"]]
    log(f"→ 画廊下载：{len(sel)} 个相册 / {len(imgs)} 张图")

    def one(u):
        http_download(u, RES / "images" / rel_from_static(u).split("/", 1)[1])

    parallel(one, imgs, workers=10, label="gallery")
    log(f"✓ 画廊完成：{_stat['ok']} 张 / {_stat['bytes']/1e6:.1f} MB，失败 {_stat['fail']}")


# ---------------------------------------------------------------- 语音


def fetch_voice(limit: int | None, lang: str = "jp", category: str | None = None) -> None:
    full = json.loads((DATA / "students_full.json").read_text(encoding="utf-8"))
    if limit:
        full = full[:limit]
    key = {"jp": "voice", "cn": "voice_cn", "kr": "voice_kr"}[lang]
    jobs = []
    for s in full:
        name = f"{s.get('family_name','')}{s.get('given_name','')}".strip() or str(s["id"])
        if s.get("skin"):
            name += f"_{s['skin']}"
        for v in s.get(key) or []:
            if category and v.get("category") != category:
                continue
            f = v.get("file")
            if f:
                jobs.append((norm(f), name, v.get("description", "voice")))
    log(f"→ 语音下载：{len(jobs)} 条（lang={lang} category={category or '全部'}）")

    def one(j):
        url, name, desc = j
        rel = rel_from_static(url)
        http_download(url, RES / "voice" / name / rel.rsplit("/", 1)[-1])

    parallel(one, jobs, workers=8, label="voice")
    log(f"✓ 语音完成：{_stat['ok']} 条 / {_stat['bytes']/1e6:.1f} MB，失败 {_stat['fail']}")


# ---------------------------------------------------------------- 状态


def status() -> None:
    for sub in ("spine", "images", "voice", "story"):
        d = RES / sub
        if not d.exists():
            print(f"{sub:<8} —  (未创建)")
            continue
        n = size = 0
        for p in d.rglob("*"):
            if p.is_file():
                n += 1
                size += p.stat().st_size
        print(f"{sub:<8} {n:>7} 文件  {size/1e6:>10.1f} MB")
    for f in sorted(DATA.glob("*.json")):
        print(f"data/{f.name:<24} {f.stat().st_size/1e3:>9.1f} KB")


def main() -> None:
    ap = argparse.ArgumentParser(description="kivo.wiki 素材抓取")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("meta", help="抓取全部元数据")
    sub.add_parser("status", help="查看本地统计")

    p = sub.add_parser("spine", help="下载 Spine 模型")
    p.add_argument("--type", default="home", help="home(回忆大厅)/spr(立绘)，逗号分隔")
    p.add_argument("--limit", type=int, default=None)

    p = sub.add_parser("gallery", help="下载画廊图片")
    p.add_argument("--albums", nargs="+", default=["all"])

    p = sub.add_parser("voice", help="下载语音")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--lang", default="jp", choices=["jp", "cn", "kr"])
    p.add_argument("--category", default=None, help="lobby/battle 等，留空为全部")

    a = ap.parse_args()
    t0 = time.time()
    if a.cmd == "meta":
        fetch_meta()
    elif a.cmd == "status":
        status()
    elif a.cmd == "spine":
        fetch_spine([t.strip() for t in a.type.split(",")], a.limit)
    elif a.cmd == "gallery":
        fetch_gallery(a.albums)
    elif a.cmd == "voice":
        fetch_voice(a.limit, a.lang, a.category)
    log(f"耗时 {time.time()-t0:.1f}s")


if __name__ == "__main__":
    sys.exit(main())
