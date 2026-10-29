import { useMemo, useState } from 'react';
import { useApp, navState } from '../core/AppContext';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

export default function EventsPage({ onGo }: { onGo: (v: 'gacha' | 'story') => void }) {
  const { assets } = useApp();
  const [server, setServer] = useState<string>('CN');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(120);

  const servers = useMemo(() => {
    const s = new Set(assets.events.map((e) => e.server));
    return [...s].sort();
  }, [assets.events]);

  /** 同名活动出现多次即视为复刻 */
  const rerunCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of assets.events) m.set(e.title, (m.get(e.title) ?? 0) + 1);
    return m;
  }, [assets.events]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.events
      .filter((e) => !server || e.server === server)
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.start - a.start)
      .slice(0, limit);
  }, [assets.events, server, query, limit]);

  return (
    <div className="events-wrap">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="seg" style={{ width: 'auto' }}>
          <button className={server === '' ? 'on' : ''} onClick={() => setServer('')}>
            全部服
          </button>
          {servers.map((s) => (
            <button key={s} className={server === s ? 'on' : ''} onClick={() => setServer(s)}>
              {s}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索活动…"
          style={{
            padding: '8px 14px',
            borderRadius: 9,
            border: '1px solid var(--line)',
            outline: 'none',
            background: '#fff',
            minWidth: 240,
          }}
        />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>
          收录 {assets.events.length} 条活动记录
        </span>
      </div>

      <div className="timeline">
        {rows.map((e) => {
          const rerun = (rerunCount.get(e.title) ?? 1) > 1;
          const bannerInWindow = assets.banners.find(
            (b) => Math.abs(b.start - e.start) < 3600 * 24 * 10 && b.type !== 'normal'
          );
          return (
            <div className="event-row" key={`${e.id}-${e.server}`}>
              <h4>{e.title}</h4>
              <div className="sub">
                <span className={`tag ${rerun ? 'rerun' : ''}`}>{rerun ? '已复刻 / 多次举办' : '初回'}</span>
                <span>{e.server} 服</span>
                <span>
                  {fmt(e.start)} ~ {fmt(e.end)}
                </span>
              </div>
              {e.summary && (
                <div
                  className="muted"
                  style={{ fontSize: 12.5, marginTop: 7, lineHeight: 1.65, maxWidth: 900 }}
                >
                  {e.summary.slice(0, 150)}
                </div>
              )}
              <div className="event-actions">
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    navState.pendingStoryId = null;
                    navState.pendingStoryQuery = e.title.replace(/[【】「」]/g, ' ').slice(0, 12);
                    onGo('story');
                  }}
                >
                  查找相关剧情
                </button>
                {bannerInWindow && (
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      navState.pendingBannerId = bannerInWindow.id;
                      onGo('gacha');
                    }}
                  >
                    同期卡池：{bannerInWindow.title.replace(/^.*?卡池/, '').replace(/[「」【】]/g, '').slice(0, 16)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rows.length >= limit && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn ghost" onClick={() => setLimit((l) => l + 120)}>
            加载更多
          </button>
        </div>
      )}
      {rows.length === 0 && <div className="empty-state">没有匹配的活动</div>}
    </div>
  );
}
