/**
 * 桃信回复选项还原验证（临时，momotalk 轨自检用）
 *
 * 断言：
 *  1. 回复选项出现在消息流末尾（.mt-reply-group 是 .mt-body 的后代）；
 *  2. 选项是竖排按钮组（数量 >= 2）；
 *  3. 点击后：被选项变成老师气泡（.mt-bubble.mt-me）进入消息流，
 *     文本与所点选项一致；
 *  4. 其余选项消失（.mt-reply-group 数量归零）；
 *  5. e2e 契约选择器仍在：.mt-list/.mt-row-item/.mt-room/.mt-bubble/
 *     .mt-row:not(.me) .mt-row-avatar。
 *
 * 用法：node tools/recon/momotalk-option-check.mjs
 * 截图：tools/recon/out/e2e-momotalk-options.png / e2e-momotalk-after-choose.png
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../../scripts/env.mjs';

const OUT = 'tools/recon/out';
mkdirSync(OUT, { recursive: true });
rmSync('.userdata/save.json', { force: true });
rmSync('.userdata/config.json', { force: true });
// MOMO_LIGHT=1 → 浅色主题存档（store.init 的 Partial 合并会补齐其余字段）
if (process.env.MOMO_LIGHT) {
  writeFileSync('.userdata/save.json', JSON.stringify({ settings: { theme: 'light' } }));
  console.log('主题: light');
}

const env = childEnv({ NODE_ENV: 'production' });
const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: process.cwd(), env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
});
const failed = new Set();
page.on('response', (r) => {
  if (r.status() >= 400) failed.add(`${r.status()} ${r.url().replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')}`);
});

const capture = async (name) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  );
  writeFileSync(path.join(OUT, `e2e-${name}.png`), Buffer.from(b64, 'base64'));
  console.log('  截图', name);
};
const shot = async (name, wait = 700) => {
  await page.waitForTimeout(wait);
  await capture(name);
};

const problems = [];
const check = (ok, msg) => {
  console.log(ok ? '  ✅' : '  ❌', msg);
  if (!ok) problems.push(msg);
};

await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
console.log('  theme@boot =', await page.evaluate(() => document.documentElement.dataset.theme));
if (await page.locator('.setup').count()) {
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
  console.log('  theme@after-setup =', await page.evaluate(() => document.documentElement.dataset.theme));
}
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const tap = { x: Math.round(vp.w / 2), y: Math.round(vp.h * 0.45) };
await page.mouse.click(tap.x, tap.y); // 跳过 splash
await page.waitForTimeout(1600);
await page.mouse.click(tap.x, tap.y); // 开始
await page.waitForSelector('.home', { timeout: 20000 });
await page.waitForTimeout(1200);
console.log('  theme@home =', await page.evaluate(() => document.documentElement.dataset.theme));

// 底部导航 → 桃信
const bottom = page.locator('.bottom-item', { hasText: '桃信' });
const nav = page.locator('.nav-item', { hasText: '桃信' });
if (await bottom.count()) await bottom.first().click();
else await nav.first().click();
await page.waitForSelector('.mt-list', { timeout: 10000 });
check((await page.locator('.mt-list').count()) === 1, '契约 .mt-list 渲染');
// 选「陆八魔阿露」：首个解锁线程的 answer 带 2 个选项，可验证竖排按钮组
const arow = page.locator('.mt-row-item', { hasText: '陆八魔阿露' }).first();
await arow.click();
await page.waitForSelector('.mt-room', { timeout: 10000 });
check(true, '契约 .mt-room 渲染');

// 等回复选项出现在消息流末尾（必要时点消息区快进）
let groupVisible = false;
for (let i = 0; i < 24 && !groupVisible; i++) {
  if (await page.locator('.mt-reply-group').count()) {
    groupVisible = true;
    break;
  }
  await page.locator('.mt-body').click({ position: { x: 300, y: 200 } }).catch(() => {});
  await page.waitForTimeout(650);
}
check(groupVisible, '回复选项组（.mt-reply-group）出现在消息流末尾');

const groupInfo = await page.evaluate(() => {
  const g = document.querySelector('.mt-reply-group');
  const body = document.querySelector('.mt-body');
  const btns = [...(g?.querySelectorAll('.mt-reply-btn') ?? [])];
  const tops = btns.map((b) => b.getBoundingClientRect().top);
  return {
    inBody: !!g && !!body && body.contains(g),
    count: btns.length,
    vertical: tops.length >= 2 && tops[1] > tops[0],
    texts: btns.map((b) => b.textContent?.trim() ?? ''),
  };
});
check(groupInfo.inBody, '.mt-reply-group 位于 .mt-body 内（消息流末尾，非底部固定栏）');
check(groupInfo.count >= 2, `选项为竖排按钮组（${groupInfo.count} 个）: ${JSON.stringify(groupInfo.texts)}`);
check(groupInfo.vertical, '按钮竖排堆叠（第二条在第一条下方）');
await shot('momotalk-options', 300);

// 点第一个选项 → 变老师气泡，其余消失
const picked = groupInfo.texts[0] ?? '';
await page.locator('.mt-reply-btn').first().click();
await page.waitForSelector('.mt-bubble.mt-me', { timeout: 8000 });
await page.waitForTimeout(500);

const after = await page.evaluate(() => ({
  groups: document.querySelectorAll('.mt-reply-group').length,
  mine: document.querySelectorAll('.mt-bubble.mt-me').length,
  lastMine: [...document.querySelectorAll('.mt-bubble.mt-me')].pop()?.textContent?.trim() ?? '',
  bubbleSrc: document.querySelector('.mt-bubble.mt-me [data-ui-sprite]')?.getAttribute('data-ui-source') ?? null,
  themBubbles: document.querySelectorAll('.mt-bubble.mt-them').length,
  avatars: document.querySelectorAll('.mt-row:not(.me) .mt-row-avatar img').length,
}));
check(after.groups === 0, '其余选项消失（.mt-reply-group 归零）');
check(after.mine >= 1, `老师气泡进入消息流（.mt-bubble.mt-me × ${after.mine}）`);
check(after.lastMine === picked, `老师气泡文本 = 所点选项（"${after.lastMine}" vs "${picked}"）`);
check(after.bubbleSrc === 'assetbundle', `老师气泡皮肤 data-ui-source=${after.bubbleSrc}（原件 mask，非伪造）`);
check(after.themBubbles > 0, '学生气泡（.mt-bubble.mt-them）正常渲染');
check(after.avatars > 0, '契约 .mt-row:not(.me) .mt-row-avatar img 正常');
await shot('momotalk-after-choose', 300);

console.log('HTTP>=400:', failed.size ? [...failed].slice(0, 8) : '无');
console.log(problems.length ? `FAILED: ${problems.length} 项` : 'ALL PASS');
await app.close();
process.exit(problems.length ? 1 : 0);
