/**
 * 游戏内 UI 规格常量
 *
 * 所有位置、尺寸、字号、动画时长集中在这里，禁止散落在组件里。
 * 每个常量都必须带 source 标注，说明它是怎么来的：
 *
 *   'assetbundle'      —— 数值来自游戏 AssetBundle 里提取的 UI 图集原件
 *                         （九宫格切边、图标原始像素尺寸），可信度最高
 *   'screenshot_crop'  —— 从游戏内 1920×1080 截图里量出来的像素值 / 切出来的图
 *   'wiki_layout'      —— 结构来自日文 Wiki ロビー页面的 ①~⑲ 分区标注，
 *                         只保证「有这个东西、在哪个方位」，不保证像素尺寸
 *   'estimated'        —— 暂按比例估算，**必须校准**，校准后改成上面三者之一
 *
 * Phase 1 允许存在 estimated，但设置页会显示「已校准 X / 97」，
 * 这个计数由 countEstimates() 实时统计，不允许手写。
 *
 * 校准流程：npm run test:e2e 按 1920×1080 出图 → 与游戏内同分辨率截图叠层对比
 * → 逐项修正 estimated。素材路径见 README「素材与数据」。
 */

export type SpecSource = 'assetbundle' | 'screenshot_crop' | 'wiki_layout' | 'estimated';

export interface SpecValue<T> {
  value: T;
  source: SpecSource;
  note?: string;
}

const v = <T>(value: T, source: SpecSource, note?: string): SpecValue<T> => ({ value, source, note });

/** 设计基准分辨率：游戏内 UI 按 1920×1080 排版，其他分辨率等比缩放 */
export const REF_WIDTH = 1920;
export const REF_HEIGHT = 1080;

/** 安全区（刘海/圆角屏留白） */
export const SAFE_AREA = v({ top: 0, right: 0, bottom: 0, left: 0 }, 'wiki_layout');

// ---------------------------------------------------------------- 顶部栏

export const TOP_BAR = {
  height: v(72, 'estimated', '顶部信息条高度'),
  paddingX: v(24, 'estimated'),
  /** 老师信息块（头像 + 等级 + 名称 + 经验条） */
  teacher: {
    avatarSize: v(52, 'estimated'),
    nameFontSize: v(20, 'estimated'),
    levelFontSize: v(15, 'estimated'),
    expBarWidth: v(150, 'estimated'),
    expBarHeight: v(5, 'estimated'),
  },
  /** 资源条目顺序：AP（闪电）→ 信用点 → 青辉石 */
  resources: {
    order: v(['ap', 'credit', 'pyroxene'] as const, 'wiki_layout'),
    iconSize: v(26, 'estimated'),
    fontSiz: v(19, 'estimated'),
    gap: v(22, 'estimated'),
    plusButtonSize: v(22, 'estimated'),
  },
};

// ---------------------------------------------------------------- 右侧图标列

/**
 * 日文 Wiki ロビー页的右侧功能区。顺序与相对位置按 Wiki 分区，尺寸为估算。
 * key 与资源文件名一一对应（提取图集后从 ui_atlas.json 取图）。
 */
export const SIDE_MENU = [
  { key: 'momotalk', label: 'MomoTalk', zone: '①' },
  { key: 'mission', label: 'Mission', zone: '②' },
  { key: 'mail', label: 'Mail', zone: '③' },
  { key: 'menu', label: 'Menu', zone: '④' },
  { key: 'cafe', label: 'Cafe', zone: '⑤' },
  { key: 'student', label: 'Student', zone: '⑥' },
  { key: 'formation', label: 'Formation', zone: '⑦' },
  { key: 'gacha', label: 'Gacha', zone: '⑧' },
] as const;

