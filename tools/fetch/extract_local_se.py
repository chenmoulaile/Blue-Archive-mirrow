#!/usr/bin/env python3
"""
从本地 Steam 客户端 bundle 提取 SE 音效，并重建 data/se_index.json。

来源（2026-11-05 本机实测）
    D:/Steam/.../PUB/Resource/GameData/Windows/ 下
    audio-sfx_{ui,ui-sfx_gacha,backgroundeffect,scenarioeffect}-*.bundle
    共 31 个 bundle、1198 个唯一 AudioClip。
    批次关系为增量（跨 bundle Clip 名零重复，实测 1198 名 0 冲突），
    catalog_Windows.bytes 中 31 个文件名全部各出现 2 次（keys+internalIds），
    所以不做"按日期取最新"去重，全部提取。

音频编码（实测）
    m_CompressionFormat=1（Vorbis / FSB5 容器），
    数据内嵌 archive:/CAB-*/CAB-*.resource（m_Resource.m_Offset/m_Size），
    UnityPy 1.25.4 + fsb5 + fmod_toolkit 解码为标准 RIFF wav（22050Hz 为主）。
    注意：clip.m_AudioData 字段本身是 None，必须走 clip.samples（内部走
    m_Resource 分支），直接读 m_AudioData 拿不到数据。

用法
    .venv/Scripts/python.exe tools/fetch/extract_local_se.py
    .venv/Scripts/python.exe tools/fetch/extract_local_se.py --dry-run
    .venv/Scripts/python.exe tools/fetch/extract_local_se.py --no-bgm

产物
    resources/se/<Clip名>.wav|.ogg        客户端 audio.ts:9 按 ogg→mp3→wav 命中任一即可
    data/se_index.json                    {files:{名:'/res/se/名.ext'}}，供 map_se.py 消费
    resources/bgm/<原文件名>.ogg          MediaResources 下的裸 .ogg（--no-bgm 跳过）
    deliverables/se-extract-report.json   对账报告
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

GAME = Path("D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource")
DEFAULT_BUNDLES = GAME / "GameData" / "Windows"
DEFAULT_CATALOG = GAME / "Catalog" / "Windows" / "catalog_Windows.bytes"
DEFAULT_BGM_SRC = GAME / "GameData" / "MediaResources"

SE_DIR = ROOT / "resources" / "se"
BGM_DIR = ROOT / "resources" / "bgm"
INDEX_OUT = ROOT / "data" / "se_index.json"
REPORT_OUT = ROOT / "deliverables" / "se-extract-report.json"
# UnityPy 探针/临时目录约定在 repo 外的 D:/Bluearchive/.scratch/
WORK_DIR = ROOT.parent / ".scratch" / "se" / "bundles"

# Windows 文件名非法字符（Clip 名实测全 ASCII，保险起见清洗）
ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize(name: str) -> str:
    return ILLEGAL.sub("_", name).strip() or "unnamed"


def log(msg: str) -> None:
    print(msg, flush=True)


def sync_bundles(sources: list[Path], work: Path) -> tuple[int, int]:
    """把选中的 bundle 复制进同一个目录（UnityPy load 目录才能正确解引用内嵌 resource）。"""
    work.mkdir(parents=True, exist_ok=True)
    copied = skipped = 0
    for src in sources:
        dst = work / src.name
        if dst.exists() and dst.stat().st_size == src.stat().st_size:
            skipped += 1
            continue
        shutil.copy2(src, dst)
        copied += 1
    # 清掉 work 目录里已不在源清单中的旧 bundle，避免污染
    valid = {s.name for s in sources}
    for old in work.glob("*.bundle"):
        if old.name not in valid:
            old.unlink()
    return copied, skipped


def extract(args) -> dict:
    import UnityPy  # venv 内

    bundle_dir = Path(args.bundles)
    if not bundle_dir.is_dir():
        log(f"bundle 目录不存在：{bundle_dir}")
        sys.exit(1)

    sources = sorted(bundle_dir.glob("audio-sfx_*.bundle"))
    log(f"选中 {len(sources)} 个 audio-sfx_*.bundle（共 {sum(s.stat().st_size for s in sources) / 1e6:.1f} MB）")
    if not sources:
        log("没有可提取的 bundle")
        sys.exit(1)

    # catalog 收录校验（只警告，不过滤）
    cat_names = {}
    if args.catalog and Path(args.catalog).exists():
        cat_bytes = Path(args.catalog).read_bytes()
        for s in sources:
            cat_names[s.name] = s.name.encode() in cat_bytes
        missing = [n for n, ok in cat_names.items() if not ok]
        log(f"catalog 校验：{len(sources) - len(missing)}/{len(sources)} 被收录")
        if missing:
            log(f"  未收录（仍会提取）: {missing}")

    if args.dry_run:
        return {"dry_run": True, "bundles": len(sources), "catalog_covered": sum(cat_names.values())}

    copied, skipped = sync_bundles(sources, Path(args.work_dir))
    log(f"bundle 同步到 {args.work_dir}：复制 {copied}、复用 {skipped}")

    log("UnityPy.load …")
    env = UnityPy.load(str(args.work_dir))

    written: dict[str, str] = {}
    same_skipped = overwritten = 0
    ext_cnt: Counter[str] = Counter()
    clip_by_bundle: Counter[str] = Counter()
    errors: list[str] = []

    for path, obj in env.container.items():
        if obj.type.name != "AudioClip":
            continue
        clip = obj.read()
        name = sanitize(clip.m_Name or f"clip_{obj.path_id}")
        try:
            samples = clip.samples  # 内部走 m_Resource → get_resource_data → fmod 解码
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {type(e).__name__}: {e}")
            continue
        for fname, data in samples.items():
            fname = sanitize(fname)
            ext_cnt[Path(fname).suffix.lower()] += 1
            dst = Path(args.out) / fname
            if dst.exists() and dst.stat().st_size == len(data):
                same_skipped += 1
            else:
                if dst.exists():
                    overwritten += 1
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(data)
            written[name] = f"/res/se/{fname}"
        reader = getattr(clip, "object_reader", None)
        af = getattr(reader, "assets_file", None)
        bn = getattr(getattr(af, "parent", None), "name", "") or ""
        if bn:
            clip_by_bundle[bn] += 1

    log(f"AudioClip {sum(clip_by_bundle.values())} 个（唯一名 {len(written)}），"
        f"新写/覆盖见下，字节相同跳过 {same_skipped}")
    log(f"扩展名分布：{dict(ext_cnt)}")
    if errors:
        log(f"解码失败 {len(errors)} 个（前 5）：{errors[:5]}")

    # 重建 se_index.json（旧 .baad 管线的 676 条目全部是死链，直接替换）
    index = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "count": len(written),
        "source": "steam-local-bundle audio-sfx_* (31 bundles, Vorbis->wav)",
        "files": dict(sorted(written.items())),
    }
    Path(args.index).parent.mkdir(parents=True, exist_ok=True)
    Path(args.index).write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"✓ {Path(args.index).relative_to(ROOT)}（{len(written)} 条）")

    report = {
        "generated": index["generated"],
        "bundle_dir": str(bundle_dir),
        "bundles_selected": len(sources),
        "catalog_covered": sum(cat_names.values()),
        "audio_clips": sum(clip_by_bundle.values()),
        "unique_names": len(written),
        "ext_distribution": dict(ext_cnt),
        "files_same_skipped": same_skipped,
        "files_overwritten": overwritten,
        "decode_errors": errors,
        "clip_count_by_bundle": dict(sorted(clip_by_bundle.items())),
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"✓ {Path(args.report).relative_to(ROOT)}")
    return report


def copy_bgm(args) -> int:
    src_dir = Path(args.bgm_src)
    if not src_dir.is_dir():
        log(f"BGM 源目录不存在，跳过：{src_dir}")
        return 0
    oggs = sorted(src_dir.rglob("*.ogg"))
    log(f"裸 .ogg 共 {len(oggs)} 个，拷贝上限 {args.bgm_limit}")
    dist = Counter(p.parent.relative_to(src_dir).as_posix() for p in oggs)
    for d, c in sorted(dist.items()):
        log(f"  {c:3d}  {d}/")

    n = 0
    for p in oggs:
        if n >= args.bgm_limit:
            log(f"达到上限 {args.bgm_limit}，剩余 {len(oggs) - n} 个未拷")
            break
        head = p.open("rb").read(4)
        if head != b"OggS":
            log(f"  非明文 OggS，跳过：{p.name}（head={head!r}）")
            continue
        dst = Path(args.bgm_out) / p.name
        if not (dst.exists() and dst.stat().st_size == p.stat().st_size):
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dst)
        n += 1
    log(f"✓ BGM 拷贝 {n} 个 → {Path(args.bgm_out).relative_to(ROOT)}/")
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="本地 Steam bundle SE 提取 + se_index 重建")
    ap.add_argument("--bundles", default=str(DEFAULT_BUNDLES))
    ap.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    ap.add_argument("--work-dir", default=str(WORK_DIR))
    ap.add_argument("--out", default=str(SE_DIR))
    ap.add_argument("--index", default=str(INDEX_OUT))
    ap.add_argument("--report", default=str(REPORT_OUT))
    ap.add_argument("--bgm-src", default=str(DEFAULT_BGM_SRC))
    ap.add_argument("--bgm-out", default=str(BGM_DIR))
    ap.add_argument("--bgm-limit", type=int, default=100)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-bgm", action="store_true", help="跳过裸 .ogg→resources/bgm 拷贝")
    args = ap.parse_args()

    report = extract(args)
    bgm = 0 if (args.dry_run or args.no_bgm) else copy_bgm(args)
    if not args.dry_run:
        log("")
        log(f"SE 文件 {report['unique_names']} 个，BGM 拷贝 {bgm} 个")
        log(f"下一步：.venv/Scripts/python.exe tools/fetch/map_se.py")


if __name__ == "__main__":
    main()
