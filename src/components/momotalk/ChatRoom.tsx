/**
 * MomoTalk 聊天页：竖屏全宽、以全屏覆盖层挂载（页栈 room 层，M-1）。
 *
 * 顶部栏（M-7）：粉色横幅形制（与列表页同款）—— 返回‹ + 学生头像 + 名字 +
 * 好感度 + 白色喇叭语音按钮。原版顶栏构成无真机截图证据（审计 M-7 自述
 * 「需截图确认」），按现可参照形制保守重排并如实标注。
 * 语音（M-7 语义修正）：不再随机循环学生任意语音，改为播放该学生的大厅
 * 语音族（desc 形如 *_Lobby_1..5，不含 MemorialLobby），族内顺序轮播；
 * 数据里语音无台词文本字段，播放期间输入栏上方显示 desc 台词占位字幕。
 *
 * 消息流（C3/裁决③）：学生侧深藏青底白字 + 气泡上方红字名字（对照 6 原版
 * 采样 #4A5768/#F88A9E）；老师侧青色底白字右对齐（#4D89C8）。
 *
 * M-2：自创「好感度分隔条」已删除；已读/未读分界改用官方「到此已读」
 * 灰白圆角通栏条（萌百参照截图确认的官方元素）。
 *
 * M-3：底部是完整输入栏外观（加号钮 + 灰底圆角输入框占位「输入消息…」 +
 * 发送钮），纯装饰可点击不可输入，永远渲染；回复选项以半透明圆角卡浮层
 * 出现在消息流末端、与输入栏并存（选项出现不隐藏输入栏）。选项按钮样式
 * 取报告二 C4「白底粉描边圆角卡」+ 萌百参照（通栏按钮、文字居中）；对照 6
 * 剧情内嵌语境里的青色实底小按钮为另一形态，已在结果里如实记录差异。
 *
 * M-9：消息弹出动画 mtMsgIn（scale 0.9→1 + translateY 8px→0 + opacity，
 * 200ms），只给流式区（index >= instantCount）的行；已读直显区不播。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SaveData, Student, StoryEntry } from '../../types';
import { UIIcon } from '../NineSlice';
import { ChatBubble } from './ChatBubble';
import { StoryCard } from './StoryCard';
import { TypingDots } from './TypingDots';
import { useMomoStream, type StreamItem } from './useMomoStream';
import {
  isStoryWatched,
  mtMsgKey,
  mtThreadKey,
  nextUnlockRank,
  storyEntry,
  unlockedThreads,
} from './data';
import { MOMO_SPRITES, type MomoCharFile, type MomoStudentRef } from './types';

export interface ChatRoomProps {
  refInfo: MomoStudentRef;
  charFile: MomoCharFile | null;
  student: Student | null;
  storyIndex: StoryEntry[];
  favor: number;
  save: SaveData;
  /** 用户音效音量（save.settings.seVolume；大厅语音按此音量播放） */
  seVolume: number;
  onBack: () => void;
  /** 老师选择回复选项（写 chosen/answered/好感/最近时间） */
  onChoose: (cid: number, item: StreamItem, optIdx: number) => void;
  /** 观看剧情触发（跳剧情页 + 标记已看 + 好感） */
  onWatchStory: (cid: number, scenarioGroup: number) => void;
  /** 消息流读完整段后标记已读（含当前已解锁的所有线程） */
  onAllRead: (cid: number, charFile: MomoCharFile | null) => void;
  toast: (msg: string) => void;
}

/** 大厅语音族：desc 形如 Shiroko_Lobby_1（倒数第二段必须是 Lobby，
 *  MemorialLobby_1/Title/Battle/Season 等不算）。族为空时顺序退化为全部
 *  语音（仍不随机），一个都没有时才提示无素材。 */
function lobbyVoices(student: Student | null): { file: string; desc: string; path: string }[] {
  const all = student?.voices ?? [];
  const lobby = all.filter((v) => {
    const seg = v.desc.split('_');
    return seg.length >= 2 && seg[seg.length - 2] === 'Lobby';
  });
  return lobby.length > 0 ? lobby : all;
}

