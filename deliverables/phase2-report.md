# Phase 2 报告 · 九宫格切边 + SE 音效 + 页面套 UI + 仓库重命名

**日期**：2026-10-29
**阶段**：Phase 2
**结论**：🟡 有条件通过 —— 九宫格切边拿到真实数据并已接入 4 个页面；SE 提取 676 个；
仓库重命名完成且无回归。**设置 / 咖啡厅 / 活动三个页面尚未套 UI**。

---

## 1. 仓库重命名

| 位置 | 改动 |
|---|---|
| `package.json` | `name: "shittim-chest"`、`version: 0.2.0`、新增 `build.appId = dev.shittimchest.app` / `productName = Shittim Chest` |
| `electron/main.ts` | 窗口标题 → `什亭之匣 · Shittim Chest` |
| `index.html` | `<title>` → 同上 |
| `README.md` | 一级标题 → `# Shittim Chest（什亭之匣）` |
| `deliverables/preview.html` | 标题与 `<h1>` → 什亭之匣 |

`typecheck` ✅、`test:e2e` ✅（控制台错误 0），无回归。

> 目标仓库 `https://github.com/chenmoulaile/shittim-chest` 尚未推送：
> GitHub connector 当前是 `auth-required`，无法代表账号执行 push。
> 见文末 `USER_ACTION_REQUIRED`。

---

## 2. 九宫格切边（1.1 探针 + 1.2 全量）

### 2.1 探针结论：border 不在 UISprite 上

原假设是「读 prefab 里 `UISprite` 的 border」，实测**不成立**：

- `UISprite` 组件字段只有 `mSpriteName / mType / mAtlas / mWidth / mHeight / mDepth …`，
  **没有任何 border 字段**，`mSprite` 也不存在（不是 PPtr，是字符串名）。
- 但 `mType` 有值：全量 217,484 个 UISprite 实例中，Sliced 177,207 / Simple 39,394 /
  Tiled 575 / Filled 258 / Advanced 50。

**真正的切边在 `NGUIAtlas.mSprites[i]` 上**：
`{name, x, y, width, height, borderLeft, borderBottom, borderRight, borderTop, padding*}`。
1991 个图集精灵里有 **440 个 border 非零**。

探针报告：`deliverables/prefab-border-probe.json`
（含 `conclusion` 字段、UISprite 字段表、图集侧 border 样例）

> 踩坑记录：`UnityPy.load(<单个 bundle>)` 读不出 MonoBehaviour 的 typetree
> （缺同目录 MonoScript），必须 `UnityPy.load(<目录>)` 一次性加载，
> 否则 `atlas_sprites` 会恒为 0。

### 2.2 全量结果

723 个 `ui-_mxload-prefabs` 共 **87.3 MB**，低于 500MB 阈值，直接全量下载。

| 项 | 数量 |
|---|---|
| 图集精灵 | 1991 |
| 带切边 | **440**（22.1%） |
| 其中 prefab 里按 Sliced 使用 | 417 |
| 切边表 | `data/ui_nineslice.json`（440 条） |

生成脚本：`tools/fetch/import_ngui_nineslice.py`

### 2.3 前端接入

- `ui-atlas.ts`：并行加载 `ui_atlas.json` + `ui_nineslice.json`，切边以 nineslice 为准。
- `nineSliceStyle()`：
  - 支持 `fillCenter=false`（BA 的精灵是**白色遮罩**，形状取原件、颜色交给 CSS，
    跟 NGUI 的 `mColor` 行为一致）；
  - 渲染宽度夹到原图 1/3，避免小控件上四边互相挤压导致角变形。
- `NineSlice`：有图无切边时 `console.warn('[NineSlice] no border for <name>')`，只 warn 一次。

### 2.4 验收截图

| 截图 | 路径 |
|---|---|
| 剧情对话框 | `tools/recon/out/e2e-nineslice-dialog.png` |
| 桃信气泡 | `tools/recon/out/e2e-nineslice-bubble.png` |
| 招募结果卡 | `tools/recon/out/e2e-nineslice-panel.png` |

拉伸到不同宽度时角不变形（截图里对话框、气泡、卡片都是圆角，边缘无拉花）。

---

## 3. SE 音效

### 3.1 探明位置

- `Media/audio/` 只有 `voc_jp` / `voc_cn` / `bgm` / `videos`，**没有 se 目录**。
- `Media/uis/` 是 UI **图片**（背景、弹窗），不是音频。
- 音效在 bundle 里：`assets-_mx-*-_mxcommon-_mxdependency-audio-*`
  （cafe / characters / npcs / spinelobbies 四组，共 16.3 MB）。

