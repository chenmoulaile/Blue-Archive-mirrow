#!/usr/bin/env python3
"""任务2 补扫：gacha/arona/plana/loading/title 相关 Texture2D/Sprite 清单+提取。

候选 bundle（catalog 实测枚举，见 DataSupplyResult）：
  assets-_mx-etceffects-uifx-gachat_aropla_ssr_fx-*   抽卡 SSR 演出 FX（阿罗娜+普拉娜）
  assets-_mx-effectsfreezed-*gacha*                   抽卡光效纹理/材质
  assets-_mx-effectsfreezed-ui-uigachassrchartext-*   SSR 录取文字 UI
  assets-_mx-etceffects-uifx-uiworkaronascenefx-*     阿罗娜场景 FX
  assets-_mx-npcs-arona-*textures* / plana-*textures* 阿罗娜/普拉娜贴图
  assets-_mx-spinecharacters-arona_spr-*              阿罗娜 spr spine
  *uis-01_common-12_loading-*                         加载画面
  assets-_mx-uis-_mxcommon-*                          公共 UI 图集（title/logo 候选）

模式：
  --inventory  只列 Texture2D/Sprite 名与尺寸
  --extract    把命中 RX_KEEP 的纹理/Sprite 切图落 resources/ui/extra/<Name>.png
               并生成 .scratch/ui/extra_stage.json（供追加 ui_atlas.json 用）
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

import UnityPy

GAME_DIR = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/Windows")
CATALOG = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Catalog/Windows/catalog_Windows.bytes")
REPO = Path(__file__).resolve().parents[2]

RX_KEEP = re.compile(
    r"(arona|plana|gacha|recruit|loading|logotype|title|sign|ticket|award|accept|enroll|stamp|illumination|sparkle|star|card)",
    re.I,
)


def catalog_bundles() -> set[str]:
    data = CATALOG.read_bytes()
    return {
        m.group().decode()
        for m in re.finditer(rb"[A-Za-z0-9_.\-]*_assets_all_\d+\.bundle", data)
    }


def select_bundles(names: set[str]) -> list[str]:
    pats = [
        "etceffects-uifx-gachat_aropla_ssr_fx",
        "effectsfreezed-effect_list-gacha",
        "effectsfreezed-material-gacha",
        "effectsfreezed-texture-gacha",
        "uigachassrchartext",
        "uiworkaronascenefx",
        "npcs-arona-",
        "npcs-plana-",
        "spinecharacters-arona_spr",
        "uis-01_common-12_loading",
        "uis-00_images-",
        "uis-01_common-08_lobbyillust",
        "uis-03_scenario-03_emoticon",
        "uis-03_scenario-04",
        "uis-03_scenario-05_mode",
        "uis-03_scenario-06_event",
    ]
    return sorted(n for n in names if any(p in n for p in pats))


# 专用 FX/角色 bundle：整个 bundle 都是演出素材，不做名字过滤
RX_ALL_BUNDLE = re.compile(
    r"(gachat_aropla_ssr_fx|effectsfreezed-.*gacha|uigachassrchartext|uiworkaronascenefx"
    r"|npcs-arona-|npcs-plana-|spinecharacters-arona_spr)",
    re.I,
)
# 桃信照片消息
RX_MO = re.compile(r"^Mo_[A-Za-z]", re.I)
# 明显无关的杂讯
RX_SKIP = re.compile(r"^(BattlePass_|Popup_LevelReward_)", re.I)


def newest_wins(bundles: list[str]) -> dict[str, tuple[str, object, str]]:
    """按 bundle 日期组内 newest-wins（后缀带 assets/prefabs/textures 的互不覆盖：key 加种类）。"""
    def date_of(fn: str) -> str:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", fn)
        return m.group(1) if m else "0000-00-00"

    best: dict[str, tuple[str, object, str]] = {}
    for fn in bundles:
        d = date_of(fn)
        env = UnityPy.load(str(GAME_DIR / fn))
        for obj in env.objects:
            if obj.type.name not in ("Texture2D", "Sprite"):
                continue
            try:
                o = obj.read()
                nm = o.m_Name
            except Exception:
                continue
            key = f"{obj.type.name}:{nm}"
            if key not in best or d > best[key][0]:
                best[key] = (d, obj, fn)
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", action="store_true")
    ap.add_argument("--extract", action="store_true")
    args = ap.parse_args()

    names = catalog_bundles()
    sel = select_bundles(names)
    print(f"selected bundles: {len(sel)}")
    for b in sel:
        print("  ", b)

    best = newest_wins(sel)
    print(f"unique Texture2D/Sprite: {len(best)}")

    if args.inventory:
        hits = 0
        for key in sorted(best):
            if RX_KEEP.search(key):
                hits += 1
                print("  HIT", key)
        print(f"RX_KEEP hits: {hits}/{len(best)}")
        return 0

    out_dir = REPO / "resources" / "ui" / "extra"
    out_dir.mkdir(parents=True, exist_ok=True)
    stage = {"generated": datetime.now().isoformat(timespec="seconds"), "entries": {}}
    ok = fail = 0
    for key, (d, obj, fn) in sorted(best.items()):
        typ, nm = key.split(":", 1)
        bundle_all = bool(RX_ALL_BUNDLE.search(fn))
        keep = bundle_all or RX_KEEP.search(key) or RX_MO.match(nm)
        if not keep or RX_SKIP.match(nm):
            continue
        try:
            if typ == "Texture2D":
                img = obj.read().image
            else:
                sp = obj.read()
                img = sp.image
        except Exception as e:  # noqa: BLE001
            stage["entries"][key] = {"error": f"{type(e).__name__}: {e}"}
            fail += 1
            continue
        dst = out_dir / f"{nm}.png"
        img.save(dst)
        stage["entries"][key] = {
            "file": f"resources/ui/extra/{nm}.png",
            "w": img.width, "h": img.height,
            "type": typ, "date": d, "bundle": fn,
        }
        ok += 1
    (Path("D:/Bluearchive/.scratch/ui/extra_stage.json")).write_text(
        json.dumps(stage, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"extracted={ok} fail={fail} -> resources/ui/extra/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
