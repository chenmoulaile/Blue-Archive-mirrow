/**
 * 大厅看板娘 Spine 探针（2026-11-08 走查②修复用）
 *
 * 目的：抓 HomePage LobbyStage 里 ch0139_home（默认看板娘）的 SpineView
 * onError/console 错误原文，判断是 skel 解析、atlas 解析还是纹理加载问题。
 *
 * 用法：node tools/recon/spine-home-probe.mjs
 * 产物：stdout（错误原文）+ tools/recon/out/spine-probe-home.png
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

page.on('console', (m) => {
  const t = m.text();
  if (/spine|atlas|skel|texture|webgl/i.test(t)) console.log('[console]', m.type(), t.slice(0, 500));
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
}
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h * 0.45)); // 过 splash
await page.waitForTimeout(1600);
await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h * 0.45)); // 点击开始
await page.waitForSelector('.home', { timeout: 20000 });

// 等 spine 加载充分（成功或失败都该在数秒内定局）
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const fallback = document.querySelector('.ls-fallback');
  const canvas = document.querySelector('.ls-stage canvas');
  const errDiv = [...document.querySelectorAll('.ls-stage div')].find((d) => /无法渲染/.test(d.textContent || ''));
  const kanban = document.querySelector('.home-stage');
  // 读 canvas 像素，测实际不透明内容的包围盒占比
  let opaque = null;
  if (canvas) {
    try {
      const c2 = document.createElement('canvas');
      const W = 288, H = Math.round((288 * canvas.height) / canvas.width);
      c2.width = W;
      c2.height = H;
      const g = c2.getContext('2d');
      g.drawImage(canvas, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      let mnx = W, mny = H, mxx = -1, mxy = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] > 8) {
            if (x < mnx) mnx = x;
            if (x > mxx) mxx = x;
            if (y < mny) mny = y;
            if (y > mxy) mxy = y;
          }
        }
      }
      opaque = mxx < 0 ? 'empty' : { mnx, mny, mxx, mxy, W, H };
    } catch (e) {
      opaque = 'readfail:' + String(e).slice(0, 80);
    }
  }
  return {
    fallback: fallback ? fallback.textContent?.trim() : null,
    hasCanvas: !!canvas,
    canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasCss: canvas ? (({ width, height }) => ({ width, height }))(canvas.getBoundingClientRect()) : null,
    errText: errDiv ? errDiv.textContent?.trim() : null,
    kanbanClass: kanban ? kanban.className : null,
    opaque,
  };
});
console.log('STATE:', JSON.stringify(state, null, 1));

const b64 = await app.evaluate(async ({ BrowserWindow }) =>
  (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
);
writeFileSync(path.join(OUT, 'spine-probe-home.png'), Buffer.from(b64, 'base64'));
console.log('截图 tools/recon/out/spine-probe-home.png');

await app.close();
