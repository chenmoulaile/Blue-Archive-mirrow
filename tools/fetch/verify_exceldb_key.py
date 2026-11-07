#!/usr/bin/env python3
"""ExcelDB.db SQLCipher page-1 HMAC 验证 v3 —— 公式三方对齐版。

参照（.scratch/exceldb/ 下留档）：
  foxit_sqlcipher_ref.py:243-250  hmac_msg = ciphertext(页1不含16B salt) + iv + pgno_le4
  zmkimu_sqlcipher_ref.py:130-137 同上（BA ExcelDB 实测工作实现）
  sqlcipher.c:1792 in = size+iv_sz；verify.c（sqlcipher-tools 官方）
  key 派生：raw key 直接用；mac_key = PBKDF2-SHA512(enc_key, salt^0x3A, 2, 32)
  crypto.c：kdf=PBKDF2-SHA512(256000)，cipher=AES-256-CBC，reserve=80
输出不回显 key 值。
"""
import hashlib
import hmac
import json
import struct
import sys
from pathlib import Path

DB = Path(r"D:/Steam/steamapps/common/BlueArchive/BlueArchive_Data/StreamingAssets/PUB/Resource/Preload/TableBundles/ExcelDB.db")
PAGE = 4096
RESERVE = 80          # iv16 + hmac64
IV_OFF = PAGE - RESERVE          # 4016
HMAC_OFF = IV_OFF + 16           # 4032
KDF_ITER = 256000
FAST_KDF_ITER = 2
MASK = 0x3A


def mac_key_of(enc_key: bytes, salt: bytes, raw: bool) -> bytes:
    if raw:
        enc = enc_key
    else:
        enc = hashlib.pbkdf2_hmac("sha512", enc_key, salt, KDF_ITER, dklen=32)
    hmac_salt = bytes(b ^ MASK for b in salt)
    return hashlib.pbkdf2_hmac("sha512", enc, hmac_salt, FAST_KDF_ITER, dklen=32)


def check_page1(db: bytes, kv: bytes, raw: bool) -> bool:
    salt = db[:16]
    mk = mac_key_of(kv, salt, raw)
    msg = db[16:IV_OFF] + db[IV_OFF:HMAC_OFF] + struct.pack("<I", 1)
    return hmac.compare_digest(hmac.new(mk, msg, hashlib.sha512).digest(), db[HMAC_OFF:PAGE])


def main() -> None:
    db = DB.read_bytes()[:PAGE * 2]
    print(f"db={DB.name} size={DB.stat().st_size} salt={db[:8].hex()}****")
    for cand in CANDIDATES:
        for enc in cand["encodings"]:
            kv = bytes.fromhex(enc["hex"])
            ok = check_page1(db, kv, enc["raw"])
            mask = enc["hex"][:8] + "****" + enc["hex"][-4:]
            print(f"  cand[{cand['id']}] len={len(kv)}B raw={enc['raw']}: {'MATCH ***' if ok else 'no'}")


if __name__ == "__main__":
    CANDIDATES = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    main()
