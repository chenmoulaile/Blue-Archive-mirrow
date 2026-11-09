import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GachaCutscene } from '../components/gacha/GachaCutscene';
import { SpineView } from '../components/SpineView';
import { useViewStack, StackOverlay } from '../components/stage';
import { useApp, navState } from '../core/AppContext';
import { store, useSave, PULL_COST, DAILY_PYROXENE } from '../core/store';
import {
  bannerIsLimited,
  buildPool,
  pullOne,
  pullTen,
  PITY,
  MILESTONE_PULLS,
  resolvePullCost,
  hitMilestones,
  type PullResult,
  type PullContext,
  type PullCost,
} from '../core/gacha/engine';
import type { Banner, Student } from '../types';
import {
  EXCHANGE_TEXT,
  PITY_TEXT,
  PROB_FES,
  PROB_NORMAL,
  SCHOOL_LABEL,
  STARTER_TEXT,
  artOf,
  loadCardArt,
  loadStudentsMeta,
  type StudentMeta,
} from '../components/gacha/gachaData';
import '../styles/gacha-cutscene.css';

/**
 * 招募页（C-12/D2 重做，报告二视频帧证据）：
 *   左侧 UP 学生 Spine 立绘动画区（带 CV 名条）+ 右侧竖白板详情面板
 *   （限时招募横幅 / 期间 / 说明 / 招募 1 次青色钮 120 / 招募 10 次金色钮 1200 / 招募点数）；
 *   轮播点 + 侧箭头（顶部返回由 App 的 TopCurrencyBar 统一提供）。
 *
 * C-12 删除项：类型筛选 seg、「卡池一览」抽屉（真机无此形态，轮播即全部当期池）。
 * C-6：充能池在招募按钮区旁展示充能进度；经典池主界面不常驻点数条（点数在交换所页查看）。
 * C-5：招募详情改为全屏页栈页（useViewStack + StackOverlay，G-2），含官方概率披露表
 *   原文；经典池另有「招募点数交换所」页；抽卡记录独立页栈入口。
 * C-2：招募按钮的消耗语义按 resolvePullCost 优先级展示（券优先于石）。
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
  /** 本次消耗（结果页与记录表标注用，C-2） */
  cost: PullCost | null;
  /** 抽取后的保底状态（D5 结果页右下点数） */
  pityAfter: { classicPoints: number; chargeNow: number; chargeMax: number };
}

type LayerKey = 'detail' | 'exchange' | 'log';