export const SIDE_MENU_SPEC = {
  iconSize: v(76, 'estimated', '圆形图标直径'),
  gap: v(14, 'estimated'),
  rightMargin: v(28, 'estimated'),
  /** 从底部导航上方开始往上排 */
  bottomOffset: v(120, 'estimated'),
  badge: {
    size: v(26, 'estimated'),
    fontSiz: v(14, 'estimated'),
    maxDigits: v(2, 'wiki_layout', '未读数最多显示 2 位，超出显示 +'),
    offsetX: v(52, 'estimated'),
    offsetY: v(-6, 'estimated'),
  },
  /** 生日当天 MomoTalk 图标换成拉炮并周期性抖动 */
  birthdayShake: {
    intervalMs: v(2600, 'estimated'),
    durationMs: v(620, 'estimated'),
    rotateDeg: v(9, 'estimated'),
  },
};

// ---------------------------------------------------------------- 底部导航

export const BOTTOM_NAV = {
  height: v(76, 'estimated'),
  items: v(['story', 'momotalk', 'cafe', 'student', 'gacha'] as const, 'wiki_layout'),
  iconSize: v(34, 'estimated'),
  labelFontSize: v(12, 'estimated'),
  activeIndicatorHeight: v(3, 'estimated'),
};

// ---------------------------------------------------------------- 事件横幅

export const EVENT_BANNER = {
  /** 右上圆形横幅 */
  round: {
    size: v(120, 'estimated'),
    top: v(96, 'estimated'),
    right: v(28, 'estimated'),
  },
  /** 左下方形横幅 */
  square: {
    width: v(300, 'estimated'),
    height: v(96, 'estimated'),
    left: v(28, 'estimated'),
    bottom: v(104, 'estimated'),
  },
  switchIntervalMs: v(6000, 'estimated', '自动轮播间隔'),
  transitionMs: v(420, 'estimated'),
};

// ---------------------------------------------------------------- 看板娘

export const KANBAN = {
  /** 立绘锚点：底部居中偏左，给右侧图标列让位 */
  anchorX: v(0.42, 'estimated'),
  anchorY: v(1, 'estimated'),
  heightRatio: v(0.92, 'estimated', '立绘高度占屏比'),
  /** L2D / 静态 切换按钮 */
  toggleSize: v(44, 'estimated'),
  hideUiHint: v('长按画面 600ms 隐藏 UI', 'wiki_layout'),
};

// ---------------------------------------------------------------- 菜单弹窗

export const MENU_POPUP = {
  items: v(['option', 'account', 'equipment', 'item', 'scrapbook'] as const, 'wiki_layout'),
  iconSize: v(84, 'estimated'),
  gap: v(26, 'estimated'),
  dimAlpha: v(0.62, 'estimated'),
  openMs: v(240, 'estimated'),
};

// ---------------------------------------------------------------- 启动流程

/**
 * 启动时序。游戏内是 splash → 标题（Constant Moderato）→ 标题内加载 → 主界面。
 * 时长按观感估算，逐帧对比后校准。
 */
export const INTRO_TIMING = {
  splash: {
    /** 每张版权画面停留 */
    holdMs: v(1400, 'estimated'),
    fadeMs: v(420, 'estimated'),
    /** 版权方顺序：NAT GAMES → NEXON → Yostar */
    studios: v(['natgames', 'nexon', 'yostar'] as const, 'wiki_layout'),
  },
  title: {
    fadeInMs: v(900, 'estimated'),
    /** 标题画面停留到出现「点击开始」 */
    promptDelayMs: v(1200, 'estimated'),
    /** 点击后进入加载的过渡 */
    enterMs: v(700, 'estimated'),
  },
  loading: {
    /** 游戏内没有独立进度条，用转圈/角色小动画 */
    minShowMs: v(600, 'estimated'),
    fadeOutMs: v(500, 'estimated'),
  },
  lobby: {
    fadeInMs: v(650, 'estimated'),
  },
};

// ---------------------------------------------------------------- 剧情播放器

