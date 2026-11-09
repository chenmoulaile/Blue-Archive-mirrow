/**
 * 卡池概率与保底引擎（纯逻辑，不依赖 DOM）
 *
 * 概率常量集中在此，便于对照官方披露审计：
 *   常驻池：★3 合计 3%（其中当期 UP 0.7%，其余 ★3 共享 2.3%）、★2 18.5%、★1 78.5%
 *   FES 池：★3 合计 6%（当期 UP 0.7% / 其他 FES 0.9% / 常驻 4.4%）、★2 18.5%、★1 75.5%
 *   二星 UP（部分池配置）：PickUp ★2 3%，其余 ★2 均分剩余 15.5%
 *
 * UP 支持多角色（真机双 UP 各占 0.7%）：UP 层总概率 = 0.7% × UP 数，
 * isUp 命中时再从 UP 名单随机确定具体角色。
 *
 * 两种保底：
 *   classic —— 200 抽天井。每抽 +1 点，满 200 必出 UP 且点数归零；
 *              自然歪出 UP 不清零，可跨池继承。
 *   charge  —— 充能。每抽 +1，第 100 抽若此前未出 UP 则必出 ★3（其中 50% 为 UP），
 *              第 200 抽必出 UP；一旦获得 UP 充能立刻归零，不跨池继承。
 *              一般池与限定池充能互不相通。
 * 另有 starter（新手池）特判：pullTen 十连必出 ★3（C-12）。
 */

import type { Banner, PityMode, Student } from '../../types';

export const RATES = {
  /** ★3 总概率（常驻池；FES 池见 FES_RATES） */
  STAR3: 0.03,
  /** 其中单个当期 UP（双 UP 各占此值，UP 层合计 = UP × 角色数） */
  UP: 0.007,
  /** ★2 */
  STAR2: 0.185,
  /** ★1（常驻池） */
  STAR1: 0.785,
} as const;

/** FES 池概率（官方披露：★3 翻倍 6%，★1 降为 75.5%） */
export const FES_RATES = {
  /** ★3 总概率 */
  STAR3: 0.06,
  /** 单个当期 UP（与常驻池一致） */
  UP: 0.007,
  /** 其他 FES 限定角色合计 */
  OTHER_FES: 0.009,
  /** 常驻 ★3 合计（单 UP 池：0.06 - 0.007 - 0.009 = 0.044） */
  RESIDENT_STAR3: 0.044,
  /** ★2（与常驻池一致） */
  STAR2: 0.185,
  /** ★1 */
  STAR1: 0.755,
} as const;

/** 二星 UP 概率（仅池配置了二星 UP 名单时生效，未配置为 0） */
export const STAR2_UP_RATE = 0.03;

export const PITY = {
  /** 经典天井 */
  CLASSIC_SPARK: 200,
  /** 充能软保底 */
  CHARGE_SOFT: 100,
  /** 充能硬保底 */
  CHARGE_HARD: 200,
  /** 软保底出 ★3 时 UP 的占比 */
  SOFT_UP_RATE: 0.5,
} as const;

export type Forced = 'none' | 'spark' | 'soft' | 'hard' | 'guarantee' | 'starter';

/** 里程碑返利抽数（日服新版：限时十连券，store 结算层先记录不发券） */
export const MILESTONE_PULLS = [70, 130, 150, 170] as const;

export interface PityState {
  classicPoints: number;
  chargeNormal: number;
  chargeLimited: number;
}

export interface PullResult {
  star: 1 | 2 | 3;
  name: string;
  studentId: number | null;
  isUp: boolean;
  forced: Forced;
  /** 本抽结束后的保底计数，用于界面展示 */
  pityAfter: number;
}

