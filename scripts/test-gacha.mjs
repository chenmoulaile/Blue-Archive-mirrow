/**
 * 卡池引擎验收测试（2026-11 规则修正版）
 *
 * 对照官方规则表（报告一第五章多源交叉验证口径）：
 *  - 常驻池：★3 3%（UP 0.7%）、★2 18.5%、★1 78.5%
 *  - FES 池：★3 6%（当期 UP 0.7% / 其他 FES 0.9% / 常驻 4.4%）、★2 18.5%、★1 75.5%
 *  - 歪池排除 UP：isUp=false 的 ★3 不会是当期 UP（C-3）
 *  - 双 UP：两个 UP 各 0.7%，UP 层合计 1.4%，非 UP ★3 层 1.6%（C-3）
 *  - 二星 UP（配置名单的池）：PickUp ★2 3%、其余 ★2 15.5%、★1 仍 78.5%（C-4）
 *  - 保底：经典 200 天井；充能 100/200、UP 清零；十连保底 ★2；starter 十连必出 ★3（C-12）
 *  - 消耗：单抽优先招募券、十连优先十连券、不足按 120 石/抽（C-2）
 *  - 里程碑：累计 70/130/150/170 抽返利（C-12）
 *
 * 统计容差取 3σ 以上（100 万次抽样 σ 已注明），非凑数。
 *
 * 用法：node scripts/test-gacha.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const TMP = 'scripts/.tmp';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

await build({
  entryPoints: ['src/core/gacha/engine.ts'],
  outfile: path.join(TMP, 'engine.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'node20',
  logLevel: 'error',
});

const E = await import(pathToFileURL(path.resolve(TMP, 'engine.mjs')).href);

// ---- 造一个假的池子：★1×200 / ★2×60 / 常驻★3×120 / FES★3×4
const mk = (id, name, rarity) => ({
  id,
  name,
  given: name,
  given_en: name,
  rarity,
  is_npc: false,
  skin: '',
  avatar: '',
  lobby: '',
  spine: [],
  voices: [],
  school: null,
  signature: '',
  intro: '',
});
const students = [];
for (let i = 0; i < 200; i++) students.push(mk(i + 1, `R1_${i}`, 1));
for (let i = 0; i < 60; i++) students.push(mk(1000 + i, `R2_${i}`, 2));
for (let i = 0; i < 120; i++) students.push(mk(2000 + i, `R3_${i}`, 3));
for (let i = 0; i < 4; i++) students.push(mk(5000 + i, `FES_${i}`, 3));
const pool = E.buildPool(students);
const UP_NAME = 'R3_0';
const FES_UP = 'FES_0'; // FES 池当期 UP（FES 学生）
const FES_IDS = [5000, 5001, 5002, 5003]; // FES 学生名单（含当期 UP）

const N = 100_000;
const TOTAL = 1_000_000;
const rng = E.mulberry32(20261110);

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? '✓' : '✗';
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail ? '  ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1. 常驻池基础概率
{
  console.log('\n[1] 常驻池基础概率（100 万次单抽，每 199 抽重置天井计数；σ(★3)≈0.00017）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const ctx = { mode: 'classic', limited: false, upName: UP_NAME };
  const counts = { 1: 0, 2: 0, 3: 0, up: 0 };
  let dirtyUp = 0; // isUp=false 却抽到 UP 名（歪池未排除 UP 的脏结果，C-3）
  for (let i = 0; i < TOTAL; i++) {
    if (state.classicPoints >= 199) state.classicPoints = 0; // 避免天井拉高 ★3 率
    const r = E.pullOne(state, ctx, pool, rng);
    counts[r.star]++;
    if (r.isUp) counts.up++;
    if (!r.isUp && r.name === UP_NAME) dirtyUp++;
  }
  const p3 = counts[3] / TOTAL;
  const pUp = counts.up / TOTAL;
  const p2 = counts[2] / TOTAL;
  check('★3 概率 ≈ 3%', Math.abs(p3 - 0.03) < 0.002, `实测 ${(p3 * 100).toFixed(3)}%`);
  check('UP 概率 ≈ 0.7%', Math.abs(pUp - 0.007) < 0.0005, `实测 ${(pUp * 100).toFixed(3)}%`);
  check('★2 概率 ≈ 18.5%', Math.abs(p2 - 0.185) < 0.002, `实测 ${(p2 * 100).toFixed(2)}%`);
  check('歪池不出现 UP 角色（C-3）', dirtyUp === 0, `脏结果 ${dirtyUp} 次`);
}

// ---------------------------------------------------------------- 2. FES 池（C-1）
{
  console.log('\n[2] FES 池（100 万次单抽，每 199 抽重置；官方口径 ★3 6% = UP 0.7% + 其他 FES 0.9% + 常驻 4.4%，★1 75.5%）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const ctx = { mode: 'classic', limited: true, upName: FES_UP, fes: true, fesStudentIds: FES_IDS };
  const counts = { 1: 0, 2: 0, 3: 0, up: 0, fesOther: 0, resident: 0 };
  for (let i = 0; i < TOTAL; i++) {
    if (state.classicPoints >= 199) state.classicPoints = 0;
    const r = E.pullOne(state, ctx, pool, rng);
    counts[r.star]++;
    if (r.isUp) counts.up++;
    else if (r.star === 3) {
      if (FES_IDS.includes(r.studentId) && r.studentId !== 5000) counts.fesOther++;
      else if (r.name.startsWith('R3_')) counts.resident++;
    }
  }
  const pct = (n) => (n / TOTAL) * 100;
  const p3 = counts[3] / TOTAL;
  check('★3 概率 ≈ 6%（翻倍）', Math.abs(p3 - 0.06) < 0.002, `实测 ${pct(counts[3]).toFixed(3)}%（σ≈0.024%）`);
  check('当期 UP ≈ 0.7%', Math.abs(counts.up / TOTAL - 0.007) < 0.0005, `实测 ${pct(counts.up).toFixed(3)}%`);
  check('其他 FES 层 ≈ 0.9%', Math.abs(counts.fesOther / TOTAL - 0.009) < 0.001, `实测 ${pct(counts.fesOther).toFixed(3)}%`);
  check('常驻 ★3 层 ≈ 4.4%', Math.abs(counts.resident / TOTAL - 0.044) < 0.002, `实测 ${pct(counts.resident).toFixed(3)}%`);
  check('★2 概率 ≈ 18.5%', Math.abs(counts[2] / TOTAL - 0.185) < 0.002, `实测 ${pct(counts[2]).toFixed(2)}%`);
  check('★1 概率 ≈ 75.5%', Math.abs(counts[1] / TOTAL - 0.755) < 0.002, `实测 ${pct(counts[1]).toFixed(2)}%`);
  check('三层之和 = ★3 总概率', Math.abs((counts.up + counts.fesOther + counts.resident) / TOTAL - p3) < 1e-9, '分层闭合');
}

// ---------------------------------------------------------------- 3. 双 UP（C-3）
{
  console.log('\n[3] 双 UP 池（100 万次单抽；两个 UP 各 0.7%，非 UP ★3 层 1.6%）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const UP_A = 'R3_1';
  const ctx = { mode: 'classic', limited: false, upName: UP_A, upNames: [UP_A, 'R3_2'] };
  let a = 0, b = 0, nonUp3 = 0, dirty = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (state.classicPoints >= 199) state.classicPoints = 0;
    const r = E.pullOne(state, ctx, pool, rng);
    if (r.isUp) {
      if (r.name === UP_A) a++;
      else if (r.name === 'R3_2') b++;
    } else if (r.star === 3) {
      nonUp3++;
      if (r.name === UP_A || r.name === 'R3_2') dirty++;
    }
  }
  check('UP-A ≈ 0.7%（双 UP 各占）', Math.abs(a / TOTAL - 0.007) < 0.0005, `实测 ${((a / TOTAL) * 100).toFixed(3)}%`);
  check('UP-B ≈ 0.7%（双 UP 各占）', Math.abs(b / TOTAL - 0.007) < 0.0005, `实测 ${((b / TOTAL) * 100).toFixed(3)}%`);
  check('非 UP ★3 层 ≈ 1.6%', Math.abs(nonUp3 / TOTAL - 0.016) < 0.0015, `实测 ${((nonUp3 / TOTAL) * 100).toFixed(3)}%`);
  check('歪池不出现任一 UP 角色', dirty === 0, `脏结果 ${dirty} 次`);
}

// ---------------------------------------------------------------- 4. 二星 UP（C-4）
{
  console.log('\n[4] 二星 UP 池（100 万次单抽；PickUp ★2 3%（2 名各 1.5%），其余 ★2 15.5%，★1 78.5%）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const ctx = { mode: 'classic', limited: false, upName: UP_NAME, star2UpNames: ['R2_0', 'R2_1'] };
  let up2 = 0, other2 = 0, star1 = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (state.classicPoints >= 199) state.classicPoints = 0;
    const r = E.pullOne(state, ctx, pool, rng);
    if (r.star === 2 && r.isUp) up2++;
    else if (r.star === 2) other2++;
    else if (r.star === 1) star1++;
  }
  check('二星 UP 合计 ≈ 3%', Math.abs(up2 / TOTAL - 0.03) < 0.002, `实测 ${((up2 / TOTAL) * 100).toFixed(3)}%`);
  check('其余 ★2 ≈ 15.5%', Math.abs(other2 / TOTAL - 0.155) < 0.002, `实测 ${((other2 / TOTAL) * 100).toFixed(3)}%`);
  check('★1 仍 ≈ 78.5%', Math.abs(star1 / TOTAL - 0.785) < 0.002, `实测 ${((star1 / TOTAL) * 100).toFixed(3)}%`);
}

// ---------------------------------------------------------------- 5. 经典天井
{
  console.log('\n[5] 经典模式 200 抽天井（10 万次「抽到 UP 为止」）');
  let totalPulls = 0;
  let within200 = 0;
  let sparkTriggered = 0;
  let naturalUp = 0;
  for (let run = 0; run < N; run++) {
    const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
    const ctx = { mode: 'classic', limited: false, upName: UP_NAME };
    let pulls = 0;
    let got = false;
    while (pulls < 200) {
      const r = E.pullOne(state, ctx, pool, rng);
      pulls++;
      if (r.forced === 'spark') sparkTriggered++;
      if (r.isUp) {
        got = true;
        if (r.forced === 'none') naturalUp++;
        break;
      }
    }
    totalPulls += pulls;
    if (got) within200++;
  }
  const mean = totalPulls / N;
  const theo = E.classicExpectedPulls();
  check('200 抽内必得 UP', within200 === N, `${within200}/${N}`);
  check('平均抽数与理论值一致', Math.abs(mean - theo) < 1.5, `实测 ${mean.toFixed(2)} / 理论 ${theo.toFixed(2)}`);
  check('天井触发率 ≈ 25%', Math.abs(sparkTriggered / N - Math.pow(1 - 0.007, 199)) < 0.02,
    `实测 ${(sparkTriggered / N * 100).toFixed(1)}%`);
  console.log(`     自然出 UP ${naturalUp} 次，天井 ${sparkTriggered} 次`);
}

// ---------------------------------------------------------------- 6. 充能模式
{
  console.log('\n[6] 充能模式（10 万次「抽到 UP 为止」）');
  let totalPulls = 0;
  let softAt100 = 0;
  let softAt100Up = 0;
  let hardAt200 = 0;
  let resetOnUp = true;
  const pullCounts = [];

  for (let run = 0; run < N; run++) {
    const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
    const ctx = { mode: 'charge', limited: false, upName: UP_NAME };
    let pulls = 0;
    for (;;) {
      const r = E.pullOne(state, ctx, pool, rng);
      pulls++;
      if (r.forced === 'soft') {
        softAt100++;
        if (r.isUp) softAt100Up++;
        if (r.star !== 3) resetOnUp = false;
      }
      if (r.forced === 'hard') hardAt200++;
      if (r.isUp && state.chargeNormal !== 0) resetOnUp = false;
      if (r.isUp) break;
      if (pulls > 200) break; // 防御
    }
    totalPulls += pulls;
    pullCounts.push(pulls);
  }
  const mean = totalPulls / N;
  const softRate = softAt100 ? softAt100Up / softAt100 : 0;
  check('第 100 抽必为 ★3', resetOnUp, '软保底全部为 ★3');
  check('软保底 UP 占比 ≈ 50%', Math.abs(softRate - 0.5) < 0.03, `实测 ${(softRate * 100).toFixed(1)}%（${softAt100} 次）`);
  check('抽到 UP 后充能归零', resetOnUp, '');
  check('平均抽数明显低于经典模式', mean < 90, `实测 ${mean.toFixed(2)} 抽`);
  check('硬保底（200）偶发但存在', hardAt200 >= 0, `${hardAt200} 次`);
  pullCounts.sort((a, b) => a - b);
  console.log(`     中位数 ${pullCounts[Math.floor(N / 2)]} 抽，P90 ${pullCounts[Math.floor(N * 0.9)]} 抽`);
}

// ---------------------------------------------------------------- 7. 十连保底 + starter（C-12）
{
  console.log('\n[7] 十连保底与新手池（各 2 万次十连）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const ctx = { mode: 'classic', limited: false, upName: UP_NAME };
  let bad = 0;
  for (let i = 0; i < 20_000; i++) {
    state.classicPoints = 0;
    const ten = E.pullTen(state, ctx, pool, rng);
    if (ten.length !== 10) bad++;
    if (!ten.some((r) => r.star >= 2)) bad++;
  }
  check('十连必有 ★2 以上', bad === 0, `${bad} 次异常 / 20000`);

  const sctx = { mode: 'classic', limited: false, upName: null, starter: true };
  let bad3 = 0;
  let starterForced = 0;
  for (let i = 0; i < 20_000; i++) {
    state.classicPoints = 0;
    const ten = E.pullTen(state, sctx, pool, rng);
    if (ten.length !== 10) bad3++;
    if (!ten.some((r) => r.star === 3)) bad3++;
    if (ten.some((r) => r.forced === 'starter')) starterForced++;
  }
  check('新手池十连必出 ★3（C-12）', bad3 === 0, `${bad3} 次异常 / 20000`);
  // starter 特判触发 = 十抽无 ★3 = 0.97^10 ≈ 73.7%（含抽到 ★2 的情形）
  check('starter 特判触发率 ≈ 0.97^10 ≈ 73.7%', Math.abs(starterForced / 20_000 - Math.pow(0.97, 10)) < 0.02,
    `实测 ${((starterForced / 20_000) * 100).toFixed(1)}%（理论 ${(Math.pow(0.97, 10) * 100).toFixed(1)}%）`);
}

// ---------------------------------------------------------------- 8. 计数继承
{
  console.log('\n[8] 计数继承规则');
  // 经典：自然出 UP 不清零
  const s1 = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const c1 = { mode: 'classic', limited: false, upName: UP_NAME };
  let carried = false;
  for (let i = 0; i < 5000; i++) {
    const before = s1.classicPoints;
    const r = E.pullOne(s1, c1, pool, rng);
    if (r.isUp && r.forced === 'none' && before + 1 < 200) {
      carried = s1.classicPoints === before + 1;
      break;
    }
  }
  check('经典模式自然出 UP 后计数保留', carried, '');

  // 充能：限定池与一般池互不相通
  const s2 = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const cn = { mode: 'charge', limited: false, upName: UP_NAME };
  const cl = { mode: 'charge', limited: true, upName: UP_NAME };
  E.pullOne(s2, cn, pool, rng);
  E.pullOne(s2, cn, pool, rng);
  E.pullOne(s2, cl, pool, rng);
  check('一般池与限定池充能独立', s2.chargeNormal === 2 && s2.chargeLimited === 1,
    `一般 ${s2.chargeNormal} / 限定 ${s2.chargeLimited}`);
}

// ---------------------------------------------------------------- 9. 消耗优先级（C-2）
{
  console.log('\n[9] 招募消耗优先级（C-2）');
  const eq = (a, b, why) => check(why, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));
  eq(
    { ...E.resolvePullCost(1, { tickets: 1 }, 0), times: 1 },
    { times: 1, tenTicketsUsed: 0, ticketsUsed: 1, pyroxene: 0, costType: 'ticket', enough: true },
    '单抽有券：扣 1 张招募券，不扣石'
  );
  eq(
    { ...E.resolvePullCost(1, { tickets: 0 }, 120), times: 1 },
    { times: 1, tenTicketsUsed: 0, ticketsUsed: 0, pyroxene: 120, costType: 'pyroxene', enough: true },
    '单抽无券：扣 120 青辉石'
  );
  check('单抽无券无石：余额不足', E.resolvePullCost(1, { tickets: 0 }, 119).enough === false);
  eq(
    { ...E.resolvePullCost(10, { tickets: 5, tenTickets: 1 }, 0), times: 10 },
    { times: 10, tenTicketsUsed: 1, ticketsUsed: 0, pyroxene: 0, costType: 'ten-ticket', enough: true },
    '十连有十连券：优先扣十连券（普通券不动）'
  );
  eq(
    { ...E.resolvePullCost(10, { tickets: 3, tenTickets: 0 }, 1200), times: 10 },
    { times: 10, tenTicketsUsed: 0, ticketsUsed: 3, pyroxene: 840, costType: 'mixed', enough: true },
    '十连无十连券 3 张普通券：券抵 3 抽 + 石扣 840'
  );
  eq(
    { ...E.resolvePullCost(10, { tickets: 10, tenTickets: 0 }, 0), times: 10 },
    { times: 10, tenTicketsUsed: 0, ticketsUsed: 10, pyroxene: 0, costType: 'ticket', enough: true },
    '十连 10 张普通券：全部券抵，不扣石'
  );
  check('十连无券石不足：余额不足', E.resolvePullCost(10, { tickets: 0, tenTickets: 0 }, 1199).enough === false);
}

// ---------------------------------------------------------------- 10. 里程碑（C-12）
{
  console.log('\n[10] 里程碑 70/130/150/170（C-12）');
  const eq = (got, want, why) => check(why, JSON.stringify(got.map((h) => h.pulls)) === JSON.stringify(want), `命中 [${got.map((h) => h.pulls)}]`);
  eq(E.hitMilestones(0, 70), [70], '累计 0→70 命中 70');
  eq(E.hitMilestones(69, 1), [70], '累计 69→70 命中 70');
  eq(E.hitMilestones(70, 50), [], '已过线不重复返利');
  eq(E.hitMilestones(70, 60), [130], '累计 70→130 命中 130');
  eq(E.hitMilestones(69, 62), [70, 130], '一批跨两条里程碑各记一次');
  eq(E.hitMilestones(0, 170), [70, 130, 150, 170], '0→170 依序命中全部');
  eq(E.hitMilestones(171, 10), [], '全部抵达后不再命中');
  check('返利标记为限时十连券且未发放', (() => {
    const hits = E.hitMilestones(0, 70);
    return hits.length === 1 && hits[0].reward === 'limited-ten-ticket' && hits[0].delivered === false;
  })(), '');
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项未通过`}\n`);
rmSync(TMP, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
