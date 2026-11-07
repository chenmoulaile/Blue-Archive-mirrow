#!/usr/bin/env python3
"""ExcelDB.db 全库解密（SQLCipher raw key，参数已由 page-1 HMAC + header 字段实测确认）。

  salt = file[0:16]（plaintext-header 模式的 salt 区，非 SQLite magic）
  key  = 32B raw（来源见 candidates.json；报告不回显）
  每页：AES-256-CBC(key, iv=page[usable:usable+16]).decrypt(page[off:usable])；usable=4016
  page1 明文 = magic(16B 重建) + pt(4000B)，其余页 = pt(4016B)；页尾补 80B 零（reserved=80 与 header 一致）
输出 ExcelDB_decrypted.db，报告不回显 key。
"""
import hashlib
import hmac
import struct
import sys
import time
from pathlib import Path

from Crypto.Cipher import AES

DB = Path(r"D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Preload/TableBundles/ExcelDB.db")
OUT = Path(r"D:/Bluearchive/.scratch/exceldb/ExcelDB_decrypted.db")
KEY = bytes.fromhex(Path(sys.argv[1]).read_text().strip())
MAGIC = b"SQLite format 3\x00"
PAGE = 4096
IV_OFF = 4016
RESERVE = 80

CHUNK = 512  # 每批页数


def main() -> None:
    salt = DB.read_bytes()[:16]
    mk = hashlib.pbkdf2_hmac("sha512", KEY, bytes(b ^ 0x3A for b in salt), 2, dklen=32)
    size = DB.stat().st_size
    npages = size // PAGE
    print(f"file={size}B pages={npages} salt={salt[:8].hex()}****")

    # page1 完整校验
    p1 = DB.read_bytes()[:PAGE]
    msg = p1[16:IV_OFF] + p1[IV_OFF:IV_OFF + 16] + struct.pack("<I", 1)
    assert hmac.compare_digest(hmac.new(mk, msg, hashlib.sha512).digest(), p1[IV_OFF + 16:PAGE]), "page1 hmac"

    fin = DB.open("rb")
    fout = OUT.open("wb")
    t0 = time.time()
    bad = 0
    for start in range(0, npages, CHUNK):
        pages = []
        for pgno in range(start + 1, min(start + CHUNK, npages) + 1):
            fin.seek((pgno - 1) * PAGE)
            page = fin.read(PAGE)
            iv = page[IV_OFF:IV_OFF + 16]
            off = 16 if pgno == 1 else 0
            pt = AES.new(KEY, AES.MODE_CBC, iv).decrypt(page[off:IV_OFF])
            if pgno == 1:
                pt = MAGIC + pt
                if pt[16:18] != b"\x10\x00" or pt[20] != RESERVE:
                    print(f"  warn: page1 header fields unexpected: size={pt[16:18].hex()} reserved={pt[20]}")
            pages.append(pt + b"\x00" * RESERVE)
        fout.write(b"".join(pages))
        if (start // CHUNK) % 20 == 0:
            done = min(start + CHUNK, npages)
            print(f"  {done}/{npages} pages {time.time()-t0:.0f}s", flush=True)
    fin.close()
    fout.close()
    print(f"done: {OUT} size={OUT.stat().st_size} bad_pages={bad} {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
