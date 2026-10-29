/**
 * 九宫格组件
 *
 * 有提取到的游戏 UI 原件时，用 border-image 做九宫格拉伸；
 * 没有时渲染 fallback（CSS 兜底），并在 DOM 上打 data-ui-source 标记，
 * 方便端到端测试统计「有多少控件还是兜底样式」。
 */
import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../core/AppContext';
import { nineSliceStyle } from '../core/ui-atlas';

/** 同一个 sprite 只 warn 一次，避免每帧刷屏 */
const warned = new Set<string>();
function warnNoBorder(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[NineSlice] no border for ${name}`);
}

export interface NineSliceProps {
  /** ui_atlas.json 里的 sprite key */
  name: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 没有原件时使用的类名 */
  fallbackClassName?: string;
  /** 没有原件时的内联样式 */
  fallbackStyle?: CSSProperties;
  /**
   * 是否让九宫格填满中心。默认 true。
   * false 时中心透明，露出 CSS background —— 深色对话框这类需要自己上色的场合用。
   */
  fillCenter?: boolean;
  as?: 'div' | 'button' | 'section';
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}

export function NineSlice({
  name,
  children,
  className,
  style,
  fallbackClassName,
  fallbackStyle,
  as = 'div',
  onClick,
  title,
  disabled,
  fillCenter = true,
}: NineSliceProps) {
  const { uiAtlas } = useApp();
  const sprite = uiAtlas.sprites[name];
  const source = sprite ? sprite.origin ?? 'assetbundle' : 'css-fallback';

  // 有图但没切边：九宫格会退化成整图拉伸，边缘会被拉花，必须能看见
  if (sprite && !sprite.border) warnNoBorder(name);

  const merged: CSSProperties = sprite
    ? { ...nineSliceStyle(sprite, fillCenter), ...style }
    : { ...fallbackStyle, ...style };

  const cls = [sprite ? className : [fallbackClassName, className].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' ');

  if (as === 'button') {
    return (
      <button
        className={cls}
        style={merged}
        onClick={onClick}
        title={title}
        disabled={disabled}
        data-ui-sprite={name}
        data-ui-source={source}
      >
        {children}
      </button>
    );
  }
  if (as === 'section') {
    return (
      <section className={cls} style={merged} data-ui-sprite={name} data-ui-source={source} title={title}>
        {children}
      </section>
    );
  }
  return (
    <div className={cls} style={merged} data-ui-sprite={name} data-ui-source={source} title={title} onClick={onClick}>
      {children}
    </div>
  );
}

/** 图标：有原件用原件，没有就用传入的兜底节点（通常是 Glyph 线性图标） */
export function UIIcon({
  name,
  size,
  fallback,
  className,
  style,
}: {
  name: string;
  size: number;
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { uiAtlas } = useApp();
  const sprite = uiAtlas.sprites[name];
  if (sprite) {
    return (
      <img
        src={sprite.file}
        alt=""
        className={className}
        data-ui-sprite={name}
        data-ui-source={sprite.origin ?? 'assetbundle'}
        style={{ width: size, height: size, objectFit: 'contain', ...style }}
      />
    );
  }
  return (
    <span
      className={className}
      data-ui-sprite={name}
      data-ui-source="css-fallback"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.52,
        lineHeight: 1,
        ...style,
      }}
    >
      {fallback}
    </span>
  );
}
