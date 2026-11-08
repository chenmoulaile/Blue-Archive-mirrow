#!/usr/bin/env python3
"""提取 arona_spr spine 模型（抽卡演出用）-> resources/spine/arona_spr/。
来源：assets-_mx-spinecharacters-arona_spr-_mxdependency-*.bundle（catalog 实测 1+1 个）。
skel=SkeletonAsset/TextAsset，atlas=TextAsset，png=Texture2D。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import UnityPy

GD = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
OUT = Path("D:/Bluearchive/repo/resources/spine/arona_spr")

cat = CATALOG.read_bytes()
names = {m.group().decode() for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", cat)}
sel = sorted(n for n in names if "spinecharacters-arona_spr" in n)
print("bundles:", sel)

OUT.mkdir(parents=True, exist_ok=True)
got = {}
for fn in sel:
    env = UnityPy.load(str(GD / fn))
    for obj in env.objects:
        t = obj.type.name
        if t not in ("SkeletonAsset", "TextAsset", "Texture2D"):
            continue
        try:
            o = obj.read()
            nm = o.m_Name
        except Exception:
            continue
        if t == "Texture2D":
            if nm not in got or got[nm][0] == "png":
                continue
        if nm in got and got[nm][0] != "png":
            continue
        if t == "SkeletonAsset":
            data = bytes(o.m_Script) if hasattr(o, "m_Script") else None
            ext = ".skel"
        elif t == "TextAsset":
            data = o.m_Script
            data = data.encode("utf-8", "surrogateescape") if isinstance(data, str) else bytes(data)
            ext = ".atlas" if "atlas" in nm.lower() or b"\n" in (data or b"")[:2000] else ".txt"
        else:
            img = o.image
            img.save(str(OUT / f"{nm}.png"))
            got[nm] = ("png", fn)
            continue
        if data:
            (OUT / f"{nm}{ext}").write_bytes(data)
            got[nm] = (ext, fn)

print("extracted:", sorted(got))
for f in sorted(OUT.iterdir()):
    print("  ", f.name, f.stat().st_size)
