/**
 * MomoTalk —— 游戏内聊天应用还原。
 *
 * 数据：data/momotalk/index.json（265 名学生会话索引）+
 *       data/momotalk/<characterId>.json（真实消息序列）。
 * 结构：左会话列表（MomotalkList）+ 右聊天页（ChatRoom）。
 * 状态：已读/未读、回复选项、好感度解锁、最近互动全部落 src/core/store.ts
 *       的 save.momotalk（read/favor/answered/chosen/recent）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navState } from '../core/AppContext';
import { store, useSave } from '../core/store';
import { ChatRoom } from '../components/momotalk/ChatRoom';
import { MomotalkList, type MomoListEntry } from '../components/momotalk/MomotalkList';
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

  const [refs, setRefs] = useState<MomoStudentRef[]>([]);
  const [charFiles, setCharFiles] = useState<Map<number, MomoCharFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCid, setActiveCid] = useState<number | null>(null);

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

  /** 会话列表条目（预览/未读/置顶规则见 MomotalkList） */
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
    const q = query.trim().toLowerCase();
    const hit = (e: MomoListEntry) =>
      !q ||
      e.ref.name.toLowerCase().includes(q) ||
      e.ref.devName.toLowerCase().includes(q) ||
      (studentById.get(e.ref.studentId)?.name_en ?? '').toLowerCase().includes(q);
    return out
      .filter(hit)
      .sort(
        (a, b) =>
          Number(b.birthday) - Number(a.birthday) ||
          b.ts - a.ts ||
          b.unread - a.unread ||
          a.ref.characterId - b.ref.characterId
      );
  }, [refs, charFiles, save, studentById, query, todayMd]);

  const activeRef = activeCid !== null ? refs.find((r) => r.characterId === activeCid) ?? null : null;
  const activeFile = activeCid !== null ? charFiles.get(activeCid) ?? null : null;

  const openChat = (cid: number): void => {
    setActiveCid(cid);
    store.update((d) => {
      d.momotalk.recent[String(cid)] = Date.now();
    });
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
    <div className="momo mt-layout">
      <MomotalkList
        entries={entries}
        activeId={activeCid}
        query={query}
        loading={loading}
        onQuery={setQuery}
        onOpen={openChat}
      />
      {activeRef ? (
        <ChatRoom
          key={activeRef.characterId}
          refInfo={activeRef}
          charFile={activeFile}
          student={studentById.get(activeRef.studentId) ?? null}
          storyIndex={assets.storyIndex}
          favor={favorOf(save, activeRef.characterId)}
          save={save}
          onBack={() => setActiveCid(null)}
          onChoose={handleChoose}
          onWatchStory={handleWatchStory}
          onAllRead={handleAllRead}
          toast={toast}
        />
      ) : (
        <div className="mt-room mt-room-placeholder">
          <div className="mt-empty">
            {loading ? '正在载入 MomoTalk…' : '从左侧选择一名学生开始聊天'}
            {loading && <div className="mt-loading-bar" />}
          </div>
        </div>
      )}
    </div>
  );
}
