"""盘点 kivo.wiki 素材总量：spine 类型分布 + 各画廊相册图片数"""
import json, urllib.request, concurrent.futures, collections

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}
API = "https://api.kivo.wiki/api/v1"


def get(url, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retry - 1:
                return {"_error": str(e)}
    return {}


def spine_page(p):
    d = get(f"{API}/data/spines/?page={p}&page_size=100")
    return d.get("data", {}).get("spine", [])


print("== 1. Spine 盘点 ==")
first = get(f"{API}/data/spines/?page=1&page_size=100")
max_page = first.get("data", {}).get("max_page", 0)
print("spine 总页数:", max_page)
allsp = []
with concurrent.futures.ThreadPoolExecutor(8) as ex:
    for rows in ex.map(spine_page, range(1, max_page + 1)):
        allsp.extend(rows)
print("spine 总数:", len(allsp))
print("类型分布:", dict(collections.Counter(s["type"] for s in allsp)))
print("备注分布 top10:", collections.Counter(s.get("remark", "") for s in allsp).most_common(10))
with open("E:/Blue archive/tools/recon/out/spine_index.json", "w", encoding="utf-8") as f:
    json.dump(allsp, f, ensure_ascii=False, indent=1)

print("\n== 2. 画廊相册盘点 ==")
gl = get(f"{API}/galleries/?page=1&page_size=100")
albums = gl.get("data", {}).get("gallery", [])


def album_detail(a):
    d = get(f"{API}/galleries/{a['id']}")
    data = d.get("data", {})
    cats = data.get("categorys", []) or []
    n = sum(len(c.get("images", []) or []) for c in cats)
    return {
        "id": a["id"],
        "title": a["title"],
        "cats": len(cats),
        "images": n,
    }


rows = []
with concurrent.futures.ThreadPoolExecutor(6) as ex:
    for r in ex.map(album_detail, albums):
        rows.append(r)
rows.sort(key=lambda x: -x["images"])
total = 0
for r in rows:
    print(f"{r['id']:>3}  {r['title'][:34]:<36} 分类{r['cats']:>3}  图片{r['images']:>6}")
    total += r["images"]
print("图片总数:", total)
with open("E:/Blue archive/tools/recon/out/gallery_index.json", "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)
