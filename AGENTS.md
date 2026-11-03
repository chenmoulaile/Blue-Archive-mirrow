# AGENTS.md —— 接手这个项目的第一个文件

> 你（下一个 agent）在不同机器上接手本项目。先读这一页，再动手。
> 最后更新：2026-11-03 · 对应提交 `334e39a` 之后

---

## 0. 一句话

**什亭之匣（Shittim Chest）** —— 《蔚蓝档案》的非官方同人桌面客户端。
Electron + Vite + React + TypeScript 严格模式，复刻启动页、记忆大厅（Spine 4.2）、
桃信、咖啡厅、剧情播放器、活动复刻、离线卡池模拟器。

**非商业、非官方**，与 NAT GAMES / NEXON / Yostar 无关。代码 MIT，**素材版权归原厂，不随仓库分发**。

---

## 1. 三十秒上手

```bash
npm install
npm run build          # 构建 dist/ + dist-electron/
npm run start          # 启动 Electron
npm run typecheck      # TS 严格模式，必须 0 错误
npm run test:config    # 语言/主题默认值断言
npm run test:gacha     # 卡池引擎 10 万次模拟
npm run test:layout    # 主界面布局自检（重叠检测）
npm run test:e2e       # 端到端 + 截图，产物在 tools/recon/out/
```

**但直接跑会缺素材** —— 见第 3 节。没有素材时软件仍能启动，界面走兜底样式，
Spine 大厅显示「未找到模型」，不会崩。

---

## 2. 目录地图

```
electron/         主进程：本地 http 服务器（127.0.0.1 随机端口）+ 存档/配置 IPC
  main.ts         ★ TEMP 重定向、userData 路径、静态服务、config:get/patch
  preload.ts      contextBridge 暴露的 baApi
src/
  core/           业务核心
    assets.ts     素材索引加载（data/asset_map.json）
    store.ts      存档（.userdata/save.json）
    audio.ts      BGM/SE/语音，含 SE 名字映射
    gacha.ts      卡池引擎（概率/保底/充能）
    config.ts     ★ 默认语言 zh-CN、语音 ja、主题 dark-game
    i18n.ts       词条，读 data/i18n/*.json
    game-ui-spec.ts  ★ 97 个 UI 常量，每个带 source 标注
    ui-atlas.ts   ★ 图集加载 + 九宫格 border-image 计算
  components/     SpineView / NineSlice / Glyph（兜底图标）
  pages/          9 个页面 + SetupWizard
  styles/         global.css / cursors.css / game-theme.css
data/             ★ 生成的数据（git 忽略，见第 3 节）
resources/        ★ 素材本体（git 忽略，4GB+，版权原因不入库）
tools/fetch/      ★ 全部素材管线脚本（见第 3 节）
scripts/          构建/启动/测试；env.mjs 统一临时目录
deliverables/     Phase 1/2/3 报告 + 探针 JSON
docs/             数据源说明 + 本文件 + ROADMAP
```

---

## 3. 素材怎么办（最重要的一节）

`resources/` 和 `data/*.json` **不在仓库里**。两条路：

### 3.1 从零重建（推荐，已验证可跑）

