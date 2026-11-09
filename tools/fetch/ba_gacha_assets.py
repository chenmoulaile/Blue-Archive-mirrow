#!/usr/bin/env python3
"""
BA 抽卡动画专用素材下载脚本（最小流量方案）
只下载核心转场素材，其他用代码生成
"""

import os
import sys
import urllib.request
from pathlib import Path

# 输出目录
OUTPUT_DIR = Path(__file__).parent.parent / "resources" / "gacha"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 素材清单
ASSETS = {
    # --- 背景图片 (~1.5MB) ---
    "bg_street_abydos.jpg": {
        "url": "https://static.kivo.wiki/gallery/bg_gacha_01.jpg",
        "desc": "阿拜多斯街道背景",
    },
    "bg_street_caeasr.jpg": {
        "url": "https://static.kivo.wiki/gallery/bg_gacha_02.jpg",
        "desc": "凯撒学院街道背景",
    },
    
    # --- 特效资源 (~0.5MB) ---
    "gacha_card_back.png": {
        "url": "https://raw.githubusercontent.com/ZM-Kimu/Blue-Archive-Asset-Downloader/main/assets/ui/extra/UI_Gacha_Card_Back.png",
        "desc": "卡片背面图案",
    },
    "fx_star_field.png": {
        "url": "https://raw.githubusercontent.com/ZM-Kimu/Blue-Archive-Asset-Downloader/main/assets/ui/extra/FX_TEX_ST_Field.png",
        "desc": "星空粒子 sprite sheet",
    },
    
    # --- 音效 (~0.2MB) ---
    "se_gacha_confirm.ogg": {
        "url": "https://bgm.blue-archive.io/se/gacha/confirm.ogg",
        "desc": "确认音效",
    },
    "se_gacha_flip_ssr.ogg": {
        "url": "https://bgm.blue-archive.io/se/gacha/flip_ssr.ogg",
        "desc": "SSR 翻卡牌音效",
    },
    "se_gacha_flip_sr.ogg": {
        "url": "https://bgm.blue-archive.io/se/gacha/flip_sr.ogg",
        "desc": "SR 翻卡牌音效",
    },
    "se_gacha_flip_r.ogg": {
        "url": "https://bgm.blue-archive.io/se/gacha/flip_r.ogg",
        "desc": "R 翻卡牌音效",
    },
}

def download_file(url, filename, desc):
    """下载文件并显示进度"""
    filepath = OUTPUT_DIR / filename
    
    if filepath.exists():
        print("[SKIP] " + filename + " (已存在)")
        return True
    
    progress_mark = "[" + str(len(ASSETS)) + "-" + str(len([f for f in ASSETS if url in ASSETS[f]['url']])) + "]"
    print(progress_mark + " " + desc)
    print("   URL: " + url)
    print("   Save: " + str(filepath))
    
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        
        with urllib.request.urlopen(req, timeout=30) as response, \
             open(filepath, "wb") as out_file:
            
            chunk_size = 8192
            total_size = int(response.getheader("Content-Length", 0))
            downloaded = 0
            
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                
                out_file.write(chunk)
                downloaded += len(chunk)
                
                if total_size:
                    percent = (downloaded / total_size) * 100
                    bar_len = 40
                    filled = int(bar_len * downloaded // total_size)
                    bar = "#" * filled + "-" * (bar_len - filled)
                    size_kb = downloaded / 1024
                    print("\r [" + bar + "] " + "%.1f" % size_kb + "/" + "%.1f" % (total_size/1024) + " KB", end="")
        
        print()
        
        file_size = filepath.stat().st_size
        if file_size == 0:
            print("[FAIL] " + filename + " - Size is 0")
            return False
            
        print("[OK] " + filename + " (" + "{:,}".format(file_size) + " bytes)")
        return True
        
    except Exception as e:
        print("[ERROR] " + filename + ": " + str(e))
        return False


def main():
    print("=" * 60)
    print("BA Gacha Animation Asset Downloader")
    print("=" * 60)
    print("\nOutput Dir:", str(OUTPUT_DIR.resolve()))
    print("Assets to download:", len(ASSETS))
    print("-" * 60)
    
    results = []
    for filename, info in ASSETS.items():
        success = download_file(info["url"], filename, info["desc"])
        results.append((filename, success))
        print()
    
    print("-" * 60)
    success_count = sum(1 for _, s in results if s)
    total_count = len(results)
    
    print("\nDownload complete:", str(success_count) + "/" + str(total_count) + " success")
    
    if success_count < total_count:
        failed = [fn for fn, s in results if not s]
        print("\nFailed files:")
        for fn in failed:
            print("  - " + fn)
        print("\nSuggestion: Check network or retry later")
        sys.exit(1)
    else:
        total_size = sum(f.stat().st_size for f in OUTPUT_DIR.iterdir())
        print("\n[SUCCESS] All assets ready! Total size:", "{:,}".format(total_size), "bytes")
        print("\nNext step: run 'npm run build && npm run start' to test new gacha animation")
        sys.exit(0)


if __name__ == "__main__":
    main()
