import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navState } from '../core/AppContext';
import { audio } from '../core/audio';
import { loadStoryFile } from '../core/assets';
import { markRead, STORY_CLEAR_REWARD, store, useSave } from '../core/store';
import { NineSlice } from '../components/NineSlice';
import { t } from '../core/i18n';
import type { StoryEntry, StoryFile, StoryOp } from '../types';

type Tab = 'all' | 'main' | 'bond' | 'event' | 'group';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'main', label: '主线' },
  { key: 'bond', label: '羁绊' },
  { key: 'event', label: '活动' },
  { key: 'group', label: '社团' },
];

interface Line {
  speaker: string;
  text: string;
  kind: 'say' | 'info' | 'mark' | 'choice';
}

function opText(n: StoryOp): Line | null {
  if (n.op === 'script') {
    const s = n as Extract<StoryOp, { op: 'script' }>;
    return { speaker: s.speaker, text: s.text, kind: 'say' };
  }
  if (n.op === 'info') return { speaker: '', text: (n as { text: string }).text, kind: 'info' };
  // wiki 不记录分支拓扑，只有「此处有选项」这个事实。
  // 对话框里说明情况，选项按钮上的文案由渲染层给（见 choice-overlay）。
  if (n.op === 'choice')
    return {
      speaker: '',
      text: '（此处存在对话选项，wiki 仅记录单条通关路径）',
      kind: 'choice',
    };
  if (n.op === 'memlobby')
    return { speaker: '', text: '★ 此处解锁该学生的回忆大厅', kind: 'mark' };
  if (n.op === 'popup') return { speaker: '', text: '（剧情插图）', kind: 'mark' };
  return null;
}

