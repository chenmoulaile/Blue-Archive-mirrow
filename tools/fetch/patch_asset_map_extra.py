#!/usr/bin/env python3
"""给 data/asset_map.extra.json 补 spines 段：盘上有、asset_map.json 未收录的 spine 模型
（实测含 gacha 演出要用的 arona_spr/arona_spr_HD）。schema 对齐 build_asset_map.py spines 段。"""
import glob
import io
import json
import os

p = 'D:/Bluearchive/repo/data/asset_map.extra.json'
extra = json.load(io.open(p, encoding='utf-8'))
am = json.load(io.open('D:/Bluearchive/repo/data/asset_map.json', encoding='utf-8'))
have = set(am.get('spines', {}))
addsp = {}
for d in sorted(x for x in glob.glob('D:/Bluearchive/repo/resources/spine/*') if os.path.isdir(x)):
    name = os.path.basename(d.rstrip('/').rstrip(chr(92)))
    if name in have or name in addsp:
        continue
    fs = os.listdir(d)
    skel = next((f for f in fs if f.endswith('.skel')), None)
    atlas = next((f for f in fs if f.endswith('.atlas')), None)
    if not (skel and atlas):
        continue
    addsp[name] = {
        'skel': f'resources/spine/{name}/{skel}',
        'atlas': f'resources/spine/{name}/{atlas}',
        'textures': [f'resources/spine/{name}/{f}' for f in sorted(fs) if f.lower().endswith('.png')],
    }
extra['spines'] = addsp
extra['counts']['spines_added'] = len(addsp)
io.open(p, 'w', encoding='utf-8').write(json.dumps(extra, ensure_ascii=False, indent=1))
print('spines added', len(addsp))
print('arona/plana:', {k: v['skel'] for k, v in addsp.items() if 'arona' in k or 'plana' in k})
