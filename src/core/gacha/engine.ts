/**
 * 卡池概率与保底引擎（纯逻辑，不依赖 DOM）
 *
 * 概率常量集中在此，便于对照公开数据审计：
 *   ★3 合计 3%，其中当期 UP 0.7%，其余 ★3 共享 2.3%
 *   ★2 18.5%，★1 78.5%
 *
 * 两种保底：
 *   classic —— 200 抽天井。每抽 +1 点，满 200 必出 UP 且点数归零；
 *              自然歪出 UP 不清零，可跨池继承。
 *   charge  —— 充能。每抽 +1，第 100 抽若此前未出 UP 则必出 ★3（其中 50% 为 UP），
 *              第 200 抽必出 UP；一旦获得 UP 充能立刻归零，不跨池继承。
 *              一般池与限定池充能互不相通。
 */

import type { Banner, PityMode, Student } from '../../types';

export const RATES = {
  /** ★3 总概率 */
  STAR3: 0.03,
  /** 其中当期 UP */
  UP: 0.007,
  /** ★2 */
  STAR2: 0.185,
  /** ★1 */
  STAR1: 0.785,
} as const;

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

export type Forced = 'none' | 'spark' | 'soft' | 'hard' | 'guarantee';

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

export interface PullContext {
  mode: PityMode;
  /** 限定池走 chargeLimited，其余走 chargeNormal / classicPoints */
  limited: boolean;
  upName: string | null;
}

export interface Pool {
  star1: Student[];
  star2: Student[];
  star3: Student[];
  byName: Map<string, Student>;
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

  if (forced === 'none') {
    const r = rng();
    if (r < RATES.UP) {
      star = 3;
      isUp = true;
    } else if (r < RATES.STAR3) {
      star = 3;
    } else if (r < RATES.STAR3 + RATES.STAR2) {
      star = 2;
    } else {
      star = 1;
    }
    // 充能模式：自然抽到 UP 立刻清零
    if (ctx.mode === 'charge' && isUp) setPity(state, ctx, 0);
  }

  const upName = ctx.upName;
  let student: Student | undefined;
  if (isUp && upName) {
    student = pool.byName.get(upName) ?? pool.byName.get(upName.toLowerCase());
  }
  if (!student) {
    const tier = star === 3 ? pool.star3 : star === 2 ? pool.star2 : pool.star1;
    const candidates = isUp ? tier : tier;
    student = pick(candidates, rng);
  }

  return {
    star,
    name: student?.name ?? '未知',
    studentId: student?.id ?? null,
    isUp: isUp && !!upName,
    forced,
    pityAfter: currentPity(state, ctx),
  };
}

/**
 * 十连。按公开规则：十连至少出现一名 ★2 以上；
 * 若十抽全是 ★1，则把最后一抽提升为 ★2。
 */
export function pullTen(
  state: PityState,
  ctx: PullContext,
  pool: Pool,
  rng: () => number = Math.random
): PullResult[] {
  const out: PullResult[] = [];
  for (let i = 0; i < 10; i++) out.push(pullOne(state, ctx, pool, rng));

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

// ---------------------------------------------------------------- 理论值

/** 单抽 UP 概率（未考虑保底） */
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
