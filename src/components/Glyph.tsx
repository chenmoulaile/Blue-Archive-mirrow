/**
 * 中性线性图标
 *
 * 为什么需要它：游戏内 UI 图集（resources/ui/）没提取到之前，所有按钮只能用文字符号兜底。
 * 之前用的是 '□' '✉' 这类字符，结果是菜单弹窗里并排 5 个一模一样的空方块，
 * 侧栏里 momotalk 和 mail 是两个一样的信封 —— 看着像坏了，也分不清功能。
 *
 * 这里换成手写的 24×24 线性图标：单色、描边、无品牌特征。
 * 刻意**不模仿**《蔚蓝档案》的图标造型（重构要求 3.3：没有原件就不伪造原画），
 * 只求「能看懂是什么功能」，等 ui_atlas.json 到位后会被真图标整块替换。
 */
import type { CSSProperties, ReactNode } from 'react';

export type GlyphName =
  | 'momotalk'
  | 'mission'
  | 'mail'
  | 'menu'
  | 'cafe'
  | 'student'
  | 'formation'
  | 'gacha'
  | 'story'
  | 'memorial'
  | 'home'
  | 'events'
  | 'option'
  | 'account'
  | 'equipment'
  | 'item'
  | 'scrapbook'
  | 'settings'
  | 'restart';

const PATHS: Record<GlyphName, ReactNode> = {
  momotalk: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path d="M3.8 7.2 12 13l8.2-5.8" />
    </>
  ),
  mission: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m8.2 12.3 2.7 2.7 5-5.4" />
    </>
  ),
  mail: (
    <>
      <rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2.2" />
      <path d="M3.4 13.2h4.3l1.5 2.6h5.6l1.5-2.6h4.3" />
    </>
  ),
  menu: <path d="M4 7.5h16M4 12h16M4 16.5h16" />,
  cafe: (
    <>
      <path d="M4.6 8.2h10.8v5.4a3.9 3.9 0 0 1-3.9 3.9H8.5a3.9 3.9 0 0 1-3.9-3.9z" />
      <path d="M15.4 9.6h1.9a2.1 2.1 0 0 1 0 4.2h-1.9" />
      <path d="M4 20.2h12.4" />
    </>
  ),
  student: (
    <>
      <circle cx="12" cy="8.4" r="3.4" />
      <path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0" />
    </>
  ),
  formation: (
    <>
      <path d="M6.4 20V4.2" />
      <path d="M6.4 5h9.8l-1.9 3.7 1.9 3.7H6.4" />
    </>
  ),
  gacha: (
    <>
      <path d="m12 3.6 1.7 4.6 4.7 1.7-4.7 1.7L12 16.2l-1.7-4.6L5.6 9.9l4.7-1.7z" />
      <path d="m18.2 15.4.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
    </>
  ),
  story: (
    <>
      <path d="M12 6.6C10.3 5.2 8 4.6 4.6 4.8v12.4c3.4-.2 5.7.4 7.4 1.8 1.7-1.4 4-2 7.4-1.8V4.8c-3.4-.2-5.7.4-7.4 1.8z" />
      <path d="M12 6.6v12.4" />
    </>
  ),
  memorial: <path d="M12 3.4l7.2 8.6-7.2 8.6-7.2-8.6z" />,
  home: (
    <>
      <path d="M4.4 11.2 12 4.4l7.6 6.8" />
      <path d="M6.4 10.2v9.4h11.2v-9.4" />
    </>
  ),
  events: (
    <>
      <rect x="4" y="5.8" width="16" height="13.6" rx="2" />
      <path d="M4 10h16M8.4 3.8v3.4M15.6 3.8v3.4" />
    </>
  ),
  option: (
    <>
      <path d="M4 7.4h8.6M17.4 7.4H20M4 12h3.2M11.6 12H20M4 16.6h9.4M18 16.6H20" />
      <circle cx="15" cy="7.4" r="2" />
      <circle cx="9.2" cy="12" r="2" />
      <circle cx="15.6" cy="16.6" r="2" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="9.8" r="2.6" />
      <path d="M7.4 17.8a4.9 4.9 0 0 1 9.2 0" />
    </>
  ),
  equipment: <path d="M12 3.6l7 2.6v5.4c0 4.2-2.9 7.3-7 8.8-4.1-1.5-7-4.6-7-8.8V6.2z" />,
  item: (
    <>
      <path d="M4.2 8.4 12 4.4l7.8 4v7.2L12 19.6l-7.8-4z" />
      <path d="M4.2 8.4 12 12.4l7.8-4M12 12.4v7.2" />
    </>
  ),
  scrapbook: (
    <>
      <rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.2" />
      <path d="m4.4 15.6 4.6-4 3.4 3 3-2.4 4.2 3.6" />
      <circle cx="9" cy="9.2" r="1.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.4v2.4M12 18.2v2.4M4.6 7.9l2.1 1.2M17.3 14.9l2.1 1.2M4.6 16.1l2.1-1.2M17.3 9.1l2.1-1.2" />
    </>
  ),
  restart: (
    <>
      <path d="M19.2 12a7.2 7.2 0 1 1-2.6-5.6" />
      <path d="M19.6 4.6v4.2h-4.2" />
    </>
  ),
};

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Glyph({ name, size = 24, strokeWidth = 1.6, className, style }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', ...style }}
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
    >
      {PATHS[name]}
    </svg>
  );
}
