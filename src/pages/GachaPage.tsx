import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NineSlice } from '../components/NineSlice';
import { useApp, navState } from '../core/AppContext';
import { store, useSave, PULL_COST } from '../core/store';
import {
  bannerIsLimited,
  buildPool,
  pullOne,
  pullTen,
  PITY,
  type PullResult,
} from '../core/gacha/engine';
import type { Banner } from '../types';

const TYPE_LABEL: Record<string, string> = {
  normal: '常驻',
  limited: '限定',
  rerun: '复刻',
  fes: 'FES',
  starter: '新手',
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

export default function GachaPage() {
  const { assets, toast } = useApp();
  const save = useSave();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [selected, setSelected] = useState<Banner | null>(null);
  const [results, setResults] = useState<PullResult[]>([]);
  const [revealAll, setRevealAll] = useState(true);
  const resultsRef = useRef<HTMLDivElement>(null);

  const banners = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.banners
      .filter((b) => (!typeFilter || b.type === typeFilter))
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.up.toLowerCase().includes(q))
      .slice()
      .reverse()
      .slice(0, 300);
  }, [assets.banners, query, typeFilter]);

  // 从活动页跳过来时定位到指定卡池
  useEffect(() => {
    if (navState.pendingBannerId == null) return;
    const target = assets.banners.find((b) => b.id === navState.pendingBannerId);
    navState.pendingBannerId = null;
    if (target) {
      setSelected(target);
      setQuery('');
      setTypeFilter('');
    }
  }, [assets.banners]);

  const banner = selected ?? banners[0] ?? null;
  const pool = useMemo(() => buildPool(assets.students), [assets.students]);

  const mode = save.gacha.mode;
  const limited = banner ? bannerIsLimited(banner) : false;
  const pityNow = mode === 'classic' ? save.gacha.classicPoints : limited ? save.gacha.chargeLimited : save.gacha.chargeNormal;
  const pityMax = mode === 'classic' ? PITY.CLASSIC_SPARK : PITY.CHARGE_HARD;

  const doPull = useCallback(
    (times: 1 | 10) => {
      if (!banner) return;
      const cost = PULL_COST * times;
      if (save.currency.pyroxene < cost) {
        toast(`青辉石不足（需要 ${cost}）`);
        return;
      }
      const state = {
        classicPoints: save.gacha.classicPoints,
        chargeNormal: save.gacha.chargeNormal,
        chargeLimited: save.gacha.chargeLimited,
      };
      const ctx = { mode, limited, upName: banner.up || null };

      let out: PullResult[];
      if (times === 1) {
        out = [pullOne(state, ctx, pool)];
      } else {
        out = pullTen(state, ctx, pool);
      }

      const stamp = Date.now();
      store.update((d) => {
        d.currency.pyroxene -= cost;
        d.gacha.classicPoints = state.classicPoints;
        d.gacha.chargeNormal = state.chargeNormal;
        d.gacha.chargeLimited = state.chargeLimited;
        for (const r of out) {
          d.gacha.history.unshift({
            at: stamp,
            bannerId: banner.id,
            bannerTitle: banner.title,
            star: r.star,
            name: r.name,
            isUp: r.isUp,
            pity: r.pityAfter,
          });
          d.gacha.owned[r.name] = (d.gacha.owned[r.name] ?? 0) + 1;
        }
        if (d.gacha.history.length > 800) d.gacha.history.length = 800;
      });

      setResults(out);
      setRevealAll(times === 1);
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    },
    [banner, limited, mode, pool, save.currency.pyroxene, save.gacha, toast]
  );

  const exportHistory = () => {
    const blob = new Blob([JSON.stringify(save.gacha.history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gacha-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('抽卡记录已导出');
  };

  return (
    <div className="gacha-layout">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索卡池 / UP 角色…"
          style={{
            padding: '8px 13px',
            borderRadius: 9,
            border: '1px solid var(--line)',
            outline: 'none',
            background: '#fff',
          }}
        />
        <div className="seg">
          {[
            { k: '', l: '全部' },
            { k: 'limited', l: '限定' },
            { k: 'rerun', l: '复刻' },
            { k: 'fes', l: 'FES' },
            { k: 'normal', l: '常驻' },
          ].map((t) => (
            <button
              key={t.k}
              className={typeFilter === t.k ? 'on' : ''}
              onClick={() => setTypeFilter(t.k)}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          收录 {assets.banners.length} 个历史卡池
        </div>
        <div className="banner-list">
          {banners.map((b) => (
            <button
              key={b.id}
              className={`banner-item${banner?.id === b.id ? ' on' : ''}`}
              onClick={() => setSelected(b)}
            >
              <b>{b.title}</b>
              <div className="meta">
                <span className={`tag ${b.type}`}>{TYPE_LABEL[b.type] ?? b.type}</span>
                <span>{b.server}</span>
                <span>{fmtDate(b.start)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="gacha-main">
        {banner ? (
          <div className="banner-hero">
            {banner.image && <img src={banner.image} alt="" />}
            <h3>{banner.title}</h3>
            <p>{banner.summary || '（该卡池没有公告摘要）'}</p>
            <div className="up">
              当期 UP：<b>{banner.up || '未标注（按无 UP 处理）'}</b>
              <span style={{ marginLeft: 14, opacity: 0.8 }}>
                {fmtDate(banner.start)} ~ {fmtDate(banner.end)}
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-state">没有匹配的卡池</div>
        )}

        <div className="pity-row">
          <div className="pity-card">
            <span>保底模式</span>
            <b style={{ fontSize: 16 }}>
              {mode === 'classic' ? '经典 200 抽天井' : '充能（100 / 200）'}
            </b>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {mode === 'classic'
                ? '歪出 UP 不清零，可跨池继承'
                : `${limited ? '限定池' : '一般池'}充能，出 UP 即归零`}
            </div>
          </div>
          <div className="pity-card">
            <span>当前计数</span>
            <b>
              {pityNow} <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>/ {pityMax}</span>
            </b>
            <div className="pity-bar">
              <i style={{ width: `${Math.min(100, (pityNow / pityMax) * 100)}%` }} />
            </div>
          </div>
          <div className="pity-card">
            <span>持有青辉石</span>
            <b>{save.currency.pyroxene.toLocaleString()}</b>
            <div className="muted" style={{ fontSize: 11.5 }}>
              单抽 {PULL_COST} / 十连 {PULL_COST * 10}
            </div>
          </div>
        </div>

        <div className="pull-actions">
          <button className="btn" disabled={!banner} onClick={() => doPull(1)}>
            招募 1 次
          </button>
          <button className="btn" disabled={!banner} onClick={() => doPull(10)}>
            招募 10 次
          </button>
          <button
            className="btn ghost"
            onClick={() =>
              store.update((d) => {
                d.gacha.mode = d.gacha.mode === 'classic' ? 'charge' : 'classic';
              })
            }
          >
            切换到{mode === 'classic' ? '充能' : '经典'}模式
          </button>
        </div>

        <div ref={resultsRef}>
          {results.length > 0 && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <b style={{ fontSize: 13.5 }}>本次结果</b>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!revealAll && (
                    <button className="btn ghost sm" onClick={() => setRevealAll(true)}>
                      全部翻开
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => setResults([])}>
                    清空
                  </button>
                </div>
              </div>
              <div className="result-grid">
                {results.map((r, i) => (
                  <NineSlice
                    key={i}
                    name="Dreammaker/Common_Bg_Raius10px"
                    className={`result-card s${r.star}`}
                    style={{ animationDelay: revealAll ? `${i * 60}ms` : '0ms' }}
                  >
                    <div className="frame">{r.star}★</div>
                    {r.isUp && <span className="badge">UP</span>}
                    <div className="info" title={r.name}>
                      {r.name}
                    </div>
                  </NineSlice>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <b style={{ fontSize: 13.5 }}>抽卡记录（最近 800 条）</b>
            <button className="btn ghost sm" onClick={exportHistory} disabled={save.gacha.history.length === 0}>
              导出 JSON
            </button>
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>卡池</th>
                  <th>结果</th>
                  <th>UP</th>
                  <th>计数</th>
                </tr>
              </thead>
              <tbody>
                {save.gacha.history.slice(0, 200).map((h, i) => (
                  <tr key={i}>
                    <td className="muted">{new Date(h.at).toLocaleString('zh-CN')}</td>
                    <td title={h.bannerTitle}>{h.bannerTitle.slice(0, 18)}</td>
                    <td>
                      <span style={{ color: h.star === 3 ? '#c98a00' : h.star === 2 ? '#8a5fc0' : '#7d8b99' }}>
                        {h.star}★
                      </span>{' '}
                      {h.name}
                    </td>
                    <td>{h.isUp ? '✓' : ''}</td>
                    <td className="muted">{h.pity}</td>
                  </tr>
                ))}
                {save.gacha.history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 22 }}>
                      还没有抽卡记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
