# 交接说明（HANDOFF）

> 面向「换一台机器接手」的 agent。读完根目录 `AGENTS.md` 再读这份，
> 这里只写**为什么是这样**、**哪些结论不要再重新推导**、**当前卡在哪**。

---

## 1. 项目由来

《蔚蓝档案》同人桌面客户端，目标是把游戏里的几个核心界面在桌面上复刻出来：
启动流程、主界面大厅、记忆大厅（Spine L2D）、剧情播放器、桃信、咖啡厅、招募、活动复刻。

**非商业、非官方**。素材版权归 NAT GAMES / NEXON，代码 MIT 但不覆盖素材，
所以 `resources/` 不进仓库。

---

## 2. 不要再重新推导的结论

这些都是花了很多轮验证出来的，**直接采信**，除非你有新证据：

| # | 结论 | 证据 |
|---|---|---|
| 1 | Spine 素材是 **4.2**（4.2.33~4.2.43），`pixi-spine` 读不了，必须用 `@esotericsoftware/spine-webgl` 4.2 | `resources/spine/*/*.skel` 头部字符串 |
| 2 | BA 的 UI 是 **NGUI**（`NGUIAtlas` / `UISprite` / `UIWidget`），不是 UGUI，bundle 里**没有 Sprite 对象** | `deliverables/prefab-border-probe.json` |
| 3 | 九宫格 border 在 `NGUIAtlas.mSprites[i].borderLeft/Bottom/Right/Top`，**不在 `UISprite` 上** | 同上，`conclusion` 字段 |
| 4 | 切图 y 轴**自上而下**，用 `crop((x,y,x+w,y+h))`，翻转会切出碎片 | `.tmp/crop_compare.png`（已删，结论保留） |
| 5 | BA 的 UI 精灵是**白色遮罩**，游戏内靠 NGUI `mColor` 上色 | 目视 `resources/ui/Common/*.png` |
| 6 | 剧情对话框**不在** `uis-03_scenario-*`（934 个 bundle 只有 26 个 `Emoji_*`） | `deliverables/scenario-ui-probe.json` |
| 7 | 剧情文本来自 bluearchive.wiki（英文），国服中文文本没有公开源 | 数据里 `source_url` |
| 8 | 分支拓扑：wiki 只记录单条通关路径，`choice` 节点只有组号没有选项文本 | 剧情 JSON 结构 |

---

## 3. 环境（Windows 实测）

| 组件 | 版本 | 备注 |
|---|---|---|
| Node.js | 22.x | |
| Python | 3.13（项目 `.venv`） | 素材管线用 |
| UnityPy | 1.25.x | **必须 `load(目录)`**，单文件加载读不出 typetree |
| Pillow | — | 切图 |
| .NET SDK | **未安装** | 所以只能用 `--bundle-handler unitypy`，不能用 AssetRipper |
| 下载器 | `ZM-Kimu/Blue-Archive-Asset-Downloader` | 装在 `.vendor/`，不进仓库 |

### 从零装（Linux/macOS 同理，改路径即可）

```bash
npm install
python -m venv .venv && .venv/Scripts/python.exe -m pip install -U pip pillow UnityPy
# 下载器
git clone --depth 1 https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader .vendor/Blue-Archive-Asset-Downloader
cd .vendor/Blue-Archive-Asset-Downloader && uv sync --extra unitypy --no-dev
```

> PyPI 直连在国内会超时，加 `--default-index https://mirrors.aliyun.com/pypi/simple`。
> `uv` 的缓存目录要指到项目内，否则沙箱会 EACCES。

---

## 4. 数据事实（重建后用来对账）

| 项 | 数值 | 怎么验证 |
|---|---|---|
| 剧情集数 | 2479 | `data/story_index.json` 长度 |
| 学生 | 434 | `data/students_slim.json` |
| 回忆大厅 Spine | 434 | `resources/spine/*_home/` |
| UI 图集 | 18 个 / 1991 精灵 / 440 带切边 | `data/ui_atlas.json` + `data/ui_nineslice.json` |
| BGM | 365 个 ogg / 382MB | `resources/bgm/` |
| SE | 676 个 wav / 82MB | `data/se_index.json` |
| 国服目录总量 | 69,840 项 / 12.29GB | `ba-downloader` 日志 |

---

## 5. 当前卡在哪

### 5.1 硬阻塞：没有游戏内截图

`game-ui-spec.ts` 的 86 个常量无法校准，剧情对话框拿不到真原件。
**需要用户提供 1920×1080 游戏内截图**（主界面 + 剧情各一张）。
拿到后：`tools/fetch/crop_ui.py` 切图（标 `screenshot_crop`），再逐控件对齐。

### 5.2 软阻塞

| 项 | 现状 | 解法 |
|---|---|---|
| 设置/咖啡厅/活动 UI | 只有配色，控件没换 | 按名字在 `data/ui_atlas.json` 找 `Common_*` |
| SE 未匹配 770 个 | 提取到的是 `SFX_*`，剧情用 `SE_*` | 下 `assets-_mx-scenes` / `uis-01_common-*` 再跑 `map_se.py` |
| 打包 | `build.appId` 已配，没接脚本 | 接 electron-builder |

### 5.3 别做的事

- 不要为了让覆盖率数字好看去改 `source` 标注。
- 不要用 CSS 伪造 BA 风格控件。
- 不要下载 `Table/ExcelDB.db` 或尝试解密。

---

## 6. 交接清单

**已经在仓库里、不用重做的**：

- `data/ui_atlas.json`、`data/ui_nineslice.json`（图集与切边元数据，659KB）
- `data/se_index.json`、`data/se_map.json`
- `deliverables/*.md`（Phase 1~3 报告）
- `deliverables/*.json`（探针原始数据）

**需要重建的**：

- `resources/ui/`（1991 张精灵 PNG，`npm run import:ui`，约 3 分钟）
- `resources/spine/`、`resources/story/`、`resources/bgm/`、`resources/se/`
- `data/students*.json`、`data/story_index.json`、`data/gacha_banners.json` 等

**验证一遍环境是否就绪**：

```bash
npm run build && npm run test:e2e
# 看 tools/recon/out/e2e-04-home.png：主界面 14/16 控件应是真图标
# 看 e2e-02-lobby.png：Airi 记忆大厅应正常渲染
```

---

## 7. 沟通约定

- 用户是算法竞赛方向的学生，喜欢直接看结论和数字，不要长篇铺垫。
- 报告里**做不到就写做不到**，数字不美化。
- 每轮结束给「文件变更 + 截图路径 + 覆盖率」三件套。
