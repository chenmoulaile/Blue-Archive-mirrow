/**
 * 消息流状态机：像真实 MomoTalk 那样逐条冒出消息。
 *
 * - 打开时已读线程（instantCount 条）直接整块显示，不重播动画；
 * - 未读消息按 delayMs 节奏流出，学生消息前先出「正在输入」气泡；
 * - 走到 answer 节点且没有已存选项时停下，等老师点选项；
 *   选项写在 save.momotalk.chosen，重开时按已选内容回放；
 * - 点聊天区任意处 = 快进到下一个待回复点（或直接读完）；
 * - 全部显示完回调 onComplete（标记整段已读）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mtMsgKey } from './data';
import type { MomoMessage } from './types';

export interface StreamItem {
  threadIdx: number;
  msgIdx: number;
  msg: MomoMessage;
}

export interface MomoStreamOpts {
  cid: number;
  items: StreamItem[];
  /** 打开时就整块显示的消息数（已读线程） */
  instantCount: number;
  /** save.momotalk.chosen */
  chosen: Record<string, number>;
  onChoose: (item: StreamItem, optIdx: number) => void;
  onComplete: () => void;
}

/** 学生消息的打字节奏：跟随 delayMs，但封顶避免拖沓 */
const capDelay = (ms: number | undefined, fb: number): number => Math.min(Math.max(ms ?? fb, 420), 1200);

export function useMomoStream({ cid, items, instantCount, chosen, onChoose, onComplete }: MomoStreamOpts) {
  const [shown, setShown] = useState(() => Math.min(instantCount, items.length));
  const [typing, setTyping] = useState(false);
  /** 正在等待老师选选项的 answer 节点 msg key */
  const [waiting, setWaiting] = useState<string | null>(null);
  const instantRef = useRef(instantCount);
  /** 完成守卫：只有「换了学生」或「消息总数变多」（好感解锁新线程）才再次回调 */
  const completedRef = useRef('');

  // 换学生时重置流状态
  useEffect(() => {
    instantRef.current = instantCount;
    setShown(Math.min(instantCount, items.length));
    setTyping(false);
    setWaiting(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  // charFile 异步加载完成（或解锁新线程）后，已读消息数增加时补齐显示，
  // 只增不减，避免打断正在进行的动画；instantRef 同步，保证流式区判断正确
  useEffect(() => {
    instantRef.current = instantCount;
    setShown((s) => Math.max(s, Math.min(instantCount, items.length)));
  }, [instantCount, items.length]);

  useEffect(() => {
    if (shown >= items.length) {
      setTyping(false);
      setWaiting(null);
      const endKey = `${cid}:${items.length}`;
      // 引擎 effect 的依赖里有 chosen（每次 store.update 都是新引用），
      // 不能无条件回调 onComplete，否则「回调→写存档→新引用→再回调」死循环
      if (completedRef.current !== endKey) {
        completedRef.current = endKey;
        onComplete();
      }
      return;
    }
    const it = items[shown];
    const key = mtMsgKey(cid, it.threadIdx, it.msgIdx);
    // answer 节点且没有存档选项 → 停住等选择
    if (it.msg.kind === 'answer' && chosen[key] === undefined) {
      setTyping(false);
      setWaiting(key);
      return;
    }
    setWaiting(null);
    // 已读区直接落位；流式区先出打字气泡再冒消息
    const streaming = shown >= instantRef.current;
    const delay = streaming
      ? it.msg.kind === 'answer'
        ? 520
        : capDelay(it.msg.delayMs, 700)
      : 0;
    if (streaming && it.msg.from === 'student' && delay >= 420) {
      setTyping(true);
    } else {
      setTyping(false);
    }
    const timer = window.setTimeout(() => {
      setTyping(false);
      setShown((s) => s + 1);
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, shown, items, chosen]);

  /** 老师点下选项 */
  const choose = useCallback(
    (item: StreamItem, optIdx: number) => {
      onChoose(item, optIdx);
    },
    [onChoose]
  );

  /** 快进：显示到下一个待回复点（没有就直接读完） */
  const skip = useCallback(() => {
    setTyping(false);
    setShown((s) => {
      for (let i = s; i < items.length; i++) {
        const it = items[i];
        if (it.msg.kind === 'answer' && chosen[mtMsgKey(cid, it.threadIdx, it.msgIdx)] === undefined) {
          return i;
        }
      }
      return items.length;
    });
  }, [cid, items, chosen]);

  return { shown, typing, waiting, choose, skip };
}
