# -*- coding: utf-8 -*-
"""
decrypt_molru.py — BlueArchive .molru 媒体容器解析/拆段工具
================================================================
实测格式（本机 D:/Steam 版，2026-11 会话逆向结论）:

  [0x00] magic   '4t+$' (34 74 2B 24)            4B
  [0x04] version 0x01                             1B
  [0x05] 加密块  （48B，16B 对齐，含义未解——疑似加密 manifest/salt）
  [0x35] Ogg 页链（**明文**，逐页 CRC 通过，多段 vorbis 流串联）
  [EOF-4-表体] 加密条目表（16B 对齐；每文件 4B u32 LE = 表体长度）
  [EOF-4]        u32 LE 表体长度

拆段不依赖表解密：Ogg 页链按 27B 页头 + segment 表步进即可完整切块，
每段 = 一个 vorbis 逻辑流（BOS..EOS），段序即容器物理序。
段名映射依赖 MediaCatalog.bytes（PUB/Resource/Catalog/MediaResources/），
其格式: 头 4B (02 79 05 01)，之后 [tag u8][u32 ~len][u32 len][str] 逐条，
每对 key(tag=0, 小写) / value(tag=3, 原始名) 之间隔 7B。

用法:
  python decrypt_molru.py info  <file.molru>
  python decrypt_molru.py split <file.molru> <out_dir> [--prefix NAME]
  python decrypt_molru.py catalog <MediaCatalog.bytes> <out.json>
"""
import argparse
import json
import os
import struct
import sys

MAGIC = b"4t+$"
OGGS = b"OggS"


def parse_ogg_pages(buf, start=0):
    """按页步进 Ogg 流。yield (page_offset, page_len, header_type, serial)。
    遇到非 OggS 或截断页即停。"""
    n = len(buf)
    off = start
    while off + 27 <= n:
        if buf[off:off + 4] != OGGS:
            break
        htype = buf[off + 5]
        serial = struct.unpack_from("<I", buf, off + 14)[0]
        nseg = buf[off + 26]
        segs = buf[off + 27:off + 27 + nseg]
        plen = 27 + nseg + sum(segs)
        if off + plen > n:
            break
        yield off, plen, htype, serial
        off += plen


def ogg_page_crc_ok(page: bytes) -> bool:
    """Ogg CRC: poly 0x04c11db7, init 0, 无终异或, CRC 字段先置 0。"""
    tbl = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if r & 0x80000000 else (r << 1) & 0xFFFFFFFF
        tbl.append(r)
    b = bytearray(page)
    struct.pack_into("<I", b, 22, 0)
    crc = 0
    for x in b:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ tbl[((crc >> 24) & 0xFF) ^ x]
    return crc == struct.unpack_from("<I", page, 22)[0]


def parse_molru(path):
    """解析 molru → dict(header, segments, table)。segments 元素:
    (file_offset, size, serial, n_pages)。"""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head = f.read(53)
        if head[:4] != MAGIC:
            raise ValueError(f"{path}: bad magic {head[:4]!r}")
        f.seek(53)
        # 流式读页链（大文件不整读）
        segments = []
        off = 53
        cur = None  # 当前流: [start, serial, npages]
        pagebuf = bytearray(27 + 255 + 65025)
        while off + 27 <= size:
            f.seek(off)
            hdr = f.read(27)
            if len(hdr) < 27 or hdr[:4] != OGGS:
                break
            htype = hdr[5]
            serial = struct.unpack_from("<I", hdr, 14)[0]
            nseg = hdr[26]
            segs = f.read(nseg)
            if len(segs) < nseg:
                break
            plen = 27 + nseg + sum(segs)
            if off + plen > size:
                break
            if htype & 0x02:  # BOS 开新流
                if cur:
                    segments.append(cur)
                cur = [off, serial, 1]
            elif cur:
                cur[2] += 1
            off += plen
        if cur:
            segments.append(cur)
        tail = size - off
        table = None
        if tail >= 4:
            f.seek(size - 4)
            declared = struct.unpack("<I", f.read(4))[0]
            if declared == tail - 4:
                f.seek(off)
                table = f.read(declared)
    return {
        "magic": head[:4].hex(),
        "version": head[4],
        "crypt_block": head[5:53],
        "data_end": off,
        "tail_total": tail,
        "table": table,
        "segments": [
            {"offset": s[0], "size": (segments[i + 1][0] if i + 1 < len(segments) else off) - s[0]
             if False else None, "serial": s[1], "pages": s[2]}
            for i, s in enumerate(segments)
        ],
        "_raw_segments": segments,  # [(offset, serial, npages)]
        "_size": size,
    }


