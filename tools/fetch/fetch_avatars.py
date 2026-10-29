#!/usr/bin/env python3
"""
下载学生头像与记忆大厅封面图

  resources/avatar/{学生ID}.png       桃信/图鉴用
  resources/lobby/{原文件名}          回忆大厅选择列表的封面
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import threading
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RES = ROOT / "resources"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}
lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0}


def norm(u: str) -> str:
    return ("https:" + u) if u.startswith("//") else u


def dl(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        with lock:
            stat["skip"] += 1
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
            if not data:
                raise RuntimeError("empty")
            dest.write_bytes(data)
            with lock:
                stat["ok"] += 1
            return
        except Exception:
            if i == 2:
                with lock:
                    stat["fail"] += 1


def main() -> None:
    students = json.loads((DATA / "students_full.json").read_text(encoding="utf-8"))
    jobs = []
    for s in students:
        if s.get("avatar"):
            jobs.append((norm(s["avatar"]), RES / "avatar" / f"{s['id']}.png"))
        lobby = s.get("recollection_lobby_image")
        if lobby:
            name = urllib.parse.unquote(lobby.rsplit("/", 1)[-1])
            jobs.append((norm(lobby), RES / "lobby" / name))
    print(f"待下载 {len(jobs)} 个文件")

    with cf.ThreadPoolExecutor(10) as ex:
        list(ex.map(lambda j: dl(j[0], j[1]), jobs))

    print(f"✓ 头像/大厅图：新增 {stat['ok']} 跳过 {stat['skip']} 失败 {stat['fail']}")


if __name__ == "__main__":
    main()
