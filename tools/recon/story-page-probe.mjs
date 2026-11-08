/**
 * 剧情页探针（2026-11-08 走查⑦验证）
 *
 * 预置存档 story.lastPlayed/progress 后启动，进入剧情页主线 tab：
 *   - 截图主线话级条目（Scenario_Title 横幅样式核对）
 *   - 截图右侧空态（Deco 横幅提示 + 「继续播放」入口核对）
 *
 * 用法：node tools/recon/story-page-probe.mjs
 * 产物：tools/recon/out/story-probe-*.png
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../../scripts/env.mjs';

const OUT = 'tools/recon/out';
mkdirSync(OUT, { recursive: true });

// 预置存档：浅合并，缺的字段由 createDefaultSave 补齐
writeFileSync(
  '.userdata/save.json',
  JSON.stringify({
    story: { progress: { 11000: 60 }, cleared: [], lastPlayed: '11000' },
  })
);

const env = childEnv({ NODE_ENV: 'production' });
const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
}
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h * 0.45));
await page.waitForTimeout(1500);
await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h * 0.45));
await page.waitForSelector('.home', { timeout: 20000 });

// 进剧情页：home 底部导航优先，其次 shell 侧栏（与 e2e 的 goto 同序）
const bottom = page.locator('.bottom-item', { hasText: '剧情' });
if (await bottom.count()) await bottom.first().click();
else await page.locator('.nav-item', { hasText: '剧情' }).first().click();
await page.waitForSelector('.story-list', { timeout: 15000 });
await page.waitForTimeout(1200);

const state = await page.evaluate(() => {
  const banner = document.querySelector('.story-item-banner');
  const empty = document.querySelector('.player-empty');
  const resume = document.querySelector('.player-empty-resume');
  return {
    bannerCount: document.querySelectorAll('.story-item-banner').length,
    bannerText: banner ? banner.textContent?.trim() : null,
    bannerBg: banner ? getComputedStyle(banner).backgroundImage.slice(0, 60) : null,
    emptyExists: !!empty,
    resumeText: resume ? resume.textContent?.replace(/\s+/g, ' ').trim() : null,
  };
});
console.log('STATE:', JSON.stringify(state, null, 1));

const b64 = await app.evaluate(async ({ BrowserWindow }) =>
  (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
);
writeFileSync(path.join(OUT, 'story-probe-main.png'), Buffer.from(b64, 'base64'));
console.log('截图 tools/recon/out/story-probe-main.png');

await app.close();