/** 单抽概率表（由 ratesFor 按 PullContext 解析） */
export interface RateTable {
  /** 池型：'normal' 常驻 / 'fes' FES */
  pool: 'normal' | 'fes';
  /** ★3 总概率（0.03 / 0.06） */
  star3: number;
  /** UP 层合计概率（0.7% × UP 角色数；无 UP 为 0） */
  up: number;
  /** 其他 FES 层概率（仅 FES 池且提供名单时 >0） */
  otherFes: number;
  /** 非 UP ★3 中常驻层概率（star3 - up - otherFes） */
  residentStar3: number;
  /** 二星 UP 层概率（未配置为 0） */
  star2Up: number;
  /** ★2 总概率（18.5% 或二星 UP 时 15.5%） */
  star2: number;
  /** ★1 概率（余量） */
  star1: number;
}

export interface PullContext {
  mode: PityMode;
  /** 限定池走 chargeLimited，其余走 chargeNormal / classicPoints */
  limited: boolean;
  /** 单 UP 名（保留字段，兼容旧调用；多 UP 用 upNames） */
  upName: string | null;
  /** 多 UP 名单（双 UP 各占 RATES.UP）；缺省回退 upName */
  upNames?: string[];
  /** FES 池标记（C-1：★3 6%、★1 75.5%，★3 内部分层） */
  fes?: boolean;
  /** FES 学生名单（studentId 集合，来自 data/fes_pool.json；分层「其他 FES 0.9%」用） */
  fesStudentIds?: number[];
  /** 二星 UP 名单（C-4；未配置该层为 0，行为不变） */
  star2UpNames?: string[];
  /** 新手池（starter）标记（C-12：pullTen 必出 ★3） */
  starter?: boolean;
}

export interface Pool {
  star1: Student[];
  star2: Student[];
  star3: Student[];
  byName: Map<string, Student>;
}

/** UP 层名单（多 UP 支持回退单 upName） */
export function upList(ctx: PullContext): string[] {
  if (ctx.upNames && ctx.upNames.length > 0) return ctx.upNames;
  return ctx.upName ? [ctx.upName] : [];
}

/** 按 PullContext 把概率常量解析成单抽概率表（C-1/C-4） */
export function ratesFor(ctx: PullContext): RateTable {
  const fes = ctx.fes === true;
  const star3 = fes ? FES_RATES.STAR3 : RATES.STAR3;
  const up = RATES.UP * upList(ctx).length;
  // 二星 UP：池配置了名单才生效（FES/常驻规则一致）
  const star2Up = ctx.star2UpNames && ctx.star2UpNames.length > 0 ? STAR2_UP_RATE : 0;
  const star2 = RATES.STAR2 - star2Up;
  const star1 = 1 - star3 - star2Up - star2;
  // 其他 FES 层：仅 FES 池且名单可用时启用；单 UP 池下 up+otherFes+resident = 0.06
  const otherFes = fes && ctx.fesStudentIds && ctx.fesStudentIds.length > 0 ? FES_RATES.OTHER_FES : 0;
  return { pool: fes ? 'fes' : 'normal', star3, up, otherFes, residentStar3: star3 - up - otherFes, star2Up, star2, star1 };
}

/** 确定性随机源（mulberry32），便于复现测试 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPool(students: Student[]): Pool {
  const pool: Pool = { star1: [], star2: [], star3: [], byName: new Map() };
  for (const s of students) {
    if (s.is_npc) continue;
    const r = s.rarity ?? 1;
    if (r >= 3) pool.star3.push(s);
    else if (r === 2) pool.star2.push(s);
    else pool.star1.push(s);
    pool.byName.set(s.name, s);
    if (s.given) pool.byName.set(s.given, s);
    if (s.given_en) pool.byName.set(s.given_en.toLowerCase(), s);
  }
  // 极端情况下某一档为空，兜底到全量
  if (pool.star3.length === 0) pool.star3 = students.slice(0, 1);
  if (pool.star2.length === 0) pool.star2 = pool.star3;
  if (pool.star1.length === 0) pool.star1 = pool.star2;
  return pool;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length] as T;
}

// ------------------------------------------------ UP 池拆分（C-3 歪池排除 UP）

/**
 * banner.up 名字 → 具体学生。官方 banner.up 对 FES 变体常省略后缀
 * （如 up='砂狼白子' 指学生表里的 '砂狼白子*恐怖'），故先精确再前缀匹配。
 */
