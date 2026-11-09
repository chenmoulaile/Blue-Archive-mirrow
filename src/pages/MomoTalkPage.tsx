/**
 * MomoTalk —— 游戏内聊天应用还原（竖屏全屏页栈形态，报告一 M-1、报告二 C1）。
 *
 * 数据：data/momotalk/index.json（265 名学生会话索引）+
 *       data/momotalk/<characterId>.json（真实消息序列）。
 * 结构：真机是全屏手机应用 —— 会话列表占满一屏（栈底），点进会话后
 *       ChatRoom 以全屏覆盖层挂载（舞台轨 ViewStack + StackOverlay，
 *       250ms 滑入过渡），左上角返回弹出栈顶；1080×1920 竖屏内全宽布局，
 *       横屏时代的双栏工作台形态已随 M-1 废除。
 * 状态：已读/未读、回复选项、好感度解锁、最近互动全部落 src/core/store.ts
 *       的 save.momotalk（read/favor/answered/chosen/recent）。
 */
import { useEffect, useMemo, useState } from 'react';
import { navState, useApp } from '../core/AppContext';
import { store, useSave } from '../core/store';
import { StackOverlay, useViewStack } from '../components/stage';
import { ChatRoom } from '../components/momotalk/ChatRoom';
import {
  MomotalkList,
  type MomoListEntry,
  type MomoSortMode,
} from '../components/momotalk/MomotalkList';
import {
  favorOf,
  loadMomoChar,
  loadMomoIndex,
  mtMsgKey,
  mtThreadKey,
  previewOf,
  unreadCount,
  unlockedThreads,
} from '../components/momotalk/data';
import type { MomoCharFile, MomoStudentRef } from '../components/momotalk/types';
import type { StreamItem } from '../components/momotalk/useMomoStream';
import type { Student } from '../types';

