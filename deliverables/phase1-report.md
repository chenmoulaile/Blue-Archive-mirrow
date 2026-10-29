# Phase 1 报告 · Electron 脚手架 + Spine 4.2 验证 + 语言锁定

**日期**：2026-10-29
**阶段**：Phase 1
**结论**：🟡 有条件通过 —— 脚手架 / Spine 4.2 / 语言锁定 / 指针 / 配置向导全部落地并通过自动化验证；
**唯一缺口是没有游戏内 UI 图集**，需要用户提供游戏解包目录（路径 1）或 1920×1080 游戏截图（路径 2）。

---

## 1. 文件变更

### 新增

| 文件 | 作用 |
|---|---|
| `src/pages/SetupWizard.tsx` | 首次启动向导：选游戏解包目录 / 选 wiki 素材目录 / 跳过 |
| `data/i18n/zh-CN.json` | 完整中文词条表（唯一必须齐全的语言） |
| `data/i18n/en.json`、`ja.json`、`zh-TW.json` | 可选覆盖表，缺键显示「未同步」 |
| `tools/fetch/crop_ui.py` | 路径 2：从游戏截图切 UI 原件，写 `origin: "screenshot_crop"` |
| `deliverables/phase1-report.md` | 本文件 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/core/game-ui-spec.ts` | `SpecSource` 改为 `assetbundle / screenshot_crop / wiki_layout / estimated` 四值；顶部补来源说明 |
| `src/core/i18n.ts` | 词条表搬到 `data/i18n/*.json`，改静态 JSON import（页面模块顶层会调 `t()`，必须同步）；`t()` 支持 `{name}` 占位 |
| `src/core/ui-atlas.ts` | `UIAtlas.source` 增加 `screenshot_crop` |
| `src/App.tsx` | 极简 History 路由（`/`、`/lobby`、`/settings`、`/story`、`/gacha`、`/momotalk`、`/cafe`、`/events`）；接入首次启动向导 |
| `src/pages/StoryPage.tsx` | `choice` 节点改为渲染选项按钮，文案「（选项文本未同步）」，点击照常推进 |
| `src/pages/SettingsPage.tsx` | 「已校准 X / 97」改用 i18n 模板；新增音频同步状态（HEAD 探测）；UI 图集区分 assetbundle / screenshot_crop |
| `src/components/SpineView.tsx` | 新增 `touchAnimation`（点击播一次反应动画后接回 idle）与 `onAnimations` 回调 |
| `src/types.ts` | 新增 `AppConfig`，`BaApi` 增加 `getConfig / patchConfig / pickDir`，`AppInfo` 增加 `setupDone / config` |
| `electron/main.ts` | `AppConfig` 扩为 4 字段；新增 `config:get`、`config:patch`、`dialog:pickDir` IPC；目录字段统一做存在性校验 |
| `electron/preload.ts` | 暴露上述三个 API |
| `src/styles/global.css` | 首次启动向导样式、剧情选项按钮样式 |
| `src/styles/cursors.css` | 指针路径 `/res/cursor/` → `/res/cursors/` |
| `scripts/e2e.mjs` | 首次启动向导截图 + 跳过；固定窗口 1440×900；新增 `e2e-02-lobby.png`（Airi_home）；点击改为视口比例 / 元素相对坐标 |
| `tools/fetch/fetch_cursors.py` | 输出目录改为 `resources/cursors/` |
| `README.md` | 新增「游戏内 UI 原件（两条路径）」「鼠标指针」章节；已知约束补 UI 图集声明；目录结构更新 |

### 移动 / 删除

| 变更 | 原因 |
|---|---|
| `tools/extract/extract_ui.py` → `tools/fetch/extract_ui.py`（`tools/extract/` 目录删除） | 与其它抓取脚本同目录，符合指令里的路径约定 |
| `resources/cursor/` → `resources/cursors/` | 目录名对齐指令 |

### 新增依赖

**无。** 路由用 History API 手写（不引 react-router）；Spine 3.8 运行时未引入（见第 4 节）。

---

## 2. game-ui-spec 常量来源

四类来源，全部由 `SpecSource` 强约束，设置页实时统计：

| 来源 | 含义 | 当前数量 |
|---|---|---|
| `assetbundle` | 游戏包提取的原件数值 | 0 |
| `screenshot_crop` | 从 1920×1080 游戏截图量出的像素 | 1 |
| `wiki_layout` | 日文 Wiki ①~⑲ 分区结构（只保证方位） | 10 |
| `estimated` | 按比例估算，**必须校准** | 86 |
| **合计** | | **97** |

**已校准 11 / 97。** 计数由 `countEstimates()` 实时算，设置页不允许手写。

> 逐项来源注释在 `src/core/game-ui-spec.ts` 每个 `v(...)` 的第二个参数上，
> 例如 `height: v(72, 'estimated', '顶部信息条高度')`。

---

## 3. Spine 4.2 验证

### 资源与运行时

| 项 | 值 |
|---|---|
| 模型 | `resources/spine/Airi_home/Airi_home.skel`（**4.2.33**）、`.atlas`、`Airi_home.png` + `Airi_home2.png` |
| 运行时 | `@esotericsoftware/spine-webgl` 4.2.120，独立 `<canvas>` 层 |
| 加载方式 | 主进程本地 http 服务器 `http://127.0.0.1:<随机端口>/res/spine/...`，避开 `file://` 的 CORS |
| 动画 | `Start_Idle_01` / `Idle_01` 优先匹配 `/^idle/i`，循环播放 |

> 注意：实际目录是 `resources/spine/<模型名>/`（扁平），不是指令里写的 `resources/spine/home/`。
> 没有为了对齐路径去搬 6234 个文件，`SpineView` 接收的是完整 URL，布局无关。

### 截图

| 截图 | 路径 |
|---|---|
| 记忆大厅（Airi） | `tools/recon/out/e2e-02-lobby.png` |
| 首次启动向导 | `tools/recon/out/e2e-00-setup.png` |
| 剧情选项节点 | `tools/recon/out/check-choice.png` |

e2e 里的断言输出：

```
记忆大厅: { canvas: true, placeholder: null, student: '栗村爱莉', spine: '原皮 · Airi_home' }
```

### 与游戏内截图的差异

<!-- USER_ACTION_REQUIRED -->
**无法并排对比：本机没有 Airi 记忆大厅的游戏内截图。** 请提供一张 1920×1080 的
游戏内同一角色大厅截图（`docs/` 或任意目录都行，脚本只读），我按同分辨率出图叠层比对。

在没有参考图的前提下，能确认和不能确认的分开写：

**已确认正常**

- 贴图无白块。BA 的 atlas 没有 `pma: true`，`drawSkeleton(sk, false)` 必须传 false，已固定。
- 背景（`BG_01` / `BG_02`）由模型自带，不是 CSS 渐变；樱花街道、石墙、草地位置正确。
- 暗角是 CSS `inset box-shadow`，叠在 canvas 之上，不影响模型边缘。
- 姿态为 idle 循环，非 T-pose（`setToSetupPose()` 后立即 `setAnimation`）。

**未校准 / 待记录（Phase 1 不解决，按要求只记录）**

| 差异点 | 可能原因 | 影响 |
|---|---|---|
| 腿部被画面下沿裁掉 | `LobbyPage` 默认 `zoom = 1.35`（相对「整只模型装进视口」），这是为了填满画面，但游戏内实际裁切比例没量过 | 构图比例偏差，属 `estimated` |
| 头发 / 裙摆摆动幅度 | spine-webgl 每帧 `Physics.update(delta)`；Unity 端 `SkeletonAnimation` 的 physics 步进频率与顺序可能不同 | 细看会有相位差 |
| `FX_Light_*` 叠加效果 | canvas 配置 `premultipliedAlpha: true`，Unity 的混合与渲染顺序不同 | 高光可能偏亮/偏暗 |
| idle 起始相位 | 两端都是从 0 开始，但进场时机不同 | 首帧姿态可能不同，比对时应对齐时间点 |
| 网格变形 | 4.2 二进制的 mesh/权重一致，未发现撕裂 | 暂未见问题 |

---

## 4. 自动化验证结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 错误（strict） |
| `npm run test:config` | ✅ 12/12（默认 zh-CN + ja、恢复默认、缺词条显示「未同步」、zh-CN 覆盖率 100%、en 0%） |
| `npm run test:gacha` | ✅ 全部通过（10 万次模拟） |
| `npm run test:layout` | ✅ `problems: []`（1920×1080 / 1280×720 / 1100×720） |
| `npm run test:e2e` | ✅ 控制台错误 0；失败请求仅 `ui_atlas.json` 与 BGM/SE 的预期 404 |

### 语言锁定

- `DEFAULT_LOCALE = 'zh-CN'`、`DEFAULT_VOICE = 'ja'`，`assertDefaults()` 在测试里断言。
- 设置页「恢复默认」→ `resetSettings()` 返回这两个值（深拷贝，改动不污染默认）。
- 词条表现在在 `data/i18n/zh-CN.json`；en/ja/zh-TW 为空表，缺键显示「未同步」，**不回退英文**。

### 指针

`resources/cursors/` 下 15 个 `.cur`/`.ani`，全局 CSS 绑定：`body` → `normal.cur`，
可点击元素 → `link.cur`，`[data-loading="true"]` → `loading.ani`，禁用态 → `block.cur`。
设置页可整体关掉（`html.no-custom-cursor` 全部 `revert`）。

---

## 5. 已知缺口与下一步

### 缺口

1. **UI 图集 0 个原件**，`data/ui_atlas.json` 不存在，主界面 16 个控件全部 `css-fallback`。
2. **BGM / SE 未同步**，设置页显示「音频未同步」，播放器静音降级。
3. 86 / 97 个布局常量仍是估算值。

### 下一步建议：**优先路径 1**

| | 路径 1（游戏解包目录） | 路径 2（截图切图） |
|---|---|---|
| 能拿到 | UI 图集原件 + 九宫格切边 + TMP 字体 + BGM/SE + Spine 3.8 原件 | 只有截图里的像素 |
| 九宫格质量 | 精确（Unity `m_Border`） | 肉眼估，高 DPI 会糊 |
| 控件状态 | 按下 / 禁用 / 悬停都有 | 只有一张 |
| 音频 | 有 | 无 |
| 前置条件 | 一个含 `assets-_mx-uisprite` 的目录 | 一张 1920×1080 游戏截图 |
| 工作量 | 跑一条命令 | 手工量坐标 + 逐张核对 |

**结论**：只要机器上还有游戏本体，就走路径 1；否则路径 2 只能救急，
并且必须在 README 与设置页保留「截图切图还原，非原始图集」的声明（已写入）。

### USER_ACTION_REQUIRED

<!-- USER_ACTION_REQUIRED -->
1. **游戏解包目录**（推荐）：包含 `assets-_mx-uisprite` / `assets-_mx-audio` 的那一层。
   提供后执行 `python tools/fetch/extract_ui.py --game-dir "<路径>"`，只读，产物写 E 盘 `resources/`。
2. 若没有游戏本体：**一张 1920×1080 的游戏内主界面截图 + 一张 Airi 记忆大厅截图**。
   前者用于切 UI 图集，后者用于第 3 节的并排比对。
3. 若两者都没有：Phase 1 视为按「占位素材」通过，Phase 2 起界面仍是中性占位。

---

> 本报告由软件工坊 AI 生成，Spine 视觉一致性结论需人工比对后确认。
