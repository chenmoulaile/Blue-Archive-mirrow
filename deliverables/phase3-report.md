# Phase 3 报告 · 剧情对话框 + 深色游戏风 + SE 映射

**日期**：2026-10-29
**结论**：🟡 有条件通过 —— 深色主题落地（默认 `dark-game`），SE 映射与音频链路打通；
**剧情对话框原件没找到**（`uis-03_scenario` 里只有表情），白边已按规则消除（改中性底板 + `estimated`），
不是靠伪造 BA 美术。

---

## 1. 剧情对话框原件（阻塞项，结论：没找到）

### 做了什么

1. 列出 `uis-03_scenario-*`：**934 个 bundle / 106.1 MB**，低于 300MB 阈值 → 全量下载。
2. `tools/fetch/probe_scenario_ui.py`：加载全目录（单 bundle 加载读不出 typetree），
   扫 NGUIAtlas 精灵 + prefab 里 `UISprite.mSpriteName/mType`。
3. 把 934 个 scenario bundle 单独拷到临时目录再加载，统计它们**实际引用**的精灵。

### 结果

| 项 | 数值 |
|---|---|
| scenario bundle | 934 个 / 106.1 MB |
| 其中的图集精灵 | **26 个，全是 `Emoji_*`**（Emoji_Balloon_N / Emoji_Action / …） |
| 对话框 / 名字框 / 选项按钮精灵 | **0** |
| 18 个图集里带切边且面积最大的 | `TBG/TBG_ResultBg` 736×273（结算背景，不是对话框） |

`uis-03_scenario` 只是**表情与立绘**，剧情对话框不在里面。
18 个 `assets-_mx-uis-*` 图集（1991 精灵）里也没有剧情对话框底图。

### 白边怎么处理的

Phase 2 用 `Dreammaker/Common_Bg_Raius20px` + `fillCenter=false` 取形状，
BA 的精灵是**白色遮罩**，所以描边是白的 —— 这就是"白边"的根因。

按指令「不要用 CSS 伪造剧情对话框；找不到正确原件就用截图切图并标注」，
本轮改成**中性深色底板**（`data-ui-source="estimated"`），白边消失，也不冒充原件：

```css
.player-dialog { background: rgba(8,18,30,.9); border: 1px solid rgba(120,178,219,.28); border-radius: 14px; }
```

截图：`tools/recon/out/e2e-story-ui-final.png`（无白边）

### 还没排除的可能位置

`uis-01_common-*`（24 个）、`assets-_mx-scenes`（35 个）没下。
如果要继续追，建议先下 `uis-01_common-27_eventcontent` 那组看看。

<!-- USER_ACTION_REQUIRED -->
如果手头有游戏内剧情截图，走 `tools/fetch/crop_ui.py` 切图是最快的收口方式
（产物标 `origin: screenshot_crop`，不算伪造）。

---

## 2. 全局深色游戏风

### 2.1 配色系统

新增 `src/styles/game-theme.css`，用 `[data-theme='dark-game']` 覆盖 `:root` 变量 +
少量硬编码白色的选择器，**不重写 global.css 的布局**：

| 变量 | 深色值 | 说明 |
|---|---|---|
| `--bg` | `#0a141f` | 深蓝底 |
| `--card` | `rgba(16,31,46,.88)` | 半透明面板 |
| `--ink` | `#eaf4ff` | 主文字 |
| `--ink-2 / --ink-3` | `#b6c9da / #7d93a6` | 次要 / 禁用文字 |
| `--line` | `rgba(122,178,219,.18)` | 描边 |
| `--ba-blue` | `#4aa8e6` | 强调色（按钮 / 进度条） |

**取色来源：图集取色**（`Common_Bg_*` 这批底板的实际像素），不是对着截图取的 ——
因为没有游戏内截图。这一点在 `estimated` 计数里如实体现。

主题切换：`settings.theme: 'dark-game' | 'light'`，**默认 `dark-game`**，
`test-config.mjs` 断言 `DEFAULT_SETTINGS.theme === 'dark-game'` ✅。

### 2.2 踩到的坑

- `.topbar` / `.main` / `.content` 在 global.css 里有硬编码浅色底，变量覆盖不到 → 显式盖掉。
- `.field select` 特异性高于 `[data-theme] select`，白底下白字几乎不可见 →
  用 `!important` 兜底（截图前后对比明显）。