export const STORY_UI = {
  /** 对话框九宫格 */
  dialog: {
    left: v(0.06, 'estimated'),
    right: v(0.06, 'estimated'),
    bottom: v(0.05, 'estimated'),
    height: v(0.30, 'estimated'),
    paddingX: v(38, 'estimated'),
    paddingY: v(26, 'estimated'),
    namePlate: {
      height: v(38, 'estimated'),
      minWidth: v(180, 'estimated'),
      offsetY: v(-30, 'estimated', '名字框压在对话框上沿'),
      fontSiz: v(21, 'estimated'),
    },
    textFontSize: v(26, 'estimated'),
    lineHeight: v(1.65, 'estimated'),
    /** 游戏内打字机速度约每字 30~40ms */
    charDelayMs: v(34, 'screenshot_crop'),
  },
  /** 右下角功能按钮：自动 / 快进 / 回看 / 历史 / 跳过 */
  buttons: v(['auto', 'skip', 'log', 'history', 'menu'] as const, 'wiki_layout'),
  buttonSize: v(46, 'estimated'),
  buttonGap: v(10, 'estimated'),
  /** 角色槽位：左中右三档 */
  characterSlots: v(['left', 'center', 'right'] as const, 'wiki_layout'),
  bgFadeMs: v(320, 'estimated'),
};

// ---------------------------------------------------------------- 桃信

export const MOMOTALK_UI = {
  listWidth: v(420, 'estimated'),
  avatarSize: v(84, 'estimated'),
  unreadBadge: {
    size: v(30, 'estimated'),
    maxDigits: v(2, 'wiki_layout'),
  },
  bubble: {
    maxWidth: v(0.68, 'estimated'),
    paddingX: v(22, 'estimated'),
    paddingY: v(16, 'estimated'),
    fontSize: v(21, 'estimated'),
  },
  pinIconSize: v(28, 'estimated'),
};

// ---------------------------------------------------------------- 招募

export const GACHA_UI = {
  bannerAspect: v(16 / 9, 'estimated'),
  card: {
    width: v(196, 'estimated'),
    height: v(340, 'estimated'),
    radius: v(10, 'estimated'),
    starIconSize: v(22, 'estimated'),
  },
  tenPull: {
    /** 逐张翻开间隔 */
    revealIntervalMs: v(180, 'estimated'),
    /** ★3 闪光时长 */
    flashMs: v(900, 'estimated'),
    upBadgeDelayMs: v(240, 'estimated'),
  },
  pityBar: {
    width: v(520, 'estimated'),
    height: v(10, 'estimated'),
  },
};

// ---------------------------------------------------------------- 记忆大厅

export const LOBBY_UI = {
  /** 大厅背景与暗角由 Spine 资源自带，不额外加 CSS 渐变 */
  useResourceBackdrop: v(true, 'wiki_layout'),
  /** 点击命中区域半径（相对模型宽度） */
  hitRadius: v(0.35, 'estimated'),
  /** 触摸动画与语音的冷却 */
  touchCooldownMs: v(800, 'estimated'),
};

// ---------------------------------------------------------------- 缩放

/** 把 1920×1080 基准下的像素值换算到当前窗口 */
export function scaleFor(winWidth: number): number {
  return winWidth / REF_WIDTH;
}

/** 把 1920×1080 基准下的像素值换算到当前窗口 */
export function px(base: number, winWidth: number): number {
  return (base * winWidth) / REF_WIDTH;
}

/** 统计还有多少常量是估算值，用于「距离 1:1 还差多少」的进度提示 */
export function countEstimates(): { total: number; estimate: number } {
  let total = 0;
  let estimate = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ('value' in node && 'source' in node) {
      total++;
      if ((node as SpecValue<unknown>).source === 'estimated') estimate++;
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) walk(child);
  };
  walk({ TOP_BAR, SIDE_MENU_SPEC, BOTTOM_NAV, EVENT_BANNER, KANBAN, MENU_POPUP, INTRO_TIMING, STORY_UI, MOMOTALK_UI, GACHA_UI, LOBBY_UI });
  return { total, estimate };
}
