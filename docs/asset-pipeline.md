# 素材与数据管线

> 素材版权归 **NAT GAMES / NEXON** 所有。本项目仅作个人学习与非商业同人用途，
> 不提供任何破解、解密或绕过官方验证的能力。所有数据均来自公开 wiki 页面的正常浏览。

## 1. 数据源

| 来源 | 用途 | 访问方式 |
|---|---|---|
| `kivo.wiki`（基沃托斯古书馆） | Spine 模型、CG/背景图、学生资料、语音、卡池与活动时间线 | 公开 JSON API `api.kivo.wiki/api/v1/` |
| `bluearchive.wiki` | 剧情全文（MediaWiki `{{Story}}` 模板） | MediaWiki API `w/api.php`，需真实浏览器上下文 |

`bluearchive.wiki` 由 Miraheze 托管并启用 Cloudflare 人机校验，`curl` 直连返回 403，
且该校验不依赖 Cookie（实测浏览器上下文里取不到任何 cookie 仍能通过），
因此抓取器只能用 Playwright 驱动本机 Chrome，在页面上下文内 `fetch()` 调用 API。
全程等同正常浏览，不伪造凭据、不破解验证码。

## 2. kivo.wiki 接口清单（已实测）

| 端点 | 说明 |
|---|---|
| `GET /api/v1/data/spines/?page=N&page_size=100` | Spine 模型索引，共 **1796** 条（`spr` 立绘 1362 / `home` 回忆大厅 434） |
| `GET /api/v1/data/spines/{id}` | 单个模型详情：`skel_file` / `atlas_file` / `images[]` |
| `GET /api/v1/galleries/?page=N` | 画廊相册列表，共 **36** 个相册 / 19237 张图 |
| `GET /api/v1/galleries/{id}` | 相册详情，`categorys[].images[]` 为原图直链 |
| `GET /api/v1/data/students/?page=N` | 学生列表，共 **512** 名（含皮肤变体） |
| `GET /api/v1/data/students/{id}` | 学生详情：`spine[]` / `voice[]` / `furniture[]` / `gift_data[]` / `recollection_lobby_image` |
| `GET /api/v1/timeline/?type=Gacha` | 卡池记录 **862** 条（含日/国/国际服） |
| `GET /api/v1/timeline/?type=Event` | 活动记录 **544** 条 |
| `GET /api/v1/timeline/` | 全量时间线 **6032** 条 |

静态资源域名 `https://static.kivo.wiki/`，路径形如
`spines/{模型名}/{模型名}.skel`、`images/gallery/{相册}/{文件名}`、`voices/students/{学生}/{文件}`。
图片原图可加 `?x-oss-process=image/resize,w_200` 取缩略图。

**kivo 没有 BGM / SE 音效库。** 站点只提供角色语音，环境音与配乐需用户自行提供。

## 3. bluearchive.wiki 剧情结构

剧情页把每一集存成 MediaWiki 模板，参数本身就是「序号 + 节点类型 + 字段」：

```wikitext
{{Story
|1=bgm
|bgm1=Theme_10
|name1=Romantic Smile
|2=background
|background2=BG_MainOffice
|3=info
|text3=Schale Executive Office
|5=student-text
|name5=Arona
|text5=Good morning, Sensei!
|spine5=Arona
|sequence5=03
}}
```

这与项目的节点图 JSON **天然一一对应**，无需解析 HTML 或做 OCR。抓取器转成：

```json
{ "op": "bgm", "id": "Theme_10", "name": "Romantic Smile", "volume": "1.00" }
{ "op": "background", "bg": "BG_MainOffice" }
{ "op": "script", "speaker": "Arona", "text": "Good morning, Sensei!", "spine": "Arona", "sequence": "03" }
```

### 3.1 页面全集枚举

剧情页命名极不统一，按前缀或分类枚举会漏掉一半以上。可靠做法是用 CirrusSearch 的
`insource` 检索：

```
action=query&list=search&srsearch=insource:"Story/StoryTop"&srlimit=500&srnamespace=0
```

共 **2479** 页。分类情况：

