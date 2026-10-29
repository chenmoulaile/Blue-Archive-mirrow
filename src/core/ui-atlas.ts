/**
 * 游戏内 UI 图集
 *
 * 由 tools/fetch/extract_ui.py（AssetBundle）或 tools/fetch/crop_ui.py（截图切图）
 * 导出，产出 data/ui_atlas.json：
 *
 * {
 *   "source": "assetbundle",
 *   "sprites": {
 *     "ui_dialog_bg": { "file": "/res/ui/ui_dialog_bg.png", "w": 1024, "h": 256,
 *                       "border": [40, 40, 40, 40] },     // 九宫格切边 LTRB
 *     ...
 *   },
 *   "fonts": { "body": { "family": "BA-Maru", "file": "/res/ui/font/body.woff2" } }
 * }
 *
 * 没有提取到图集时（文件 404），所有控件自动回退到 CSS 兜底样式，
 * 并在设置页显示「UI 原件未提取」的状态，而不是报错。
 */

import type { CSSProperties } from 'react';

export interface SpriteEntry {
  file: string;
  w: number;
  h: number;
  /** 九宫格切边 [left, top, right, bottom]，缺省表示整图拉伸 */
  border?: [number, number, number, number];
  /** 记录来源，便于 README 汇总 */
  origin?: 'assetbundle' | 'screenshot_crop';
}

export interface UIFontEntry {
  family: string;
  file: string;
  weight?: string;
}

export interface UIAtlas {
  /** assetbundle = 从游戏包提取的原件；screenshot_crop = 从游戏截图切的图 */
  source: 'assetbundle' | 'screenshot_crop' | 'none';
  generated?: string;
  sprites: Record<string, SpriteEntry>;
  fonts: Record<string, UIFontEntry>;
  /** 九宫格切边表（data/ui_nineslice.json），key 与 sprites 一致 */
  nineslice: Record<string, NineSliceEntry>;
}

export interface NineSliceEntry {
  /** [左, 上, 右, 下]，单位像素 */
  border: [number, number, number, number];
  /** NGUI UISprite.Type：Sliced / Simple / Tiled / Filled / Advanced */
  type: string;
  source_prefab?: string | null;
}

const EMPTY: UIAtlas = { source: 'none', sprites: {}, fonts: {}, nineslice: {} };

let cache: Promise<UIAtlas> | null = null;

export function loadUIAtlas(): Promise<UIAtlas> {
  if (!cache) {
    const json = (url: string): Promise<Record<string, unknown>> =>
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : {}))
        .catch(() => ({}));

    cache = Promise.all([json('/data/ui_atlas.json'), json('/data/ui_nineslice.json')])
      .then(([atlas, ns]) => {
        if (!atlas || !('sprites' in atlas)) return EMPTY;
        const out = atlas as unknown as UIAtlas;
        const sprites = (out.sprites ?? {}) as Record<string, SpriteEntry>;
        const nineslice = ((ns as { sprites?: Record<string, NineSliceEntry> }).sprites ??
          {}) as Record<string, NineSliceEntry>;
        // 切边以 ui_nineslice.json 为准；图集里自带的 border 作为兜底
        for (const [key, entry] of Object.entries(nineslice)) {
          if (sprites[key] && entry.border) sprites[key] = { ...sprites[key], border: entry.border };
        }
        return { ...out, sprites, nineslice, fonts: out.fonts ?? {} };
      })
      .catch(() => EMPTY);
  }
  return cache;
}

export function hasSprite(atlas: UIAtlas, name: string): boolean {
  return Boolean(atlas.sprites[name]);
}

/**
 * 生成 border-image 的 style，供九宫格组件直接使用
 *
 * fillCenter=false 时不带 `fill`，中心区域保持透明，让 CSS 的 background 透上来。
 * 这是必要的：BA 的图集精灵是**白色遮罩**，游戏里由 NGUI 的 mColor 上色；
 * 我们拿它只取「形状」，颜色交给 CSS，跟引擎行为一致。
 */
export function nineSliceStyle(sprite: SpriteEntry, fillCenter = true): CSSProperties {
  const b = sprite.border;
  if (!b) {
    return {
      backgroundImage: `url(${sprite.file})`,
      backgroundSize: '100% 100%',
      borderStyle: 'none',
    };
  }
  // 渲染宽度不能超过原图的 1/3，否则小控件上左右/上下边框会互相挤压，
  // CSS 会按比例压缩整张图，角就变形了。slice 仍用原始像素，只缩 width。
  const capX = Math.max(1, Math.round(sprite.w / 3));
  const capY = Math.max(1, Math.round(sprite.h / 3));
  const wl = Math.min(b[0], capX);
  const wr = Math.min(b[2], capX);
  const wt = Math.min(b[1], capY);
  const wb = Math.min(b[3], capY);

  return {
    borderStyle: 'solid',
    borderWidth: `${wt}px ${wr}px ${wb}px ${wl}px`,
    borderImageSource: `url(${sprite.file})`,
    borderImageSlice: `${b[1]} ${b[2]} ${b[3]} ${b[0]}${fillCenter ? ' fill' : ''}`,
    borderImageWidth: `${wt}px ${wr}px ${wb}px ${wl}px`,
    borderImageRepeat: 'stretch',
    background: fillCenter ? 'none' : undefined,
  };
}

/** 注入提取到的字体（若存在） */
export function injectUIFonts(atlas: UIAtlas): void {
  for (const [key, f] of Object.entries(atlas.fonts)) {
    if (!f?.file) continue;
    const id = `ba-font-${key}`;
    if (document.getElementById(id)) continue;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `@font-face{font-family:"${f.family}";src:url("${f.file}") format("woff2");font-display:swap;}`;
    document.head.appendChild(style);
  }
}