function resolveUpStudent(pool: Pool, upName: string): Student | null {
  const n = upName.trim();
  if (!n) return null;
  const direct = pool.byName.get(n) ?? pool.byName.get(n.toLowerCase());
  if (direct && (direct.rarity ?? 0) >= 3) return direct;
  return pool.star3.find((s) => s.name === n || s.name.startsWith(n + '*')) ?? null;
}

/** UP 层学生（按 ctx 解析；解析失败的名字如实跳过，不伪装命中） */
function upStudentsOf(pool: Pool, ctx: PullContext): Student[] {
  const out: Student[] = [];
  for (const n of upList(ctx)) {
    const s = resolveUpStudent(pool, n);
    if (s) out.push(s);
  }
  return out;
}

interface Star3Split {
  ups: Student[];
  /** 非 UP ★3（歪池）：FES 池再按名单分「其他 FES / 常驻」两层 */
  nonUp: Student[];
  fesLayer: Student[];
  residentLayer: Student[];
}

let splitCache: { pool: Pool; key: string; split: Star3Split } | null = null;

/** ★3 池拆分（带缓存：同一池+同一 UP/名单配置复用） */
function splitStar3(pool: Pool, ctx: PullContext): Star3Split {
  const key = upList(ctx).join('|') + '#' + (ctx.fesStudentIds ?? []).join(',');
  if (splitCache && splitCache.pool === pool && splitCache.key === key) return splitCache.split;
  const ups = upStudentsOf(pool, ctx);
  const upIds = new Set(ups.map((s) => s.id));
  const fesIds = new Set(ctx.fesStudentIds ?? []);
  const nonUp = upIds.size > 0 ? pool.star3.filter((s) => !upIds.has(s.id)) : pool.star3;
  const split: Star3Split = {
    ups,
    nonUp,
    fesLayer: fesIds.size > 0 ? nonUp.filter((s) => fesIds.has(s.id)) : [],
    residentLayer: fesIds.size > 0 ? nonUp.filter((s) => !fesIds.has(s.id)) : [],
  };
  splitCache = { pool, key, split };
  return split;
}

/** 从非 UP ★3 抽一名；FES 池按「其他 FES 0.9% / 常驻」分层（层内均匀）。
 *  名单缺失时退化为整池均匀（引擎不因数据缺失而崩）。 */
function pickNonUpStar3(pool: Pool, ctx: PullContext, rng: () => number): Student | undefined {
  const { nonUp, fesLayer, residentLayer } = splitStar3(pool, ctx);
  if (fesLayer.length > 0 && residentLayer.length > 0) {
    const table = ratesFor(ctx);
    // 非 UP ★3 内部占比 = otherFes / (star3 - up)；等价于绝对概率 0.9% / residentStar3
    if (rng() < table.otherFes / Math.max(1e-9, table.star3 - table.up)) {
      return pick(fesLayer, rng);
    }
    return pick(residentLayer, rng);
  }
  return pick(nonUp.length > 0 ? nonUp : pool.star3, rng);
}

function currentPity(state: PityState, ctx: PullContext): number {
  if (ctx.mode === 'classic') return state.classicPoints;
  return ctx.limited ? state.chargeLimited : state.chargeNormal;
}

function setPity(state: PityState, ctx: PullContext, value: number): void {
  if (ctx.mode === 'classic') state.classicPoints = value;
  else if (ctx.limited) state.chargeLimited = value;
  else state.chargeNormal = value;
}

/**
 * 单抽。会就地修改 state 里的保底计数。
 * @param state 保底状态（跨抽共享）
 * @param ctx   当前卡池上下文
 * @param pool  可选学生池
 * @param rng   随机源，缺省用 Math.random
 */
