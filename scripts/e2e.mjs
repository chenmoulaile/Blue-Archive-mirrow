/**
 * 端到端冒烟测试 + 视觉回归基线
 *
 * 流程：splash → 标题 → 加载 → 主界面 → 各功能页
 * 截图统一用 Electron 的 capturePage（Playwright 的 screenshot 抓不到 WebGL）。
 *
 * 用法：node scripts/e2e.mjs
 * 产物：tools/recon/out/e2e-*.png
 */
import { _electron as electron } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { childEnv } from './env.mjs';

const OUT = 'tools/recon/out';
mkdirSync(OUT, { recursive: true });
// 每次跑都从干净存档 + 干净配置开始，保证结果可复现
rmSync('.userdata/save.json', { force: true });
rmSync('.userdata/config.json', { force: true });

// 临时目录统一落到项目 .tmp；ELECTRON_RUN_AS_NODE 也在这里被清掉
const env = childEnv({ NODE_ENV: 'production' });

const app = await electron.launch({
  // --no-sandbox：部分虚拟化 / 容器环境下 GPU 进程会崩，关掉沙箱才能起来
  args: ['.', '--no-sandbox'],
  cwd: process.cwd(),
  env,
});

const page = await app.firstWindow();
// 固定窗口尺寸，保证截图基线可比较（显示器只有 1024×768 时也能拉大窗口）
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
});
const errors = [];
const failed = new Set();
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
    errors.push(m.text().slice(0, 200));
  }
});
page.on('response', (r) => {
  if (r.status() >= 400) failed.add(`${r.status()} ${r.url().replace(/^https?:\/\/127\.0\.0\.1:\d+/, '')}`);
});

// 用 Electron 的 capturePage 截图，Playwright 的 screenshot 抓不到 WebGL 画布
const capture = async (name) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  );
  writeFileSync(path.join(OUT, `e2e-${name}.png`), Buffer.from(b64, 'base64'));
};

const shot = async (name, wait = 900) => {
  await page.waitForTimeout(wait);
  await capture(name);
  console.log('  截图', name);
};

// 素材是本地大 JSON，首屏可能超过 2s 才出来。
// 必须等「引导 / splash / 标题」其中之一出现再操作，否则会在 .boot 上点空，
// 后面整条流程都卡住（表现为截图里全是引导页）。
await page.waitForSelector('.setup, .splash, .title-screen2', { timeout: 30000 });
console.log('窗口标题:', await page.title());

// ---- 首次启动向导（config.json 每次都被删掉，所以每次都会出现）
if (await page.locator('.setup').count()) {
  await shot('00-setup', 400);
  await page.getByRole('button', { name: /跳过/ }).click();
  await page.waitForSelector('.splash, .title-screen2', { timeout: 15000 });
  console.log('  向导：已跳过');
}

// 窗口尺寸随显示器变（远程桌面下可能只有 1024×768），
// 所有点击都按视口比例算，不写死坐标。
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const tap = { x: Math.round(vp.w / 2), y: Math.round(vp.h * 0.45) };
console.log('视口:', vp);

// ---- 启动流程
await shot('01-splash', 400);
await page.mouse.click(tap.x, tap.y); // 跳过 splash
await page.waitForTimeout(1600);
await shot('02-title');
await page.mouse.click(tap.x, tap.y); // 点击开始
await page.waitForTimeout(1100);
await shot('03-loading');
await page.waitForTimeout(2200);
await page.waitForSelector('.home', { timeout: 20000 });
await shot('04-home', 1400);

// ---- 记忆大厅：Phase 1 的验收基准，固定用 Airi_home 的 4.2 资源
const lobbyBottom = page.locator('.bottom-item', { hasText: '大厅' });
if (await lobbyBottom.count()) {
  await lobbyBottom.first().click();
  await page.waitForTimeout(900);

  // 换到 Airi：打开选择器 → 搜 Airi → 点第一张
  const pickBtn = page.locator('.lobby-tools .icon-btn').first();
  if (await pickBtn.count()) {
    await pickBtn.click();
    await page.waitForTimeout(400);
    const search = page.locator('.lobby-picker input');
    if (await search.count()) {
      await search.fill('Airi');
      await page.waitForTimeout(600);
      const card = page.locator('.picker-card').first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(2600);
      }
    }
  }
  await shot('02-lobby', 1800);
  const lobbyState = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.lobby-canvas canvas')),
    placeholder: document.querySelector('.lobby-loading')?.textContent?.trim() ?? null,
    student: document.querySelector('.lobby-name b')?.textContent ?? null,
    spine: document.querySelector('.lobby-name span')?.textContent ?? null,
  }));
  console.log('记忆大厅:', lobbyState);

  // 回主界面，后面的流程从大厅继续走底部导航
  const backHome = page.locator('.nav-item', { hasText: '大厅' });
  if (await backHome.count()) {
    await backHome.first().click();
    await page.waitForTimeout(700);
  }
}