### 3.2 提取结果

| 项 | 数量 |
|---|---|
| AudioClip | **676** |
| 命名前缀 | `SFX_` 663、`FX_` 9、`FurnitureBGM` 3、`UI` 1 |
| 产物 | `resources/se/*.wav`（82 MB）+ `data/se_index.json` |

脚本：`tools/fetch/probe_se.py --export`

### 3.3 已知限制

剧情里的 SE id 形如 `SE_DoorOpen_01`，而提取到的是 `SFX_*`，
**两套命名对不上**，所以剧情 SE 节点仍然静音降级（有 warn，不崩）。
UI 点击音可能不在这些 common audio bundle 里，需要再按 `assets-_mx-uis-*` 的
`-_mxdependency-audio` 找（CN 目录里没有这一类）。

---

## 4. 页面套 UI（原件覆盖率）

统计口径：页面内「用上 assetbundle 原件（图标或九宫格）」的控件数 / 该页控件总数。

| 页面 | 覆盖率 | 说明 | 截图 |
|---|---|---|---|
| 主界面 | **14 / 16 = 87.5%** | AP / 信用点图标 NGUI 里无对应精灵，保留 Glyph 兜底 | `e2e-04-home.png` |
| 剧情播放器 | 对话框 + 选项按钮 已换原件 | 左侧剧集列表仍是浅色 Web 壳 | `e2e-story-ui.png` |
| 桃信 | 气泡 + 3 个回复按钮 已换原件 | 左侧列表项仍是浅色样式 | `e2e-momotalk-ui.png` |
| 招募 | 十连结果卡 已换原件 | 卡池列表项、保底条未换 | `e2e-gacha-ui.png` |
| 设置 | 0% | 未做 | — |
| 咖啡厅 | 0% | 未做（家具图标已有独立资源） | — |
| 活动复刻 | 0% | 未做 | — |

### 具体替换

| 页面 | 原件 key | 用途 |
|---|---|---|
| 剧情 | `Dreammaker/Common_Bg_Raius20px` | 对话框底板（`fillCenter=false`，中心透深色） |
| 剧情 | `TBG/Common_Btn_BG` | 选项按钮 |
| 桃信 | `Common/School_Chat_BG` | 聊天气泡（带小尾巴的圆角板） |
| 桃信 | `TBG/Common_Btn_BG` | 回复选项按钮 |
| 招募 | `Dreammaker/Common_Bg_Raius10px` | 十连结果卡 |

---

## 5. 自动化验证

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 错误 |
| `npm run test:e2e` | ✅ 控制台错误 0；无 `[NineSlice] no border` 警告 |
| 失败请求 | 仅 `.mp3/.wav` 备选格式与 `SE_*` 的预期 404 |

---

## 6. 下一步建议

1. **设置 / 咖啡厅 / 活动套 UI**（本轮未做）：这三页是浅色 Web 壳，需要先决定
   「整体转深色游戏风」还是「保持浅色只用原件的圆角板」。前者要改 `:root` 变量，
   影响面大；后者改动小但视觉割裂。
2. **剧情对话框换成深色原件**：现在的 `Common_Bg_Raius20px` 是白色遮罩，
   靠 `fillCenter=false` + 深色背景模拟，边缘会有一圈白边。真正的剧情对话框
   可能在 `uis-03_scenario-*` 的 prefab 里（660 个 bundle，未下载）。
3. **SE 命名映射**：需要一张 `SE_DoorOpen_01 → SFX_xxx` 的对照表，
   可以从 `uis-03_scenario-*` prefab 的 AudioSource 引用里反查。
4. **UI 点击音**：继续找 `assets-_mx-uis-*` 下的 audio 依赖 bundle（CN 目录里没有，
   可能只在 JP 包里）。

---

## 7. USER_ACTION_REQUIRED

<!-- USER_ACTION_REQUIRED -->
1. **推送到 `chenmoulaile/shittim-chest`**：GitHub connector 处于 `auth-required`，
   需要在「连接器」里重新授权，或本地配好 PAT 后手动 `git push`。
   本地代码已经就绪（`name` / 标题 / appId 都改好了），只差远端写入权限。
2. **设置 / 咖啡厅 / 活动三页的风格决策**：整体转深色，还是保持浅色只换圆角板？
3. 若要让剧情对话框 1:1，需要允许再下 `uis-03_scenario-*`（660 个 bundle，体积未测）。

---

> 本报告由软件工坊 AI 生成，视觉一致性仍需人工比对确认。
