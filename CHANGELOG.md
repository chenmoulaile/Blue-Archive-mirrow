# 更新日志（Changelog）

本项目全部版本变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循语义化版本。

## [v0.3.0] — 2026-11-09

终版：素材全量解包 + 还原度修复 + 下载即用发布包。

### 素材全量（随 GitHub Release 分卷包分发，每包 ≤ 1.9GB）

- **Spine 模型**：SCNX 解包提取 38/38 套三件套全齐（`asset_map.spines` 887 → 931），
  页图经 `bundle_scan.json` 纹理索引精确定位、0 缺失；修复 UnityPy `m_Script` 字符串
  解码污染（surrogateescape 还原）。46 套新模型中 45 套通过 spine-core 4.2 官方
  runtime 装载实测（`skeleton` / `alice_princess_spr` 源头缺件移入 `.trash`）。
- **立绘 → 骨骼映射**：`character_spine` 显示名映射 552 → 903 条
  （「室笠茜 → akane_spr」等 351 条显示名补全）。
- **reference2 合并**：201 条目中 191 套与现有 asset_map 重名且磁盘核对齐全（跳过），
  净增 8 套（2 套源头缺件如实记录）。
- **语音**：`molru_named` 补完 6997 条大厅（Lobby）语音；网络补缺下载 993 条契约语音
  （voice 7051 → 8044，含 `*_Title` 语音）。
- **BGM / 音效**：网络补缺 `Theme_01` 等（17 首缺口中 16 首实测已由提取轨产出且 OggS
  头全部有效）；音效索引 `se_index` 全量入库。
- **卡面立绘**：193 张 SchaleDB portrait 全命中，转 PNG 落 `cards/`，
  `card_art.json` 193 条、0 悬空。
- **剧情 BG**：缺口重算 68 张，有直链的 13 张全部入库。
- **其余门类**：ui 2025 PNG、剧情 BG 2375、avatar 512、npc_portrait 239、banners 863、
  furniture、home 族 266 + spr 族 610 spine 全部随包分发。

### 功能

- **剧情**：2276 集剧情含分支选择（`.choice-overlay` 分支徽标契约）；主线按 8 卷结构
  组织（`main_story_map.json`），活动 60 个（`event_story_map.json`）。修正 `story_index`
  main 段 820 条活动剧情错分类，重分类为 event，「全部」tab 不再混入。
- **招募（抽卡）**：862 个历史卡池、两套保底（经典 200 天井 / 充能 100·200）、十连保底、
  抽卡记录导出；**十连结果卡面换为学生卡面立绘**（`card_art.json` 接线，图源未就位时
  回退头像），新增 **NEW 徽标**（对照 `gachaHistory` 判定首次获得）。
- **桃信**：265 名学生会话、聊天气泡、回复选项与好感度；修复回复按钮被通栏拉伸的
  问题，收窄为内容宽度。
- **记忆大厅**：Spine 4.2 骨骼动画，点击互动 + 大厅语音、滚轮缩放 / 拖拽平移。
- **咖啡厅 / 活动复刻 / 设置**等既有模块沿用。

### 还原度修复

- 剧情对话框底板由 css-fallback 换为官方真素材：`Scenario_Mode_Bg_3`（对话大底板）与
  `Dialogue_Event_Background`（气泡底板），名字牌同步接入（注意：素材九宫格 border
  缺失，按 `background-image` 而非 `border-image` 接线）。
- `SpineView` 包围盒修正：不再使用 setup-pose 包围盒（隐藏附件撑大导致 cover 取景
  偏小），改为按当前 skin 实际渲染附件计算。
- `audio.ts` 音效/BGM 加载改为查 `se_index.json` / `bgm_map.json` 的实际扩展名直接
  命中，消除每个音效 2 条无效 404。

### 工程 / 发布

- **`data/` 元数据（56MB）解除 gitignore 入库**：`git clone` + 补素材包即可运行，
  不再依赖本地解包流程。
- 素材按类别分卷（00-核心 / spine / ui+se / bgm+images / avatar+furniture /
  npc_portrait / voice ×N）随 GitHub Release 分发。
- e2e 契约覆盖：剧情分支、十连演出、桃信气泡、记忆大厅；`typecheck` /
  `test:config` / `test:gacha` / `test:layout` / `test:e2e` 全绿。

### 已知限制

- 上游源缺失（尽力补齐后仍缺）：`Theme_01` 等 17 首 BGM 中 1 首待补、9 张剧情 BG、
  少量语音契约路径（详见 `data/story_failed.json`）。
- 本项目与 NAT GAMES / NEXON / Yostar 无任何关联；全部素材版权归 **NAT GAMES /
  NEXON** 所有，本项目非官方、非商业同人，仅作个人学习用途。

## [v0.2.0]

- Electron + Vite + React + TypeScript 严格模式基线：启动页、记忆大厅、剧情、招募、
  桃信、咖啡厅、活动复刻、设置。
- 资产管线（kivo 抓取 + Steam 包解包）、asset_map / story_index 等元数据。
