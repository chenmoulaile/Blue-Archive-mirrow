import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GachaCutscene } from '../components/gacha/GachaCutscene';
import { useApp, navState } from '../core/AppContext';
import { store, useSave, PULL_COST, DAILY_PYROXENE } from '../core/store';
import {
  bannerIsLimited,
  buildPool,
  pullOne,
  pullTen,
  PITY,
  RATES,
  MILESTONE_PULLS,
  resolvePullCost,
  hitMilestones,
  type PullResult,
  type PullContext,
  type PullCost,
} from '../core/gacha/engine';
import type { Banner, Student } from '../types';
import '../styles/gacha-cutscene.css';

/**
 * 招募页 —— 对照 BA 真机招募布局：全屏卡池横幅 + 底部招募按钮 + 右上详情。
 * 保底 / 天井 / UP / 概率 / 抽卡记录收进「招募详情」覆盖层（三 Tab）。
 * 货币图标用官方切片 extra2/Gem_Blue_1.png（青辉石）与 extra2/Ticket_1.png（招募券）。
 */

/** 演出覆盖层的状态（一次抽取一份） */
interface Cutscene {
  results: PullResult[];
  times: 1 | 10;
  plana: boolean;
  newStar3: Student | null;
  /** 本批「首次获得」的学生名（对照抽取前 owned 快照），结果页 NEW 徽标用 */
  newNames: string[];
  bannerTitle: string;
  /** 本次消耗（C-2：招募券 / 十连券 / 青辉石 / 混合） */
  cost: PullCost | null;
}

/** data/fes_pool.json 的形状（FES 学生名单 + 二星 UP 池配置） */
interface FesPoolFile {
  fesStudents: { id: number; name: string }[];
  star2UpPools: Record<string, string[]>;
}

