# -*- coding: utf-8 -*-
"""name_molru.py — 用解密的 molru 尾部 JSON 索引给 22917 个已拆出 ogg 命名归位。

算法链 (GameAssembly.dll 实测还原 + BA-AX 交叉验证):
  容器: [4B magic '4t+$'][1B ver=01][16B IV @5..21][段数据 @53...][AES-CBC JSON 索引][u32 LE json_len]
  key  = SHA256(UTF8(Path.GetFileName(path)))      # 32B → AES-256-CBC
  iv   = file[5:21]
  索引 = JSON {"<Name>.ogg": {"Path","Offset","Length","Sha256"}}, 条目按 Offset 升序
  段序 = 索引序 = 物理序 = 上轮拆分的 seg_XXXXX 序 (已实测三序一致)

命名:
  BGM   369 段 → resources/molru_named/bgm/<id>.ogg        (id = data/bgm_map.json ids)
  VOC_JP 22548 段 → resources/molru_named/voice/JP_<学生>/<clip>.ogg
每段做 SHA256 校验 (JSON Sha256 字段); 校验失败或无名的进 molru_named/.unnamed/。
"""
import hashlib
import json
import os
import struct
import sys
import time

from Crypto.Cipher import AES

REPO = r"D:/Bluearchive/repo"
MR = r"D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/GameData/MediaResources/Audio"
IDX_PATH = r"D:/Bluearchive/.scratch/molru/molru_indexes.json"
OUT_BGM = os.path.join(REPO, "resources", "molru_named", "bgm")
OUT_VOC = os.path.join(REPO, "resources", "molru_named", "voice")
OUT_UNNAMED = os.path.join(REPO, "resources", "molru_named", ".unnamed")


def decrypt_index(path):
    """解密单个 molru 的尾部 JSON 索引。返回 (list[(name, entry)], error)"""
    fn = os.path.basename(path)
    with open(path, "rb") as f:
        head = f.read(21)
        if head[:4] != b"4t+$":
            return None, f"bad magic {head[:4]!r}"
        iv = head[5:21]
        sz = os.path.getsize(path)
        f.seek(sz - 4)
        json_len = struct.unpack("<i", f.read(4))[0]
        if not 0 < json_len <= sz:
            return None, f"bad json_len {json_len}"
        f.seek(sz - 4 - json_len)
        enc = f.read(json_len)
    key = hashlib.sha256(fn.encode("utf-8")).digest()
    try:
        dec = AES.new(key, AES.MODE_CBC, iv).decrypt(enc)
        d = json.loads(dec[: -dec[-1]].decode("utf-8"))
    except Exception as e:
        return None, f"aes/json: {e}"
    return list(d.items()), None


def sha256_file(path, buf=None):
    if buf is not None:
        return hashlib.sha256(buf).hexdigest()
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def place(src, dst, expect_sha, tag, report):
    """校验 + 复制。返回 True/False。"""
    data = open(src, "rb").read()
    got = hashlib.sha256(data).hexdigest()
    if expect_sha and got != expect_sha.lower():
        report["sha_fail"].append({"tag": tag, "src": src, "expect": expect_sha, "got": got})
        dst = os.path.join(OUT_UNNAMED, os.path.basename(src))
        os.makedirs(OUT_UNNAMED, exist_ok=True)
    with open(dst, "wb") as f:
        f.write(data)
    return got == (expect_sha or "").lower()


