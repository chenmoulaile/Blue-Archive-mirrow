/**
 * story-recon.mjs — 剧情轨自查脚本（非正式 e2e 门禁）
 *
 * 只验证剧情播放器三个新路径：
 *   1. spr 立绘渲染（SpineCanvas 加载 shizuko_spr）
 *   2. 表情差分切换（sequence 变化）
 *   3. 选项真分支（点选项跳 branch 段）
 * 产物：tools/recon/out/story-recon-*.png
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from './env.mjs';

const OUT = 'tools/recon/out';
mkdirSync(OUT, { recursive: true });
rmSync('.userdata/save.json', { force: true });
rmSync('.userdata/config.json', { force: true });

const env = childEnv({ NODE_ENV: 'production' });
const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text().slice(0, 300));
});
const capture = async (name) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  );
  writeFileSync(path.join(OUT, `story-recon-${name}.png`), Buffer.from(b64, 'base64'));
  console.log('shot', name);
};
const shot = async (name, wait = 800) => {
  await page.waitForTimeout(wait);
  await capture(name);
};

// ---- 向导 + 启动（与 e2e.mjs 相同的流程，不写死坐标）
await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
  console.log('向导已跳过');
}
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const tap = { x: Math.round(vp.w / 2), y: Math.round(vp.h * 0.45) };
await page.mouse.click(tap.x, tap.y); // splash
await page.waitForTimeout(1600);
await page.mouse.click(tap.x, tap.y); // title TOUCH TO START
await page.waitForTimeout(1100);
await page.waitForSelector('.home', { timeout: 20000 });
await shot('00-home', 1200);

// ---- 进剧情页
let entered = false;
for (const sel of ['.bottom-item', '.nav-item']) {
  const nav = page.locator(sel, { hasText: '剧情' });
  if (await nav.count()) {
    await nav.first().click();
    entered = true;
    break;
  }
}
console.log('entered story page:', entered);
await shot('01-story-list', 1200);
console.log('story items:', await page.locator('.story-item').count());
console.log('event sections: (需点活动 tab)');
// 活动分组检查
const evTab = page.locator('.seg button', { hasText: '活动' });
if (await evTab.count()) {
  await evTab.click();
  await page.waitForTimeout(1200);
  await capture('02-event-groups');
  console.log('section heads:', await page.locator('.story-section-head b').allTextContents().then((a) => a.slice(0, 6)));
  console.log('section heads count:', await page.locator('.story-section-head').count());
  // 回主线 tab
  const mainTab = page.locator('.seg button', { hasText: '主线' });
  await mainTab.click();
  await page.waitForTimeout(700);
}

// ---- 打开「序幕」（10000005：54 句，静子立绘 + 多个选项分支）
const target = page.locator('.story-item', { hasText: '序幕' }).first();
const first = (await target.count()) ? target : page.locator('.story-item').first();
if (await first.count()) {
  await first.click();
  await page.waitForTimeout(3200);
  await capture('03-player-open');
  console.log('actors on stage:', await page.locator('.story-actor').count());
  console.log('portrait canvases:', await page.locator('.story-portrait canvas').count());
  console.log('dialog visible:', await page.locator('[data-testid="story-dialog"]').count());
  console.log('corner avatar:', await page.locator('.dialog-corner-avatar').count());
  console.log('actor avatars (fallback):', await page.locator('.story-actor-avatar').count());
  console.log('actor nameplates (fallback):', await page.locator('.story-actor-nameplate').count());

  // 推进若干句，观察立绘/表情与选项
  for (let i = 0; i < 14; i++) {
    const choiceBtn = page.locator('.choice-overlay .story-choice-btn').first();
    if (await choiceBtn.count()) {
      console.log('== choice at step', i, 'options:', await page.locator('.choice-overlay .story-choice-btn').count());
      await capture('04-choice');
      await choiceBtn.click();
      await page.waitForTimeout(700);
      await capture('05-after-choice');
      console.log('branch badge visible:', await page.locator('[data-testid="branch-badge"]').count());
      continue;
    }
    await page.locator('.player-stage').click({ position: { x: 120, y: 80 } });
    await page.waitForTimeout(450);
  }
  await capture('06-advanced');
  console.log('actors after advance:', await page.locator('.story-actor').count());
  console.log('portrait canvases after:', await page.locator('.story-portrait canvas').count());
  console.log('speaker name:', await page.locator('.player-dialog .speaker').allTextContents());

  // 回看面板
  const logBtn = page.locator('[data-testid="story-log-btn"]');
  if (await logBtn.count()) {
    await logBtn.click();
    await page.waitForTimeout(500);
    await capture('07-history');
    console.log('history rows:', await page.locator('.history-row').count());
    await page.locator('.history-panel').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
  }

  // 上一句（回退）
  const before = await page.locator('.player-dialog .text').textContent().catch(() => '');
  const prevBtn = page.locator('.player-bar button', { hasText: '上一句' });
  await prevBtn.click();
  await page.waitForTimeout(600);
  const after = await page.locator('.player-dialog .text').textContent().catch(() => '');
  console.log('back works:', before !== after, '| before:', (before ?? '').slice(0, 14), '| after:', (after ?? '').slice(0, 14));
  await capture('08-back');
} else {
  console.log('NO story items');
}
console.log('console errors:', JSON.stringify(errors.slice(0, 8), null, 1));
await app.close();
