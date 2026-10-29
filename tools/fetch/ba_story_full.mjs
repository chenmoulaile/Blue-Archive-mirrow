/**
 * bluearchive.wiki 剧情全量抓取（insource 枚举版）
 *
 * 之前的做法是按「Main Story/ 前缀 + 分类」枚举，只能覆盖 945 页；
 * 实际上 wiki 有 2479 个页面内嵌了 {{Story/StoryTop}}，羁绊剧情的
 * 正文在 <学生>/Relationship Story/1..5 这类子页面里，活动剧情同理。
 *
 * 所以改用 CirrusSearch 的 insource 检索做全集枚举，再逐页抓取。
 *
 * 用法：node ba_story_full.mjs [--enumerate-only]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = 'E:/Blue archive';
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'resources', 'story');
const SITE = 'https://bluearchive.wiki';
const API = SITE + '/w/api.php';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WORKERS = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSession() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(600);
    if (await page.evaluate(() => !!document.querySelector('#mw-content-text'))) break;
  }
  return { browser, ctx, page };
}

async function api(page, params, retry = 3) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const url = `${API}?${qs}`;
  for (let i = 0; i < retry; i++) {
    let txt;
    try {
      txt = await Promise.race([
        page.evaluate(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'include' });
            return await r.text();
          } catch (e) {
            return 'ERR:' + e.message;
          }
        }, url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
      ]);
    } catch {
      try {
        await page.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(1200);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (typeof txt !== 'string' || txt.startsWith('ERR:')) {
      await sleep(1000 * (i + 1));
      continue;
    }
    try {
      return JSON.parse(txt);
    } catch {
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

// ------------------------------------------------------------ 模板解析

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
    if (t === 'bgm') return { op: 'bgm', id: n.bgm || '', name: n.name || '', volume: n.volume || '1' };
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
    if (t === 'reply') return { op: 'choice', group: n.group || '' };
    return { op: t };
  });
  return { ...meta, nodes: graph };
}

/** 页面标题 -> {type, slug} */
function classify(title) {
  let type = 'other';
  if (title.startsWith('Main Story/')) type = 'main';
  else if (/\/Relationship Story(\/\d+)?$/.test(title)) type = 'bond';
  else if (title.startsWith('Group Story/')) type = 'group';
  else if (/\/Story(\/[^/]+)?$/.test(title)) type = 'event'; // 含 <活动>/Story/<角色> 这种子页
  else if (/\/Event Story(\/[^/]+)?$/.test(title)) type = 'event';
  else if (title.startsWith('Code:')) type = 'event';

  let s = title;
  if (type === 'main' || type === 'group') s = s.replace(/^[^/]+\//, '');
  const slug = s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
  return { type, slug };
}

// ------------------------------------------------------------ 主流程

const enumerateOnly = process.argv.includes('--enumerate-only');
const { browser, ctx, page } = await openSession();

try {
  // 1. 全集枚举
  const idxPath = path.join(DATA, 'story_full_index.json');
  let titles;
  if (fs.existsSync(idxPath)) {
    titles = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    console.log(`复用已有索引 ${titles.length} 页`);
  } else {
    console.log('→ 枚举全部剧情页（insource:"Story/StoryTop"）');
    titles = [];
    let offset = 0;
    for (;;) {
      const d = await api(page, {
        action: 'query',
        list: 'search',
        srsearch: 'insource:"Story/StoryTop"',
        srlimit: '500',
        srnamespace: '0',
        sroffset: String(offset),
        srinfo: 'totalhits',
      });
      const rows = d?.query?.search || [];
      titles.push(...rows.map((r) => r.title));
      console.log(`  ${titles.length}/${d?.query?.searchinfo?.totalhits ?? '?'}`);
      if (!d?.continue || rows.length === 0) break;
      offset = d.continue.sroffset;
      await sleep(200);
    }
    titles = [...new Set(titles)].sort();
    fs.writeFileSync(idxPath, JSON.stringify(titles, null, 1), 'utf8');
    console.log(`✓ 枚举完成 ${titles.length} 页`);
  }

  if (enumerateOnly) process.exit(0);

  // 2. 抓取
  const todo = titles.filter((t) => {
    const { type, slug } = classify(t);
    const f = path.join(OUT, type, slug + '.json');
    return !(fs.existsSync(f) && fs.statSync(f).size > 10);
  });
  console.log(`待抓 ${todo.length} 页（已存在 ${titles.length - todo.length}）`);

  let ok = 0;
  let fail = 0;
  const failed = [];
  const t0 = Date.now();

  // 每个 worker 独立 page，共享同一浏览器上下文（共用 CF 会话）
  const pages = [page];
  for (let i = 1; i < WORKERS; i++) pages.push(await ctx.newPage());

  let lastWrite = Date.now();
  async function worker(myPage, list) {
    for (const title of list) {
      // 看门狗：页面假死时主动重载，避免整批卡住
      if (Date.now() - lastWrite > 75000) {
        try {
          await myPage.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
          await myPage.waitForTimeout(1500);
        } catch {
          try {
            await myPage.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 45000 });
          } catch { /* ignore */ }
        }
        lastWrite = Date.now();
      }
      const { type, slug } = classify(title);
      const d = await api(myPage, { action: 'parse', page: title, prop: 'wikitext' });
      if (!d?.parse?.wikitext) {
        fail++;
        failed.push(title);
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
      fs.writeFileSync(path.join(dir, slug + '.json'), JSON.stringify(rec, null, 1), 'utf8');
      ok++;
      if (ok % 50 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(
          `  ${ok}/${todo.length}  ${(ok / el).toFixed(2)}/s  ETA ${((todo.length - ok) / (ok / el) / 60).toFixed(1)}min`
        );
      }
      await sleep(50);
    }
  }

  const chunk = Math.ceil(todo.length / WORKERS);
  await Promise.all(pages.map((p, i) => worker(p, todo.slice(i * chunk, (i + 1) * chunk))));

  fs.writeFileSync(path.join(DATA, 'story_failed.json'), JSON.stringify(failed, null, 1), 'utf8');
  console.log(`✓ 新增 ${ok} 页，失败 ${fail} 页 -> data/story_failed.json`);
} finally {
  await browser.close();
}
