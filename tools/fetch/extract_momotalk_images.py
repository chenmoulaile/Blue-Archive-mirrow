#!/usr/bin/env python3
"""提取桃信照片消息 Mo_*_01 纹理 -> resources/ui/extra/（20 个，来自 momotalk ImagePath）。"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import UnityPy

GD = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "resources" / "ui" / "extra"
STAGE = Path("D:/Bluearchive/.scratch/ui/extra_stage.json")

NEED = {
    "Mo_CH0101_01", "Mo_CH0139_01", "Mo_CH0167_01", "Mo_CH0218_01", "Mo_CH0222_01",
    "Mo_CH0250_01", "Mo_CH0274_01", "Mo_Cherino_01", "Mo_Hare_01", "Mo_Hoshino_01",
    "Mo_Iori_01", "Mo_Miyako_01", "Mo_Nodoka_01", "Mo_Serika_01", "Mo_Sumire_01",
    "Mo_Tsurugi_01", "Mo_Yuuka_01", "Mo_Yuuka_02", "Mo_Yuzu_01", "Mo_kazusa_01",
}


def main() -> int:
    cat = CATALOG.read_bytes()
    names = {m.group().decode() for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", cat)}
    sel = sorted(n for n in names if "uis-03_scenario-02_character" in n and "prefabs" in n)
    print(f"scanning {len(sel)} prefab bundles for {len(NEED)} Mo_ textures")
    found = {}
    for i, fn in enumerate(sel):
        if len(found) == len(NEED):
            break
        env = UnityPy.load(str(GD / fn))
        for obj in env.objects:
            if obj.type.name != "Texture2D":
                continue
            try:
                t = obj.read()
                nm = t.m_Name
            except Exception:
                continue
            if nm in NEED and nm not in found:
                found[nm] = (fn, obj)
        if i % 100 == 0:
            print(f"  {i}/{len(sel)} bundles, found {len(found)}")
    print(f"found {len(found)}/{len(NEED)}")
    OUT.mkdir(parents=True, exist_ok=True)
    stage = json.loads(STAGE.read_text(encoding="utf-8")) if STAGE.exists() else {"entries": {}}
    ok = 0
    for nm, (fn, obj) in sorted(found.items()):
        try:
            img = obj.read().image
            img.save(OUT / f"{nm}.png")
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL {nm}: {e}")
            continue
        stage["entries"][f"Texture2D:{nm}"] = {
            "file": f"resources/ui/extra/{nm}.png", "w": img.width, "h": img.height,
            "type": "Texture2D", "bundle": fn, "origin": "momotalk-image-message",
        }
        ok += 1
    STAGE.write_text(json.dumps(stage, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"extracted {ok} -> resources/ui/extra/")
    missing = NEED - set(found)
    if missing:
        print(f"missing: {sorted(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
