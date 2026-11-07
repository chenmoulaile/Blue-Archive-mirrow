/**
 * 探针：启动 Electron 应用，记录全部 >=400 的响应（不截断），
 * 专项验证 /res/cursors/* 404 已消除（e2e.mjs 的失败请求列表 slice(0,12) 会截断）。
 *
 * 用法：node scripts/probe-cursors-404.mjs
 */
import { _electron as electron } from 'playwright-core';
import { rmSync } from 'node:fs';
import { childEnv } from './env.mjs';

rmSync('.userdata/save.json', { force: true });
rmSync('.userdata/config.json', { force: true });
const env = childEnv({ NODE_ENV: 'production' });

const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
});

const failed = [];
const cursorReqs = [];
page.on('response', (r) => {
  const u = r.url().replace(/^https?:\/\/127\.0\.0\.1:\d+/, '');
  if (r.status() >= 400) failed.push(`${r.status()} ${u}`);
  if (u.includes('/res/cursors/')) cursorReqs.push(`${r.status()} ${u}`);
});
// cursors.css 由 App.tsx 静态 import，标题屏出现时已请求全部指针；多等一会让动画指针(.ani)也发请求
await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(8000);

console.log('cursors 相关请求:', cursorReqs.length ? cursorReqs : '（无请求记录）');
const cursorFail = failed.filter((f) => f.includes('/res/cursors/'));
console.log('cursors >=400:', cursorFail.length ? cursorFail : '无');
console.log('全部 >=400 (不截断):', failed.length ? failed : '无');

await app.close();
process.exit(cursorFail.length > 0 ? 1 : 0);
