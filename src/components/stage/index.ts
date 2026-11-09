/**
 * 竖屏舞台基础设施统一出口（页面轨从这里 import）。
 *
 * 接口契约见同目录 README.md。
 */
export { default as PortraitStage, useStageScale, type PortraitStageProps } from './PortraitStage';
export {
  useViewStack,
  StackOverlay,
  type StackEntry,
  type StackStatus,
  type StackOverlayProps,
  type ViewStackApi,
} from './ViewStack';
export { default as TopCurrencyBar, type TopCurrencyBarProps } from './TopCurrencyBar';
