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
// integration-w1 追加段的断言失败单独记录；任一非空则进程退出码非 0
const segFails = [];
const segFail = (msg) => {
  segFails.push(msg);
  console.log('  ❌', msg);
};
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
// 2026-11-10 大厅轨 L-1~L-6 重排同步：底部功能条 = [大厅选择, 回忆重播]
//（首个 .icon-btn 为「大厅选择」契约保留）；学生名移入切换抽屉（L-5），
// 抽屉改横向轮播卡片（.lobby-picker input 搜索契约保留）；顶部返回走
// App 级 TopCurrencyBar（.nav-item），切学生核对需重开抽屉读 .lobby-name b。
// 入口：P0-2 后底条无「大厅」，记忆大厅由首项「编成」(nav.formation) 进入。
const lobbyBottom = page.locator('.bottom-item', { hasText: '编成' });
if (await lobbyBottom.count()) {
  await lobbyBottom.first().click();
  await page.waitForTimeout(900);

  // 画布契约：spine canvas 存在（或明示占位原因）
  const lobbyCanvas = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.lobby-canvas canvas')),
    placeholder: document.querySelector('.lobby-loading')?.textContent?.trim() ?? null,
  }));
  console.log('记忆大厅画布:', lobbyCanvas);

  // 换到 Airi：打开抽屉（首个 .icon-btn）→ 读当前学生名 → 搜 Airi → 点第一张
  const pickBtn = page.locator('.lobby-tools .icon-btn').first();
  if (await pickBtn.count()) {
    await pickBtn.click();
    await page.waitForTimeout(400);
    const nameBefore = await page.evaluate(
      () => document.querySelector('.lobby-name b')?.textContent ?? null
    );
    console.log('记忆大厅学生(切换抽屉内):', nameBefore);
    await shot('02a-lobby-picker', 400); // L-5 轮播抽屉目检
    const search = page.locator('.lobby-picker input');
    if (await search.count()) {
      await search.fill('Airi');
      await page.waitForTimeout(600);
      const card = page.locator('.picker-card').first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(2600);
        // 重开抽屉核对切换生效（学生名随切换变化）
        await pickBtn.click();
        await page.waitForTimeout(400);
        const nameAfter = await page.evaluate(
          () => document.querySelector('.lobby-name b')?.textContent ?? null
        );
        console.log('切换后学生:', nameAfter);
        await page.locator('.lobby-picker .btn', { hasText: '关闭' }).click();
        await page.waitForTimeout(300);
      }
    }
  }
  await shot('02-lobby', 1800);
  const lobbyState = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.lobby-canvas canvas')),
    // 学生名在切换抽屉内（L-5），抽屉关闭时读不到属预期
    student: document.querySelector('.lobby-name b')?.textContent ?? null,
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
  // gacha 轨交接修复：当前在内页（剧情/招募/设置页没有底条）时，
  // 先点返回钮（.nav-item「大厅」，既有 e2e 契约的回主界面路径）回主页再走底条。
  // 剧情播放器进行时可能用全屏层拦截返回钮（2026-11-10 实测）：force+catch
  // 尽力而为，失败回落到 .nav-item 直接查找，不超时阻塞后续段
  const back = page.locator('.nav-item', { hasText: '大厅' });
  if (await back.count()) {
    await back.first().click({ timeout: 4000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
    const bottom2 = page.locator('.bottom-item', { hasText: label });
    if (await bottom2.count()) {
      await bottom2.first().click();
      return true;
    }
  }
  const nav = page.locator('.nav-item', { hasText: label });
  if (await nav.count()) {
    // 与上方返回钮同策略：内页全屏层可能拦截点击（剧情轨在途实测），尽力而为
    await nav.first().click({ timeout: 4000, force: true }).catch(() => {});
    return true;
  }
  return false;
};

try {
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
        // 选项出现时点第一个选项（真分支跳转，选择器来自 StoryChoices 的 NineSlice className）；否则点舞台推进。
        // 剧情轨进行时播放器可能暂时不可见（2026-11-10 实测 .player-stage not visible）：
        // 点击尽力而为，超时跳过不阻塞后续段（招募/桃信的验证依赖流程继续）
        const choiceBtn = page.locator('.choice-overlay .story-choice-btn').first();
        if (await choiceBtn.count()) {
          await choiceBtn.click({ timeout: 3000 }).catch(() => {});
        } else {
          await page.locator('.player-stage').click({ position: { x: 120, y: 80 }, timeout: 3000 }).catch(() => {});
        }
        await page.waitForTimeout(300);
      }
      await shot('08-story-advanced');
    }
    // 回主界面（gacha 轨交接修复）：招募/桃信/咖啡厅各段依赖主页底条导航。
    // 播放器是全屏层，要先从右上 MENU 胶囊退出（剧情轨契约 data-testid=story-menu-btn
    // → 「退出剧情」），再点 TopCurrencyBar 返回钮回主页，否则返回钮被播放器层拦截
    const storyMenuBtn = page.locator('[data-testid="story-menu-btn"]');
    if (await storyMenuBtn.count()) {
      await storyMenuBtn.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
      const exitBtn = page.getByRole('button', { name: '退出剧情' });
      if (await exitBtn.count()) {
        await exitBtn.first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
      }
    }
    const backHomeAfterStory = page.locator('.nav-item', { hasText: '大厅' });
    if (await backHomeAfterStory.count()) {
      await backHomeAfterStory.first().click({ timeout: 4000, force: true }).catch(() => {});
      await page.waitForTimeout(700);
    }
  }
} catch (e) {
  segFail(`剧情主段失败：${e?.message ?? e}`);
}