```bash
# A. wiki 抓取（剧情/学生/卡池/家具/语音）
python tools/fetch/kivo.py meta
python tools/fetch/kivo.py spine --type home
python tools/fetch/kivo.py gallery --albums 1 2 83 6 58 79 15 78 8 16 29 53 67
node tools/fetch/ba_story_full.mjs          # 需要本机 Chrome
python tools/fetch/fetch_avatars.py
python tools/fetch/fetch_furniture.py
python tools/fetch/fetch_banner_images.py
python tools/fetch/normalize_story.py
python tools/fetch/build_app_data.py
python tools/fetch/build_asset_map.py

# B. 国服 CDN 解包（UI 图集 / BGM / SE）—— 不需要装游戏
git clone --depth 1 https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader .vendor/Blue-Archive-Asset-Downloader
cd .vendor/Blue-Archive-Asset-Downloader
UV_CACHE_DIR="<项目>/.vendor/uv-cache" uv sync --extra unitypy --no-dev \
  --default-index https://mirrors.aliyun.com/pypi/simple
.venv/Scripts/python.exe -m ba_downloader assets download --region cn \
  --resources bundle --filter "path~assets-_mx-uis" --workspace "<项目>/.baad"
.venv/Scripts/python.exe -m ba_downloader assets download --region cn \
  --resources media  --filter "path~Media/audio/bgm/" --workspace "<项目>/.baad"
cd ../../..
npm run import:ui                            # -> resources/ui/ + data/ui_atlas.json
python tools/fetch/import_ngui_nineslice.py  # -> data/ui_nineslice.json
cp .baad/cn/android/raw/media/audio/bgm/*.ogg resources/bgm/
```

### 3.2 或者从上一台机器拷

`resources/`（约 4GB）+ `data/`（约 45MB）+ `.baad/`（约 250MB）。
**`data/ui_atlas.json` / `ui_nineslice.json` / `se_index.json` / `se_map.json` 已在仓库里**
（659KB 元数据，含每个精灵的名字、尺寸、九宫格切边、来源标注），
但 **`resources/ui/` 的 1991 张 PNG 不入库**（版权原因，与其他素材一致）。
重建只需 3 分钟：下 74MB bundle → `npm run import:ui`。

### 3.3 关键数字（重建时用来对账）

| 项 | 数量 |
|---|---|
| Spine 模型 | 6234 个文件 / 434 个回忆大厅 |
| 剧情 | 2479 集 |
| 学生 | 434 |
| UI 图集 | 18 个 NGUI 图集 / 1991 精灵（440 个带九宫格切边） |
| BGM | 365 个 .ogg（382MB） |
| SE | 676 个 AudioClip（82MB） |

---

## 4. 硬性约束（违反会返工）

1. **所有工作只允许落在项目所在盘**，不得在系统盘（C:）产生任何文件，包括临时文件和缓存。
   拉起子进程一律用 `scripts/env.mjs` 的 `childEnv()`；它还会改写当前进程的
   `TEMP/TMP/TMPDIR`（Playwright 用 `os.tmpdir()` 建 profile，只传子进程拦不住）。
2. **不实现游戏数据库解密**：不 dump `Table/ExcelDB.db`、不做 SQLCipher 解密。
   只取 `bundle` 和 `media` 两类资源。
3. **来源标注必须真实**：`game-ui-spec.ts` 每个常量必须标
   `assetbundle` / `screenshot_crop` / `wiki_layout` / `estimated` 之一。
   **禁止为了覆盖率好看把 `estimated` 改成 `assetbundle`。**
4. **没有原件就不伪造**：缺图时用 `src/components/Glyph.tsx` 的中性线性图标兜底，
   打 `data-ui-source="css-fallback"`。不做「BA 风格仿制按钮」。
5. **素材不入库**：`resources/`、`data/*.json` 都在 `.gitignore` 里。

---

## 5. 当前状态（2026-11-03）

| 模块 | 状态 |
|---|---|
| 脚手架 / 构建 / 打包 | ✅ 可用 |
| 启动流程（splash → 标题 → 加载） | ✅ |
| 主界面（大厅） | ✅ 结构完成，14/16 控件用真原件 |
| 记忆大厅 Spine 4.2 | ✅ Airi_home 渲染正常 |
| 剧情播放器 | ✅ 可播 2479 集；对话框是中性底板（无原件） |
| 桃信 / 咖啡厅 / 招募 / 活动 | ✅ 功能完整，UI 部分套原件 |
| 设置页 | ✅ 深色主题 + 全控件 |
| 首次启动向导 | ✅ |
| 主题 | ✅ 默认 `dark-game`，可切 `light` |
| UI 图集 / 九宫格 / BGM / SE | ✅ 已提取并接入 |

