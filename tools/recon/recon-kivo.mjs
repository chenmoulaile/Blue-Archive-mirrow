// 侦察脚本：用本机 Chrome 打开 kivo.wiki/gallery，抓取网络请求与页面结构
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'E:/Blue archive/tools/recon/out';
fs.mkdirSync(OUT, { recursive: true });

const apiCalls = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

page.on('response', async (res) => {
  const url = res.url();
  const ct = res.headers()['content-type'] || '';
  if (ct.includes('json') || /\/api\//.test(url)) {
    let body = '';
    try {
      body = await res.text();
    } catch {}
    apiCalls.push({ url, status: res.status(), ct, len: body.length, sample: body.slice(0, 1200) });
  }
});

console.log('→ 打开 https://kivo.wiki/gallery');
await page.goto('https://kivo.wiki/gallery', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

console.log('标题:', await page.title());
await page.screenshot({ path: `${OUT}/gallery-01.png`, fullPage: false });

// 页面文本 + 链接
const info = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({
    text: (a.textContent || '').trim().slice(0, 60),
    href: a.getAttribute('href'),
  }));
  const imgs = [...document.querySelectorAll('img')]
    .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt }))
    .slice(0, 40);
  return { bodyText: document.body.innerText.slice(0, 4000), links, imgs };
});

fs.writeFileSync(`${OUT}/gallery-page.json`, JSON.stringify({ ...info, apiCalls }, null, 2), 'utf8');
console.log('链接数:', info.links.length, '图片数:', info.imgs.length, 'API调用数:', apiCalls.length);
console.log('--- 页面文本前 1200 字 ---');
console.log(info.bodyText.slice(0, 1200));

await browser.close();