def main():
    t0 = time.time()
    idx = json.load(open(IDX_PATH, encoding="utf-8"))
    bgm_map = json.load(open(os.path.join(REPO, "data", "bgm_map.json"), encoding="utf-8"))
    cat = json.load(open(os.path.join(REPO, "data", "molru_catalog.json"), encoding="utf-8"))

    # catalog: value basename(casefold) -> (key, value)，用于命名回查与统计
    cat_by_base = {}
    for e in cat:
        v = e["value"]
        if v.startswith("Audio/BGM/") or v.startswith("Audio/VOC_JP/"):
            cat_by_base.setdefault(v.split("/")[-1].casefold(), []).append(e)

    # id 表: source basename(casefold) -> id
    id_by_base = {}
    for vid, meta in (bgm_map.get("ids") or {}).items():
        base = (meta.get("source") or "").split("/")[-1]
        if base:
            id_by_base[base.casefold()] = vid

    report = {
        "bgm_named": 0, "bgm_unnamed": 0, "bgm_sha_fail": 0,
        "voc_named": 0, "voc_unnamed": 0, "voc_sha_fail": 0,
        "sha_fail": [], "unnamed": [], "packs_missing_segdir": [],
    }
    manifest = {"bgm": {}, "voc": {}}
    unnamed_dir = OUT_UNNAMED
    os.makedirs(unnamed_dir, exist_ok=True)

    # ---------- BGM ----------
    os.makedirs(OUT_BGM, exist_ok=True)
    src_dir = os.path.join(REPO, "resources", "molru_unnamed", "bgm")
    entries, err = decrypt_index(os.path.join(MR, "BGM.molru"))
    assert entries, err
    for i, (name, ent) in enumerate(entries):
        seg = os.path.join(src_dir, f"seg_{i:05d}.ogg")
        vid = id_by_base.get(name.casefold())
        cat_e = cat_by_base.get(name.casefold())
        if vid is None:
            report["bgm_unnamed"] += 1
            report["unnamed"].append({"pack": "BGM.molru", "i": i, "name": name,
                                      "catalog_keys": [e["key"] for e in (cat_e or [])]})
            dst = os.path.join(unnamed_dir, f"bgm_seg_{i:05d}_{name}")
        else:
            dst = os.path.join(OUT_BGM, vid + ".ogg")
        ok = place(seg, dst, ent["Sha256"], f"bgm/{i}:{name}", report)
        if ok and vid:
            report["bgm_named"] += 1
            manifest["bgm"][vid] = {"pack": "BGM.molru", "offset": ent["Offset"],
                                    "length": ent["Length"], "sha256": ent["Sha256"],
                                    "catalog_key": (cat_e[0]["key"] if cat_e else None)}
        elif not ok:
            report["bgm_sha_fail"] += 1

    # ---------- VOC_JP ----------
    for pack, d in sorted(idx.items()):
        if not pack.startswith("JP_"):
            continue
        stem = pack[:-6]  # JP_Airi
        src_dir = os.path.join(REPO, "resources", "molru_unnamed", "voc", stem)
        if not os.path.isdir(src_dir):
            report["packs_missing_segdir"].append(pack)
            continue
        out_dir = os.path.join(OUT_VOC, stem)
        os.makedirs(out_dir, exist_ok=True)
        entries, err = decrypt_index(os.path.join(MR, "VOC_JP", pack))
        if not entries:
            report["unnamed"].append({"pack": pack, "error": err})
            continue
        named_list = []
        for i, (name, ent) in enumerate(entries):
            seg = os.path.join(src_dir, f"seg_{i:05d}.ogg")
            clip = name  # pack 索引键 = 游戏内真实文件名 (与 catalog value 大小写一致)
            cat_e = cat_by_base.get(name.casefold())
            dst = os.path.join(out_dir, clip)
            ok = place(seg, dst, ent["Sha256"], f"voc/{stem}/{i}:{name}", report)
            if ok:
                report["voc_named"] += 1
                manifest["voc"][f"{stem}/{clip}"] = {
                    "pack": pack, "offset": ent["Offset"], "length": ent["Length"],
                    "sha256": ent["Sha256"],
                    "catalog_key": (cat_e[0]["key"] if cat_e else None)}
            else:
                report["voc_sha_fail"] += 1
                report["unnamed"].append({"pack": pack, "i": i, "name": name, "reason": "sha256"})
            named_list.append({"i": i, "name": clip, "sha_ok": ok})
        manifest.setdefault("voc_seq", {})[stem] = named_list

    # ---------- 落盘 ----------
    with open(os.path.join(REPO, "resources", "molru_named", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    with open(os.path.join(REPO, "resources", "molru_named", "naming_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    # 更新 bgm_map 统计
    bgm_map["_stats"]["named"] = report["bgm_named"]
    for vid in manifest["bgm"]:
        if vid in (bgm_map.get("ids") or {}):
            bgm_map["ids"][vid]["extracted"] = True
    with open(os.path.join(REPO, "data", "bgm_map.json"), "w", encoding="utf-8") as f:
        json.dump(bgm_map, f, ensure_ascii=False, indent=1)

    print(f"BGM   named={report['bgm_named']} unnamed={report['bgm_unnamed']} sha_fail={report['bgm_sha_fail']}")
    print(f"VOCJP named={report['voc_named']} sha_fail={report['voc_sha_fail']}")
    print(f"missing segdirs: {report['packs_missing_segdir']}")
    print(f"done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
