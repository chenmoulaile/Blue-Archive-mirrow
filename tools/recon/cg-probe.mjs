/**
 * cg-probe.mjs — 剧情演出层临时探针（S-3 CG / S-4 telop / 语音）
 * 验证 80000005（新的巧克力产品！：popup Event01_Hihumi + subtitle 2），
 * 产物 tools/recon/out/cgprobe-*.png。验证完删除本文件。
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../../scripts/env.mjs';

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
const fails = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text().slice(0, 200));
});
page.on('requestfailed', (r) => fails.push(`${r.failure()?.errorText} ${r.url()}`.slice(0, 140)));
const capture = async (name) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  );
  writeFileSync(path.join(OUT, `cgprobe-${name}.png`), Buffer.from(b64, 'base64'));
  console.log('shot', name);
};

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
await page.waitForTimeout(1100);
await page.waitForSelector('.home', { timeout: 20000 });

// 进剧情页 → 羁绊覆盖层 → 打开 1010603「另一个自己」（subtitle@103 有真实文本）
const nav = page.locator('.bottom-item, .nav-item', { hasText: '剧情' });
await nav.first().click();
await page.waitForSelector('.story-item', { timeout: 10000 });
await page.locator('.story-mode-seg button', { hasText: '羁绊' }).click();
await page.waitForTimeout(800);
await page.locator('.group-filter').fill('另一个自己');
await page.waitForTimeout(600);
const item = page.locator('.story-item', { hasText: '另一个自己' }).first();
if (!(await item.count())) {
  console.log('NO item');
} else {
  await item.click();
  await page.waitForSelector('[data-testid="story-dialog"]', { timeout: 10000 });
  console.log('player open');
  // 推进直到 subtitle telop 出现（@103，节点较深）
  let telopSeen = false;
  for (let i = 0; i < 110 && !telopSeen; i++) {
    const choiceBtn = page.locator('.choice-overlay .story-choice-btn').first();
    if (await choiceBtn.count()) {
      await choiceBtn.click();
      await page.waitForTimeout(280);
      continue;
    }
    await page.locator('.player-stage').click({ position: { x: 120, y: 80 } });
    await page.waitForTimeout(200);
    if (await page.locator('.story-telop-subtitle').count()) telopSeen = true;
  }
  console.log('subtitle telop:', telopSeen);
  const telopText = await page.locator('.story-telop-subtitle').textContent().catch(() => '');
  console.log('telop text:', (telopText ?? '').slice(0, 40));
  await capture('telop');
  // telop 停顿点：再点一次应继续（off 清除）
  await page.locator('.player-stage').click({ position: { x: 120, y: 80 } });
  await page.waitForTimeout(400);
  console.log('telop cleared after click:', (await page.locator('.story-telop-subtitle').count()) === 0);
  await capture('after-telop');
}
console.log('console errors:', JSON.stringify(errors.slice(0, 6)));
console.log('failed requests:', JSON.stringify(fails.filter((f) => !f.includes('SE_')).slice(0, 8)));
await app.close();
