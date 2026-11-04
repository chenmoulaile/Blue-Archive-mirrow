/**
 * 主界面布局自检
 *
 * 目的：game-ui-spec.ts 里的尺寸大量是 estimate，靠肉眼看截图无法定位「差几像素」。
 * 这里在真实窗口里量出每个锚点元素的 boundingRect，并检查几类必然翻车的重叠：
 *   - 右侧图标列 vs 底部导航
 *   - 右上圆形横幅 vs 右侧图标列
 *   - 左下方形横幅 vs 底部导航
 *   - 顶部栏 vs 右上圆形横幅
 *
 * 用法：node scripts/measure-ui.mjs [窗口宽] [窗口高]
 * 产物：控制台 JSON + tools/recon/out/layout-<宽>x<高>.json
 */
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from './env.mjs';

const OUT = 'tools/recon/out';
mkdirSync(OUT, { recursive: true });

// dist/（渲染层构建产物）不入库，干净检出后直接跑本脚本会白屏直到超时。
// 缺失就现场构建一次，保证测试自洽；构建失败按失败退出，不吞错误。
if (!existsSync('dist/index.html')) {
  console.log('dist/index.html 缺失，先执行 vite build …');
  const { build } = await import('vite');
  await build({ logLevel: 'info' });
}

const W = Number(process.argv[2] ?? 1920);
const H = Number(process.argv[3] ?? 1080);

const env = childEnv({ NODE_ENV: 'production' });

const app = await electron.launch({
  args: ['.', '--no-sandbox'],
  cwd: process.cwd(),
  env,
});

const page = await app.firstWindow();
await page.setViewportSize({ width: W, height: H }).catch(() => {});
await app.evaluate(({ BrowserWindow }, size) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(size.w, size.h);
}, { w: W, h: H });

// 跳过启动流程：先处理首次启动向导，再点掉 splash / 标题
await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
}
await page.waitForTimeout(800);
await page.mouse.click(W / 2, H / 2); // splash
await page.waitForTimeout(1500);
await page.mouse.click(W / 2, H / 2); // title -> loading
await page.waitForSelector('.home', { timeout: 20000 });
await page.waitForTimeout(1200);

const rects = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
      bottom: Math.round(b.bottom),
      right: Math.round(b.right),
    };
  };
  const all = (sel) => [...document.querySelectorAll(sel)].map((el) => {
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
      bottom: Math.round(b.bottom),
      right: Math.round(b.right),
      text: (el.textContent ?? '').trim().slice(0, 8),
    };
  });
  return {
    win: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    home: pick('.home'),
    top: pick('.home-top'),
    resources: pick('.resources'),
    side: pick('.home-side'),
    sideBtns: all('.side-btn'),
    bottom: pick('.home-bottom'),
    bottomItems: all('.bottom-item'),
    bannerRound: pick('.banner-round'),
    bannerSquare: pick('.banner-square'),
    kanbanBar: pick('.kanban-bar'),
  };
});

/** 两个矩形的重叠面积（0 表示不重叠） */
const overlap = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const problems = [];
const { side, bottom, bannerRound, bannerSquare, top, kanbanBar } = rects;

if (overlap(side, bottom)) problems.push('右侧图标列与底部导航重叠');
if (overlap(bannerRound, side)) problems.push('右上圆形横幅与右侧图标列重叠');
if (overlap(bannerSquare, bottom)) problems.push('左下方形横幅与底部导航重叠');
if (overlap(bannerRound, top)) problems.push('右上圆形横幅与顶部栏重叠');
if (overlap(kanbanBar, bottom)) problems.push('看板娘信息条与底部导航重叠');
if (bottom && bottom.bottom > rects.win.h + 1) problems.push('底部导航超出窗口下边缘');
if (bottom && bottom.h < 40) problems.push(`底部导航高度过小（${bottom.h}px）`);
if (side && side.bottom > (bottom?.y ?? rects.win.h)) problems.push('右侧图标列伸进底部导航区域');
if (side && side.y < (top?.bottom ?? 0)) problems.push('右侧图标列压住顶部栏');

const report = { size: `${W}x${H}`, rects, problems };
console.log(JSON.stringify(report, null, 1));
writeFileSync(path.join(OUT, `layout-${W}x${H}.json`), JSON.stringify(report, null, 1));

await app.close();
process.exit(problems.length ? 1 : 0);
