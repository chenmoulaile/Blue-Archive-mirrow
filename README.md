# Shittim Chest（什亭之匣）

> **接手开发请先读 [`AGENTS.md`](./AGENTS.md)** —— 三十秒上手、素材怎么重建、
> 已知的坑、当前状态与下一步都在那一页。换机器接手的额外说明见
> [`docs/HANDOFF.md`](./docs/HANDOFF.md)，路线图见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。

> **非官方项目。** 本项目与 NAT GAMES / NEXON / Yostar 无任何关联，未获其授权或认可。
> 《蔚蓝档案》(Blue Archive / ブルーアーカイブ) 的全部美术、音乐、剧情文本、角色形象
> 版权归 **NAT GAMES / NEXON** 所有。本项目仅作个人学习与非商业同人用途。
> 代码部分以 MIT 许可发布，**该许可不覆盖任何素材**。
>
> 本项目不包含、不实现、也不提供任何游戏数据库解密功能；不接入真实货币、支付渠道、
> 账号系统或在线验证；抽卡模拟完全离线，仅使用软件内生成的虚拟资源。

Electron + Vite + React + TypeScript 严格模式实现的《蔚蓝档案》同人桌面客户端。

## 下载即用（普通用户看这里）

不想配置环境，直接到 [**Releases**](https://github.com/chenmoulaile/Blue-Archive-mirrow/releases) 下载 **v0.3.0** 资产包：

1. **下载全部资产分卷**（`00-核心` + `01-*` 起的素材分卷，清单以 Release 资产列表为准）。
2. **全部解压到同一个目录**（分卷压缩包只需对 `00-核心` 或第一个分卷右键解压，其余分卷自动续接），得到如下结构：

   ```
   Blue-Archive-mirrow/
   ├─ 启动.bat            ← 双击启动
   ├─ package.json
   ├─ data/               ← 元数据（已在核心包 / git 仓库内）
   ├─ dist/  dist-electron/   ← 构建产物（核心包内）
   ├─ node_modules/       ← 依赖（核心包内）
   ├─ docs/
   └─ resources/          ← 素材分卷解压到这里（spine / ui / voice / bgm / images / …）
   ```

3. **双击 `启动.bat`**。脚本会在同目录启动应用；若提示缺少 Node.js，请安装
   **Node.js ≥ 18**（https://nodejs.org/ 下载 LTS 版）后再双击。
   也可手动启动：在解压目录打开终端执行 `npm start`。

> 若 Release 提供了 **portable exe**（单文件绿色版），下载后双击即可，无需 Node.js；
> 素材分卷仍需解压到 exe 同目录的 `resources/` 下。
> 若只 clone 了 git 仓库（含 `data/` 元数据，56MB），下载素材分卷解压到仓库根的
> `resources/` 后同样可用；开发者从源码跑见下文「运行」。

## 功能

| 模块 | 内容 |
|---|---|
| 首次启动向导 | 选择游戏解包目录 / 跳过（使用占位素材），结果写 `.userdata/config.json` |
| 启动页 | BA 风格标题画面、签到状态、资料概览 |
| 记忆大厅 | Spine 4.2 骨骼动画，434 个回忆大厅模型，点击互动 + 大厅语音，滚轮缩放 / 拖拽平移 |
| 剧情 | 2479 集剧情（主线 521 / 羁绊 1116 / 活动 777 / 社团 65），背景切换、打字机、自动播放、已读快进、对话回看 |
| 招募 | 862 个历史卡池，两套保底（经典 200 天井 / 充能 100·200），十连保底，抽卡记录导出 |
| 桃信 | 以羁绊剧情为素材的会话列表、聊天气泡、回复选项与好感度 |
| 咖啡厅 | 1092 件家具、舒适度 → 离线青辉石收益、来访学生 |
| 活动复刻 | 544 条活动时间线，跳转同期卡池与相关剧情 |
| 设置 | 素材目录、文字速度、音量、存档重置、版权声明 |

## 运行

```bash
npm install
npm run build      # 构建主进程 + 渲染层
npm start          # 启动（scripts/start.mjs 会清掉 ELECTRON_RUN_AS_NODE）
```

首次运行前需要准备素材与数据，见下一节。素材缺失时界面会显示占位而不是崩溃。

### 验证

```bash
npm run typecheck   # TypeScript 严格模式检查
npm run test:config # 语言/语音默认值与 i18n 兜底规则
npm run test:gacha  # 卡池引擎 10 万次模拟验收
npm run test:layout # 主界面布局自检（锚点尺寸 + 重叠检测）
npm run test:e2e    # 启动 Electron，逐页截图并检查控制台错误
```

## 素材与数据

素材不入库，需自行运行抓取脚本（详见 [docs/asset-pipeline.md](docs/asset-pipeline.md)）。

```bash
# 元数据（约 70 秒）
python tools/fetch/kivo.py meta

# Spine：回忆大厅 434 个 / 立绘 1362 个
python tools/fetch/kivo.py spine --type home
python tools/fetch/kivo.py spine --type spr

# 画廊（背景、主线 CG、活动、个人剧情等 13 个相册）
python tools/fetch/kivo.py gallery --albums 1 2 83 6 58 79 15 78 8 16 29 53 67

# 大厅语音
python tools/fetch/kivo.py voice --category lobby

# 剧情（需本机 Chrome）
node tools/fetch/ba_story_full.mjs

# 头像 / 大厅封面 / 家具图标 / 卡池公告图
python tools/fetch/fetch_avatars.py
python tools/fetch/fetch_furniture.py
python tools/fetch/fetch_furniture_icons.py
python tools/fetch/fetch_banner_images.py

# 归一化 + 生成客户端数据 + 建索引
python tools/fetch/normalize_story.py
python tools/fetch/build_app_data.py
python tools/fetch/build_asset_map.py
```

### 音频

kivo 与 bluearchive.wiki 都**没有**提供 BGM / 音效文件，只有角色语音。
BGM 可以从国服 CDN 直接下（见下一节路径 A 的第 2 步，365 个 `.ogg` 共 399MB），
放到 `resources/bgm/`，文件名即剧情里的 id（`theme_10.ogg` ↔ `Theme_10`）。

```
resources/bgm/theme_10.ogg      ← 剧情 BGM
resources/se/SE_DoorOpen_01.wav ← 音效（已就位，见「已知约束」SE 一节）
```

找不到时播放器静音降级，不会报错。支持 `.ogg` / `.mp3` / `.wav`。
设置页会显示「音频未同步」而不是弹错误。

### 游戏内 UI 原件（三条路径）

界面上的按钮、对话框、顶栏都需要游戏内 UI 图集。拿不到时全部退回
`src/components/Glyph.tsx` 的中性线性图标，并在 DOM 上打 `data-ui-source="css-fallback"`，
**不做 BA 风格仿制**。

**路径 A：从国服 CDN 下载 bundle 再切图（已跑通，推荐）**

不需要装游戏。用 [Blue-Archive-Asset-Downloader](https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader)
拉取指定 bundle，再用本项目脚本切出 NGUI 图集：

```bash
# 1. 准备下载器（一次性）
git clone --depth 1 https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader .vendor/Blue-Archive-Asset-Downloader
cd .vendor/Blue-Archive-Asset-Downloader
UV_CACHE_DIR="E:/Blue archive/.vendor/uv-cache" \
  uv sync --extra unitypy --no-dev --default-index https://mirrors.aliyun.com/pypi/simple

# 2. 只下 UI 相关 bundle（25 个，约 74MB）与 BGM（365 个，约 399MB）
.venv/Scripts/python.exe -m ba_downloader assets download --region cn \
  --resources bundle --filter "path~assets-_mx-uis" --workspace "E:/Blue archive/.baad"
.venv/Scripts/python.exe -m ba_downloader assets download --region cn \
  --resources media --filter "path~Media/audio/bgm/" --workspace "E:/Blue archive/.baad"

# 3. 切图 + 写 ui_atlas.json
cd ../../.. && npm run import:ui
cp .baad/cn/android/raw/media/audio/bgm/*.ogg resources/bgm/
```

**关键事实：BA 用的是 NGUI，不是 UGUI。** bundle 里没有 `Sprite` 对象，
只有一张 2048×2048 的 `Texture2D` + 一个 `MonoBehaviour(NGUIAtlas)`，
后者用 `mSprites[{name, x, y, width, height}]` 记录每个精灵的矩形。
所以切图 = 按矩形从大图裁，**y 轴是自上而下的**（UnityPy 读出的位图已是正向，
再做 `texH - y - h` 翻转会切出错位碎片）。

产出：18 个图集、1991 个精灵，`resources/ui/<图集>/<精灵名>.png`（15MB）+
`data/ui_atlas.json`（含 18 个语义别名，`icon_momotalk` → `Common/Common_Icon_MoMoTalk` 这种）。

**路径 B：本机有游戏安装 / 解包目录**

```bash
.venv/Scripts/python.exe tools/fetch/extract_ui.py --list "D:/BlueArchive"
.venv/Scripts/python.exe tools/fetch/extract_ui.py --game-dir "D:/BlueArchive"
```

产物同上，另外还能拿到 TMP 字体（`data/ui_font.json`）与 SE。只读游戏目录。

**路径 C：只有游戏内截图（兜底）**

```bash
.venv/Scripts/python.exe tools/fetch/crop_ui.py --init
.venv/Scripts/python.exe tools/fetch/crop_ui.py \
  --shot shots/lobby-1920x1080.png --regions tools/fetch/ui_regions.json
```

产物同上，但 `source: "screenshot_crop"`。

> **声明**：只有路径 C 是**截图切图还原，不是原始图集**。路径 A / B 都是 bundle 原件。

### 鼠标指针

```bash
python tools/fetch/fetch_cursors.py    # -> resources/cursors/
```

来自 [makipom/BlueArchive-Cursors](https://github.com/makipom/BlueArchive-Cursors)（MIT）。
设置页可以关掉，退回系统默认指针。

## 目录结构

```
├── electron/            主进程（本地 http 服务器 + 存档/配置 IPC）
├── src/
│   ├── core/            存档、素材加载、音频、卡池引擎、i18n、UI 规格
│   ├── components/      SpineView（spine-webgl 4.2）、NineSlice、Glyph（占位图标）
│   ├── pages/           9 个页面（含首次启动向导）
│   └── styles/          全局样式
├── data/                元数据、客户端数据、i18n 词条（JSON）
├── resources/           素材本体（git 忽略）
├── tools/fetch/         抓取、UI 提取（extract_ui.py）/ 截图切图（crop_ui.py）
├── tools/viewer/        离线素材检视器
├── scripts/             构建、启动、测试（env.mjs 统一临时目录）
├── docs/                数据源与接口说明
└── deliverables/        阶段报告
```

## 已知约束

**Spine 是 4.2，不是 3.8。** kivo 的二进制 `.skel` 头标记为 4.2.33~4.2.43，
`pixi-spine` 最高只到 4.1，读不了。所以记忆大厅用官方
`@esotericsoftware/spine-webgl` 4.2，走独立 canvas 层。

**wiki 不记录分支拓扑。** 剧情模板只存单条通关路径，`choice` 节点只有组号，
没有全部选项文本。播放器把选项位置渲染为提示标记。

**BGM 与 SE 都已就位（2026-11-10 盘点核对）。** `resources/bgm/` 有 365 个 `.ogg`（382MB，
文件名小写，如 `theme_10.ogg`；Windows 文件系统大小写不敏感，代码里按 `Theme_10` 查也能命中）。
SE 有 1198 个 `.wav`（`resources/se/`，Steam 版 bundle 提取），与 `data/se_index.json` 一一对应、
双向零差额；剧情 SE 经 `data/se_map.json` 映射后 804/804 目标文件实存；
`src/components/gacha/gachaData.ts` 引用的 16 个 `UI_Gacha_*` 全部实存。
已知缺口仅剩 35 个剧情 SE 引用无对应文件（桃信表情动效音 `SFX_Emoticon_Motion_*` 28 种、
剧情确认/回答音 `SE_Confirm/SE_Answer` 4 种、其他 3 种，剧情节点里合计出现 7842 次），
播放时静音降级；补齐路径是从音频 bundle 重扫（见 `docs/asset-pipeline.md`）。

**UI 图集已从 bundle 提取。** `data/ui_atlas.json` 有 2536 条（NGUI 图集精灵 + 39 条
ChatArchive 独立件），顶栏三货币图标（AP 闪电 `Common/Common_Icon_Stamina`、
信用点 `Common/Common_Icon_Gold`、青辉石 `Conquest/Common_Icon_Diamond`）官方原件
实存且已接线（`src/core/game-ui-spec.ts` TOP_CURRENCY_ICONS，2026-11-08 走查①），
其余零散控件缺件时走 `Glyph.tsx` 占位并在 DOM 打 `data-ui-source` 标注。
**九宫格切边已落地**（`data/ui_nineslice.json`，
476 条，border 为 LTRB 序）：474 条来自 NGUIAtlas.mSprites 解析（2026-11-10 用
国服 atlas bundle 快照 + KR CDN 同名 bundle 重扫交叉验证，300/300 完全一致零冲突），
另 2 条 ChatArchive 对话底板（`Scenario_Mode_Bg_3` / `Dialogue_Event_Background`）
不是图集精灵，用 Pillow 从原图量出（`tools/fetch/measure_chat_borders.py`，明细在
`.scratch/infra/chat_border_measure.json`）。只有走截图切图（路径 C）时才是「非原始图集」。
`Emoji/*` 33 条仍缺图集纹理文件（禁止恢复引用，补齐路径见 `.scratch/infra/icon-found.md`）。

**存档落在工作目录。** `.userdata/save.json`，缓存与 GPU shader 也在 `.userdata/`，
不写系统盘。

## 磁盘占用（全部在 E 盘）

硬性约束：本项目**不在 C 盘产生任何文件**，包括临时文件与包管理器缓存。

| 用途 | 位置 | 由谁保证 |
|---|---|---|
| 依赖与构建产物 | `node_modules/`、`dist/`、`dist-electron/` | 项目本身在工作目录 |
| 存档 / 会话 / 日志 / GPU 缓存 | `.userdata/` | `electron/main.ts` 的 `app.setPath(...)` |
| Chromium / V8 临时目录 | `.userdata/tmp/` | `electron/main.ts` 在 app ready 前改写 `TEMP/TMP/TMPDIR` |
| 脚本运行期临时目录 | `.tmp/` | `scripts/env.mjs` 的 `childEnv()`，同时改写当前进程的 `TEMP` |
| npm 缓存 | `E:/npm-cache` | `.npmrc` 的 `cache` / `electron_config_cache` |
| pip 缓存 | `E:/pip-cache` | `.venv/pip.ini` 的 `cache-dir` |

新增会拉起子进程的脚本时，一律用 `scripts/env.mjs` 的 `childEnv()` 构造环境变量，
不要直接 `{ ...process.env }` —— Playwright 用 `os.tmpdir()` 建浏览器 profile，
只传给子进程是拦不住的。

## 素材版权

`resources/`、`viewer/`、`data/*.json` 中的素材与抓取结果不随仓库分发。
使用者需自行运行抓取脚本，从公开 wiki 页面获取，并自行承担使用责任。
