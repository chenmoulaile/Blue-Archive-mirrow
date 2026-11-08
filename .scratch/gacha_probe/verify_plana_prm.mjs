/**
 * 分支验证：1) 限定池 → 普拉娜（CSS 剪影兜底 + data-ui-source 标记）；
 * 2) prefers-reduced-motion: reduce → 直接进 result（无障碍降级不崩）。
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

// ---- 1) 选限定池（列表里第 2 个含「限时招募」的项），单抽看普拉娜
const limitedItem = page.locator('.banner-item', { hasText: '限时招募' }).first();
await limitedItem.click();
await page.waitForTimeout(600);
console.log('已选限定池:', await limitedItem.locator('b').textContent());

await page.getByRole('button', { name: '招募 1 次' }).click();
await page.waitForSelector('[data-gacha-overlay]', { timeout: 5000 });
await page.waitForTimeout(900);
const planaCount = await page.locator('.gcs-plana').count();
const planaSource = planaCount ? await page.locator('.gcs-plana').first().getAttribute('data-ui-source') : null;
const aronaCount = await page.locator('.gcs-arona').count();
console.log('普拉娜剪影数=', planaCount, 'source=', planaSource, '阿罗娜图数=', aronaCount);
await shot('b1-plana-enter', 400);

// 跳过清理
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.locator('[data-gacha-close]').click();
await page.waitForTimeout(300);

// ---- 2) reduced-motion：emulate 后再抽，应直接 result
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.getByRole('button', { name: '招募 1 次' }).click();
await page.waitForSelector('[data-gacha-overlay]', { timeout: 5000 });
await page.waitForTimeout(250);
console.log('reduced-motion 首个 phase=', await phase(), '（期望 result）');
const phaseNow = await phase();
await shot('b2-reduced-motion-result', 300);
console.log('reduced-motion 直达 result =', phaseNow === 'result' ? '通过' : '未通过');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('[data-gacha-close]').click().catch(() => {});
await page.waitForTimeout(200);

console.log('控制台错误:', errors.length ? errors : '无');
await app.close();
process.exit(errors.length > 0 ? 1 : 0);