export function ChatRoom({
  refInfo,
  charFile,
  student,
  storyIndex,
  favor,
  save,
  seVolume,
  onBack,
  onChoose,
  onWatchStory,
  onAllRead,
  toast,
}: ChatRoomProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  const threads = useMemo(
    () => (charFile ? unlockedThreads(charFile, favor) : []),
    [charFile, favor]
  );
  const items = useMemo(() => {
    const out: StreamItem[] = [];
    threads.forEach((t, threadIdx) => t.messages.forEach((msg, msgIdx) => out.push({ threadIdx, msgIdx, msg })));
    return out;
  }, [threads]);

  // 已读线程的消息总数：打开时整块显示，不重播动画
  const instantCount = useMemo(() => {
    if (!charFile) return 0;
    let n = 0;
    threads.forEach((t, i) => {
      if (save.momotalk.read.includes(mtThreadKey(charFile.characterId, i))) n += t.messages.length;
    });
    return n;
    // 只在换学生/换记录时算一次，读的过程中不重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charFile, refInfo.characterId]);

  const stream = useMomoStream({
    cid: refInfo.characterId,
    items,
    instantCount,
    chosen: save.momotalk.chosen,
    onChoose: (item, optIdx) => onChoose(refInfo.characterId, item, optIdx),
    onComplete: () => onAllRead(refInfo.characterId, charFile),
  });

  // 新消息冒出后滚到底部
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream.shown, stream.typing, stream.waiting]);

  // ---- 大厅语音族（M-7 语义修正：顺序轮播 + 台词占位字幕，不随机循环）----
  const lobby = useMemo(() => lobbyVoices(student), [student]);
  const voiceIdx = useRef(0);
  const voiceEl = useRef<HTMLAudioElement | null>(null);
  const [voiceSub, setVoiceSub] = useState<string | null>(null);

  const stopVoice = (): void => {
    if (voiceEl.current) {
      voiceEl.current.pause();
      voiceEl.current.removeAttribute('src');
      voiceEl.current = null;
    }
    setVoiceSub(null);
  };

  useEffect(() => stopVoice, []); // 换学生/退出聊天页时停掉在播语音

  const playVoice = (): void => {
    if (lobby.length === 0) {
      toast('该学生暂无语音素材');
      return;
    }
    const v = lobby[voiceIdx.current % lobby.length];
    voiceIdx.current += 1;
    stopVoice();
    const el = new Audio(v.path);
    el.volume = seVolume;
    el.addEventListener('ended', () => setVoiceSub(null), { once: true });
    el.addEventListener('error', () => setVoiceSub(null), { once: true });
    voiceEl.current = el;
    setVoiceSub(v.desc); // 台词占位字幕：语音数据无文本字段，desc 如实占位
    el.play().catch(() => setVoiceSub(null));
  };

  const shownItems = items.slice(0, stream.shown);
  const nextRank = charFile ? nextUnlockRank(charFile, favor) : null;
  const waitingItem = useMemo(() => {
    if (!stream.waiting) return null;
    return items.find((it) => mtMsgKey(refInfo.characterId, it.threadIdx, it.msgIdx) === stream.waiting) ?? null;
  }, [stream.waiting, items, refInfo.characterId]);
  const waitingOptions = waitingItem?.msg.options ?? null;

  return (
    <div className="mt-room">
      {/* 顶部栏：粉色横幅形制（M-7 重排） */}
      <div className="mt-head">
        <button className="mt-back" onClick={onBack} title="返回会话列表">
          ‹
        </button>
        {refInfo.avatar && <img className="mt-head-avatar" src={refInfo.avatar} alt="" />}
        <div className="mt-head-info">
          <b>{refInfo.name}</b>
          <span className="mt-head-favor">
            <UIIcon
              name={MOMO_SPRITES.favor}
              size={22}
              fallback={<span style={{ color: '#fff' }}>♥</span>}
            />
            好感度 Lv.{favor}
          </span>
        </div>
        <button className="mt-voice" onClick={playVoice} title="播放大厅语音">
          <span className="mt-voice-icon" data-ui-source="css-fallback" aria-hidden>
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
              <path d="M3.5 9.4v5.2h4.1l5.2 4.6V4.8L7.6 9.4H3.5z" />
              <path d="M15.7 8.5a5.1 5.1 0 0 1 0 7l1.5 1.4a7.2 7.2 0 0 0 0-9.8l-1.5 1.4z" />
            </svg>
          </span>
        </button>
      </div>

      {/* 消息流（点击空白快进） */}
      <div className="mt-body" ref={bodyRef} onClick={stream.skip}>
        {charFile === null && <div className="mt-empty">正在读取对话记录…</div>}
        {charFile !== null && items.length === 0 && (
          <div className="mt-empty">
            还没有可以查看的消息。
            {nextRank ? `好感度达到 Lv.${nextRank} 后解锁下一段。` : ''}
          </div>
        )}
        {shownItems.map((it, i) => {
          const key = mtMsgKey(refInfo.characterId, it.threadIdx, it.msgIdx);
          const prev = i > 0 ? shownItems[i - 1] : null;
          const newThread = !prev || prev.threadIdx !== it.threadIdx;
          // 同发送者连续发言：行距收紧（真机 MomoTalk 连发消息排得很密）
          const cont = !!prev && !newThread && prev.msg.from === it.msg.from;
          // M-9：流式区（>= instantCount）播弹出动画；已读直显区不播
          const anim = i >= instantCount;
          return (
            <div key={key} style={{ display: 'contents' }}>
              {/* 官方「到此已读」分界条（M-2 自创分隔条的替代，萌百参照确认） */}
              {i === instantCount && instantCount > 0 && (
                <div className={`mt-read-divider${anim ? ' anim' : ''}`}>到此已读</div>
              )}
              {it.msg.kind === 'answer' ? (
                // 已回复过的 answer 节点按所选选项回放成老师气泡
                (() => {
                  const pick = save.momotalk.chosen[key];
                  const opt = pick !== undefined ? it.msg.options?.[pick] : undefined;
                  return opt ? (
                    <ChatBubble
                      msg={{ ...it.msg, kind: 'text', text: opt.text }}
                      mine
                      animate={anim}
                    />
                  ) : null;
                })()
              ) : (
                <ChatBubble
                  msg={it.msg}
                  avatar={refInfo.avatar}
                  mine={it.msg.from === 'teacher'}
                  cont={cont}
                  name={it.msg.from === 'student' ? refInfo.name : undefined}
                  animate={anim}
                />
              )}
              {it.msg.story && (
                <StoryCard
                  title={storyEntry(it.msg.story.scenarioGroup, storyIndex)?.title ?? null}
                  favorRank={it.msg.story.favorRank}
                  watched={isStoryWatched(save, it.msg.story.scenarioGroup)}
                  animate={anim}
                  onWatch={() => onWatchStory(refInfo.characterId, it.msg.story!.scenarioGroup)}
                />
              )}
            </div>
          );
        })}
        {stream.typing && <TypingDots avatar={refInfo.avatar} animate />}
        {/* 回复选项：半透明圆角卡浮层于消息流末端（M-3），与底部输入栏并存；
            点击后该选项写入 chosen → answer 节点回放成老师气泡进入消息流，
            其余选项随 waiting 清空消失。 */}
        {waitingOptions && (
          <div className="mt-reply-group" onClick={(e) => e.stopPropagation()}>
            <span className="mt-reply-label">回复</span>
            {waitingItem!.msg.options!.map((opt, idx) => (
              <button
                key={idx}
                className="mt-reply-btn"
                onClick={() => stream.choose(waitingItem!, idx)}
              >
                {opt.text}
              </button>
            ))}
          </div>
        )}
        {items.length > 0 && stream.shown < items.length && !stream.typing && !stream.waiting && (
          <div className="mt-skip-hint">点击空白处快进</div>
        )}
      </div>

      {/* 台词占位字幕（M-7：语音播放期间显示，语音数据无文本字段，desc 占位） */}
      {voiceSub && (
        <div className="mt-voice-sub" data-note="voice-desc-placeholder">
          ♪ {voiceSub}
        </div>
      )}

      {/* 底部完整输入栏外观（M-3：纯装饰，可点击不可输入，永远渲染；
          选项浮层出现时不再隐藏本栏） */}
      <div className="mt-inputbar" onClick={(e) => e.stopPropagation()}>
        <button className="mt-plus" title="附件（装饰）" aria-label="附件（装饰按钮）">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <input
          className="mt-input"
          readOnly
          placeholder="输入消息…"
          aria-label="消息输入框（展示用，不可输入）"
          onClick={(e) => e.stopPropagation()}
        />
        <button className="mt-send" title="发送（装饰）" aria-label="发送（装饰按钮）">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
            <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9l-.1 6.5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
