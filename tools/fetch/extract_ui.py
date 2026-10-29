#!/usr/bin/env python3
"""
从《蔚蓝档案》游戏的 AssetBundle 中提取 UI 原件。

提取内容
    UI 图集       assets-_mx-uisprite / assets-_mx-ui 前缀 bundle 里的 Sprite
                  -> resources/ui/<名字>.png + data/ui_atlas.json（含九宫格切边）
    音频          BGM / SE 的 AudioClip
                  -> resources/bgm/<名字>.ogg、resources/se/<名字>.ogg
    Spine 3.8     assets-_mx-spinelobbies 里的 .skel / .atlas / 贴图
                  -> resources/spine38/<模型名>/
    TMP 字体      FontAsset 的图集贴图 + 字形表
                  -> resources/ui/font/<名字>.png + data/ui_font.json

用法
    # 先看看游戏目录里有哪些相关 bundle（不写文件）
    .venv/Scripts/python.exe tools/fetch/extract_ui.py --list "D:/BlueArchive"

    # 正式提取
    .venv/Scripts/python.exe tools/fetch/extract_ui.py --game-dir "D:/BlueArchive"

    # 只提取某一类
    .venv/Scripts/python.exe tools/fetch/extract_ui.py --game-dir "..." --only ui
    # --only 可选：ui / audio / spine / font

说明
    * 本工具只读取你本机的游戏文件，不下载、不解密、不绕过任何验证。
    * 提取出的素材版权归 NAT GAMES / NEXON，仅限个人学习与非商业同人使用。
    * 需要在项目内 venv 里装 UnityPy：
      .venv/Scripts/python.exe -m pip install UnityPy -i https://mirrors.aliyun.com/pypi/simple
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "resources"
DATA = ROOT / "data"

# bundle 名前缀 -> 类别
PREFIXES = {
    "assets-_mx-uisprite": "ui",
    "assets-_mx-ui": "ui",
    "assets-_mx-spinelobbies": "spine",
    "assets-_mx-spinecharacters": "spine",
    "assets-_mx-font": "font",
    "assets-_mx-fontasset": "font",
    "assets-_mx-audio": "audio",
}

# 音频文件名特征（游戏里 BGM/SE 是独立 bundle，名字不一定带前缀）
AUDIO_HINTS = ("bgm", "se_", "sound", "audio", "voice")

VALID_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def log(msg: str) -> None:
    print(msg, flush=True)


def classify(name: str) -> str | None:
    low = name.lower()
    for prefix, kind in PREFIXES.items():
        if low.startswith(prefix):
            return kind
    if any(h in low for h in AUDIO_HINTS):
        return "audio"
    return None


def iter_bundles(game_dir: Path):
    """遍历游戏目录下所有可能是 AssetBundle 的文件"""
    exts = {".bundle", ".ab", ".unity3d", ".dat", ""}
    for p in game_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in exts or p.suffix == "":
            yield p


def list_bundles(game_dir: Path) -> None:
    counts: Counter[str] = Counter()
    samples: dict[str, list[str]] = {}
    total = 0
    for p in iter_bundles(game_dir):
        total += 1
        kind = classify(p.name)
        if not kind:
            continue
        counts[kind] += 1
        samples.setdefault(kind, [])
        if len(samples[kind]) < 8:
            samples[kind].append(p.name)
        if total % 5000 == 0:
            log(f"  已扫描 {total} 个文件…")
    log(f"\n扫描 {total} 个文件，命中：")
    for kind, n in counts.most_common():
        log(f"  {kind:<6} {n:>5} 个 bundle")
        for s in samples.get(kind, []):
            log(f"      {s}")
    if not counts:
        log("  （没有命中任何已知前缀，请确认路径指向游戏解包后的根目录）")


class Extractor:
    def __init__(self, only: set[str] | None):
        self.only = only
        self.sprites: dict[str, dict] = {}
        self.fonts: dict[str, dict] = {}
        self.stats = Counter()
        self.errors: list[str] = []

    def want(self, kind: str) -> bool:
        return self.only is None or kind in self.only

    # ---------------------------------------------------------------- Sprite

    def export_sprite(self, obj, bundle_kind: str) -> None:
        sprite = obj.read()
        name = getattr(sprite, "m_Name", "") or f"sprite_{obj.path_id}"
        safe = name.replace("/", "_").replace("\\", "_")
        try:
            img = sprite.image
        except Exception:
            # 少数 Sprite 需要手动从贴图裁切
            try:
                tex = sprite.m_RD.texture.read()
                img = tex.image
                r = sprite.m_Rect
                img = img.crop(
                    (
                        int(r.x),
                        int(img.height - r.y - r.height),
                        int(r.x + r.width),
                        int(img.height - r.y),
                    )
                )
            except Exception as e:  # noqa: BLE001
                self.errors.append(f"{name}: {e}")
                return

        out = RES / "ui" / f"{safe}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out)

        border = None
        try:
            b = sprite.m_Border
            l, btm, r, t = int(b.x), int(b.y), int(b.z), int(b.w)
            if l or btm or r or t:
                # Unity 顺序 x=left, y=bottom, z=right, w=top -> 转成 CSS 的 [左 上 右 下]
                border = [l, t, r, btm]
        except Exception:
            pass

        self.sprites[safe] = {
            "file": f"/res/ui/{safe}.png",
            "w": int(img.width),
            "h": int(img.height),
            **({"border": border} if border else {}),
            "origin": "assetbundle",
        }
        self.stats["sprite"] += 1

    # ---------------------------------------------------------------- Audio

    def export_audio(self, obj) -> None:
        clip = obj.read()
        name = getattr(clip, "m_Name", "") or f"audio_{obj.path_id}"
        samples = getattr(clip, "samples", None)
        if not samples:
            return
        safe = name.replace("/", "_").replace("\\", "_")
        # 按游戏内命名归类：Theme_xx / AMB_xx 归 BGM，SE_xx 归 SE
        is_bgm = safe.startswith(("Theme_", "AMB_", "BGM_"))
        sub = "bgm" if is_bgm else "se"
        wrote = False
        for fname, data in samples.items():
            ext = Path(fname).suffix or ".wav"
            out = RES / sub / f"{safe}{ext}"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            wrote = True
        if wrote:
            self.stats[f"audio_{sub}"] += 1

    # ---------------------------------------------------------------- Spine

    def export_spine(self, obj) -> None:
        """Spine 资源在 bundle 里是 TextAsset(.skel/.atlas) + Texture2D"""
        typ = obj.type.name
        if typ == "TextAsset":
            ta = obj.read()
            name = getattr(ta, "m_Name", "")
            raw = getattr(ta, "m_Script", None)
            if raw is None:
                return
            data = raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else bytes(raw)
            ext = Path(name).suffix.lower()
            if ext not in (".skel", ".atlas", ".json"):
                return
            model = Path(name).stem
            # 去掉 _spr/_home 后缀之外的多余层级，保持模型目录名
            out = RES / "spine38" / model / name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            self.stats["spine_text"] += 1
        elif typ == "Texture2D":
            tex = obj.read()
            name = getattr(tex, "m_Name", "")
            if not name:
                return
            try:
                img = tex.image
            except Exception:
                return
            out = RES / "spine38" / Path(name).stem / f"{name}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            img.save(out)
            self.stats["spine_tex"] += 1

    # ---------------------------------------------------------------- Font

    def export_font(self, obj) -> None:
        """TMP FontAsset 是 MonoBehaviour，字段随版本变化，尽量宽松地取"""
        try:
            tree = obj.read_typetree()
        except Exception:
            return
        name = tree.get("m_Name", f"font_{obj.path_id}")
        # 字形表
        glyphs = []
        for g in tree.get("m_GlyphTable") or []:
            try:
                glyphs.append(
                    {
                        "index": g.get("m_Index"),
                        "w": g.get("m_Metrics", {}).get("m_Width"),
                        "h": g.get("m_Metrics", {}).get("m_Height"),
                        "x": g.get("m_GlyphRect", {}).get("m_X"),
                        "y": g.get("m_GlyphRect", {}).get("m_Y"),
                        "gw": g.get("m_GlyphRect", {}).get("m_Width"),
                        "gh": g.get("m_GlyphRect", {}).get("m_Height"),
                    }
                )
            except Exception:
                continue
        if not glyphs:
            return
        chars = {}
        for c in tree.get("m_CharacterTable") or []:
            try:
                chars[str(c.get("m_Unicode"))] = c.get("m_GlyphIndex")
            except Exception:
                continue
        self.fonts[name] = {
            "family": name,
            "glyphs": glyphs[:20000],
            "chars": chars,
            "atlas": f"/res/ui/font/{name}.png",
            "pointSize": tree.get("m_FaceInfo", {}).get("m_PointSize"),
        }
        self.stats["font"] += 1

    # ---------------------------------------------------------------- 主循环

    def run(self, game_dir: Path) -> None:
        import UnityPy

        bundles = list(iter_bundles(game_dir))
        log(f"共 {len(bundles)} 个候选文件，开始解析…")
        for i, path in enumerate(bundles, 1):
            kind = classify(path.name)
            if not kind or not self.want(kind):
                continue
            try:
                env = UnityPy.load(str(path))
            except Exception:
                continue
            for obj in env.objects:
                try:
                    if kind == "ui" and obj.type.name == "Sprite":
                        self.export_sprite(obj, kind)
                    elif kind == "audio" and obj.type.name == "AudioClip":
                        self.export_audio(obj)
                    elif kind == "spine" and obj.type.name in ("TextAsset", "Texture2D"):
                        self.export_spine(obj)
                    elif kind == "font" and obj.type.name == "MonoBehaviour":
                        self.export_font(obj)
                except Exception as e:  # noqa: BLE001
                    self.errors.append(f"{path.name}:{obj.path_id}: {e}")
            if i % 200 == 0:
                log(f"  {i}/{len(bundles)}  sprite {self.stats['sprite']}  audio {self.stats['audio_bgm'] + self.stats['audio_se']}")

    def write_manifest(self) -> None:
        DATA.mkdir(parents=True, exist_ok=True)
        if self.sprites:
            (DATA / "ui_atlas.json").write_text(
                json.dumps(
                    {
                        "source": "assetbundle",
                        "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                        "sprites": self.sprites,
                        "fonts": {},
                    },
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
        if self.fonts:
            (DATA / "ui_font.json").write_text(
                json.dumps(self.fonts, ensure_ascii=False, indent=1), encoding="utf-8"
            )


def main() -> None:
    ap = argparse.ArgumentParser(description="从游戏 AssetBundle 提取 UI 原件")
    ap.add_argument("--game-dir", help="游戏解包后的根目录")
    ap.add_argument("--list", dest="list_dir", help="只扫描并列出命中的 bundle，不写文件")
    ap.add_argument(
        "--only",
        default=None,
        help="只提取某类：ui / audio / spine / font，逗号分隔",
    )
    args = ap.parse_args()

    if args.list_dir:
        list_bundles(Path(args.list_dir))
        return
    if not args.game_dir:
        ap.print_help()
        sys.exit(1)

    game_dir = Path(args.game_dir)
    if not game_dir.exists():
        log(f"目录不存在：{game_dir}")
        sys.exit(1)

    only = set(args.only.split(",")) if args.only else None
    ex = Extractor(only)
    ex.run(game_dir)
    ex.write_manifest()

    log("\n=== 提取结果 ===")
    for k, v in ex.stats.most_common():
        log(f"  {k:<12} {v}")
    if ex.errors:
        log(f"  跳过 {len(ex.errors)} 个对象（前 5 条）:")
        for e in ex.errors[:5]:
            log(f"    {e}")
    if ex.sprites:
        log(f"✓ data/ui_atlas.json 已更新，共 {len(ex.sprites)} 个 UI 原件")
        log("  重启客户端即可自动替换掉兜底样式。")
    else:
        log("没有提取到 UI Sprite，请确认 --game-dir 指向包含 assets-_mx-uisprite 的目录。")


if __name__ == "__main__":
    main()
