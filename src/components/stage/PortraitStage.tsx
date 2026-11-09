/**
 * G-1 竖屏舞台 —— 全部页面的根容器（报告一 3.1）
 *
 * 结构：
 *   .stage-viewport   外层 letterbox：铺满窗口、纯黑底、内容居中
 *   .stage-frame      内层 1080×1920 逻辑画框，整体 transform: scale()
 *
 * 尺寸约定（页面轨必读）：
 *   - 舞台内所有布局一律使用 1080×1920 逻辑 px，**不要**再读 window.innerWidth
 *     自行换算——横屏量出的尺寸到竖屏全部作废（冲突裁决④）；
 *   - 缩放由本组件统一施加，缩放系数同步写入 :root 的 --stage-scale
 *     （STAGE_SCALE_CSS_VAR），需要"舞台外坐标"的场景（如全局遮罩）才用它；
 *   - 舞台内 position: fixed 的元素以 .stage-frame 为包含块（transform
 *     产生 containing block），正好等于"游戏内全屏"，这正是想要的行为。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { REF_HEIGHT, REF_WIDTH, STAGE_SCALE_CSS_VAR, stageScaleFor } from '../../core/game-ui-spec';

export interface PortraitStageProps {
  /** 舞台内容：任何页面都直接铺进 1080×1920 画框 */
  children: ReactNode;
  /** 附加到 .stage-frame 的类名（页面轨做整页背景/倾斜时用） */
  frameClassName?: string;
  /** 附加到 .stage-frame 的内联样式 */
  frameStyle?: CSSProperties;
}

/**
 * 依据窗口尺寸计算舞台缩放系数（导出仅为测试与特殊布局复用）。
 * 与 game-ui-spec.stageScaleFor 同源：min(窗宽/1080, 窗高/1920)。
 */
export function useStageScale(): number {
  const [scale, setScale] = useState(() => stageScaleFor(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const onResize = (): void => setScale(stageScaleFor(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return scale;
}

export default function PortraitStage({ children, frameClassName, frameStyle }: PortraitStageProps) {
  const scale = useStageScale();

  // 缩放系数同步到 :root CSS 变量（全局可用），舞台卸载时清理
  useEffect(() => {
    document.documentElement.style.setProperty(STAGE_SCALE_CSS_VAR, String(scale));
    return () => {
      document.documentElement.style.removeProperty(STAGE_SCALE_CSS_VAR);
    };
  }, [scale]);

  return (
    <div className="stage-viewport">
      <div
        className={`stage-frame${frameClassName ? ` ${frameClassName}` : ''}`}
        style={{
          width: REF_WIDTH,
          height: REF_HEIGHT,
          // 居中缩放：先平移自身中心到视口中心再 scale（translate 百分比基于
          // 自身未缩放尺寸）。不依赖 grid/flex 的溢出居中语义（item 大于容器
          // 时不同浏览器轨道行为有差异，实测 grid 行轨道会顶对齐）。
          transform: `translate(-50%, -50%) scale(${scale})`,
          ...frameStyle,
        }}
        data-stage-frame
      >
        {children}
      </div>
    </div>
  );
}
