/**
 * bluearchive.wiki 剧情抓取器（Cookie 复用版）
 *
 * 浏览器只用来过 Cloudflare 拿到 cf_clearance，之后全部请求走普通 HTTP，
 * 并发 4 路，比在页面上下文里逐条 fetch 稳得多，也不会因为页面假死而卡住。
 *
 * 用法：
 *   node ba_story_fast.mjs              # 抓取缺失的剧情页
 *   node ba_story_fast.mjs --retry      # 连之前失败的重试一遍
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = 'E:/Blue archive';
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'resources', 'story');
const SITE = 'https://bluearchive.wiki';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用真实浏览器过一次 CF，拿回 Cookie 头 */
async function getCookieHeader() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等 CF 挑战完成：页面出现 MediaWiki 内容即视为通过
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(800);
    const ok = await page.evaluate(() => !!document.querySelector('#mw-content-text, .mw-parser-output'));
    if (ok) break;
  }
  const cookies = await ctx.cookies();
  await browser.close();
  const rel = cookies.filter((c) => /bluearchive\.wiki$/.test(c.domain.replace(/^\./, '')));
  console.log('  取到 Cookie:', rel.map((c) => c.name).join(', ') || '(空)');
  return rel.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function api(cookie, params, retry = 3) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const url = `${SITE}/w/api.php?${qs}`;
  for (let i = 0; i < retry; i++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' },
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const txt = await r.text();
      if (txt.trim().startsWith('{')) return JSON.parse(txt);
      if (i === retry - 1) return null;
    } catch {
      /* 重试 */
    }
    await sleep(600 * (i + 1) + Math.random() * 400);
  }
  return null;
}

// ---------------------------------------------------------------- 模板解析

function extractTemplates(wikitext, name) {
  const out = [];
  const needle = '{{' + name;
  let i = 0;
  while ((i = wikitext.indexOf(needle, i)) !== -1) {
    let depth = 0;
    let j = i;
    for (; j < wikitext.length - 1; j++) {
      if (wikitext[j] === '{' && wikitext[j + 1] === '{') {
        depth++;
        j++;
      } else if (wikitext[j] === '}' && wikitext[j + 1] === '}') {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    out.push(wikitext.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

function splitParams(tpl) {
  const body = tpl.replace(/^\{\{[^|]*/, '').replace(/\}\}$/, '');
  const parts = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' && body[i + 1] === '{') {
      depth++;
      cur += '{{';
      i++;
    } else if (c === '}' && body[i + 1] === '}') {
      depth--;
      cur += '}}';
      i++;
    } else if (c === '[' && body[i + 1] === '[') {
      depth++;
      cur += '[[';
      i++;
    } else if (c === ']' && body[i + 1] === ']') {
      depth--;
      cur += ']]';
      i++;
    } else if (c === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  const map = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    map[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return map;
}

function toNodes(map) {
  const idx = Object.keys(map)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);
  const nodes = [];
  for (const n of idx) {
    const kind = map[String(n)];
    if (!kind) continue;
    const fields = {};
    for (const [k, v] of Object.entries(map)) {
      const m = /^([a-z_]+)(\d+)$/i.exec(k);
      if (m && Number(m[2]) === n) fields[m[1]] = v;
    }
    nodes.push({ index: n, type: kind, ...fields });
  }
  return nodes;
}

function toGraph(nodes, meta) {
  const graph = nodes.map((n) => {
    const t = n.type;
    if (t === 'background') return { op: 'background', bg: n.background || n.name || '' };
    if (t === 'bgm')
      return { op: 'bgm', id: n.bgm || '', name: n.name || '', volume: n.volume || '1' };
    if (t === 'bgm-stop') return { op: 'bgmStop' };
    if (t === 'sound') return { op: 'se', id: n.sound || '', name: n.name || '' };
    if (t === 'student-text')
      return {
        op: 'script',
        speaker: n.name || '',
        text: n.text || '',
        spine: n.spine || '',
        sequence: n.sequence || '',
        affiliation: n.affiliation || '',
      };
    if (t === 'sensei') return { op: 'script', speaker: 'Sensei', text: n.text || '' };
    if (t === 'info') return { op: 'info', text: n.text || '' };
    return { op: t };
  });
  return { ...meta, nodes: graph };
}

function slug(title, type) {
  let s = title;
  if (type === 'main' || type === 'group') s = s.replace(/^[^/]+\//, '');
  return s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

// ---------------------------------------------------------------- 主流程

const cookie = await getCookieHeader();
console.log('Cookie 长度', cookie.length, cookie.includes('cf_clearance') ? '(含 cf_clearance)' : '(无 cf_clearance)');

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'story_page_index.json'), 'utf8'));
const todo = index.filter(({ type, title }) => {
  const f = path.join(OUT, type, slug(title, type) + '.json');
  return !(fs.existsSync(f) && fs.statSync(f).size > 10);
});
console.log(`总 ${index.length} 集，待抓 ${todo.length} 集`);

let ok = 0;
let fail = 0;
const failed = [];
const t0 = Date.now();

async function worker(list) {
  for (const { type, title } of list) {
    const d = await api(cookie, { action: 'parse', page: title, prop: 'wikitext' });
    if (!d?.parse?.wikitext) {
      fail++;
      failed.push({ type, title });
      continue;
    }
    const wt = d.parse.wikitext;
    const tops = extractTemplates(wt, 'Story/StoryTop');
    const top = tops.length ? splitParams(tops[0]) : {};
    const real = extractTemplates(wt, 'Story').filter((s) => !/^\{\{Story\/StoryTop/.test(s));
    const nodes = real.flatMap((s) => toNodes(splitParams(s)));

    const rec = toGraph(nodes, {
      story_id: title.replace(/\s+/g, '_'),
      type,
      title: top.title || title.split('/').pop(),
      summary: top.summary || '',
      prev: top.prev_page || '',
      next: top.next_page || '',
      source_url: `${SITE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      fetched_at: new Date().toISOString(),
    });

    const dir = path.join(OUT, type);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, slug(title, type) + '.json'), JSON.stringify(rec, null, 1), 'utf8');
    ok++;
    if (ok % 50 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  ${ok}/${todo.length}  ${(ok / el).toFixed(2)}/s  ETA ${((todo.length - ok) / (ok / el) / 60).toFixed(1)}min`);
    }
    await sleep(60);
  }
}

const CONC = 4;
const chunk = Math.ceil(todo.length / CONC);
await Promise.all(
  Array.from({ length: CONC }, (_, i) => worker(todo.slice(i * chunk, (i + 1) * chunk)))
);

fs.writeFileSync(path.join(DATA, 'story_failed.json'), JSON.stringify(failed, null, 1), 'utf8');
console.log(`✓ 新增 ${ok} 集，失败 ${fail} 集 -> data/story_failed.json`);
