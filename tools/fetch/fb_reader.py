#!/usr/bin/env python3
"""极简 FlatBuffer table 读取器（按 fbs 字段声明顺序读 slot，够用即可）。

约定：字段 slot 顺序 = fbs table 内声明顺序（0 起）。字符串/标量/向量分类型读取。
"""
from __future__ import annotations

import struct
from typing import Any


class FBTable:
    def __init__(self, buf: bytes, pos: int):
        self.buf = buf
        self.pos = pos  # table root position

    def _field_off(self, slot: int) -> int:
        vt = self.pos - struct.unpack_from("<i", self.buf, self.pos)[0]
        vt_size, tbl_size = struct.unpack_from("<HH", self.buf, vt)
        fo = vt + 4 + 2 * slot
        if fo >= vt + vt_size:
            return 0
        return struct.unpack_from("<H", self.buf, fo)[0]

    def _read(self, off: int, fmt: str) -> Any:
        return struct.unpack_from(fmt, self.buf, self.pos + off)[0]

    def scalar(self, slot: int, fmt: str, default: Any = 0) -> Any:
        off = self._field_off(slot)
        return self._read(off, fmt) if off else default

    def string(self, slot: int) -> str | None:
        off = self._field_off(slot)
        if not off:
            return None
        p = self.pos + off
        p = p + struct.unpack_from("<i", self.buf, p)[0]  # offset -> string pos
        n = struct.unpack_from("<I", self.buf, p)[0]
        return self.buf[p + 4:p + 4 + n].decode("utf-8", "replace")

    def vector(self, slot: int, fmt: str) -> list[Any]:
        """向量元素为标量时返回值列表。"""
        off = self._field_off(slot)
        if not off:
            return []
        p = self.pos + off
        p = p + struct.unpack_from("<i", self.buf, p)[0]
        n = struct.unpack_from("<I", self.buf, p)[0]
        return list(struct.unpack_from(f"<{n}{fmt}", self.buf, p + 4)) if n else []

    def string_vector(self, slot: int) -> list[str]:
        off = self._field_off(slot)
        if not off:
            return []
        p = self.pos + off
        p = p + struct.unpack_from("<i", self.buf, p)[0]
        n = struct.unpack_from("<I", self.buf, p)[0]
        out = []
        for i in range(n):
            sp = p + 4 + i * 4
            sp = sp + struct.unpack_from("<i", self.buf, sp)[0]
            ln = struct.unpack_from("<I", self.buf, sp)[0]
            out.append(self.buf[sp + 4:sp + 4 + ln].decode("utf-8", "replace"))
        return out


def table_of(blob: bytes) -> FBTable:
    return FBTable(blob, struct.unpack_from("<I", blob, 0)[0])
