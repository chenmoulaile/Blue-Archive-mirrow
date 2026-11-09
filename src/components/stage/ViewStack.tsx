/**
 * G-2 页栈基础设施 —— 页面内的全屏导航（报告一 3.1、报告二 A1/C1）
 *
 * 真机形态：桃信/剧情/招募详情都是「列表页全屏 → 点入整屏替换 → 左上返回」
 * 的全屏页栈，不是双栏工作台。列表页作为栈底保留，上层以全屏覆盖层挂载，
 * 带约 250ms 滑入/滑出过渡（STAGE_UI.transitionMs）。
 *
 * 页面轨标准用法（桃信为例）：
 * ```tsx
 * const stack = useViewStack();
 * return (
 *   <div className="mt-page">
 *     <MomotalkList onOpen={(id) => stack.open('room', { id })} />
 *     {stack.entries.map((e) => (
 *       <StackOverlay key={e.key} entry={e} onClose={() => stack.close(e.key)}>
 *         {e.key === 'room' && <ChatRoom id={(e.params as { id: string }).id} />}
 *       </StackOverlay>
 *     ))}
 *   </div>
 * );
 * ```
 *
 * 注意：
 *   - StackOverlay 必须放在「相对定位铺满舞台」的容器内（它是 absolute inset:0），
 *     通常就是页面根节点；
 *   - 同名层已打开（未在退出动画中）时 open() 是幂等的，不会叠加两层；
 *   - 退出动画结束后才真正卸载，业务数据（params）在动画期间仍可访问。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STAGE_UI } from '../../core/game-ui-spec';

/** 栈层生命周期：entering（挂载，画面在右侧外）→ open（滑入完成）→ exiting（滑出中，结束后卸载） */
export type StackStatus = 'entering' | 'open' | 'exiting';

export interface StackEntry<S extends string = string> {
  /** 层标识：与页内业务态一一对应（如 'room' | 'player' | 'detail'） */
  key: S;
  /** 打开该层时携带的业务参数（会话 id / 剧集 id / 卡池 id 等） */
  params?: unknown;
  status: StackStatus;
}

export interface ViewStackApi<S extends string = string> {
  /** 当前打开的层（不含栈底），栈顶在数组末尾 */
  entries: StackEntry<S>[];
  /** 栈顶层；没有打开层时为 null */
  top: StackEntry<S> | null;
  /** 是否存在指定 key 的层（含退出动画中） */
  has: (key: S) => boolean;
  /** 打开一层（全屏覆盖层滑入）。同名层已存在时幂等 */
  open: (key: S, params?: unknown) => void;
  /** 关闭栈顶（默认）或指定层，播放滑出动画后卸载 */
  close: (key?: S) => void;
  /** 关闭全部层（直接回栈底） */
  closeAll: () => void;
}

const TRANSITION_MS = STAGE_UI.transitionMs.value;

export function useViewStack<S extends string = string>(): ViewStackApi<S> {
  const [entries, setEntries] = useState<StackEntry<S>[]>([]);
  const timers = useRef<number[]>([]);

  // 卸载时清掉所有退出动画的定时器
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.length = 0;
    };
  }, []);

  const open = useCallback((key: S, params?: unknown) => {
    setEntries((cur) => {
      // 幂等：同名层已在栈上（未处于退出动画）则不重复压栈
      if (cur.some((e) => e.key === key && e.status !== 'exiting')) return cur;
      // 同名层正在退出：立即复活为进入态（快速连点返回/进入不丢层）
      const revived = cur.filter((e) => !(e.key === key && e.status === 'exiting'));
      const next: StackEntry<S> = { key, params, status: 'entering' };
      return [...revived, next];
    });
    // 双 rAF 保证浏览器先以 translateX(100%) 完成首次绘制，再切 open 触发过渡
    const id = window.setTimeout(() => {
      setEntries((cur) =>
        cur.map((e) => (e.key === key && e.status === 'entering' ? { ...e, status: 'open' } : e))
      );
    }, 16);
    timers.current.push(id);
  }, []);

  const close = useCallback((key?: S) => {
    setEntries((cur) => {
      if (cur.length === 0) return cur;
      const targetKey = key ?? cur[cur.length - 1]!.key;
      const target = cur.find((e) => e.key === targetKey && e.status !== 'exiting');
      if (!target) return cur;
      const id = window.setTimeout(() => {
        setEntries((c) => c.filter((e) => !(e.key === targetKey && e.status === 'exiting')));
      }, TRANSITION_MS);
      timers.current.push(id);
      return cur.map((e) => (e.key === target.key ? { ...e, status: 'exiting' } : e));
    });
  }, []);

  const closeAll = useCallback(() => {
    setEntries((cur) => {
      if (cur.length === 0) return cur;
      const keys = cur.filter((e) => e.status !== 'exiting').map((e) => e.key);
      const id = window.setTimeout(() => {
        setEntries((c) => c.filter((e) => e.status === 'exiting' && keys.includes(e.key)));
      }, TRANSITION_MS);
      timers.current.push(id);
      return cur.map((e) => (e.status !== 'exiting' ? { ...e, status: 'exiting' } : e));
    });
  }, []);

  const has = useCallback((key: S) => entries.some((e) => e.key === key), [entries]);

  const top = useMemo(
    () => (entries.length > 0 ? entries[entries.length - 1]! : null),
    [entries]
  );

  return { entries, top, has, open, close, closeAll };
}

export interface StackOverlayProps {
  /** 来自 stack.entries 的层对象，状态由此驱动过渡 */
  entry: StackEntry;
  /** 层内容：全屏页面 */
  children: ReactNode;
  /** 附加类名（页面轨自定义层内布局） */
  className?: string;
  /** 无障碍名（朗读/测试定位用），默认取 entry.key */
  label?: string;
  /** z-index；默认按渲染顺序自然叠放，多层同屏时才需要指定 */
  zIndex?: number;
}

/**
 * 全屏覆盖层：absolute inset:0 滑入/滑出（data-stack-status 驱动）。
 * 不自带返回钮——返回钮由页面轨放在层内容里（原版是层内左上角），
 * 需要通用返回钮时复用 TopCurrencyBar；关闭动作走 stack.close()。
 */
export function StackOverlay({
  entry,
  children,
  className,
  label,
  zIndex,
}: StackOverlayProps): React.JSX.Element {
  return (
    <section
      className={`stack-overlay${className ? ` ${className}` : ''}`}
      data-stack-key={entry.key}
      data-stack-status={entry.status}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? `stack-${entry.key}`}
      style={zIndex != null ? { zIndex } : undefined}
    >
      {children}
    </section>
  );
}
