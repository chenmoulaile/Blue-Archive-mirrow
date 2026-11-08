/**
 * 招募演出验证探针（非正式 e2e；正式门禁 scripts/e2e.mjs 不由本轨跑）
 * 预算：初始 1320 青辉石 = 单抽 120 + 十连 1200，顺序安排：
 *   1) 单抽 → ESC 跳过直达结果 → 返回
 *   2) 十连 → 全幕按节拍截图 → 结果页 → 单卡大图 → 关闭(不关结果页) → 再来一次(不足弹toast，覆盖层不崩) → 点空白关结果页
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../../scripts/env.mjs';

const OUT = '.scratch/gacha_probe/out';
mkdirSync(OUT, { recursive: true });

// 与 scripts/e2e.mjs 相同：干净存档起步
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
await page.mouse.click(tap.x, tap.y); // splash
await page.waitForTimeout(1600);
await page.mouse.click(tap.x, tap.y); // title TOUCH TO START
await page.waitForTimeout(3300);
await page.waitForSelector('.home', { timeout: 20000 });
console.log('已进入主界面');

await page.locator('.bottom-item', { hasText: '招募' }).first().click();
await page.waitForTimeout(1200);
await shot('p0-gacha-page');

// ---- 1) 单抽：进 enter 幕 → ESC 跳过 → 结果页
await page.getByRole('button', { name: '招募 1 次' }).click();
await page.waitForSelector('[data-gacha-overlay]', { timeout: 5000 });
console.log('单抽演出开启, phase=', await phase());
await shot('p1-single-enter', 700);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
console.log('ESC 跳过后 phase=', await phase());
await shot('p2-single-skipped-result', 400);
await page.locator('[data-gacha-close]').click();
await page.waitForTimeout(300);
console.log('返回后 overlay 数=', await page.locator('[data-gacha-overlay]').count());

// ---- 2) 十连：全幕
await page.getByRole('button', { name: '招募 10 次' }).click();
await page.waitForSelector('[data-gacha-overlay]', { timeout: 5000 });
console.log('十连演出开启, phase=', await phase());
await shot('p3-enter', 900);
await shot('p4-pull', 1100);
await shot('p5-flip-early', 700);
await shot('p6-flip-late', 2600);
await page.waitForFunction(
  () => document.querySelector('[data-gacha-overlay]')?.getAttribute('data-gacha-phase') === 'result',
  null,
  { timeout: 15000 }
);
await shot('p7-result', 900);

// 单卡大图 → 关闭后结果页仍在（回归：关闭不冒泡关掉整页）
await page.locator('.gcs-r-card').first().click();
await shot('p8-zoom', 500);
await page.getByRole('button', { name: '关闭' }).click();
await page.waitForTimeout(400);
console.log('关闭大图后：zoom 数=', await page.locator('.gcs-zoom').count(), 'overlay 仍在=', (await page.locator('[data-gacha-overlay]').count()) > 0, 'phase=', await phase());

// 再来一次（余额不足 → toast，覆盖层不崩）
await page.locator('[data-gacha-again]').click();
await page.waitForTimeout(600);
console.log('再来一次后 phase=', await phase(), '（余额不足时应保持 result）');
await shot('p9-again-insufficient', 300);

// 点空白关闭结果页（游戏同款「点击任意处离开」）
await page.locator('[data-gacha-overlay]').click({ position: { x: 60, y: 60 } });
await page.waitForTimeout(400);
console.log('点空白后 overlay 数=', await page.locator('[data-gacha-overlay]').count());
await shot('p10-back-to-page', 300);

console.log('控制台错误:', errors.length ? errors : '无');
await app.close();
process.exit(errors.length > 0 ? 1 : 0);