export default function MomoTalkPage() {
  const { assets, go, toast } = useApp();
  const save = useSave();
  const stack = useViewStack<'room'>();

  const [refs, setRefs] = useState<MomoStudentRef[]>([]);
  const [charFiles, setCharFiles] = useState<Map<number, MomoCharFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<MomoSortMode>('recent');

  // 会话索引（一次），再全量拉各学生记录做列表预览/未读数（懒加载缓存在 data.ts）
  useEffect(() => {
    let alive = true;
    void loadMomoIndex().then(async (students) => {
      if (!alive) return;
      setRefs(students);
      const files = await Promise.all(students.map((s) => loadMomoChar(s.characterId)));
      if (!alive) return;
      const map = new Map<number, MomoCharFile>();
      files.forEach((f) => {
        if (f) map.set(f.characterId, f);
      });
      setCharFiles(map);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const studentById = useMemo(() => {
    const m = new Map<number, Student>();
    for (const s of assets.students) m.set(s.id, s);
    return m;
  }, [assets.students]);

  const todayMd = useMemo(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  /** 会话列表条目（预览/未读规则见 data.ts；排序 M-6：最新=最近互动优先，
   *  生日置顶保留在「最新」档；「未读」档未读段数优先） */
  const entries = useMemo<MomoListEntry[]>(() => {
    const out: MomoListEntry[] = [];
    for (const ref of refs) {
      const cf = charFiles.get(ref.characterId) ?? null;
      const favor = favorOf(save, ref.characterId);
      const unlocked = cf ? unlockedThreads(cf, favor) : [];
      const pv = unlocked.length > 0 ? previewOf(unlocked) : null;
      const unread = cf ? unreadCount(save, cf, favor) : 0;
      const st = studentById.get(ref.studentId);
      out.push({
        ref,
        preview: pv?.text ?? null,
        previewFrom: pv?.from ?? null,
        unread,
        birthday: st?.birthday === todayMd,
        ts: save.momotalk.recent[String(ref.characterId)] ?? 0,
      });
    }
    return out.sort((a, b) => {
      if (sort === 'unread') {
        return b.unread - a.unread || b.ts - a.ts || a.ref.characterId - b.ref.characterId;
      }
      return (
        Number(b.birthday) - Number(a.birthday) ||
        b.ts - a.ts ||
        b.unread - a.unread ||
        a.ref.characterId - b.ref.characterId
      );
    });
  }, [refs, charFiles, save, studentById, sort, todayMd]);

  const unreadTotal = useMemo(() => entries.reduce((n, e) => n + e.unread, 0), [entries]);

  // 页栈 room 层：open 幂等，entries 里至多一个 room（退出动画期间保留可渲染）
  const roomEntry = stack.entries.find((e) => e.key === 'room') ?? null;
  const activeCid = roomEntry ? (roomEntry.params as { cid: number } | undefined)?.cid ?? null : null;
  const activeRef = activeCid !== null ? refs.find((r) => r.characterId === activeCid) ?? null : null;
  const activeFile = activeCid !== null ? charFiles.get(activeCid) ?? null : null;

  const openChat = (cid: number): void => {
    store.update((d) => {
      d.momotalk.recent[String(cid)] = Date.now();
    });
    stack.open('room', { cid });
  };

  /** 老师选回复：持久化选项 + 首次回复 +1 好感（好感驱动下一段对话解锁） */
  const handleChoose = (cid: number, item: StreamItem, optIdx: number): void => {
    const key = mtMsgKey(cid, item.threadIdx, item.msgIdx);
    const optText = item.msg.options?.[optIdx]?.text ?? '';
    let gained = false;
    store.update((d) => {
      d.momotalk.chosen[key] = optIdx;
      d.momotalk.recent[String(cid)] = Date.now();
      if (!d.momotalk.answered.includes(key)) {
        d.momotalk.answered.push(key);
        d.momotalk.favor[String(cid)] = favorOf(d, cid) + 1;
        gained = true;
      }
    });
    if (gained) toast(`回信：${optText} · 好感度 +1`);
  };

  /** 剧情触发：跳剧情播放器（StoryPage 用 storyIndex id 接住），看过的剧情 +1 好感 */
  const handleWatchStory = (cid: number, scenarioGroup: number): void => {
    const first = !save.momotalk.read.includes(String(scenarioGroup));
    store.update((d) => {
      const k = String(scenarioGroup);
      if (!d.momotalk.read.includes(k)) d.momotalk.read.push(k);
      d.momotalk.recent[String(cid)] = Date.now();
      const fk = `story:${k}`;
      if (!d.momotalk.answered.includes(fk)) {
        d.momotalk.answered.push(fk);
        d.momotalk.favor[String(cid)] = favorOf(d, cid) + 1;
      }
    });
    navState.pendingStoryId = String(scenarioGroup);
    go('story');
    if (first) toast('羁绊剧情 · 好感度 +1');
  };

  /** 消息流读完：当前解锁的所有对话段标记已读（未读红点消失） */
  const handleAllRead = (cid: number, cf: MomoCharFile | null): void => {
    if (!cf) return;
    store.update((d) => {
      const favor = favorOf(d, cid);
      cf.threads.forEach((t, i) => {
        if (t.favorRank <= favor) {
          const k = mtThreadKey(cid, i);
          if (!d.momotalk.read.includes(k)) d.momotalk.read.push(k);
        }
      });
      d.momotalk.recent[String(cid)] = Date.now();
    });
  };

  return (
    // 页面根节点可容纳 absolute 全屏覆盖层（ViewStack 契约）
    <div className="momo mt-page">
      <MomotalkList
        entries={entries}
        activeId={activeCid}
        loading={loading}
        unreadTotal={unreadTotal}
        sort={sort}
        onSort={setSort}
        onOpen={openChat}
        onFilter={() => toast('筛选 · 尚未实装')}
      />
      {roomEntry && (
        <StackOverlay key="room" entry={roomEntry} label="桃信聊天">
          {activeRef && (
            <ChatRoom
              key={activeRef.characterId}
              refInfo={activeRef}
              charFile={activeFile}
              student={studentById.get(activeRef.studentId) ?? null}
              storyIndex={assets.storyIndex}
              favor={favorOf(save, activeRef.characterId)}
              save={save}
              seVolume={save.settings.seVolume}
              onBack={() => stack.close('room')}
              onChoose={handleChoose}
              onWatchStory={handleWatchStory}
              onAllRead={handleAllRead}
              toast={toast}
            />
          )}
        </StackOverlay>
      )}
    </div>
  );
}