export function pullOne(
  state: PityState,
  ctx: PullContext,
  pool: Pool,
  rng: () => number = Math.random
): PullResult {
  const before = currentPity(state, ctx);
  const next = before + 1;
  setPity(state, ctx, next);

  let star: 1 | 2 | 3 = 1;
  let isUp = false;
  let forced: Forced = 'none';

  if (ctx.mode === 'classic') {
    if (next >= PITY.CLASSIC_SPARK) {
      star = 3;
      isUp = true;
      forced = 'spark';
      setPity(state, ctx, 0);
    }
  } else if (next >= PITY.CHARGE_HARD) {
    star = 3;
    isUp = true;
    forced = 'hard';
    setPity(state, ctx, 0);
  } else if (next === PITY.CHARGE_SOFT) {
    star = 3;
    forced = 'soft';
    isUp = rng() < PITY.SOFT_UP_RATE;
    if (isUp) setPity(state, ctx, 0);
  }

  let star2UpHit = false;
  if (forced === 'none') {
    const table = ratesFor(ctx);
    const r = rng();
    if (r < table.up) {
      star = 3;
      isUp = true;
    } else if (r < table.up + (table.star3 - table.up)) {
      // 非 UP ★3（歪池）：已排除当期 UP
      star = 3;
    } else if (table.star2Up > 0 && r < table.up + (table.star3 - table.up) + table.star2Up) {
      star = 2;
      isUp = true;
      star2UpHit = true;
    } else if (r < table.up + (table.star3 - table.up) + table.star2Up + table.star2) {
      star = 2;
    } else {
      star = 1;
    }
    // 充能模式：自然抽到 UP 立刻清零
    if (ctx.mode === 'charge' && isUp) setPity(state, ctx, 0);
  }

  const ups = upList(ctx);
  let student: Student | undefined;
  if (isUp && ups.length > 0) {
    const split = splitStar3(pool, ctx);
    if (star2UpHit) {
      // 二星 UP：从配置名单均匀确定
      const byName = ctx.star2UpNames
        ?.map((n) => pool.byName.get(n) ?? pool.byName.get(n.toLowerCase()))
        .filter((s): s is Student => !!s);
      student = byName && byName.length > 0 ? pick(byName, rng) : pick(pool.star2, rng);
    } else if (split.ups.length > 0) {
      // ★3 UP（含保底）：多 UP 随机确定具体角色
      student = pick(split.ups, rng);
    }
  }
  if (!student) {
    const tier = star === 3 ? pool.star3 : star === 2 ? pool.star2 : pool.star1;
    if (star === 3 && !isUp) {
      // 歪池：从非 UP ★3 抽（FES 池分层）
      student = pickNonUpStar3(pool, ctx, rng);
    } else if (isUp && star === 3 && ups.length > 0 && splitStar3(pool, ctx).ups.length === 0) {
      // UP 名字在学生表里找不到（banner.up 与学生表失配）：退化为全池随机并如实降级 isUp
      student = pick(tier, rng);
      isUp = false;
    } else {
      student = pick(tier, rng);
    }
  }

  return {
    star,
    name: student?.name ?? '未知',
    studentId: student?.id ?? null,
    isUp: isUp && (ups.length > 0 || star2UpHit),
    forced,
    pityAfter: currentPity(state, ctx),
  };
}

/**
 * 十连。按公开规则：十连至少出现一名 ★2 以上；
 * 若十抽全是 ★1，则把最后一抽提升为 ★2。
 * starter（新手池）特判（C-12）：十连必出 ★3——若十抽无 ★3，把最后一抽
 * 提升为 ★3（从非 UP ★3 池随机，forced='starter'）。
 */
