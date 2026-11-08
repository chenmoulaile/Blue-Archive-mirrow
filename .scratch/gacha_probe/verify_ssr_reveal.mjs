/**
 * 确定性 SSR 验证：seed Math.random → 每抽必 ★3 →
 * 验证 SSR 音效链对应的视觉（金色爆发/眼部辉光）、翻卡金 aura、揭示幕（新学生录取/签字）、SSR 结果背景。
 * 只验证演出，不动概率逻辑（seed 只存在于本探针进程）。
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../../scripts/env.mjs';

const OUT = '.scratch/gacha_probe/out';
mkdirSync(OUT, { recursive: true });
rmSync('.userdata/save.json', { force: true });
rmSync('.userdata/config.json', { force: true });

const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env: childEnv({ NODE_ENV: 'production' }) });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text().slice(0, 200));
});

const shot = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  );
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'));
  console.log('  截图', name);
};
const phase = () => page.locator('[data-gacha-overlay]').getAttribute('data-gacha-phase');

await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
}
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const tap = { x: Math.round(vp.w / 2), y: Math.round(vp.h * 0.45) };
await page.mouse.click(tap.x, tap.y);
await page.waitForTimeout(1600);
await page.mouse.click(tap.x, tap.y);
await page.waitForTimeout(3300);
await page.waitForSelector('.home', { timeout: 20000 });

await page.locator('.bottom-item', { hasText: '招募' }).first().click();
await page.waitForTimeout(1200);

// SPA 不换文档，addInitScript 注入不到当前文档 —— 直接改当前文档的 Math.random：
// 每次抽卡 rng() 都命中 < 0.007 的 UP 区间 → 全 ★3（只影响本探针进程）
await page.evaluate(() => {
  Math.random = () => 0.001;
});

await page.getByRole('button', { name: '招募 10 次' }).click();
await page.waitForSelector('[data-gacha-overlay]', { timeout: 5000 });
await shot('s1-enter', 800);

// 先等 reveal 幕（全 ★3 → 必有新学生揭示），再补拍
await page.waitForFunction(
  () => document.querySelector('[data-gacha-overlay]')?.getAttribute('data-gacha-phase') === 'reveal',
  null,
  { timeout: 20000 }
);
console.log('揭示幕已触发, phase=', await phase());
await shot('s2-reveal-burst', 500);
await shot('s3-reveal-sign', 1500);

await page.waitForFunction(
  () => document.querySelector('[data-gacha-overlay]')?.getAttribute('data-gacha-phase') === 'result',
  null,
  { timeout: 10000 }
);
await shot('s4-result-ssr', 900);
console.log('最终 phase=', await phase());

console.log('控制台错误:', errors.length ? errors : '无');
await app.close();
process.exit(errors.length > 0 ? 1 : 0);
