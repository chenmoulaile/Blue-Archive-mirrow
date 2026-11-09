# 竖屏舞台与页栈 —— 页面轨接口契约（G-1 / G-2 / P0-1）

> 本目录是全部页面重构的地基（什亭之匣审计报告一 3.1 G-1/G-2、报告二 A1/A2 的落地）。
> 页面轨（桃信/剧情/招募详情）从这里 import，接口变更必须先改本文件。

## 1. 竖屏舞台 PortraitStage（G-1）

**文件**：`PortraitStage.tsx`，默认导出；`useStageScale` 具名导出。

所有游戏页面（主页 + 内页）都渲染在 **1080×1920 逻辑画框** 内，外层页面
letterbox（居中 + 按高度缩放）。App.tsx 已统一包好，页面组件**不需要**自己再包。

```tsx
import PortraitStage from './components/stage/PortraitStage';
<PortraitStage frameClassName="..." frameStyle={...}>...页面...</PortraitStage>
```

| Props | 类型 | 说明 |
|---|---|---|
| `children` | `ReactNode` | 页面内容，直接铺进 1080×1920 画框 |
| `frameClassName` | `string` | 附加到 `.stage-frame` 的类名 |
| `frameStyle` | `CSSProperties` | 附加到 `.stage-frame` 的内联样式 |

**尺寸铁律（冲突裁决④）**：
- 舞台内布局一律用 1080×1920 逻辑 px，尺寸常量取 `src/core/game-ui-spec.ts`；
- **禁止**在舞台内读 `window.innerWidth/innerHeight` 自行换算，**禁止** vw/vh——
  横屏时代量出的尺寸到竖屏全部作废，竖屏校准前保持 spec 估算值；
- `position: fixed` 在舞台内以 `.stage-frame` 为包含块（transform 产生 containing
  block），效果即"游戏内全屏"，这是预期行为；
- 全局缩放系数在 `:root` 的 `--stage-scale`（`STAGE_SCALE_CSS_VAR`），仅舞台外
  场景（全局遮罩、窗口级覆盖物）需要时使用。

**规格常量**（game-ui-spec.ts）：
- `REF_WIDTH = 1080`、`REF_HEIGHT = 1920`；
- `stageScaleFor(winWidth, winHeight)`：舞台缩放系数 = `min(窗宽/1080, 窗高/1920)`，
  旧 `scaleFor(winWidth)` / `px(base, winWidth)`（按窗宽换算）已删除，无调用方；
- `STAGE_UI.transitionMs = 250`（页栈过渡）、`STAGE_UI.tiltDeg = -1.5`（微倾斜留档）。

## 2. 页栈 ViewStack（G-2）

**文件**：`ViewStack.tsx`。供桃信（list→room）、剧情（list→player）、招募详情
（主界面→详情）三处使用；列表页作为栈底保留，上层以全屏覆盖层挂载。

```tsx
import { useViewStack, StackOverlay } from './components/stage';

const stack = useViewStack<'room' | 'detail'>();
return (
  <div style={{ position: 'relative', height: '100%' }}>   {/* 页面根节点要能容纳 absolute 覆盖层 */}
    <ListPage onOpen={(id) => stack.open('room', { id })} />
    {stack.entries.map((e) => (
      <StackOverlay key={e.key} entry={e}>
        {e.key === 'room' && <ChatRoom params={e.params} onBack={() => stack.close(e.key)} />}
      </StackOverlay>
    ))}
  </div>
);
```

### `useViewStack<S extends string>(): ViewStackApi<S>`

| 成员 | 类型 | 语义 |
|---|---|---|
| `entries` | `StackEntry<S>[]` | 已打开的层（不含栈底），栈顶在末尾；层对象含 `key`/`params`/`status` |
| `top` | `StackEntry<S> \| null` | 栈顶层 |
| `has(key)` | `boolean` | 是否存在该层（含退出动画中） |
| `open(key, params?)` | `void` | 压栈并滑入；同名层已存在时**幂等**，快速连点不叠层 |
| `close(key?)` | `void` | 关闭栈顶（默认）或指定层；播放滑出动画后卸载 |
| `closeAll()` | `void` | 全部关闭，直接回栈底 |

### `<StackOverlay entry onClose?>`

全屏覆盖层，`absolute inset: 0`，由 `data-stack-status` 驱动 CSS 过渡
（`entering` → 右侧外；`open` → 滑入到位；`exiting` → 滑出，250ms 后卸载）。
Props：`entry`（必填，来自 `stack.entries`）、`children`、`className`、`label`
（无障碍名）、`zIndex`（多层同屏才需要）。**不自带返回钮**——返回钮由页面放在
层内容左上角（原版形态），可用 TopCurrencyBar；关闭动作走 `stack.close()`。