/** banner.up 支持多角色（真机双 UP 各占 0.7%）：按常见分隔符拆分 */
function parseUpNames(up: string | undefined | null): string[] {
  if (!up) return [];
  return up
    .split(/[、,，/／&＋+·]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** banner.up 名字 → 学生（与 engine.resolveUpStudent 同口径：精确 → 前缀*） */
function resolveUpStudent(students: Student[], n: string): Student | null {
  const key = n.trim();
  if (!key) return null;
  return (
    students.find((s) => s.name === key && (s.rarity ?? 0) >= 3) ??
    students.find((s) => s.name.startsWith(key + '*')) ??
    students.find((s) => (s.given === key || s.name === key) && (s.rarity ?? 0) >= 3) ??
    null
  );
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
  const stack = useViewStack<LayerKey>();

  const [selected, setSelected] = useState<Banner | null>(null);
  const [results, setResults] = useState<PullResult[]>([]);
  const [cut, setCut] = useState<Cutscene | null>(null);
  const [cutSeq, setCutSeq] = useState(0);
  /** 余额不足时的待重试抽取：补给按钮（测试用）点击后自动重放 */
  const [needSupply, setNeedSupply] = useState<{ cost: number; times: 1 | 10 } | null>(null);
  /** FES 学生名单 + 二星 UP 池配置（data/fes_pool.json；缺失时引擎退化为整池均匀） */
  const [fesPool, setFesPool] = useState<{ fesStudents: { id: number; name: string }[]; star2UpPools: Record<string, string[]> } | null>(null);
  /** CV/武器/学园 meta 与卡面立绘（主页立绘区 + 契约书共用） */
  const [metaMap, setMetaMap] = useState<Map<number, StudentMeta>>(new Map());
  const [cardArt, setCardArt] = useState<Record<string, string>>({});
  /** UP 立绘 Spine 失败时回退头像 */
  const [spineError, setSpineError] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/data/fes_pool.json')
      .then((r) => (r.ok ? (r.json() as Promise<{ fesStudents: { id: number; name: string }[]; star2UpPools: Record<string, string[]> }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (live) setFesPool(j);
      })
      .catch(() => {
        /* 名单缺失按无常驻分层处理，不阻塞招募 */
      });
    loadStudentsMeta().then((m) => live && setMetaMap(m));
    loadCardArt().then((m) => live && setCardArt(m));
    return () => {
      live = false;
    };
  }, []);

  const studentById = useMemo(() => new Map(assets.students.map((s) => [s.id, s])), [assets.students]);
  const studentOf = useCallback(
    (r: PullResult): Student | null => (r.studentId != null ? studentById.get(r.studentId) ?? null : null),
    [studentById]
  );

  // ------------------------------------------------ 卡池轮播（C-12：当期池轮播，无筛选栏）
  const banners = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const active = assets.banners.filter((b) => Number(b.end) >= now);
    // 当期池为空（数据陈旧）时回退最近公告的池，保证轮播可用
    const list = active.length > 0 ? active : assets.banners.slice(-30);
    return list.slice().reverse();
  }, [assets.banners]);

  // 从活动页跳过来时定位到指定卡池
  useEffect(() => {
    if (navState.pendingBannerId == null) return;
    const target = assets.banners.find((b) => b.id === navState.pendingBannerId);
    navState.pendingBannerId = null;
    if (target) {
      setSelected(target);
    }
  }, [assets.banners]);

  // selected（轮播点/箭头/活动页跳转指定）优先；不在当期列表的池照常显示（dots 不点亮）
  const banner = selected ?? banners[0] ?? null;
  const pool = useMemo(() => buildPool(assets.students), [assets.students]);

  const mode = save.gacha.mode;
  const limited = banner ? bannerIsLimited(banner) : false;
  const pityNow = mode === 'classic' ? save.gacha.classicPoints : limited ? save.gacha.chargeLimited : save.gacha.chargeNormal;
  const pityMax = mode === 'classic' ? PITY.CLASSIC_SPARK : PITY.CHARGE_HARD;

  // 当期 UP 学生（多 UP：立绘区取第一个；白板横幅显示全部）
  const upStudents = useMemo(() => {
    if (!banner?.up) return [];
    return parseUpNames(banner.up)
      .map((n) => resolveUpStudent(assets.students, n))
      .filter((s): s is Student => !!s);
  }, [assets.students, banner]);
  const upStudent = upStudents[0] ?? null;
  const upLabel = parseUpNames(banner?.up).join(' & ');

  // UP 立绘：Spine（character_spine 通道，战斗立绘族）→ 卡面/头像回退
  const upSpine = useMemo(() => {
    if (!upStudent) return null;
    return assets.spine(upStudent.given_en) ?? assets.spineByName(upStudent.home_spine);
  }, [upStudent, assets]);
  const upArt = upStudent ? artOf(upStudent, cardArt) : undefined;
  const upCv = upStudent ? metaMap.get(upStudent.id)?.cv || undefined : undefined;
  useEffect(() => setSpineError(false), [upStudent?.id]);

  // ------------------------------------------------ 抽取
  const upNames = useMemo(() => parseUpNames(banner?.up), [banner?.up]);
  const isFes = banner?.type === 'fes';
  const isStarter = banner?.type === 'starter';
  const fesStudentIds = useMemo(() => (fesPool?.fesStudents ?? []).map((s) => s.id), [fesPool]);
  const star2UpNames = useMemo(() => (banner ? fesPool?.star2UpPools?.[String(banner.id)] : undefined), [banner, fesPool]);

  // C-2 消耗语义（按钮显示）：单抽优先一张招募券；十连优先一张十连券，其次招募券逐抽抵扣
  const singleCost = useMemo(
    () =>
      resolvePullCost(1, { tickets: save.currency.tickets ?? 0, tenTickets: save.currency.tenTickets }, save.currency.pyroxene),
    [save.currency.tickets, save.currency.tenTickets, save.currency.pyroxene]
  );
  const tenCost = useMemo(
    () =>
      resolvePullCost(10, { tickets: save.currency.tickets ?? 0, tenTickets: save.currency.tenTickets }, save.currency.pyroxene),
    [save.currency.tickets, save.currency.tenTickets, save.currency.pyroxene]
  );

  const doPull = useCallback(
    (times: 1 | 10) => {
      if (!banner) return;
      // C-2 消耗优先级：单抽优先扣一张招募券，十连优先扣一张十连券；
      // 券不足部分按每抽 120 青辉石扣，仍不足才走余额不足分支。
      const cost =
        times === 1
          ? resolvePullCost(1, { tickets: save.currency.tickets ?? 0, tenTickets: save.currency.tenTickets }, save.currency.pyroxene)
          : resolvePullCost(10, { tickets: save.currency.tickets ?? 0, tenTickets: save.currency.tenTickets }, save.currency.pyroxene);
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
      // NEW 徽标名单：抽取前 owned 里没有的就是首次获得
      const newNames = out.filter((r) => !(ownedBefore[r.name] > 0)).map((r) => r.name);
      setResults(out);
      setNeedSupply(null);
      setCut({
        results: out,
        times,
        plana: limited,
        newStar3: fresh ? studentById.get(fresh.studentId ?? -1) ?? null : null,
        newNames,
        bannerTitle: banner.title,
        cost,
        pityAfter: {
          classicPoints: state.classicPoints,
          chargeNow: limited ? state.chargeLimited : state.chargeNormal,
          chargeMax: PITY.CHARGE_HARD,
        },
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

  // 招募按钮消耗行（券优先语义标注，C-2）
  const costRow = (c: PullCost): ReactNode => {
    if (c.costType === 'ten-ticket')
      return (
        <span className="cost">
          <img src={TICKET_ICON} alt="" />
          十连券×1
        </span>
      );
    if (c.costType === 'ticket')
      return (
        <span className="cost">
          <img src={TICKET_ICON} alt="" />
          {c.ticketsUsed}
        </span>
      );
    if (c.costType === 'mixed')
      return (
        <span className="cost">
          <img src={TICKET_ICON} alt="" />
          {c.ticketsUsed}
          <i>+</i>
          <img src={GEM_ICON} alt="" />
          {c.pyroxene.toLocaleString()}
        </span>
      );
    return (
      <span className="cost">
        <img src={GEM_ICON} alt="" />
        {c.pyroxene.toLocaleString()}
      </span>
    );
  };

  const bannerIdx = banner ? banners.findIndex((b) => b.id === banner.id) : -1;

  return (
    <div className="gacha-page">
      {/* ------------------------------------------------ C-12/D2 主页：左立绘区 + 右竖白板 */}
      <div className="gacha-hero">
        {banner ? (
          <>
            {banner.image && <img className="gacha-hero-bg" src={banner.image} alt="" draggable={false} />}
            <div className="gacha-hero-dim" />

            {/* UP 学生 Spine 立绘动画区（D2）：战斗立绘族，失败回退卡面/头像 */}
            <div className="gacha-hero-spine" data-ui-source={upSpine && !spineError ? 'assetbundle' : 'assetbundle(图)'} key={upStudent?.id ?? 'none'}>
              {upStudent && upSpine && !spineError ? (
                <SpineView
                  skelUrl={upSpine.skel}
                  atlasUrl={upSpine.atlas}
                  fit="cover"
                  anchorX={0.42}
                  anchorY={0.92}
                  onError={() => setSpineError(true)}
                />
              ) : upArt ? (
                <img className="gacha-hero-art" src={upArt} alt={upStudent?.name ?? ''} />
              ) : (
                <div className="gacha-hero-fallback">{upStudent?.name ?? banner.up ?? ''}</div>
              )}
            </div>

            {/* CV 名条（D2）：students_meta 真数据，缺 CV 如实不显示 */}
            {upStudent && upCv && (
              <div className="gacha-hero-cv">
                <b>{upStudent.name}</b>
                <span>CV. {upCv}</span>
              </div>
            )}

            <span className={`gacha-pool-tag ${banner.type}`}>
              {TYPE_LABEL[banner.type] ?? banner.type}
              {isFes ? ' · FES' : ''}
            </span>

            {/* 侧箭头 + 轮播点（C-12：真机为横幅轮播 + 侧箭头） */}
            <button className="gacha-nav-arrow left" aria-label="上一个卡池" onClick={() => stepBanner(-1)}>
              ◀
            </button>
            <button className="gacha-nav-arrow right" aria-label="下一个卡池" onClick={() => stepBanner(1)}>
              ▶
            </button>
            <div className="gacha-dots" role="tablist" aria-label="卡池轮播点">
              {banners.slice(0, 12).map((b, i) => (
                <button
                  key={b.id}
                  role="tab"
                  aria-selected={bannerIdx === i}
                  className={`gacha-dot${bannerIdx === i ? ' on' : ''}`}
                  onClick={() => setSelected(b)}
                  aria-label={`卡池 ${i + 1}`}
                />
              ))}
              {banners.length > 12 && <span className="gacha-dots-more">{banners.length}</span>}
            </div>
          </>
        ) : (
          <div className="empty-state">暂无招募卡池</div>
        )}
      </div>

      {/* 右侧竖白板详情面板（D2） */}
      <aside className="gacha-board">
        {banner ? (
          <>
            <div className="gacha-board-banner">
              <span className="gacha-board-kicker">限时招募</span>
              <b className="gacha-board-up">{upLabel || '常驻招募（无 UP 标注）'}</b>
              <span className="gacha-board-period">
                {fmtDate(banner.start)} ~ {fmtDate(banner.end)}
              </span>
            </div>
            <p className="gacha-board-desc">{banner.summary ? banner.summary.slice(0, 120) : '（该卡池没有公告摘要）'}</p>

            {/* C-6：充能池在招募按钮区旁展示充能进度；经典池不常驻点数条 */}
            {mode !== 'classic' && (
              <div className="gacha-charge">
                <span>{limited ? '限定充能' : '一般充能'}</span>
                <i>
                  <u style={{ width: `${Math.min(100, (pityNow / pityMax) * 100)}%` }} />
                </i>
                <em>
                  {pityNow}/{pityMax}
                </em>
              </div>
            )}

            <div className="gacha-pull-group">
              <button className="btn gacha-pull single" disabled={!banner} onClick={() => doPull(1)}>
                招募 1 次
                {costRow(singleCost)}
              </button>
              <button className="btn gacha-pull ten" disabled={!banner} onClick={() => doPull(10)}>
                招募 10 次
                {costRow(tenCost)}
              </button>
            </div>

            {/* 经典池：招募点数入口（交换所页查看，主界面不常驻点数条） */}
            {mode === 'classic' && (
              <button className="gacha-exchange-link" onClick={() => stack.open('exchange')}>
                <img src={TICKET_ICON} alt="" />
                <span>
                  招募点数 <b>{save.gacha.classicPoints}</b>/200 · 点数交换所
                </span>
                <em>›</em>
              </button>
            )}

            <div className="gacha-board-links">
              <button className="gacha-board-link" onClick={() => stack.open('detail')}>
                招募详情 ›
              </button>
              <button className="gacha-board-link" onClick={() => stack.open('log')}>
                抽卡记录 ›
              </button>
            </div>

            {/* 里程碑返利提示（C-12：70/130/150/170 抽） */}
            <span className="gacha-milestone-hint">
              累计招募里程碑 {MILESTONE_PULLS.filter((m) => save.gacha.milestones?.[String(m)]).length}/{MILESTONE_PULLS.length}
            </span>
          </>
        ) : (
          <div className="empty-state">暂无卡池数据</div>
        )}

        {/* 余额不足：内联补给条（测试用） */}
        {needSupply && (
          <div className="gacha-supply" role="alert">
            <span>
              青辉石不足（还需 {needSupply.cost}，持有 {save.currency.pyroxene.toLocaleString()}）
            </span>
            <button className="btn gacha-supply-btn" onClick={supplyCurrency}>
              一键补给（测试）
            </button>
          </div>
        )}
      </aside>

      {/* ------------------------------------------------ 页栈层（G-2）：详情 / 交换所 / 记录 */}
      {stack.entries.map((e) => (
        <StackOverlay key={e.key} entry={e} className="gacha-stack" label={e.key === 'detail' ? '招募详情' : e.key === 'exchange' ? '招募点数交换所' : '抽卡记录'}>
          {e.key === 'detail' && (
            <div className="gacha-layer">
              <button className="btn ghost sm gacha-layer-back" onClick={() => stack.close('detail')}>
                ‹ 返回
              </button>
              <h2 className="gacha-layer-title">招募详情</h2>
              <div className="gacha-layer-body">
                {banner && (
                  <>
                    <div className="gacha-detail-upcard">
                      {upArt ? (
                        <img src={upArt} alt={upLabel} />
                      ) : upStudent?.avatar ? (
                        <img src={upStudent.avatar} alt={upLabel} />
                      ) : (
                        <div className="gacha-upcard-fallback">{banner.up?.slice(0, 1) ?? '?'}</div>
                      )}
                      <div>
                        <span className="muted" style={{ fontSize: 12 }}>
                          当期 UP（{TYPE_LABEL[banner.type] ?? banner.type} 池{isFes ? ' · ★3 概率翻倍' : ''}）
                        </span>
                        <b>{upLabel || '未标注（按无 UP 处理）'}</b>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {fmtDate(banner.start)} ~ {fmtDate(banner.end)} · {banner.server}
                        </span>
                      </div>
                    </div>
                    <p className="gacha-summary">{banner.summary || '（该卡池没有公告摘要）'}</p>
                  </>
                )}

                {/* 官方概率披露表原文（C-5）：按池型取对应披露口径 */}
                <table className="gacha-rates">
                  <thead>
                    <tr>
                      <th>稀有度</th>
                      <th>概率</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isFes ? PROB_FES : PROB_NORMAL).map((row) => (
                      <tr key={row.star}>
                        <td style={{ color: row.star === '★★★' ? '#c98a00' : row.star === '★★' ? '#8a5fc0' : '#7d8b99' }}>
                          {row.star}
                        </td>
                        <td>{row.rate}</td>
                        <td className="muted">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="gacha-rates-note">单抽 {PULL_COST} 青辉石 · 十连 {PULL_COST * 10} 青辉石 · 每日签到补给 {DAILY_PYROXENE}+ · 支持招募券（券优先抵扣，不足扣石）</p>

                {/* 保底规则原文 */}
                <div className="gacha-pity-block">
                  <div className="row">
                    <span>保底模式</span>
                    <b>{mode === 'classic' ? '经典 200 抽天井（点数制）' : '充能（100 / 200）'}</b>
                  </div>
                  <div className="row">
                    <span>当前{mode === 'classic' ? '点数' : '充能'}</span>
                    <b>
                      {pityNow} <span className="muted">/ {pityMax}</span>
                    </b>
                  </div>
                  <div className="pity-bar">
                    <i style={{ width: `${Math.min(100, (pityNow / pityMax) * 100)}%` }} />
                  </div>
                  <p className="gacha-pity-text">{mode === 'classic' ? PITY_TEXT.classic : PITY_TEXT.charge}</p>
                  {isStarter && <p className="gacha-pity-text starter">{STARTER_TEXT}</p>}
                </div>

                {/* 里程碑返利说明（C-12） */}
                <p className="gacha-milestone-note">
                  累计招募里程碑（{MILESTONE_PULLS.join(' / ')} 抽）各返利限时十连券×1，已达{' '}
                  {MILESTONE_PULLS.filter((m) => save.gacha.milestones?.[String(m)]).length} 个；当前版本仅记录进度，限时十连券暂未实装发放。
                </p>
                {banner?.source_url && (
                  <a className="gacha-source" href={banner.source_url} target="_blank" rel="noreferrer">
                    官方公告出处 ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {e.key === 'exchange' && (
            <div className="gacha-layer">
              <button className="btn ghost sm gacha-layer-back" onClick={() => stack.close('exchange')}>
                ‹ 返回
              </button>
              <h2 className="gacha-layer-title">招募点数交换所</h2>
              <div className="gacha-layer-body">
                <div className="gacha-exchange-count">
                  <img src={TICKET_ICON} alt="" data-ui-source="assetbundle" />
                  <b>{save.gacha.classicPoints}</b>
                  <span>/ 200 点</span>
                </div>
                <div className="pity-bar big">
                  <i style={{ width: `${Math.min(100, (save.gacha.classicPoints / PITY.CLASSIC_SPARK) * 100)}%` }} />
                </div>
                <ul className="gacha-exchange-rules">
                  {EXCHANGE_TEXT.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  当前保底模式：{mode === 'classic' ? '经典（产生招募点数）' : '充能（不产生招募点数）'}
                </p>
              </div>
            </div>
          )}

          {e.key === 'log' && (
            <div className="gacha-layer">
              <button className="btn ghost sm gacha-layer-back" onClick={() => stack.close('log')}>
                ‹ 返回
              </button>
              <h2 className="gacha-layer-title">抽卡记录</h2>
              <div className="gacha-layer-body">
                <div className="gacha-log-head">
                  <span className="muted" style={{ fontSize: 12 }}>
                    最近 {Math.min(save.gacha.history.length, 200)} / {save.gacha.history.length} 条（上限 800）
                  </span>
                  <button className="btn ghost sm" onClick={exportHistory} disabled={save.gacha.history.length === 0}>
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
                            <span style={{ color: h.star === 3 ? '#c98a00' : h.star === 2 ? '#8a5fc0' : '#7d8b99' }}>
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
            </div>
          )}
        </StackOverlay>
      ))}

      {/* ------------------------------------------------ 演出覆盖层（页栈之上） */}
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
          classicPoints={cut.pityAfter.classicPoints}
          chargeNow={cut.pityAfter.chargeNow}
          chargeMax={cut.pityAfter.chargeMax}
          mode={mode}
          onAgain={() => doPull(10)}
          onClose={() => setCut(null)}
        />
      )}
    </div>
  );
}