### 2.3 截图

| 页面 | 截图 |
|---|---|
| 设置 | `tools/recon/out/e2e-settings-dark.png` |
| 剧情 | `tools/recon/out/e2e-story-ui-final.png` |
| 咖啡厅 | `tools/recon/out/e2e-cafe-dark.png` |
| 活动 | `tools/recon/out/e2e-events-dark.png` |

---

## 3. SE 命名映射

`tools/fetch/map_se.py`：归一化（去 `SE_/SFX_/FX_` 前缀 + 去尾部编号 + 小写）后
精确匹配 = high，编辑距离 ≤ 2 = medium。

| 项 | 数量 |
|---|---|
| 剧情里不同 SE 名字 | **834** |
| high（精确匹配） | **24** |
| medium（编辑距离 ≤2） | **40** |
| 未匹配 | **770** → `deliverables/se-unmatched.csv` |

产物：`data/se_map.json`；`audio.ts` 播放时先查映射再退回原名，缺失仍静音降级 + warn。

> 命中率低是**真实情况**：我们提取到的 676 个是 `SFX_*`（角色 / 环境音），
> 剧情用的 `SE_*` 是另一套资源，大概率在未下载的 bundle 里。
> 没有为了数字好看去放宽阈值。

---

## 4. 页面覆盖率

| 页面 | 覆盖率 | 说明 |
|---|---|---|
| 主界面 | **14 / 16 = 87.5%** | AP / 信用点无对应 NGUI 精灵，`glyph_fallback` |
| 剧情 | ~55% | 对话框 `estimated`（无原件）、选项按钮 `TBG/Common_Btn_BG` 原件、播放器按钮未换 |
| 桃信 | ~60% | 气泡 + 回复按钮原件；列表项、头像框未换 |
| 招募 | ~45% | 结果卡原件；卡池列表、保底条未换 |
| 设置 | ~35% | 深色主题 + 面板/下拉/滑块全部走变量；无九宫格原件 |
| 咖啡厅 | ~30% | 仅深色化 |
| 活动 | ~30% | 仅深色化 |

**未达到目标**（设置 80% / 咖啡厅 70% / 活动 75%）：这三页目前只做了配色，
没有逐控件换 `Common_*` 九宫格与图标。

### `game-ui-spec.ts` 的 `estimated` 计数

**仍是 86 / 97，没有下降。** 原因：本轮没有拿到任何游戏内截图做对照，
不能凭感觉把 `estimated` 改成 `assetbundle`（指令明确禁止）。

---

## 5. 自动化验证

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 错误 |
| `npm run test:config` | ✅ 通过（新增「默认主题 = dark-game」断言） |
| `npm run test:e2e` | ✅ 控制台错误 0 |

---

## 6. 下一步建议（按收益排序）

1. **拿一张 1920×1080 游戏内主界面截图**：一次性把 86 个 `estimated` 常量校准，
   同时可以裁出剧情对话框（`crop_ui.py`，标 `screenshot_crop`）。
2. **设置 / 咖啡厅 / 活动逐控件换原件**：这三页的深色底已经铺好，
   缺的是把 `.field`、`.furni`、`.event-row` 换成 `Common_*` 九宫格。
3. **补 SE**：下 `assets-_mx-scenes` / `uis-01_common-*` 找 `SE_*` 资源，
   再跑一次 `map_se.py`，770 个未匹配能大幅下降。
4. **推仓库**：GitHub connector 仍 `auth-required`，本地已就绪。

---

## 7. 文件变更

**新增**：`src/styles/game-theme.css`、`tools/fetch/probe_scenario_ui.py`、
`tools/fetch/map_se.py`、`data/se_map.json`、`deliverables/scenario-ui-probe.json`、
`deliverables/se-unmatched.csv`

**修改**：`src/core/config.ts`（theme 字段 + 默认值）、`src/App.tsx`（引入主题 + `data-theme`）、
`src/pages/SettingsPage.tsx`（主题开关）、`src/core/audio.ts`（SE 映射）、
`src/pages/StoryPage.tsx`（对话框改中性底板）、`src/styles/global.css`（对话框样式）、
`scripts/e2e.mjs`（新增 4 张验收截图）、`scripts/test-config.mjs`（主题断言）

---

> 本报告由软件工坊 AI 生成。深色主题取色来自图集而非游戏截图，配色是否"游戏原色"需人工比对。