if (await goto('招募')) {
  await shot('09-gacha', 1200);
  const pull = page.getByRole('button', { name: '招募 10 次' });
  // 卡池列表为空（banners.json 缺失）时按钮 disabled={true}，直接点会卡 30s 崩掉整条链
  if (await pull.count() && (await pull.isEnabled())) {
    await pull.click();
    // integration-w1 追加（gacha 轨交接事项）：十连演出覆盖层会拦截后续导航
    // 点击——点跳过直达结果幕，截完图再关结果页，避免 goto 卡 30s 超时
    await page.waitForSelector('[data-gacha-overlay]', { timeout: 10000 }).catch(() => {});
    await page.locator('[data-gacha-skip]').click({ timeout: 5000 }).catch(() => {});
    await shot('10-gacha-result', 1700);
    // integration-w3 最小增量（2026-11-09 走查② 卡面新结构契约）：十连演出结果幕
    // 网格 = GachaResultView 的 .gcs-r-card ×10；NEW 徽标按抽取前 owned 快照判断，
    // e2e 存档每次被清空（脚本头部 rmSync save.json），首抽必全新 → NEW 恒 10/10。
    // 卡面立绘(.gcs-r-art)与头像回退(.gcs-r-avatar)按 card_art.json 覆盖率自选，数量不断言
    // （覆盖率 193/513 非确定；students_slim 仅 id635「透」无 avatar，走 .gcs-card-initial 兜底字），
    // 只断言「每张卡有图像或兜底字承载，无空白卡」。
    if (await page.locator('[data-gacha-scene="result"]').count()) {
      const cut = await page.evaluate(() => ({
        cards: document.querySelectorAll('[data-gacha-scene="result"] .gcs-r-card').length,
        newBadges: document.querySelectorAll('[data-gacha-scene="result"] .gcs-card-new').length,
        imgCards: document.querySelectorAll('[data-gacha-scene="result"] .gcs-r-card img').length,
        initialCards: document.querySelectorAll('[data-gacha-scene="result"] .gcs-card-initial').length,
      }));
      console.log('  卡面结构:', cut);
      if (cut.cards !== 10) segFail(`卡面新结构：演出结果网格 ${cut.cards}/10 张`);
      if (cut.newBadges !== 10) segFail(`卡面新结构：NEW 徽标 ${cut.newBadges}/10（首抽应全 NEW）`);
      if (cut.imgCards + cut.initialCards !== 10)
        segFail(`卡面新结构：图像+兜底字 ${cut.imgCards + cut.initialCards}/10（不应有空白卡）`);
    }
    await shot('nineslice-panel', 300);
    await shot('gacha-ui', 300);
    await page.locator('[data-gacha-close]').click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
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

// ==================================================================
// integration-w1 追加四段验收（既有流程保持不动）：
//   ① 剧情分支：序幕(10000005) 带选项，点选项断言分支徽标
//   ② 招募十连：跳过按钮直达结果幕，断言结果网格
//   ③ 桃信会话：断言头像气泡
//   ④ 大厅互动：点击学生断言语音/反应
// 选择器与各轨道组件约定：
//   story: [data-testid=story-dialog]/[data-testid=branch-badge]/.story-choice-btn/.story-actor
//   gacha: [data-gacha-overlay]/[data-gacha-phase]/[data-gacha-skip]/[data-gacha-scene]/[data-gacha-close]
//   momotalk: .mt-list/.mt-row-item/.mt-room/.mt-bubble/.mt-row-avatar
//   lobby: .ls-stage/.ls-heart/.ls-bounce/.lb-namebar
// ==================================================================

// ---- 追加① 剧情页：带选项的主线 + 真分支跳转
try {
  if (await goto('剧情')) {
    // 2026-11-10 E2 重构（拼贴横幅+斜切章节条，tab/搜索框删除）：主线 Vol.0 默认
    // 选中、话目列表第一项 = Vol.0 第1章 11000（choice options 8 个 + branch 节点
    // 4 个，实测见 TrackResult）；选择器与断言保持原契约
    //（.choice-overlay .story-choice-btn / branch-badge / story-dialog / story-actor）
    await page.waitForSelector('.story-item', { timeout: 10000 });
    const prologue = page.locator('.story-item').first();
    await prologue.click();
    // 开场即选项（choice@3），连点推进：有选项点第一个，没选项点舞台；
    // 直到 branch-badge 出现（= 真分支跳转生效）
    let inBranch = false;
    for (let i = 0; i < 140 && !inBranch; i++) {
      const choiceBtn = page.locator('.choice-overlay .story-choice-btn').first();
      if (await choiceBtn.count()) {
        await choiceBtn.click();
        await page.waitForTimeout(450);
        inBranch = (await page.locator('[data-testid="branch-badge"]').count()) > 0;
      } else {
        await page.locator('.player-stage').click({ position: { x: 120, y: 80 } });
        await page.waitForTimeout(220);
      }
    }
    if (!inBranch) throw new Error('追加①：点选项后 branch-badge 未出现，分支未生效');
    await page.waitForSelector('[data-testid="story-dialog"]', { timeout: 8000 });
    // 立绘计数（2026-11-10 数据轨重生成后 11000 开场为 ??? 无立绘、choice@150 后的
    // branch 段说话人有无立绘随数据浮动）——原 .story-actor 硬等待移除，改为
    // 非阻塞观察输出；立绘层容器 .story-actors 由组件恒定渲染
    const actorInfo = await page.evaluate(() => ({
      actors: document.querySelectorAll('.story-actor').length,
      spineCanvas: document.querySelectorAll('.story-actor .story-portrait canvas').length,
      badge: document.querySelector('[data-testid="branch-badge"]')?.textContent?.trim() ?? null,
      speaker: document.querySelector('[data-testid="story-dialog"] .speaker')?.textContent?.trim() ?? null,
    }));
    if (!actorInfo.badge?.startsWith('分支')) throw new Error(`追加①：徽标异常 ${actorInfo.badge}`);
    console.log('  剧情分支:', actorInfo);
    await shot('16-story-choice', 300);
  }
  // 成功路径同样退出播放器并回主界面：追加②③④依赖主页底条导航（gacha 轨交接）
  const menuOk = page.locator('[data-testid="story-menu-btn"]');
  if (await menuOk.count()) {
    await menuOk.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const exitOk = page.getByRole('button', { name: '退出剧情' });
    if (await exitOk.count()) {
      await exitOk.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  const backHomeOk = page.locator('.nav-item', { hasText: '大厅' });
  if (await backHomeOk.count()) {
    await backHomeOk.first().click({ timeout: 4000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
} catch (e) {
  segFail(`剧情分支段失败：${e?.message ?? e}`);
  // 剧情轨进行时播放器可能停留在全屏层拦截一切点击：尽力从 MENU 退出，
  // 让追加②招募 / ③桃信 / ④大厅段能继续（gacha 轨交接，2026-11-10）
  try {
    const mb = page.locator('[data-testid="story-menu-btn"]');
    if (await mb.count()) {
      await mb.first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(300);
      const eb = page.getByRole('button', { name: '退出剧情' });
      if (await eb.count()) await eb.first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } catch {
    /* 尽力而为 */
  }
}

// ---- 追加② 招募页：十连（跳过直达结果），断言结果网格
try {
  // 既有流程已抽掉一次十连；设置页「重置」按钮是幂等补给（Math.max 拉到
  // 120,000 青辉石 + 5,000,000 信用点水位，反复点击结果一致），e2e 靠它补回预算
  if (await goto('设置')) {
    const resetBtn = page.getByRole('button', { name: '重置', exact: true });
    if (await resetBtn.count()) {
      await resetBtn.click();
      await page.waitForTimeout(400);
    }
  }
  if (await goto('招募')) {
    const pull = page.getByRole('button', { name: '招募 10 次' });
    if (!(await pull.count())) throw new Error('追加②：找不到「招募 10 次」按钮');
    if (!(await pull.isEnabled())) throw new Error('追加②：招募按钮不可用（卡池/货币异常）');
    await pull.click();
    try {
      await page.waitForSelector('[data-gacha-overlay]', { timeout: 10000 });
    } catch {
      // 主流程同一链路已验证（gacha 轨）；这里超时多为 GPU/渲染抖动 —— 截图取证，
      // overlay 迟到则继续，未出现则如实失败
      await shot('diag-append2-gacha', 300);
      if (!(await page.locator('[data-gacha-overlay]').count())) {
        throw new Error('追加②：招募演出覆盖层未出现（诊断截图 diag-append2-gacha.png）');
      }
    }
    await page.locator('[data-gacha-skip]').click(); // 跳过按钮直达结果幕
    await page.waitForSelector('[data-gacha-phase="result"]', { timeout: 8000 });
    const scene = await page.evaluate(() => ({
      result: document.querySelectorAll('[data-gacha-scene="result"]').length,
      phase: document.querySelector('[data-gacha-overlay]')?.getAttribute('data-gacha-phase'),
    }));
    if (!scene.result) throw new Error('追加②：跳过后未进入结果幕');
    await shot('18-gacha-ten-result', 500);
    // D5 重做（gacha 轨 2026-11-10）：结果页「本次结果」抽屉已删，结果网格在
    // 演出终幕内（[data-gacha-scene="result"] .gcs-r-card，与主流程断言同一契约）。
    // 确认钮会卸载整个演出层 —— 必须先数网格再点 close
    const cards = await page.locator('[data-gacha-scene="result"] .gcs-r-card').count();
    if (cards !== 10) throw new Error(`追加②：结果网格 ${cards}/10 张`);
    await page.locator('[data-gacha-close]').click();
    await page.waitForTimeout(500);
    console.log('  十连结果: phase=%s, 网格 %d/10 张', scene.phase, cards);
  } else {
    console.log('  未找到招募入口，跳过追加②');
  }
} catch (e) {
  segFail(`招募十连段失败：${e?.message ?? e}`);
}

// ---- 追加③ 桃信：打开会话，断言头像气泡
try {
  if (await goto('桃信')) {
    await page.waitForSelector('.mt-list', { timeout: 10000 });
    const row = page.locator('.mt-row-item').first();
    if (!(await row.count())) throw new Error('追加③：桃信会话列表为空');
    await row.click();
    await page.waitForSelector('.mt-room', { timeout: 10000 });
    // 消息流是逐条冒出的（capDelay 1200ms），等首个学生头像气泡落位即可
    await page.waitForSelector('.mt-row:not(.me) .mt-row-avatar', { timeout: 25000 });
    await page.waitForSelector('.mt-bubble', { timeout: 8000 });
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({
      bubbles: document.querySelectorAll('.mt-bubble').length,
      mine: document.querySelectorAll('.mt-bubble.mt-me').length,
      avatars: document.querySelectorAll('.mt-row:not(.me) .mt-row-avatar').length,
      avatarImgs: document.querySelectorAll('.mt-row:not(.me) .mt-row-avatar img').length,
    }));
    if (info.bubbles === 0) throw new Error('追加③：聊天气泡未渲染');
    if (info.avatars === 0) throw new Error('追加③：学生头像位未渲染');
    console.log('  桃信会话:', info);
    await shot('19-momotalk-room', 400);
  } else {
    console.log('  未找到桃信入口，跳过追加③');
  }
} catch (e) {
  segFail(`桃信会话段失败：${e?.message ?? e}`);
}

// ---- 追加④ 大厅：点击学生，断言语音/反应触发
try {
  if (await goto('大厅')) {
    await page.waitForSelector('.home .ls-stage', { timeout: 15000 });
    await page.waitForTimeout(600);
    const vp2 = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await page.mouse.click(Math.round(vp2.w / 2), Math.round(vp2.h * 0.45)); // .home-veil 是 pointer-events:none
    let heart = false;
    try {
      await page.waitForSelector('.ls-heart', { timeout: 3000 }); // ♥ 存活 1.1s
      heart = true;
    } catch {
      /* 心形窗口短，落空再靠字幕/微动效判定 */
    }
    const info = await page.evaluate(() => ({
      line: document.querySelector('.lb-namebar span')?.textContent?.trim() ?? '', // 语音字幕存活 2.6s
      bounce: document.querySelectorAll('.ls-stage.ls-bounce').length, // 微动效存活 0.62s
      spineCanvas: document.querySelectorAll('.ls-stage canvas').length,
    }));
    if (!heart && !info.line && !info.bounce) {
      throw new Error('追加④：点击学生后无任何反馈（无♥/字幕/微动效）');
    }
    console.log('  大厅互动: heart=%s, 字幕="%s", bounce=%s, spine canvas=%d', heart, info.line, info.bounce, info.spineCanvas);
    await shot('20-lobby-touch', 300);
  } else {
    console.log('  未找到大厅入口，跳过追加④');
  }
} catch (e) {
  segFail(`大厅互动段失败：${e?.message ?? e}`);
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
if (segFails.length) console.log('追加段断言失败:', segFails);

await app.close();
// 素材缺失（BGM/SE）不算失败，只有脚本错误才算；追加段断言失败同判
process.exit(errors.length > 0 || segFails.length > 0 ? 1 : 0);
