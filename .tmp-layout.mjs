import { _electron as electron } from 'playwright-core';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env });
const page = await app.firstWindow();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '开始游戏' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: '剧情' }).first().click();
await page.waitForTimeout(1000);
await page.locator('.story-item').first().click();
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  const g = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], overflow: cs.overflow, height: cs.height };
  };
  return {
    win: [window.innerWidth, window.innerHeight],
    content: g('.content'),
    layout: g('.story-layout'),
    player: g('.player'),
    stage: g('.player-stage'),
    dialog: g('.player-dialog'),
    bar: g('.player-bar'),
    lineText: document.querySelector('.player-dialog .text')?.textContent?.slice(0, 60) ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
await app.close();