/** banner.up 支持多角色（真机双 UP 各占 0.7%）：按常见分隔符拆分 */
function parseUpNames(up: string | undefined | null): string[] {
  if (!up) return [];
  return up
    .split(/[、,，/／&＋+·]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function costLabel(c: PullCost): string {
  if (c.costType === 'ten-ticket') return '十连券×1';
  if (c.costType === 'ticket') return `招募券×${c.ticketsUsed}`;
  if (c.costType === 'mixed') return `招募券×${c.ticketsUsed} + 青辉石×${c.pyroxene.toLocaleString()}`;
  return `青辉石×${c.pyroxene.toLocaleString()}`;
}

/** 测试补给水位：与设置页「一键补给（测试用）」一致 */
const SUPPLY_PYROXENE = 120_000;
const SUPPLY_CREDIT = 5_000_000;

const TYPE_LABEL: Record<string, string> = {
  normal: '常驻',
  limited: '限定',
  rerun: '复刻',
  fes: 'FES',
  starter: '新手',
};

const GEM_ICON = '/res/ui/extra2/Gem_Blue_1.png';
const TICKET_ICON = '/res/ui/extra2/Ticket_1.png';

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
  const [cut, setCut] = useState<Cutscene | null>(null);
  const [cutSeq, setCutSeq] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'pity' | 'log'>('info');
  const [showPoolList, setShowPoolList] = useState(false);
  /** 余额不足时的待重试抽取：补给按钮（测试用）点击后自动重放 */
  const [needSupply, setNeedSupply] = useState<{ cost: number; times: 1 | 10 } | null>(null);
  /** 本次消耗（结果抽屉与记录表标注用，C-2） */
  const [lastCost, setLastCost] = useState<PullCost | null>(null);
  /** FES 学生名单 + 二星 UP 池配置（data/fes_pool.json；缺失时引擎退化为整池均匀） */
  const [fesPool, setFesPool] = useState<FesPoolFile | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/data/fes_pool.json')
      .then((r) => (r.ok ? (r.json() as Promise<FesPoolFile>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (live) setFesPool(j);
      })
      .catch(() => {
        /* 名单缺失按无常驻分层处理，不阻塞招募 */
      });
    return () => {
      live = false;
    };
  }, []);

  const studentById = useMemo(() => new Map(assets.students.map((s) => [s.id, s])), [assets.students]);
  const studentOf = useCallback(
    (r: PullResult): Student | null => (r.studentId != null ? studentById.get(r.studentId) ?? null : null),
    [studentById]
  );

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

  // 当期 UP 学生头像（找不到就只显示名字）
  const upStudent = useMemo(
    () => (banner?.up ? assets.students.find((s) => s.name === banner.up) ?? null : null),
    [assets.students, banner]
  );

  // ------------------------------------------------ 抽取
  const upNames = useMemo(() => parseUpNames(banner?.up), [banner?.up]);
  const isFes = banner?.type === 'fes';
  const isStarter = banner?.type === 'starter';
  const fesStudentIds = useMemo(() => (fesPool?.fesStudents ?? []).map((s) => s.id), [fesPool]);
  const star2UpNames = useMemo(
    () => (banner ? fesPool?.star2UpPools?.[String(banner.id)] : undefined),
    [banner, fesPool]
  );

  const doPull = useCallback(
    (times: 1 | 10) => {
      if (!banner) return;
      // C-2 消耗优先级：单抽优先扣一张招募券，十连优先扣一张十连券；
      // 券不足部分按每抽 120 青辉石扣，仍不足才走余额不足分支。
      const cost = resolvePullCost(
        times,
        { tickets: save.currency.tickets ?? 0, tenTickets: save.currency.tenTickets },
        save.currency.pyroxene
      );
      if (!cost.enough) {
        toast(`青辉石不足（券抵扣后本次还需 ${cost.pyroxene}）`);
        setNeedSupply({ cost: cost.pyroxene, times });
        return;
      }
      const state = {
        classicPoints: save.gacha.classicPoints,
        chargeNormal: save.gacha.chargeNormal,
        chargeLimited: save.gacha.chargeLimited,
      };
      const ctx: PullContext = {
        mode,
        limited,
        upName: banner.up || null,
        upNames,
        fes: isFes,
        fesStudentIds,
        star2UpNames,
        starter: isStarter,
      };

      let out: PullResult[];
      if (times === 1) {
        out = [pullOne(state, ctx, pool)];
      } else {
        out = pullTen(state, ctx, pool);
      }

      const stamp = Date.now();
      // 抽取前的持有表快照，用于判断「新获得的 ★3」（进揭示幕）；只读，不影响保底逻辑
      const ownedBefore = save.gacha.owned;
      const totalPullsBefore = save.gacha.totalPulls ?? 0;
      const milestonesHit = hitMilestones(totalPullsBefore, out.length);
      store.update((d) => {
        d.currency.tickets = (d.currency.tickets ?? 0) - cost.ticketsUsed;
        d.currency.tenTickets = (d.currency.tenTickets ?? 0) - cost.tenTicketsUsed;
        d.currency.pyroxene -= cost.pyroxene;
        d.gacha.classicPoints = state.classicPoints;
        d.gacha.chargeNormal = state.chargeNormal;
        d.gacha.chargeLimited = state.chargeLimited;
        // C-12 里程碑返利：按累计抽数记录（限时十连券先记录不发券，文案见招募详情）
        d.gacha.totalPulls = totalPullsBefore + out.length;
        if (milestonesHit.length > 0) {
          d.gacha.milestones = { ...(d.gacha.milestones ?? {}) };
          for (const h of milestonesHit) d.gacha.milestones[String(h.pulls)] = 'recorded';
        }
        for (const r of out) {
          d.gacha.history.unshift({
            at: stamp,
            bannerId: banner.id,
            bannerTitle: banner.title,
            star: r.star,
            name: r.name,
            isUp: r.isUp,
            pity: r.pityAfter,
            costType: cost.costType,
          });
          d.gacha.owned[r.name] = (d.gacha.owned[r.name] ?? 0) + 1;
        }
        if (d.gacha.history.length > 800) d.gacha.history.length = 800;
      });

      const fresh = out.find((r) => r.star === 3 && !(ownedBefore[r.name] > 0));
      // NEW 徽标名单（2026-11-09 走查②）：抽取前 owned 里没有的就是首次获得
      const newNames = out
        .filter((r) => !(ownedBefore[r.name] > 0))
        .map((r) => r.name);
      setResults(out);
      setLastCost(cost);
      setNeedSupply(null);
      setCut({
        results: out,
        times,
        plana: limited,
        newStar3: fresh ? studentById.get(fresh.studentId ?? -1) ?? null : null,
        newNames,
        bannerTitle: banner.title,
        cost,
      });
      setCutSeq((n) => n + 1);
    },
    [
      banner,
      limited,
      mode,
      pool,
      upNames,
      isFes,
      isStarter,
      fesStudentIds,
      star2UpNames,
      save.currency.tickets,
      save.currency.tenTickets,
      save.currency.pyroxene,
      save.gacha,
      studentById,
      toast,
    ]
  );

  // 补给（测试用）：补足到固定水位（幂等），余额到位后自动重放刚才未成的抽取
  const supplyCurrency = useCallback(() => {
    store.update((d) => {
      d.currency.pyroxene = Math.max(d.currency.pyroxene, SUPPLY_PYROXENE);
      d.currency.credit = Math.max(d.currency.credit ?? 0, SUPPLY_CREDIT);
    });
    toast(`已补给 ${SUPPLY_PYROXENE.toLocaleString()} 青辉石（测试用），继续招募`);
  }, [toast]);

  useEffect(() => {
    if (!needSupply) return;
    if (save.currency.pyroxene >= needSupply.cost) {
      const { times } = needSupply;
      setNeedSupply(null);
      doPull(times);
    }
  }, [needSupply, save.currency.pyroxene, doPull]);

  const stepBanner = useCallback(
    (dir: 1 | -1) => {
      if (banners.length === 0) return;
      const idx = banner ? banners.findIndex((b) => b.id === banner.id) : -1;
      const next = banners[(idx + dir + banners.length) % banners.length];
      if (next) setSelected(next);
    },
    [banners, banner]
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
    <div className="gacha-page">
      {/* 顶部：类型筛选 + 卡池一览 */}
      <div className="gacha-topbar">
        <div className="seg gacha-type-seg">
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
        <button className="btn ghost sm" onClick={() => setShowPoolList(true)}>
          卡池一览（{banners.length}）
        </button>
      </div>

      {/* 全屏卡池横幅 */}
      <div className="gacha-stage">
        {banner ? (
          <>
            {banner.image && (
              <img className="gacha-stage-img" src={banner.image} alt="" draggable={false} />
            )}
            <div className="gacha-stage-dim" />
            <button
              className="gacha-nav-arrow left"
              aria-label="上一个卡池"
              onClick={() => stepBanner(-1)}
            >
              ◀
            </button>
            <button
              className="gacha-nav-arrow right"
              aria-label="下一个卡池"
              onClick={() => stepBanner(1)}
            >
              ▶
            </button>
            <div className="gacha-stage-info">
              <span className={`gacha-pool-tag ${banner.type}`}>
                {TYPE_LABEL[banner.type] ?? banner.type} · {banner.server}
              </span>
              <h3 title={banner.title}>{banner.title}</h3>
              <p className="gacha-stage-up">
                {banner.up ? (
                  <>
                    Pick UP <b>{banner.up}</b>
                  </>
                ) : (
                  '无 UP 标注（按无 UP 处理）'
                )}
                <span className="gacha-stage-date">
                  {fmtDate(banner.start)} ~ {fmtDate(banner.end)}
                </span>
              </p>
            </div>
            <button className="btn gacha-detail-btn" onClick={() => setShowDetail(true)}>
              招募详情
            </button>
          </>
        ) : (
          <div className="empty-state">没有匹配的卡池</div>
        )}
      </div>

      {/* 余额不足：toast 之外的内联补给条（测试用） */}
      {needSupply && (
        <div className="gacha-supply" role="alert">
          <span>
            青辉石不足（券抵扣后本次还需 {needSupply.cost}，持有 {save.currency.pyroxene.toLocaleString()}）
          </span>
          <button className="btn gacha-supply-btn" onClick={supplyCurrency}>
            一键补给（测试用）
          </button>
        </div>
      )}

      {/* 本次结果：关闭演出后落在底部抽屉，横排十连卡 */}
      {results.length > 0 && (
        <div className="gacha-last">
          <div className="gacha-last-head">
            <b>本次结果</b>
            {lastCost && (
              <span className="muted" style={{ fontSize: 12 }}>
                本次消耗：{costLabel(lastCost)}
              </span>
            )}
            <button className="btn ghost sm" onClick={() => setResults([])}>
              清空
            </button>
          </div>
          <div className="result-grid">
            {results.map((r, i) => {
              const st = studentOf(r);
              return (
                <div
                  key={i}
                  className={`result-card s${r.star}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                  title={r.name}
                >
                  <div className="frame">
                    {st?.avatar ? (
                      <img src={st.avatar} alt={r.name} />
                    ) : (
                      `${r.star}★`
                    )}
                  </div>
                  <span className={`stars s${r.star}`}>{'★'.repeat(r.star)}</span>
                  {r.isUp && <span className="badge">UP</span>}
                  <div className="info">{r.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 底部操作条：持有货币 + 保底简条 + 招募按钮 */}
      <div className="gacha-dock">
        <div className="gacha-currency" title="持有青辉石 / 招募券">
          <img src={GEM_ICON} alt="" data-ui-source="assetbundle" />
          <b>{save.currency.pyroxene.toLocaleString()}</b>
          <img src={TICKET_ICON} alt="" data-ui-source="assetbundle" />
          <b>{save.currency.tickets}</b>
        </div>
        <button className="gacha-pity-mini" onClick={() => { setDetailTab('pity'); setShowDetail(true); }}>
          <span>{mode === 'classic' ? '天井' : limited ? '限定充能' : '一般充能'}</span>
          <i>
            {pityNow}/{pityMax}
          </i>
          <em>
            <u style={{ width: `${Math.min(100, (pityNow / pityMax) * 100)}%` }} />
          </em>
        </button>
        <div className="gacha-pull-group">
          <button className="btn gacha-pull single" disabled={!banner} onClick={() => doPull(1)}>
            招募 1 次
            <span className="cost">
              <img src={GEM_ICON} alt="" />
              {PULL_COST}
            </span>
          </button>
          <button className="btn gacha-pull ten" disabled={!banner} onClick={() => doPull(10)}>
            招募 10 次
            <span className="cost">
              <img src={GEM_ICON} alt="" />
              {PULL_COST * 10}
            </span>
          </button>
        </div>
      </div>

      {/* 卡池一览抽屉 */}
      {showPoolList && (
        <div
          className="gacha-poolmask"
          onClick={() => setShowPoolList(false)}
        >
          <div className="gacha-pooldrawer" onClick={(e) => e.stopPropagation()}>
            <div className="gacha-pooldrawer-head">
              <b>卡池一览</b>
              <button className="btn ghost sm" onClick={() => setShowPoolList(false)}>
                关闭
              </button>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索卡池 / UP 角色…"
              className="gacha-search"
            />
            <div className="banner-list">
              {banners.map((b) => (
                <button
                  key={b.id}
                  className={`banner-item${banner?.id === b.id ? ' on' : ''}`}
                  onClick={() => {
                    setSelected(b);
                    setShowPoolList(false);
                  }}
                >
                  <b>{b.title}</b>
                  <div className="meta">
                    <span className={`tag ${b.type}`}>{TYPE_LABEL[b.type] ?? b.type}</span>
                    <span>{b.server}</span>
                    <span>{fmtDate(b.start)}</span>
                  </div>
                </button>
              ))}
              {banners.length === 0 && (
                <div className="muted" style={{ padding: 18, textAlign: 'center' }}>
                  没有匹配的卡池
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 招募详情覆盖层：情报 / 保底与概率 / 记录 */}
      {showDetail && banner && (
        <div className="gacha-detail" role="dialog" aria-label="招募详情" onClick={() => setShowDetail(false)}>
          <div className="gacha-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="gacha-detail-head">
              <div className="gacha-detail-tabs">
                {[
                  { k: 'info', l: '卡池情报' },
                  { k: 'pity', l: '保底与概率' },
                  { k: 'log', l: '抽卡记录' },
                ].map((t) => (
                  <button
                    key={t.k}
                    className={detailTab === t.k ? 'on' : ''}
                    onClick={() => setDetailTab(t.k as typeof detailTab)}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
              <button className="btn ghost sm" onClick={() => setShowDetail(false)}>
                关闭
              </button>
            </div>

            {detailTab === 'info' && (
              <div className="gacha-detail-body">
                <div className="gacha-upcard">
                  {upStudent?.avatar ? (
                    <img src={upStudent.avatar} alt={banner.up} />
                  ) : (
                    <div className="gacha-upcard-fallback">{banner.up?.slice(0, 1) ?? '?'}</div>
                  )}
                  <div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      当期 UP
                    </span>
                    <b>{banner.up || '未标注（按无 UP 处理）'}</b>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {fmtDate(banner.start)} ~ {fmtDate(banner.end)} · {banner.server}
                    </span>
                  </div>
                </div>
                <p className="gacha-summary">{banner.summary || '（该卡池没有公告摘要）'}</p>
                {banner.source_url && (
                  <a className="gacha-source" href={banner.source_url} target="_blank" rel="noreferrer">
                    官方公告出处 ↗
                  </a>
                )}
              </div>
            )}

            {detailTab === 'pity' && (
              <div className="gacha-detail-body">
                <div className="gacha-pity-block">
                  <div className="row">
                    <span>保底模式</span>
                    <b>{mode === 'classic' ? '经典 200 抽天井' : '充能（100 / 200）'}</b>
                  </div>
                  <div className="row">
                    <span>当前计数</span>
                    <b>
                      {pityNow} <span className="muted">/ {pityMax}</span>
                    </b>
                  </div>
                  <div className="pity-bar">
                    <i style={{ width: `${Math.min(100, (pityNow / pityMax) * 100)}%` }} />
                  </div>
                  <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: '8px 0 0' }}>
                    {mode === 'classic'
                      ? '经典模式：每抽 +1 点，满 200 必得当期 UP 且点数归零；歪出 UP 不清零，可跨池继承。'
                      : '充能模式：每抽 +1，第 100 抽未出 UP 则必得 ★3（其中 50% 为 UP），第 200 抹必得 UP；获得 UP 立刻归零，不跨池继承。一般池与限定池充能互不相通。'}
                  </p>
                </div>
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: '10px 0 0' }}>
                  累计招募里程碑（{MILESTONE_PULLS.join(' / ')} 抽）各返利限时十连券×1，已达{' '}
                  {MILESTONE_PULLS.filter((m) => save.gacha.milestones?.[String(m)]).length} 个；当前版本仅记录进度，
                  限时十连券暂未实装发放。
                </p>
                <table className="gacha-rates">
                  <thead>
                    <tr>
                      <th>稀有度</th>
                      <th>概率</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ color: '#c98a00' }}>★★★</td>
                      <td>{(RATES.STAR3 * 100).toFixed(1)}%</td>
                      <td className="muted">其中当期 UP {(RATES.UP * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#8a5fc0' }}>★★</td>
                      <td>{(RATES.STAR2 * 100).toFixed(1)}%</td>
                      <td className="muted">十连第 10 抽保底 ★2</td>
                    </tr>
                    <tr>
                      <td>★</td>
                      <td>{(RATES.STAR1 * 100).toFixed(1)}%</td>
                      <td className="muted">—</td>
                    </tr>
                  </tbody>
                </table>
                <div className="muted" style={{ fontSize: 12 }}>
                  单抽 {PULL_COST} 青辉石 · 十连 {PULL_COST * 10} 青辉石 · 每日签到补给 {DAILY_PYROXENE}+
                </div>
              </div>
            )}

            {detailTab === 'log' && (
              <div className="gacha-detail-body">
                <div className="gacha-log-head">
                  <span className="muted" style={{ fontSize: 12 }}>
                    最近 {Math.min(save.gacha.history.length, 200)} / {save.gacha.history.length} 条（上限 800）
                  </span>
                  <button
                    className="btn ghost sm"
                    onClick={exportHistory}
                    disabled={save.gacha.history.length === 0}
                  >
                    导出 JSON
                  </button>
                </div>
                <div className="gacha-log-scroll">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>卡池</th>
                        <th>结果</th>
                        <th>UP</th>
                        <th>计数</th>
                        <th>消耗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {save.gacha.history.slice(0, 200).map((h, i) => (
                        <tr key={i}>
                          <td className="muted">{new Date(h.at).toLocaleString('zh-CN')}</td>
                          <td title={h.bannerTitle}>{h.bannerTitle.slice(0, 18)}</td>
                          <td>
                            <span
                              style={{
                                color: h.star === 3 ? '#c98a00' : h.star === 2 ? '#8a5fc0' : '#7d8b99',
                              }}
                            >
                              {h.star}★
                            </span>{' '}
                            {h.name}
                          </td>
                          <td>{h.isUp ? '✓' : ''}</td>
                          <td className="muted">{h.pity}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {h.costType === 'ten-ticket'
                              ? '十连券'
                              : h.costType === 'ticket'
                                ? '招募券'
                                : h.costType === 'mixed'
                                  ? '券+石'
                                  : '青辉石'}
                          </td>
                        </tr>
                      ))}
                      {save.gacha.history.length === 0 && (
                        <tr>
                          <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 22 }}>
                            还没有抽卡记录
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cut && (
        <GachaCutscene
          key={cutSeq}
          results={cut.results}
          times={cut.times}
          plana={cut.plana}
          newStar3={cut.newStar3}
          newNames={cut.newNames}
          studentOf={studentOf}
          bannerTitle={cut.bannerTitle}
          onAgain={() => doPull(10)}
          onClose={() => setCut(null)}
        />
      )}
    </div>
  );
}