**覆盖率**：主界面 87.5%、剧情 ~55%、桃信 ~60%、招募 ~45%、设置 ~35%、咖啡厅 ~30%、活动 ~30%。

---

## 6. 已知的坑（都是踩过的，别再踩）

### 6.1 素材侧

- **BA 用 NGUI，不是 UGUI**。bundle 里没有 `Sprite` 对象，只有
  `Texture2D` + `MonoBehaviour(NGUIAtlas)`，后者 `mSprites[{name,x,y,width,height,borderLeft/Bottom/Right/Top}]`。
- **切图 y 轴自上而下**：`crop((x, y, x+w, y+h))`，**不能**做 `texH-y-h` 翻转，
  否则切出错位碎片。
- **UnityPy 必须 `load(目录)`**，单 bundle 加载读不出 MonoBehaviour typetree（缺同目录 MonoScript）。
- **九宫格 border 不在 `UISprite` 上**，在 `NGUIAtlas.mSprites[i]`。`UISprite` 只有 `mSpriteName/mType`。
- **BA 的 UI 精灵是白色遮罩**，游戏里靠 NGUI `mColor` 上色。所以九宫格只取形状，
  颜色交给 CSS；`fillCenter=false` 时中心透明，露出 CSS background。
- `borderImageWidth` 要夹到原图 1/3，否则小控件四边互挤、角变形。
- **剧情对话框不在 `uis-03_scenario-*`**（934 个 bundle 里只有 26 个 `Emoji_*`）。
  18 个图集里也没有。要 1:1 只能截图切图。

### 6.2 前端侧

- `i18n.ts` 必须**静态 import** JSON，不能用 fetch —— 页面模块顶层就调 `t()`。
- 深色主题下 `.field select` 特异性高于 `[data-theme] select`，会白底白字，
  已在 `game-theme.css` 用 `!important` 兜住。
- 浅色页面复用 `.choice-btn` 时文字是浅色，白底看不见 → `.momo-choices .choice-btn` 单独覆盖。
- e2e 里**不要写死点击坐标**：显示器只有 1024×768 时窗口会被裁，点击落到窗口外，
  整条流程静默失败。用视口比例或元素相对坐标。
- e2e 开头要 `waitForSelector('.setup, .splash, .title-screen2')`，
  素材是本地大 JSON，首屏可能 >2s 才出来。

---

## 7. 下一步（Phase 4 起，详见 docs/ROADMAP.md）

1. **拿一张 1920×1080 游戏内主界面截图** → 校准 86 个 `estimated` 常量（当前 11/97），
   并可用 `tools/fetch/crop_ui.py` 切出剧情对话框（标 `screenshot_crop`）。
2. 设置 / 咖啡厅 / 活动三页逐控件换 `Common_*` 九宫格（现在只做了配色）。
3. 补 SE：`SE_*` 资源不在已下载的 bundle 里，需找 `assets-_mx-scenes` / `uis-01_common-*`。
4. 打包发布：`electron-builder` 配置已加 `appId`，但没接打包脚本。

---

## 8. 验证清单（改完必须跑）

```bash
npm run typecheck && npm run test:config && npm run test:gacha \
  && npm run test:layout && npm run test:e2e
```

全部通过 + e2e「控制台错误 0」才算完。截图在 `tools/recon/out/`，
用 `ViewImage` 看过再下结论 —— 数字对不代表画面对。

---

## 9. 历史报告

- `deliverables/phase1-report.md` —— 脚手架 / Spine 4.2 / 语言锁定
- `deliverables/phase2-report.md` —— 九宫格切边 / SE / 页面套 UI
- `deliverables/phase3-report.md` —— 深色主题 / SE 映射 / 剧情对话框探针
- `deliverables/prefab-border-probe.json` —— 九宫格探针原始数据
- `deliverables/scenario-ui-probe.json` —— 剧情 UI 探针原始数据
- `deliverables/se-unmatched.csv` —— 770 个未匹配 SE，工单
