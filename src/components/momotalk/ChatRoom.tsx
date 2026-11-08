/**
 * MomoTalk 聊天页：顶部学生资料栏 + 消息流 + 回复选项栏。
 *
 * 排版贴近游戏：学生头像居左、白气泡；老师（我）蓝气泡居右；
 * 每段 threads 按 favorRank 分界；点击消息区快进。
 * 语音：momotalk 消息数据本身没有语音字段（全量 15065 条已验证），
 * 资料栏的语音按钮按 audio.playVoice 契约播放 students_slim 的真实语音。
 */
import { useEffect, useMemo, useRef } from 'react';
import type { SaveData, Student, StoryEntry } from '../../types';
import { audio } from '../../core/audio';
import { NineSlice, UIIcon } from '../NineSlice';
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
  onBack: () => void;
  /** 老师选择回复选项（写 chosen/answered/好感/最近时间） */
  onChoose: (cid: number, item: StreamItem, optIdx: number) => void;
  /** 观看剧情触发（跳剧情页 + 标记已看 + 好感） */
  onWatchStory: (cid: number, scenarioGroup: number) => void;
  /** 消息流读完整段后标记已读（含当前已解锁的所有线程） */
  onAllRead: (cid: number, charFile: MomoCharFile | null) => void;
  toast: (msg: string) => void;
}

export function ChatRoom({
  refInfo,
  charFile,
  student,
  storyIndex,
  favor,
  save,
  onBack,
  onChoose,
  onWatchStory,
  onAllRead,
  toast,
}: ChatRoomProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const voiceIdx = useRef(0);

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

  const playVoice = (): void => {
    const voices = student?.voices ?? [];
    if (voices.length === 0) {
      toast('该学生暂无语音素材');
      return;
    }
    const v = voices[voiceIdx.current % voices.length];
    voiceIdx.current += 1;
    audio.playVoice(v.path);
    toast(`♪ ${v.desc.replace(/\.ogg$/i, '')}`);
  };

  const shownItems = items.slice(0, stream.shown);
  const nextRank = charFile ? nextUnlockRank(charFile, favor) : null;
  const waitingItem = useMemo(() => {
    if (!stream.waiting) return null;
    return items.find((it) => mtMsgKey(refInfo.characterId, it.threadIdx, it.msgIdx) === stream.waiting) ?? null;
  }, [stream.waiting, items, refInfo.characterId]);

  return (
    <div className="mt-room">
      {/* 顶部资料栏 */}
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
              size={16}
              fallback={<span style={{ color: '#e8a' }}>♥</span>}
            />
            好感度 Lv.{favor}
          </span>
        </div>
        <button className="mt-voice" onClick={playVoice} title="播放语音">
          <NineSlice name={MOMO_SPRITES.chat} className="mt-voice-btn" fillCenter={false}>
            ♪
          </NineSlice>
        </button>
      </div>

      {/* 消息流 */}
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
          const favorRank = threads[it.threadIdx]?.favorRank ?? 0;
          return (
            <div key={key} style={{ display: 'contents' }}>
              {newThread && (
                <div className="mt-thread-divider">
                  —— 好感度 Lv.{favorRank} 的对话 ——
                </div>
              )}
              {it.msg.kind === 'answer' ? (
                // 已回复过的 answer 节点按所选选项回放成老师气泡
                (() => {
                  const pick = save.momotalk.chosen[key];
                  const opt = pick !== undefined ? it.msg.options?.[pick] : undefined;
                  return opt ? (
                    <ChatBubble msg={{ ...it.msg, kind: 'text', text: opt.text }} mine />
                  ) : null;
                })()
              ) : (
                <ChatBubble
                  msg={it.msg}
                  avatar={refInfo.avatar}
                  mine={it.msg.from === 'teacher'}
                  cont={cont}
                />
              )}
              {it.msg.story && (
                <StoryCard
                  title={storyEntry(it.msg.story.scenarioGroup, storyIndex)?.title ?? null}
                  favorRank={it.msg.story.favorRank}
                  watched={isStoryWatched(save, it.msg.story.scenarioGroup)}
                  onWatch={() => onWatchStory(refInfo.characterId, it.msg.story!.scenarioGroup)}
                />
              )}
            </div>
          );
        })}
        {stream.typing && <TypingDots avatar={refInfo.avatar} />}
        {/* 回复选项：真机出现在消息流末尾的竖排按钮组（半透明白底圆角卡，
            对照 Dialogue_Event_Background 底板的淡粉描边）。
            点击后该选项写入 chosen → answer 节点回放成老师气泡进入消息流，
            其余选项随 waiting 清空消失。 */}
        {waitingItem?.msg.options && (
          <div className="mt-reply-group" onClick={(e) => e.stopPropagation()}>
            <span className="mt-reply-label">回复</span>
            {waitingItem.msg.options.map((opt, idx) => (
              <button
                key={idx}
                className="mt-reply-btn"
                onClick={() => stream.choose(waitingItem, idx)}
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

      {/* 底部输入栏（纯状态提示；选项在消息流末尾，见 .mt-reply-group） */}
      <div className="mt-options" onClick={(e) => e.stopPropagation()}>
        <div className="mt-inputbar">
          <UIIcon name={MOMO_SPRITES.star} size={20} fallback={<span>✦</span>} />
          <span className="mt-inputbar-hint">
            {stream.waiting ? '请选择回复' : stream.shown < items.length ? '对方正在输入…' : '等待下一条消息…'}
          </span>
        </div>
      </div>
    </div>
  );
}