export function pullTen(
  state: PityState,
  ctx: PullContext,
  pool: Pool,
  rng: () => number = Math.random
): PullResult[] {
  const out: PullResult[] = [];
  for (let i = 0; i < 10; i++) out.push(pullOne(state, ctx, pool, rng));

  // 新手池：十连必出 ★3（优先于 ★2 保底判断）
  if (ctx.starter && !out.some((r) => r.star === 3)) {
    const s = pickNonUpStar3(pool, ctx, rng) ?? pick(pool.star3, rng);
    out[out.length - 1] = {
      ...out[out.length - 1],
      star: 3,
      name: s.name,
      studentId: s.id,
      isUp: false,
      forced: 'starter',
    };
  }

  if (!out.some((r) => r.star >= 2)) {
    const last = out[out.length - 1] as PullResult;
    if (last.star === 1) {
      const s = pick(pool.star2, rng);
      out[out.length - 1] = {
        ...last,
        star: 2,
        name: s.name,
        studentId: s.id,
        isUp: false,
        forced: 'guarantee',
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------- 消耗（C-2）

export type PullCostType = 'ticket' | 'ten-ticket' | 'pyroxene' | 'mixed';

export interface PullCost {
  times: 1 | 10;
  /** 消耗的十连券（0/1） */
  tenTicketsUsed: number;
  /** 消耗的普通招募券 */
  ticketsUsed: number;
  /** 扣除的青辉石 */
  pyroxene: number;
  /** 本次消耗类型：券 / 十连券 / 石 / 券+石混合 */
  costType: PullCostType;
  /** 是否支付得起（false 时调用方走余额不足分支） */
  enough: boolean;
}

export const PULL_COST_PER = 120;
export const TEN_TICKET_COVERS = 10;

/**
 * 招募消耗优先级（C-2）：
 *   单抽优先扣一张招募券；十连优先扣一张十连券；
 *   券不足（无十连券时可用普通券逐抽抵扣）的部分按每抽 120 青辉石扣，
 *   仍不足则 enough=false，由调用方走余额不足分支。
 */
export function resolvePullCost(
  times: 1 | 10,
  currency: { tickets: number; tenTickets?: number },
  pyroxene: number,
  costPerPull: number = PULL_COST_PER
): PullCost {
  const need = times === 10 ? TEN_TICKET_COVERS : 1;
  let tenUsed = 0;
  let single = 0;
  if (times === 10 && (currency.tenTickets ?? 0) > 0) {
    tenUsed = 1;
  } else {
    single = Math.min(currency.tickets ?? 0, need);
  }
  const remaining = tenUsed > 0 ? 0 : need - single;
  const pyro = remaining * costPerPull;
  let costType: PullCostType;
  if (tenUsed > 0) costType = 'ten-ticket';
  else if (single === need) costType = 'ticket';
  else if (single > 0) costType = 'mixed';
  else costType = 'pyroxene';
  return { times, tenTicketsUsed: tenUsed, ticketsUsed: single, pyroxene: pyro, costType, enough: pyro <= pyroxene };
}

// ---------------------------------------------------------------- 里程碑（C-12）

export interface MilestoneHit {
  pulls: number;
  /** 里程碑奖励：限时十连券（暂只记录不发放，文案注明） */
  reward: 'limited-ten-ticket';
  /** 实装发放前恒为 false */
  delivered: false;
}

/** 结算一批抽取后命中的里程碑（按累计抽数跨越判定） */
export function hitMilestones(totalPullsBefore: number, batch: number): MilestoneHit[] {
  const hits: MilestoneHit[] = [];
  const after = totalPullsBefore + batch;
  for (const m of MILESTONE_PULLS) {
    if (totalPullsBefore < m && after >= m) {
      hits.push({ pulls: m, reward: 'limited-ten-ticket', delivered: false });
    }
  }
  return hits;
}

// ---------------------------------------------------------------- 理论值

/** 单抽 UP 概率（单 UP 池，未考虑保底） */
export const P_UP = RATES.UP;

/** 经典模式下，n 抽内至少出一个 UP 的概率（含 200 抽天井） */
export function classicUpProbability(n: number): number {
  const k = Math.min(n, PITY.CLASSIC_SPARK);
  const p = 1 - Math.pow(1 - RATES.UP, k - 1);
  return n >= PITY.CLASSIC_SPARK ? 1 : p;
}

/** 从 0 开始，抽到 UP 所需抽数的期望（几何分布截断到天井） */
export function classicExpectedPulls(): number {
  const p = RATES.UP;
  let ev = 0;
  for (let i = 1; i <= PITY.CLASSIC_SPARK; i++) {
    const prob = Math.pow(1 - p, i - 1) * (i === PITY.CLASSIC_SPARK ? 1 : p);
    ev += i * prob;
  }
  return ev;
}

export function bannerIsLimited(b: Banner): boolean {
  return b.type === 'limited' || b.type === 'fes';
}
