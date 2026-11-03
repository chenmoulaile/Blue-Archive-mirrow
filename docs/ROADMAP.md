# 路线图（Phase 4 起）

> 上接 `deliverables/phase1..3-report.md`。本文件只写「接下来做什么、验收标准是什么」。
> 接手前先读根目录 `AGENTS.md`。

---

## 现状基线（Phase 3 结束时）

| 指标 | 数值 |
|---|---|
| `game-ui-spec.ts` 常量 | 97 个，已校准 **11**，`estimated` **86** |
| UI 图集 | 18 个 NGUI 图集 / 1991 精灵 / 440 个带切边 |
| 页面覆盖率 | 主界面 87.5% · 剧情 55% · 桃信 60% · 招募 45% · 设置 35% · 咖啡厅 30% · 活动 30% |
| SE | 676 个文件，剧情 SE 名字 834 个，high 24 / medium 40 / 未匹配 770 |
| 测试 | typecheck / config / gacha / layout / e2e 全绿 |

---

## Phase 4：像素校准（阻塞解除的前提）

**目标**：把 86 个 `estimated` 降到 0，剧情对话框拿到真原件。

| # | 任务 | 验收 |
|---|---|---|
| 4.1 | 用户提供 1920×1080 游戏内主界面截图 | 文件落到 `docs/refs/` |
| 4.2 | 用 `tools/fetch/crop_ui.py` 切剧情对话框 / 名字框 / 选项按钮 | `data/ui_atlas.json` 出现 `origin: screenshot_crop` 条目 |
| 4.3 | 逐控件对齐位置尺寸，写回 `game-ui-spec.ts` | `countEstimates()` 的 `estimate` 降到 ≤ 20 |
| 4.4 | 主界面截图与参考图叠层比对 | `tools/recon/out/` 出对比图，肉眼一致 |

> 没有截图就别开这一阶段。凭感觉改 `estimated` 等于造假。

---

## Phase 5：页面收口（覆盖率达标）

**目标**：七页覆盖率达标。

| 页面 | 当前 | 目标 | 主要缺口 |
|---|---|---|---|
| 主界面 | 87.5% | ≥90% | AP / 信用点图标（NGUI 无对应精灵） |
| 剧情 | 55% | ≥90% | 对话框、播放器按钮（自动/快进/回看/历史/跳过） |
| 桃信 | 60% | ≥85% | 列表项、头像框、未读角标 |
| 招募 | 45% | ≥85% | 卡池列表项、保底计数条、类型标签 |
| 设置 | 35% | ≥80% | 分组标题、滑块、开关、下拉全部换 `Common_*` |
| 咖啡厅 | 30% | ≥70% | 家具栏、舒适度条、领取按钮、来访气泡 |
| 活动 | 30% | ≥75% | 缩略图框、时间线标签、跳转按钮 |

**做法**：先在图集里按名字找对应精灵（`data/ui_atlas.json` 有 1991 条，够用），
有切边的用 `NineSlice`，纯图标用 `UIIcon`。找不到的保留 `Glyph` 兜底并标注原因。

---

## Phase 6：音频补全

| # | 任务 | 验收 |
|---|---|---|
| 6.1 | 找 `SE_*` 资源：下 `assets-_mx-scenes` / `uis-01_common-*` 再跑 `map_se.py` | 未匹配从 770 降到 < 300 |
| 6.2 | UI 点击音（按钮/切页/弹窗） | 点按钮有声音 |
| 6.3 | 咖啡厅 BGM（`assets-_mx-cafe-mxcommonaudio-cafe_bgm`） | 进咖啡厅自动播放 |

---

## Phase 7：打包与分发

| # | 任务 | 验收 |
|---|---|---|
| 7.1 | 接 `electron-builder`（`build.appId` 已就位） | `npm run dist` 出 Windows 安装包 |
| 7.2 | 首次启动检测素材缺失并给出下载引导 | 空目录也能进向导 |
| 7.3 | 自动更新 / 版本号策略 | — |

---

## 长期待办（不排期）

- 剧情中文文本：当前剧情来自 bluearchive.wiki（英文），国服中文文本需另找源。
- 分支对话树：wiki 只有单条通关路径，`choice` 节点只有组号。
- Spine 3.8 运行时：当前只有 4.2，3.8 资源读不了。

---

## 验收纪律

每个 Phase 结束必须：

1. `npm run typecheck && npm run test:config && npm run test:gacha && npm run test:layout && npm run test:e2e` 全绿；
2. e2e「控制台错误 0」；
3. 截图用 `ViewImage` 亲眼看过；
4. 写 `deliverables/phaseN-report.md`，**数字必须真实**，做不到就写「未达标」。
