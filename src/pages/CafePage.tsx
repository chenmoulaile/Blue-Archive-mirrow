import { useMemo, useState } from 'react';
import { useApp } from '../core/AppContext';
import { cafeIncome, store, useSave } from '../core/store';

export default function CafePage() {
  const { assets, toast } = useApp();
  const save = useSave();
  const [tab, setTab] = useState<'shop' | 'visitors'>('shop');
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(assets.furniture.map((f) => [f.id, f])), [assets.furniture]);

  const placed = save.cafe.placed.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const comfort = placed.reduce((a, f) => a + f.comfort, 0);

  const { amount } = cafeIncome(comfort, Date.now() - save.cafe.lastCollect);

  const shopList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.furniture
      .filter((f) => f.comfort > 0)
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice(0, 240);
  }, [assets.furniture, query]);

  const visitors = useMemo(() => {
    const ids = new Set<number>();
    for (const f of placed) for (const id of f.liked_by) ids.add(id);
    return [...ids]
      .map((id) => assets.studentById.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s && !s.is_npc)
      .slice(0, 12);
  }, [placed, assets.studentById]);

  const add = (id: number) => {
    if (save.cafe.placed.includes(id)) {
      toast('这件家具已经摆好了');
      return;
    }
    store.update((d) => {
      d.cafe.placed.push(id);
    });
  };

  const remove = (id: number) => {
    store.update((d) => {
      d.cafe.placed = d.cafe.placed.filter((x) => x !== id);
    });
  };

  return (
    <div className="cafe-layout">
      <div className="cafe-floor">
        <div className="cafe-room">
          {placed.length === 0 ? (
            <div className="empty-state" style={{ color: '#8a7f6a' }}>
              还没有摆放家具。右侧挑几件，舒适度越高，青辉石产出越快。
            </div>
          ) : (
            <div className="cafe-grid">
              {placed.map((f) => (
                <div className="furni" key={f.id} title={`${f.name} · 舒适度 ${f.comfort}`}>
                  {f.icon ? <img src={f.icon} alt={f.name} loading="lazy" /> : <span>{f.name}</span>}
                  <button className="rm" onClick={() => remove(f.id)} title="收起">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cafe-hud">
          <div>
            舒适度 <b>{comfort.toLocaleString()}</b>
          </div>
          <div>
            每小时产出 <b>{Math.floor(comfort / 12)}</b> 青辉石
          </div>
          <div>
            待收取 <b style={{ color: amount > 0 ? '#2e7d32' : undefined }}>{amount}</b>
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm"
            disabled={amount <= 0}
            onClick={() => {
              store.update((d) => {
                d.currency.pyroxene += amount;
                d.cafe.lastCollect = Date.now();
              });
              toast(`收取 ${amount} 青辉石`);
            }}
          >
            收取收益
          </button>
        </div>
      </div>

      <div className="cafe-side">
        <div className="panel">
          <h4>舒适度与收益</h4>
          <div style={{ fontSize: 12.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>
            已摆放 {placed.length} 件家具，舒适度合计 {comfort.toLocaleString()}。
            <br />
            产出速率 = 舒适度 ÷ 12 每小时，最多累积 12 小时。
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                className="btn ghost sm"
                onClick={() => {
                  const top = assets.furniture
                    .filter((f) => f.comfort > 0)
                    .slice(0, 12)
                    .map((f) => f.id);
                  store.update((d) => {
                    d.cafe.placed = top;
                  });
                  toast('已按舒适度摆放 12 件家具');
                }}
              >
                一键布置
              </button>
              <button
                className="btn ghost sm"
                onClick={() =>
                  store.update((d) => {
                    d.cafe.placed = [];
                  })
                }
              >
                全部收起
              </button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="seg" style={{ marginBottom: 10 }}>
            <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>
              家具库
            </button>
            <button className={tab === 'visitors' ? 'on' : ''} onClick={() => setTab('visitors')}>
              来访学生 {visitors.length > 0 ? `(${visitors.length})` : ''}
            </button>
          </div>

          {tab === 'shop' ? (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索家具…"
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  outline: 'none',
                  marginBottom: 10,
                }}
              />
              <div className="shop-list" style={{ flex: 1 }}>
                {shopList.map((f) => (
                  <button
                    key={f.id}
                    className="shop-item"
                    title={`${f.name} · 舒适度 ${f.comfort}`}
                    onClick={() => add(f.id)}
                  >
                    {f.icon ? <img src={f.icon} alt={f.name} loading="lazy" /> : <span>?</span>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ overflow: 'auto', flex: 1 }}>
              {visitors.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5, padding: '18px 0' }}>
                  摆上学生喜欢的家具，她们就会来咖啡厅坐坐。
                </div>
              )}
              {visitors.map((s) => (
                <div className="visitor-row" key={s.id}>
                  {s.avatar ? <img src={s.avatar} alt="" /> : <span>·</span>}
                  <div style={{ flex: 1 }}>
                    <b>{s.name}</b>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {s.signature || '—'}
                    </div>
                  </div>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      store.update((d) => {
                        d.currency.pyroxene += 20;
                      });
                      toast(`和 ${s.name} 聊了两句，+20 青辉石`);
                    }}
                  >
                    搭话
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