| 类型 | 页面命名 | 说明 |
|---|---|---|
| `main` | `Main Story/Volume N/Chapter N/Episode N` | 主线，含 Vol.0 / F（最终篇） |
| `bond` | `<学生名>/Relationship Story/N` | 羁绊剧情，**正文在编号子页面**，父页面只是目录 |
| `event` | `<活动名>/Story` 或 `<活动名>/Story/N` | 活动剧情 |
| `group` | `Group Story/<slug>` | 社团剧情 |

早期按「前缀 + Category」枚举只得到 945 页，漏掉的正是羁绊子页面与大部分活动剧情。

### 3.2 节点类型

实测出现的节点类型（全量 1467 集样本）：

| 原始类型 | 归一化后 | 含义 |
|---|---|---|
| `student-text` | `script` | 角色台词，带 `spine`（角色名）与 `sequence`（表情差分号） |
| `sensei` | `script` | 老师台词（speaker 固定为 `Sensei`） |
| `info` | `info` | 旁白 / 信件 / 系统文本 |
| `background` | `background` | 背景切换，值为 `BG_xxx`，与图片文件名一一对应 |
| `bgm` | `bgm` | 配乐，`Theme_xx` 为曲目、`AMB_xx` 为环境音 |
| `bgm-stop` | `bgmStop` | 停止配乐 |
| `sound` | `se` | 音效 `SE_xxx` |
| `reply` | `choice` | 选项出现的位置标记，带 `group` 组号 |

**重要限制：wiki 只记录单条通关路径。** `choice` 节点只有组号，不含全部分支选项文本；
实际选中的那一句以 `sensei` 节点出现在后面。因此无法从 wiki 还原完整分支拓扑，
播放器只能把 `choice` 渲染为「（此处存在对话选项）」标记，或用社区补充分支数据。

## 4. 使用

```bash
# 元数据（约 70 秒）
python tools/fetch/kivo.py meta

# Spine：回忆大厅 434 个（2.8GB）/ 立绘 1362 个（2.2GB）
python tools/fetch/kivo.py spine --type home
python tools/fetch/kivo.py spine --type spr

# 画廊：指定相册 ID 或全部（全部约 19k 张 / 6.7GB）
python tools/fetch/kivo.py gallery --albums 1 2 83
python tools/fetch/kivo.py gallery --albums all

# 语音：--category lobby 只下大厅语音（约 8000 条 / 400MB）
python tools/fetch/kivo.py voice --category lobby --lang jp

# 剧情（需本机 Chrome；Playwright 驱动，断点续传）
node tools/fetch/ba_story_full.mjs --enumerate-only
node tools/fetch/ba_story_full.mjs

# 归一化 + 建索引 + 算覆盖率
python tools/fetch/normalize_story.py
python tools/fetch/build_asset_map.py

# 生成素材检视器
python tools/viewer/build_viewer.py
```

所有下载均支持断点续传：已存在且非空的文件自动跳过，失败项重试 3 次并记录。

`ba_story_full.mjs` 内置看门狗：超过 75 秒没有新文件落盘就主动重载页面。
Cloudflare 会话长时间跑会假死，没有看门狗会整批卡住。

## 5. 已知技术约束

**Spine 运行时版本不匹配。** kivo 提供的二进制 `.skel` 头标记为 **4.2.x**
（实测 4.2.33 / 4.2.37 / 4.2.40 / 4.2.43），而 `pixi-spine` 最高支持到 4.1。
记忆大厅不能按原计划用 `pixi-spine 3.8` 渲染，需改用官方
`@esotericsoftware/spine-webgl` 4.2 运行时，用独立 canvas 层叠加在 Pixi 之上。

**剧情语言。** `bluearchive.wiki` 为英文站，台词为英译。中文台词需另接
`zh.bluearchive.wiki` 或国服 wiki，节点结构一致，可作为第二语言层并入同一张表。

**音频缺口。** BGM 271 种、SE 748 种在剧情里被引用，但没有任何公开站点提供可下载文件。
播放器需要静音降级 + 用户自备音频目录的映射机制。
