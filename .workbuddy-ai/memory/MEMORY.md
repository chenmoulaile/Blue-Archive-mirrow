# 蔚蓝档案同人桌面客户端 · 项目长期记忆

## 项目定位

Electron + Vite + React + TypeScript 严格模式的 Windows/macOS 桌面软件，复刻《蔚蓝档案》的
启动页、记忆大厅、桃信、咖啡厅、剧情播放器、活动复刻、本地卡池模拟器。
非官方、非商业同人，素材版权归 NAT GAMES / NEXON，代码 MIT 但不覆盖素材。

## 铁律

- 卡池模拟**完全离线**，只用软件内生成的虚拟青辉石，绝不接真实货币/支付/账号。
- **不实现**游戏数据库解密（不做 ScenarioScriptExcel dump、不做 SQLCipher 解密）。
- 所有从 wiki 拿的数据，数据文件里必须带 `source_url`。
- **所有工作（含临时文件、包管理器缓存）只允许落在 E 盘**，不得在 C 盘产生任何文件。
  拉起子进程一律用 `scripts/env.mjs` 的 `childEnv()`；`scripts/env.mjs` 还会改写当前进程的
  `TEMP/TMP/TMPDIR`（Playwright 用 `os.tmpdir()` 建 profile，只传子进程拦不住）。
- 严格按 Phase 1→9 顺序推进，**每完成一个 Phase 等用户确认**。
- **没有原件就不伪造原画**：UI 图集未提取时用中性线性图标（`src/components/Glyph.tsx`）
  兜底并打 `data-ui-source="css-fallback"`，不做 BA 风格仿制按钮。

## 架构决定（已因实测数据修正）

| 项 | 原计划 | 实际 |
|---|---|---|
| Spine 运行时 | PixiJS + pixi-spine 3.8 | **spine-webgl 4.2**（素材是 4.2.33~4.2.43），独立 canvas 层 |
| 剧情来源 | 自建元数据 + wiki 抓取 | wiki `{{Story}}` 模板 → 节点 JSON，已跑通 2479 集 |
| 分支拓扑 | 完整对话树 | wiki 只有单条路径，`choice` 仅标记位置 |
| 音频 | wiki 下载 | **无公开源**，用户自备 + 静音降级 |

## 关键路径

- 素材根目录 `resources/`（git 忽略），索引 `data/asset_map.json`
- 剧本背景 `BG_xxx` ↔ 图片文件名同名，直接按 stem 查表
- 羁绊剧情里的 `memlobby` 节点 = 记忆大厅解锁点，可直接串起剧情与大厅 Spine
- 抓取工具全在 `tools/fetch/`，检视器 `viewer/index.html`（离线单文件）

## 用户偏好

- 在校大学生，算法竞赛方向（2026 CCPC 乐山站）
- 二游《蔚蓝档案》，特别喜欢空崎日奈、龙华妃咲
- 泳装龙华妃咲 = 学生 id 599，Spine `CH0356_spr` / `CH0356_home`，144 条语音；
  卡池「限定限时招募【黑君有所远虑】」（国服 2026-02-14）