// 主界面上的控件来源统计（有多少还是兜底样式）
const uiStatsHome = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-ui-source]')];
  const by = {};
  for (const el of all) {
    const k = el.getAttribute('data-ui-source') || 'unknown';
    by[k] = (by[k] || 0) + 1;
  }
  return { total: all.length, by };
});
console.log('主界面 UI 控件来源:', uiStatsHome);

// 主界面：打开菜单弹窗
const menuBtn = page.locator('.side-btn[data-zone="④"]');
if (await menuBtn.count()) {
  await menuBtn.click();
  await shot('05-menu', 700);
  // ESC 关闭；关不掉再点遮罩，避免小窗口下点坐标点空
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('.menu-dim').count()) {
    await page.locator('.menu-dim').click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(400);
  }
}

// 底部导航进入各功能页（回主界面后才有底部导航）
const goto = async (label) => {
  const bottom = page.locator('.bottom-item', { hasText: label });
  if (await bottom.count()) {
    await bottom.first().click();
    return true;
  }
  const nav = page.locator('.nav-item', { hasText: label });
  if (await nav.count()) {
    await nav.first().click();
    return true;
  }
  return false;
};

if (await goto('剧情')) {
  await shot('06-story', 1200);
  const first = page.locator('.story-item').first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(2600);
    await shot('07-story-player');
    await shot('nineslice-dialog', 400);
    await shot('story-ui', 300);
    await shot('story-ui-final', 300);
    for (let i = 0; i < 5; i++) {
      // 选项出现时点第一个选项（真分支跳转，选择器来自 StoryChoices 的 NineSlice className）；否则点舞台推进
      const choiceBtn = page.locator('.choice-overlay .story-choice-btn').first();
      if (await choiceBtn.count()) {
        await choiceBtn.click();
      } else {
        await page.locator('.player-stage').click({ position: { x: 120, y: 80 } });
      }
      await page.waitForTimeout(300);
    }
    await shot('08-story-advanced');
  }
}

if (await goto('招募')) {
  await shot('09-gacha', 1200);
  const pull = page.getByRole('button', { name: '招募 10 次' });
  // 卡池列表为空（banners.json 缺失）时按钮 disabled={true}，直接点会卡 30s 崩掉整条链
  if (await pull.count() && (await pull.isEnabled())) {
    await pull.click();
    await shot('10-gacha-result', 1700);
    await shot('nineslice-panel', 300);
    await shot('gacha-ui', 300);
  }
}

if (await goto('桃信')) {
  await shot('11-momotalk', 1100);
  await shot('nineslice-bubble', 300);
  await shot('momotalk-ui', 300);
}
if (await goto('咖啡厅')) {
  await shot('12-cafe', 1100);
  const one = page.getByRole('button', { name: '一键布置' });
  if (await one.count()) {
    await one.click();
    await shot('13-cafe-placed', 900);
  }
}
if (await goto('活动')) {
  await shot('14-events', 1100);
  await shot('events-dark', 300);
}
if (await goto('设置')) {
  await shot('15-settings', 1000);
  await shot('settings-dark', 300);
}

// ---- 还原度统计：有多少控件还是兜底样式
const uiStats = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-ui-source]')];
  const by = {};
  for (const el of all) {
    const k = el.getAttribute('data-ui-source') || 'unknown';
    by[k] = (by[k] || 0) + 1;
  }
  return { total: all.length, by };
});
console.log('UI 控件来源统计:', uiStats);

// ---- 存档检查
const savePath = path.resolve('.userdata/save.json');
let saveInfo = { path: savePath };
try {
  const d = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  saveInfo = {
    ...saveInfo,
    locale: d.settings?.locale,
    voice: d.settings?.voice,
    pyroxene: d.currency?.pyroxene,
    readStories: Object.keys(d.story?.read ?? {}).length,
    gachaHistory: d.gacha?.history?.length ?? 0,
    placed: d.cafe?.placed?.length ?? 0,
  };
} catch (err) {
  saveInfo.error = String(err);
}
console.log('存档:', saveInfo);

console.log('控制台错误:', errors.length ? errors : '无');
console.log('失败请求:', failed.size ? [...failed].slice(0, 12) : '无');

await app.close();
// 素材缺失（BGM/SE）不算失败，只有脚本错误才算
process.exit(errors.length > 0 ? 1 : 0);
