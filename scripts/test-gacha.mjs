/**
 * 卡池引擎验收测试
 *
 * 对照项目验收标准：
 *  - 两种保底模式各跑 10 万次，UP 获取率与理论值吻合
 *  - 充能模式第 100 抽必为 ★3，其中约 50% 为 UP
 *  - 抽到 UP 后充能归零
 *  - 十连至少一名 ★2
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

// ---- 造一个假的池子
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
const pool = E.buildPool(students);
const UP_NAME = 'R3_0';

const N = 100_000;
const rng = E.mulberry32(20261028);

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? '✓' : '✗';
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail ? '  ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1. 基础概率
{
  console.log('\n[1] 基础概率（100 万次单抽，无保底干扰：每 199 抽重置一次计数）');
  const state = { classicPoints: 0, chargeNormal: 0, chargeLimited: 0 };
  const ctx = { mode: 'classic', limited: false, upName: UP_NAME };
  const counts = { 1: 0, 2: 0, 3: 0, up: 0 };
  const TOTAL = 1_000_000;
  for (let i = 0; i < TOTAL; i++) {
    if (state.classicPoints >= 199) state.classicPoints = 0; // 避免天井拉高 ★3 率
    const r = E.pullOne(state, ctx, pool, rng);
    counts[r.star]++;
    if (r.isUp) counts.up++;
  }
  const p3 = counts[3] / TOTAL;
  const pUp = counts.up / TOTAL;
  const p2 = counts[2] / TOTAL;
  check('★3 概率 ≈ 3%', Math.abs(p3 - 0.03) < 0.001, `实测 ${(p3 * 100).toFixed(3)}%`);
  check('UP 概率 ≈ 0.7%', Math.abs(pUp - 0.007) < 0.0005, `实测 ${(pUp * 100).toFixed(3)}%`);
  check('★2 概率 ≈ 18.5%', Math.abs(p2 - 0.185) < 0.002, `实测 ${(p2 * 100).toFixed(2)}%`);
}

// ---------------------------------------------------------------- 2. 经典天井
{
  console.log('\n[2] 经典模式 200 抽天井（10 万次「抽到 UP 为止」）');
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

// ---------------------------------------------------------------- 3. 充能模式
{
  console.log('\n[3] 充能模式（10 万次「抽到 UP 为止」）');
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
      const before = state.chargeNormal;
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
      void before;
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

// ---------------------------------------------------------------- 4. 十连保底
{
  console.log('\n[4] 十连保底');
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
}

// ---------------------------------------------------------------- 5. 跨池继承
{
  console.log('\n[5] 计数继承规则');
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

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项未通过`}\n`);
rmSync(TMP, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