def split_molru(path, out_dir, prefix=None, names=None, limit=None):
    """拆段为独立 .ogg 文件。names: {物理段序: 文件名(不带扩展名)}，缺省 seg_XXXXX。"""
    info = parse_molru(path)
    segs = info["_raw_segments"]
    data_end = info["data_end"]
    os.makedirs(out_dir, exist_ok=True)
    written = []
    with open(path, "rb") as f:
        for i, (soff, serial, npages) in enumerate(segs):
            if limit is not None and i >= limit:
                break
            end = segs[i + 1][0] if i + 1 < len(segs) else data_end
            f.seek(soff)
            data = f.read(end - soff)
            name = (names or {}).get(i, f"seg_{i:05d}")
            base = f"{prefix}_{name}" if prefix else name
            out = os.path.join(out_dir, base + ".ogg")
            with open(out, "wb") as g:
                g.write(data)
            written.append(out)
    return written, info


def catalog_pairs(cat_path):
    """MediaCatalog.bytes → [(key, value)] 有序对。"""
    with open(cat_path, "rb") as f:
        blob = f.read()
    pairs = []
    off = 4  # 头 4B: 02 79 05 01
    n = len(blob)
    cur = {}
    while off + 9 <= n:
        tag = blob[off]
        inv, ln = struct.unpack_from("<II", blob, off + 1)
        if (inv ^ ln) == 0xFFFFFFFF and 0 < ln <= 2048 and off + 9 + ln <= n:
            s = blob[off + 9:off + 9 + ln].decode("utf-8", "replace")
            cur.setdefault(tag, s)
            off += 9 + ln
            if 0 in cur and 3 in cur:
                pairs.append((cur[0], cur[3]))
                cur = {}
            continue
        off += 7  # 对间 7B 间隔簇
    return pairs


def main(argv=None):
    ap = argparse.ArgumentParser(description="BlueArchive .molru parser/splitter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("info")
    p1.add_argument("file")
    p2 = sub.add_parser("split")
    p2.add_argument("file")
    p2.add_argument("out_dir")
    p2.add_argument("--prefix", default=None)
    p2.add_argument("--limit", type=int, default=None)
    p3 = sub.add_parser("catalog")
    p3.add_argument("cat_file")
    p3.add_argument("out_json")
    a = ap.parse_args(argv)

    if a.cmd == "info":
        info = parse_molru(a.file)
        segs = info["_raw_segments"]
        print(f"file      : {a.file}")
        print(f"size      : {info['_size']}")
        print(f"magic     : {info['magic']} version {info['version']}")
        print(f"cryptblk  : {info['crypt_block'].hex()}")
        print(f"pages end : {info['data_end']}  tail {info['tail_total']}B")
        print(f"segments  : {len(segs)}  (serials {segs[0][1]}..{segs[-1][1]})" if segs else "segments  : 0")
        print(f"table     : {'%dB' % len(info['table']) if info['table'] else 'none'}")
        if info["table"]:
            print(f"table[0:32]: {info['table'][:32].hex()}")
    elif a.cmd == "split":
        written, info = split_molru(a.file, a.out_dir, a.prefix, limit=a.limit)
        print(f"split {len(written)} segments -> {a.out_dir}")
        for w in written[:5]:
            print("  ", w)
    elif a.cmd == "catalog":
        pairs = catalog_pairs(a.cat_file)
        with open(a.out_json, "w", encoding="utf-8") as f:
            json.dump([{"key": k, "value": v} for k, v in pairs], f, ensure_ascii=False, indent=1)
        print(f"{len(pairs)} pairs -> {a.out_json}")


if __name__ == "__main__":
    main()
