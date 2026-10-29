import { createContext, useContext } from 'react';
import type { AssetBundle } from './assets';
import type { Locale, Settings } from './config';
import type { UIAtlas } from './ui-atlas';

export type View =
  | 'home'
  | 'memorial'
  | 'story'
  | 'gacha'
  | 'momotalk'
  | 'cafe'
  | 'events'
  | 'settings';

export interface AppCtx {
  assets: AssetBundle;
  /** 游戏内 UI 图集；没提取到就是 source: 'none' */
  uiAtlas: UIAtlas;
  resourceDir: string;
  version: string;
  settings: Settings;
  locale: Locale;
  /** 提示条 */
  toast: (msg: string) => void;
  /** 页面跳转 */
  go: (v: View) => void;
  /** 返回启动流程 */
  restartIntro: () => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext 未初始化');
  return ctx;
}

/** 跨页面传参：桃信/活动页要跳去剧情页播某一集，或跳到某个卡池 */
export const navState: {
  pendingStoryId: string | null;
  pendingStoryQuery: string | null;
  pendingBannerId: number | null;
  pendingMemorialStudent: number | null;
} = {
  pendingStoryId: null,
  pendingStoryQuery: null,
  pendingBannerId: null,
  pendingMemorialStudent: null,
};
