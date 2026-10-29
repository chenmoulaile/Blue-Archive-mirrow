import { useMemo, useState } from 'react';
import { NineSlice } from '../components/NineSlice';
import { useApp, navState } from '../core/AppContext';
import { store, useSave } from '../core/store';
import type { Student, StoryEntry } from '../types';

interface Conv {
  key: string;
  title: string;
  student: Student | null;
  episodes: StoryEntry[];
  lastLine: string;
}

export default function MomoTalkPage() {
  const { assets, go, toast } = useApp();
  const save = useSave();
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [replyIdx, setReplyIdx] = useState(0);

  /** 用羁绊剧情的页面名前缀当作会话对象，并把学生信息对上 */
  const convs = useMemo<Conv[]>(() => {
    const groups = new Map<string, StoryEntry[]>();
    for (const s of assets.storyIndex) {
      if (s.type !== 'bond') continue;
      const key = s.id.split('/')[0] ?? s.id;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    const byGiven = new Map<string, Student>();
    for (const st of assets.students) {
      if (st.given_en) byGiven.set(st.given_en.toLowerCase(), st);
    }
    const out: Conv[] = [];
    for (const [key, eps] of groups) {
      const base = key.split('(')[0].trim().toLowerCase();
      const st = byGiven.get(key.toLowerCase()) ?? byGiven.get(base) ?? null;
      eps.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      out.push({
        key,
        title: st?.name ?? key,
        student: st,
        episodes: eps,
        lastLine: eps[eps.length - 1]?.summary ?? '',
      });
    }
    out.sort((a, b) => b.episodes.length - a.episodes.length);
    return out;
  }, [assets.storyIndex, assets.students]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return convs.slice(0, 120);
    return convs.filter((c) => c.title.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)).slice(0, 120);
  }, [convs, query]);

  const active = activeKey ? convs.find((c) => c.key === activeKey) ?? null : filtered[0] ?? null;

  const favor = active ? (save.momotalk.favor[active.key] ?? 0) : 0;

  const REPLIES = [
    { text: '「今天也辛苦了，要不要一起去喝杯茶？」', gain: 3 },
    { text: '「你最近的状态看起来不错。」', gain: 2 },
    { text: '「有需要帮忙的地方随时说。」', gain: 1 },
  ];

  return (
    <div className="momo">
      <div className="momo-list">
        <div className="momo-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索学生…"
          />
        </div>
        {filtered.map((c) => {
          const unread = !save.momotalk.read.includes(c.key);
          return (
            <button
              key={c.key}
              className={`momo-chat${active?.key === c.key ? ' on' : ''}`}
              onClick={() => {
                setActiveKey(c.key);
                setReplyIdx(0);
                store.update((d) => {
                  if (!d.momotalk.read.includes(c.key)) d.momotalk.read.push(c.key);
                });
              }}
            >
              {c.student?.avatar ? (
                <img src={c.student.avatar} alt="" loading="lazy" />
              ) : (
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    background: '#dfeaf3',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    color: '#7b8b99',
                    flex: '0 0 42px',
                  }}
                >
                  {c.title.slice(0, 1)}
                </div>
              )}
              <div className="txt">
                <b>{c.title}</b>
                <span>{c.student?.signature || `${c.episodes.length} 段羁绊剧情`}</span>
              </div>
              {unread && <span className="dot" />}
            </button>
          );
        })}
        {filtered.length === 0 && <div className="empty-state">没有匹配的会话</div>}
      </div>

      <div className="momo-room">
        {active ? (
          <>
            <div className="momo-room-head">
              {active.student?.avatar && <img src={active.student.avatar} alt="" />}
              <div style={{ flex: 1 }}>
                <b>{active.title}</b>
                <span>
                  {active.student?.signature || '—'} · 好感度 {favor}
                </span>
              </div>
              <button
                className="btn ghost sm"
                onClick={() => {
                  const first = active.episodes[0];
                  if (!first) return;
                  navState.pendingStoryId = first.id;
                  go('story');
                }}
              >
                打开羁绊剧情
              </button>
            </div>

            <div className="momo-body">
              <NineSlice name="Common/School_Chat_BG" className="msg them">
                {active.student?.intro
                  ? active.student.intro.slice(0, 120)
                  : '老师，今天也辛苦了。'}
              </NineSlice>
              {active.episodes.map((ep, i) => (
                <div key={ep.id} style={{ display: 'contents' }}>
                  <div className="msg narr">羁绊剧情 {i + 1} · {ep.title}</div>
                  <NineSlice name="Common/School_Chat_BG" className="msg them">{ep.summary || '（这段剧情没有摘要）'}</NineSlice>
                </div>
              ))}
              {replyIdx > 0 && (
                <NineSlice name="Common/School_Chat_BG" className="msg me">{REPLIES[(replyIdx - 1) % REPLIES.length]?.text}</NineSlice>
              )}
              {replyIdx > 0 && (
                <NineSlice name="Common/School_Chat_BG" className="msg them">谢谢老师。那……我就先告辞了。</NineSlice>
              )}
            </div>

            <div className="momo-choices">
              {REPLIES.map((r, i) => (
                <NineSlice
                  as="button"
                  name="TBG/Common_Btn_BG"
                  className="choice-btn"
                  onClick={() => {
                    setReplyIdx(i + 1);
                    store.update((d) => {
                      d.momotalk.favor[active.key] = (d.momotalk.favor[active.key] ?? 0) + r.gain;
                    });
                    toast(`好感度 +${r.gain}`);
                  }}
                >
                  {r.text}
                </NineSlice>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">选择一个会话</div>
        )}
      </div>
    </div>
  );
}
