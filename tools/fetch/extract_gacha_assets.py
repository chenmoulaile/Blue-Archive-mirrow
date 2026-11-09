#!/usr/bin/env python3
"""
从三个本地资源源提取抽卡相关素材
1. Steam 国际服游戏 (BlueArchive_Data)
2. Shittim Canvas NEXT 
3. ChatArchive V1.2.1
"""

import os
import sys
from pathlib import Path

# 输出目录
OUTPUT_DIR = Path(__file__).parent.parent / "resources" / "gacha_extracted"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Steam 游戏路径
STEAM_GAME = Path(r"D:/steam/steamapps/common/BlueArchive/BlueArchive_Data")
SCNX_PATH = Path(r"D:/[全量] Shittim Canvas NEXT Windows (11020260812)/[全量] Shittim Canvas NEXT Windows (11020260812)/Shittim Canvas NEXT_Data")
CHAT_ARCHIVE = Path(r"D:/ChatArchive V1.2.1（电脑-Windows）/ChatArchive V1.2.1（电脑-Windows）")

print("=" * 60)
print("BA Gacha Asset Extractor - Multi-Source")
print("=" * 60)
print(f"\nOutput: {OUTPUT_DIR}")
print(f"Steam Game: {'✓' if STEAM_GAME.exists() else '✗'} {STEAM_GAME}")
print(f"SCNX: {'✓' if SCNX_PATH.exists() else '✗'} {SCNX_PATH}")
print(f"ChatArchive: {'✓' if CHAT_ARCHIVE.exists() else '✗'} {CHAT_ARCHIVE}")
print("-" * 60)

try:
    import UnityPy
except ImportError:
    print("\n❌ UnityPy not installed!")
    print("Install with: pip install UnityPy")
    sys.exit(1)

def extract_from_unity(path, label):
    """Extract assets from Unity bundle"""
    if not path.exists():
        print(f"\n⊘ [SKIP] {label} - Not found")
        return []
    
    print(f"\n📂 Processing {label}...")
    extracted = []
    
    # Find all bundle files
    bundle_files = list(path.glob("*.assets")) + \
                   list(path.glob("*.bundle")) + \
                   list(path.glob("sharedassets*.assets")) + \
                   list(path.glob("globalgamemanagers*"))
    
    for bundle in bundle_files[:5]:  # Limit to first 5 bundles
        try:
            env = UnityPy.load(str(bundle))
            
            for name, obj in env.files.items():
                # Look for textures related to gacha
                if "gacha" in name.lower() or "Gacha" in name:
                    tex = obj.read()
                    if tex and hasattr(tex, 'image'):
                        output_path = OUTPUT_DIR / f"{label}_{name}"
                        tex.image.save(output_path)
                        extracted.append(str(output_path))
                        print(f"  ✓ {name} ({tex.size:,} bytes)")
        
        except Exception as e:
            print(f"  ✗ Error processing {bundle}: {e}")
    
    return extracted

# 开始提取
results = []
results.extend(extract_from_unity(STEAM_GAME, "Steam_GBA"))
results.extend(extract_from_unity(SCNX_PATH, "SCNX"))
results.extend(extract_from_unity(CHAT_ARCHIVE, "ChatArch"))

print("\n" + "=" * 60)
print(f"Extraction complete: {len(results)} files")
print(f"Saved to: {OUTPUT_DIR}")
print("=" * 60)

if results:
    print("\n✅ Successfully extracted gacha assets!")
    print("\nNext steps:")
    print("1. Review extracted files in:", OUTPUT_DIR)
    print("2. Use relevant assets in your UI components")
else:
    print("\n⚠️ No assets extracted. Try manually browsing the bundles.")