## 3. 通用货币顶栏 TopCurrencyBar（P0-1）

**文件**：`TopCurrencyBar.tsx`，默认导出。原版形态：只有货币 + 左上返回 + 右侧
商店/菜单；**没有页面标题、没有签到胶囊**（签到内容归登录奖励弹窗，弹窗尚未实现）。

```tsx
import TopCurrencyBar from './components/stage';
<TopCurrencyBar
  ap={{ value, max }}           // 全部可选：不传就不渲染该块
  credit={123456}
  pyroxene={90120}
  onBack={() => go('home')}     // 内页标准返回；不传则不渲染返回钮
  backLabel="大厅"              // 默认「大厅」
  backClassName="nav-item"      // e2e 钩子（App.tsx 已统一挂）
  onShop={...} onMenu={...}     // 右侧商店/菜单图标；不传不渲染
  right={<ReactNode>}           // 顶栏右侧扩展位
  iconSize={26}
/>
```

App.tsx 已为全部内页统一渲染（货币取 store，返回 `go('home')`，商店 toast、
菜单进设置页）。页面轨只有两种情况需要自己挂：页面顶栏在舞台覆盖层内
（如页栈 room 层），或页面需要隐藏默认顶栏自带栏。

**e2e 语义**：返回钮固定带 `nav-item` 类名 + 文案含「大厅」，保住
`page.locator('.nav-item', { hasText: '大厅' })` 回主界面的既有契约。

## 4. 全局 CSS 变量清单（global.css `:root`）

### 舞台（G-1）
| 变量 | 值 | 用途 |
|---|---|---|
| `--stage-w` / `--stage-h` | `1080px` / `1920px` | 逻辑画框尺寸 |
| `--stage-scale` | 运行时写入 | 舞台缩放系数（`STAGE_SCALE_CSS_VAR`），舞台内勿用 |

### BA 视觉语言（P0-3，页面轨直接套用）
| 变量 | 值 | 用途 |
|---|---|---|
| `--ba-tilt` | `-1.5deg` | BA 标志性微倾斜（对话框/大面板整体倾斜） |
| `--ba-tilt-soft` | `-0.75deg` | 弱化档（胶囊/小卡片/按钮） |
| `--ba-grad-hero` | 淡蓝紫 135° 渐变 | 页面底色 / 横幅大面（白底深字基调） |
| `--ba-grad-accent` | 蓝→青渐变 | 强调按钮 / 名字条 / 进度条（青色高亮） |

### 页栈（G-2）
| 变量 | 值 | 用途 |
|---|---|---|
| `--stack-transition` | `250ms` | `.stack-overlay` 滑入/滑出时长，与 `STAGE_UI.transitionMs` 同步 |

既有调色/圆角/阴影变量（`--ba-blue`、`--card`、`--shadow` 等）含义不变。

## 5. 已随本骨架变化的全局结构（页面轨注意）

- **侧栏已删**（P0-1）：`.shell/.sidebar/.brand/.nav-item/.main/.topbar/.wallet`
  样式与 DOM 一并移除；内页 = `.inner-page`（`TopCurrencyBar` + `.content`），
  `.content` 不再有 padding，页面直接全屏排布；
- **默认主题 = light**（P0-3）：`config.ts DEFAULT_SETTINGS.theme = 'light'`；
  深色仍是可选项（`dark-game`），`game-theme.css` 的覆盖机制不变；
- **主页底条**（P0-2）：`.bottom-item` 构成改为 编队/任务/挑战任务/剧情/社团/
  道具/资料馆/招募（`BOTTOM_NAV.items`，报告二 B4）；桃信走右下 `lb-momo`、
  咖啡厅走右侧菜单（`side-btn`），不进底条；未实装入口点击 toast；
- **左下名条**（B5）：`.lb-namebar` 头像（`<i class="lb-avatar">`）+ 彩带名字条；
  `.lb-namebar span` 语义不变（语音字幕）；左下横幅 `.banner-square` 右下三角切角；
- **主页窗口缩放已删**：HomePage 原 `useScale()`（按窗宽换算）随舞台化移除，
  页面内尺寸一律 spec 逻辑 px。

## 6. 验证

- `npm run typecheck`：TS 严格模式全量；
- `npm run test:layout`（`scripts/measure-ui.mjs`，默认 1920×1080 窗口）：舞台
  letterbox 下量取锚点矩形并做重叠自检——重叠面积按比例缩放，断言仍然有效。
