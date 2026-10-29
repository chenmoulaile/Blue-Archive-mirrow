// 侦察 kivo.wiki 站点导航与各页面的 API 端点
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'E:/Blue archive/tools/recon/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

const seen = new Map();
page.on('response', async (res) => {
  const url = res.url();
  if (!/api\.kivo\.wiki\/api\//.test(url)) return;
  if (seen.has(url)) return;
  const ct = res.headers()['content-type'] || '';
  let sample = '';
  if (ct.includes('json')) {
    try {
      sample = (await res.text()).slice(0, 400);
    } catch {}
  }
  seen.set(url, { status: res.status(), sample });
});

await page.goto('https://kivo.wiki/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const nav = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').trim().slice(0, 30);
    if (href.startsWith('/') && href !== '/' && !out.some((o) => o.href === href)) out.push({ href, text });
  });
  return out;
});
console.log('导航链接:', nav.map((n) => n.text + '(' + n.href + ')').join(' | '));

// 访问几个关键页面触发接口
const targets = ['/data/character', '/archive', '/library', '/data'];
for (const t of targets) {
  try {
    await page.goto('https://kivo.wiki' + t, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    console.log('visited', t, '->', page.url());
  } catch (e) {
    console.log('fail', t, e.message.slice(0, 80));
  }
}

// 角色详情页（含 spine / voice / 剧情）
await page.goto('https://kivo.wiki/data/character/1', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3500);
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
console.log('--- 角色页文本 ---');
console.log(bodyText);

const result = { nav, api: [...seen.entries()].map(([url, v]) => ({ url, ...v })) };
fs.writeFileSync(`${OUT}/kivo-nav.json`, JSON.stringify(result, null, 2), 'utf8');
console.log('\n=== 捕获 API ===');
for (const [url, v] of seen) console.log(v.status, url.slice(0, 120));

await browser.close();