export default function StoryPage() {
  const { assets, toast } = useApp();
  const save = useSave();

  const [tab, setTab] = useState<Tab>('main');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StoryEntry | null>(null);
  const [file, setFile] = useState<StoryFile | null>(null);
  const [idx, setIdx] = useState(-1);
  const [line, setLine] = useState<Line | null>(null);
  const [bgName, setBgName] = useState('');
  const [bgmName, setBgmName] = useState('');
  const [history, setHistory] = useState<Line[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [typed, setTyped] = useState(0);
  const [ended, setEnded] = useState(false);

  const typingRef = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.storyIndex
      .filter((s) => tab === 'all' || s.type === tab)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 400);
  }, [assets.storyIndex, tab, query]);

  const fullText = line?.text ?? '';
  const isTyping = typed < fullText.length;

  // 打字机
  useEffect(() => {
    if (typingRef.current) window.clearInterval(typingRef.current);
    if (!line) return;
    setTyped(0);
    if (skip) {
      setTyped(fullText.length);
      return;
    }
    const stepMs = Math.max(8, Math.round(1000 / Math.max(save.settings.textSpeed, 1)));
    typingRef.current = window.setInterval(() => {
      setTyped((t) => {
        if (t >= fullText.length) {
          if (typingRef.current) window.clearInterval(typingRef.current);
          return t;
        }
        return t + 1;
      });
    }, stepMs);
    return () => {
      if (typingRef.current) window.clearInterval(typingRef.current);
    };
  }, [line, fullText, save.settings.textSpeed, skip]);

  /** 从 start 开始沿 dir 扫描，执行副作用直到遇到可显示的节点 */
  const scan = useCallback(
    (f: StoryFile, start: number, dir: 1 | -1, silent = false): { index: number; line: Line | null; bg: string; bgm: string } => {
      let i = start;
      let bg = '';
      let bgm = '';
      while (i >= 0 && i < f.nodes.length) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') bg = (n as { bg: string }).bg;
        else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
        else if (n.op === 'se' && !silent) audio.playSe((n as { id: string }).id);
        else {
          const l = opText(n);
          if (l) return { index: i, line: l, bg, bgm };
        }
        i += dir;
      }
      return { index: -1, line: null, bg, bgm };
    },
    []
  );

  const applyNode = useCallback(
    (f: StoryFile, target: number, dir: 1 | -1) => {
      // 先静默重放到目标前一格，重建背景与 BGM
      let bg = '';
      let bgm = '';
      for (let i = 0; i < target; i++) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') bg = (n as { bg: string }).bg;
        else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
      }
      const r = scan(f, target, dir);
      const finalBg = r.bg || bg;
      const finalBgm = r.bgm || bgm;
      setBgName(finalBg);
      setBgmName(finalBgm);
      if (finalBgm) audio.playBgm(finalBgm);
      else audio.stopBgm();

      if (r.index === -1 || !r.line) {
        setEnded(true);
        setIdx(f.nodes.length);
        if (target >= f.nodes.length && f.story_id) {
          const id = f.story_id;
          if (!save.story.cleared.includes(id)) {
            store.update((d) => {
              d.story.cleared.push(id);
              d.currency.pyroxene += STORY_CLEAR_REWARD;
            });
            toast(`首次通关 +${STORY_CLEAR_REWARD} 青辉石`);
          }
        }
        return;
      }
      setEnded(false);
      setIdx(r.index);
      setLine(r.line);
      setHistory((h) => [...h.slice(-300), r.line as Line]);
      store.update((d) => {
        markRead(d, f.story_id, r.index);
        d.story.progress[f.story_id] = r.index;
      });
    },
    [scan, save.story.cleared, toast]
  );

  const openStory = useCallback(
    async (entry: StoryEntry) => {
      setSelected(entry);
      setLine(null);
      setHistory([]);
      setEnded(false);
      try {
        const f = await loadStoryFile(entry.path);
        setFile(f);
        const start = save.story.progress[entry.id] ?? 0;
        applyNode(f, Math.min(start, f.nodes.length - 1), 1);
      } catch (e) {
        toast(`剧情加载失败：${e instanceof Error ? e.message : e}`);
      }
    },
    [applyNode, save.story.progress, toast]
  );

  const advance = useCallback(() => {
    if (!file) return;
    if (isTyping) {
      setTyped(fullText.length);
      return;
    }
    if (ended) return;
    const next = idx + 1;
    if (next >= file.nodes.length) {
      setEnded(true);
      return;
    }
    applyNode(file, next, 1);
  }, [file, idx, isTyping, fullText.length, ended, applyNode]);

  // 自动 / 快进
  useEffect(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    if (!auto || !file || ended || showHistory) return;
    if (isTyping) return;
    autoTimer.current = window.setTimeout(() => {
      advance();
    }, save.settings.autoDelay);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, [auto, file, ended, isTyping, idx, advance, save.settings.autoDelay, showHistory]);

  // 快进只跳已读节点
  useEffect(() => {
    if (!skip || !file || ended) return;
    const t = window.setTimeout(() => {
      const next = idx + 1;
      const node = file.nodes[next];
      if (!node) {
        setSkip(false);
        setEnded(true);
        return;
      }
      const l = opText(node);
      if (!l) {
        applyNode(file, next, 1);
        return;
      }
      const read = save.story.read[file.story_id]?.includes(next) ?? false;
      if (read || save.settings.skipUnread) applyNode(file, next, 1);
      else {
        setSkip(false);
        toast('遇到未读内容，已自动停止快进');
      }
    }, 90);
    return () => window.clearTimeout(t);
  }, [skip, file, idx, ended, applyNode, save.story.read, save.settings.skipUnread, toast]);

  useEffect(() => {
    return () => {
      audio.stopBgm();
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, []);

  // 消费来自桃信 / 活动页的跳转参数
  useEffect(() => {
    if (navState.pendingStoryId) {
      const entry = assets.storyIndex.find((s) => s.id === navState.pendingStoryId);
      navState.pendingStoryId = null;
      if (entry) {
        setTab(entry.type);
        void openStory(entry);
      }
      return;
    }
    if (navState.pendingStoryQuery) {
      setTab('all');
      setQuery(navState.pendingStoryQuery);
      navState.pendingStoryQuery = null;
    }
  }, [assets.storyIndex, openStory]);

  const bgUrl = bgName ? assets.bg(bgName) : null;
  const speakerStudent = line?.kind === 'say' ? assets.studentByName.get(line.speaker.toLowerCase()) : undefined;

  return (
    <div className="story-layout">
      <div className="story-side">
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索剧集标题…"
          style={{
            padding: '8px 13px',
            borderRadius: 9,
            border: '1px solid var(--line)',
            outline: 'none',
            background: '#fff',
          }}
        />
        <div className="muted" style={{ fontSize: 11.5 }}>
          共 {assets.storyIndex.filter((s) => tab === 'all' || s.type === tab).length} 集，显示前{' '}
          {list.length} 条
        </div>
        <div className="story-list">
          {list.map((s) => {
            const cleared = save.story.cleared.includes(s.id);
            return (
              <button
                key={s.id}
                className={`story-item${selected?.id === s.id ? ' on' : ''}`}
                onClick={() => void openStory(s)}
              >
                <b>{s.title}</b>
                <span>
                  {cleared && <span className="cleared">已通关 · </span>}
                  {s.lines} 句 · {s.id.replace(/_/g, ' ').slice(0, 46)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="player">
        <div className="player-stage" onClick={advance}>
          <div
            className={`player-bg${bgUrl ? '' : ' missing'}`}
            data-name={bgName ? `素材缺失：${bgName}` : ''}
            style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
          />

          {!file && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: '#7f9cb3',
                fontSize: 13,
                letterSpacing: 2,
              }}
            >
              从左侧选择一集剧情开始播放
            </div>
          )}

          {file && line?.kind === 'choice' && (
            <div className="choice-overlay">
              <NineSlice
                as="button"
                name="TBG/Common_Btn_BG"
                className="choice-btn"
                onClick={() => advance()}
              >
                {t('story.choice')}
              </NineSlice>
            </div>
          )}

          {file && line && (
            <div className="player-dialog" data-ui-source="estimated">
              {line.kind === 'say' && (
                <span className="speaker">{line.speaker}</span>
              )}
              {line.kind !== 'say' && (
                <span className="speaker info">
                  {line.kind === 'mark' ? '提示' : line.kind === 'choice' ? '选项' : '旁白'}
                </span>
              )}
              <div className="text">
                {fullText.slice(0, typed)}
                {isTyping ? '' : ''}
              </div>
              {!isTyping && !ended && <span className="next">▼ 点击继续</span>}
              {speakerStudent?.avatar && line.kind === 'say' && (
                <img
                  src={speakerStudent.avatar}
                  alt=""
                  style={{
                    position: 'absolute',
                    right: 26,
                    top: -54,
                    width: 62,
                    height: 62,
                    borderRadius: '50%',
                    border: '2px solid rgba(143,216,242,0.7)',
                    objectFit: 'cover',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
                  }}
                />
              )}
            </div>
          )}

          {file && ended && (
            <div className="choice-box">
              <div
                style={{
                  background: 'rgba(10,24,38,0.9)',
                  color: '#dff0fb',
                  padding: '22px 26px',
                  borderRadius: 12,
                  textAlign: 'center',
                }}
              >
                <b style={{ fontSize: 16, letterSpacing: 2 }}>本集结束</b>
                <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    className="btn sm"
                    onClick={() => {
                      setEnded(false);
                      setIdx(-1);
                      setLine(null);
                      setHistory([]);
                      applyNode(file, 0, 1);
                    }}
                  >
                    重播
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setFile(null);
                      setSelected(null);
                      setLine(null);
                      audio.stopBgm();
                    }}
                  >
                    返回列表
                  </button>
                </div>
              </div>
            </div>
          )}

          {showHistory && (
            <div className="history-panel" onClick={() => setShowHistory(false)}>
              <h4>对话回看（点击关闭）</h4>
              {history.length === 0 && <div className="muted">还没有记录</div>}
              {history.map((h, i) => (
                <div className="history-row" key={i}>
                  {h.kind === 'say' && <b>{h.speaker}</b>}
                  {h.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="player-bar">
          <button onClick={() => setShowHistory((v) => !v)}>回看</button>
          <button
            className={auto ? 'on' : ''}
            onClick={() => {
              setAuto((v) => !v);
              setSkip(false);
            }}
          >
            自动
          </button>
          <button
            className={skip ? 'on' : ''}
            onClick={() => {
              setSkip((v) => !v);
              setAuto(false);
            }}
          >
            快进
          </button>
          <button
            onClick={() => {
              if (!file) return;
              const target = Math.max(0, idx - 1);
              applyNode(file, target, -1);
            }}
          >
            上一句
          </button>
          <button onClick={advance}>下一句</button>
          <div className="spacer" />
          <span style={{ opacity: 0.65 }}>{bgmName ? `BGM ${bgmName}` : '无 BGM'}</span>
          <div className="progress" title="进度">
            <i
              style={{
                width: file && idx >= 0 ? `${Math.min(100, ((idx + 1) / file.nodes.length) * 100)}%` : '0%',
              }}
            />
          </div>
          <span style={{ opacity: 0.65, minWidth: 62, textAlign: 'right' }}>
            {file && idx >= 0 ? `${idx + 1} / ${file.nodes.length}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
