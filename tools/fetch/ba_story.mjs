/**
 * bluearchive.wiki 剧情抓取器
 *
 * 原理：BA Wiki 把每一集剧情存成 MediaWiki 模板 {{Story|...}}，
 * 参数已经是「编号 + 节点类型 + 字段」的结构（|1=bgm |bgm1=Theme_10），
 * 与项目的节点图 JSON 天然一一对应，无需解析 HTML。
 *
 * Cloudflare 会拦截 curl，所以全部请求走真实 Chrome 上下文内的 fetch()。
 *
 * 用法：
 *   node ba_story.mjs discover            # 枚举剧情页面，输出清单
 *   node ba_story.mjs fetch [--limit N]   # 抓取并转换为节点 JSON
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

// BA Wiki 的剧情页命名并不统一，四类来源分别取
const SOURCES = [
  { kind: 'prefix', value: 'Main Story/', type: 'main' },
  { kind: 'category', value: 'Relationship_stories', type: 'bond' },
  { kind: 'category', value: 'Event_stories', type: 'event' },
  { kind: 'prefix', value: 'Group Story/', type: 'group' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSession() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  // 首次访问建立 Cloudflare 会话
  await page.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  return { browser, page };
}

/** 在页面上下文里发 API 请求，自带 CF cookie；带硬超时，避免页面假死拖死整批 */
async function api(page, params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const url = `${API}?${qs}`;
  for (let i = 0; i < 3; i++) {
    const job = page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        return await r.text();
      } catch (e) {
        return 'ERR:' + e.message;
      }
    }, url);
    let txt;
    try {
      txt = await Promise.race([
        job,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
      ]);
    } catch {
      // 页面可能已假死，重载后重试
      try {
        await page.goto(SITE + '/wiki/Main_Page', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(1500);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (typeof txt !== 'string' || txt.startsWith('ERR:')) {
      await sleep(1200 * (i + 1));
      continue;
    }
    try {
      return JSON.parse(txt);
    } catch {
      await sleep(1200 * (i + 1));
    }
  }
  return null;
}

// ------------------------------------------------------------ 模板解析

/** 从 wikitext 中按花括号深度切出所有 {{Story ...}} 块 */
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

/** 把 {{Story|1=bgm|bgm1=Theme_10|...}} 拆成参数表 */
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
    } else {
      cur += c;
    }
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

/** {{Story}} → 节点数组 */
function toNodes(map) {
  // 收集所有「纯数字键」，即节点序号
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

/** 把节点数组映射到项目节点图（保留原始字段，便于无损回溯） */
function toGraph(nodes, meta) {
  const graph = [];
  for (const n of nodes) {
    const t = n.type;
    switch (t) {
      case 'background':
        graph.push({ op: 'background', bg: n.background || n.name || '', raw: n });
        break;
      case 'bgm':
        graph.push({ op: 'bgm', id: n.bgm || '', name: n.name || '', volume: n.volume || '1', raw: n });
        break;
      case 'bgm-stop':
        graph.push({ op: 'bgmStop', raw: n });
        break;
      case 'sound':
        graph.push({ op: 'se', id: n.sound || '', name: n.name || '', raw: n });
        break;
      case 'student-text':
        graph.push({
          op: 'script',
          speaker: n.name || '',
          text: n.text || '',
          spine: n.spine || '',
          sequence: n.sequence || '',
          affiliation: n.affiliation || '',
          raw: n,
        });
        break;
      case 'sensei':
        graph.push({ op: 'script', speaker: 'Sensei', text: n.text || '', raw: n });
        break;
      case 'info':
        graph.push({ op: 'info', text: n.text || '', raw: n });
        break;
      default:
        graph.push({ op: t, raw: n });
    }
  }
  return { ...meta, nodes: graph };
}

// ------------------------------------------------------------ 命令

async function discover(page) {
  const index = [];
  const seen = new Set();
  const push = (type, title) => {
    const k = title + '|' + type;
    if (seen.has(k)) return false;
    seen.add(k);
    index.push({ type, title });
    return true;
  };

  for (const src of SOURCES) {
    let cont = {};
    let count = 0;
    for (;;) {
      const params =
        src.kind === 'prefix'
          ? {
              action: 'query',
              list: 'allpages',
              apprefix: src.value,
              aplimit: '500',
              apnamespace: '0',
              ...cont,
            }
          : {
              action: 'query',
              list: 'categorymembers',
              cmtitle: 'Category:' + src.value,
              cmlimit: '500',
              cmnamespace: '0',
              ...cont,
            };
      const d = await api(page, params);
      const rows =
        src.kind === 'prefix' ? d?.query?.allpages : d?.query?.categorymembers;
      if (!rows) break;
      for (const p of rows) if (push(src.type, p.title)) count++;
      if (!d.continue) break;
      cont = d.continue;
      await sleep(150);
    }
    console.log(`  ${src.value.padEnd(24)} ${String(count).padStart(4)} 页  (${src.type})`);
  }

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'story_page_index.json'), JSON.stringify(index, null, 1), 'utf8');
  console.log(`合计 ${index.length} 个剧情页面 -> data/story_page_index.json`);
  return index;
}

function slug(title, type) {
  // main / group 的页面名带统一前缀，去掉；bond / event 的首段是学生名或活动名，必须保留以免撞名
  let s = title;
  if (type === 'main' || type === 'group') s = s.replace(/^[^/]+\//, '');
  return s
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
}

async function fetchAll(page, limit, start, end) {
  const idxPath = path.join(DATA, 'story_page_index.json');
  if (!fs.existsSync(idxPath)) throw new Error('先运行 discover');
  let index = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  if (start || end) index = index.slice(start || 0, end || undefined);
  if (limit) index = index.slice(0, limit);

  let ok = 0;
  let skip = 0;
  let empty = 0;
  const t0 = Date.now();
  const manifest = [];

  for (let i = 0; i < index.length; i++) {
    const { type, title } = index[i];
    const dir = path.join(OUT, type);
    const file = path.join(dir, slug(title, type) + '.json');
    if (fs.existsSync(file) && fs.statSync(file).size > 10) {
      skip++;
      continue;
    }
    const d = await api(page, { action: 'parse', page: title, prop: 'wikitext' });
    if (!d?.parse?.wikitext) {
      empty++;
      continue;
    }
    const wt = d.parse.wikitext;
    const tops = extractTemplates(wt, 'Story/StoryTop');
    const top = tops.length ? splitParams(tops[0]) : {};
    const stories = extractTemplates(wt, 'Story');
    const real = stories.filter((s) => !/^\{\{Story\/StoryTop/.test(s));
    const nodes = real.flatMap((s) => toNodes(splitParams(s)));

    const rec = toGraph(nodes, {
      story_id: title.replace(/\s+/g, '_'),
      type,
      title: top.title || title.split('/').pop(),
      summary: top.summary || '',
      volume: top.volume || '',
      chapter: top.chapter || '',
      episode: top.episode || '',
      prev: top.prev_page || '',
      next: top.next_page || '',
      source_url: `${SITE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      fetched_at: new Date().toISOString(),
    });

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 1), 'utf8');
    ok++;

    if (ok % 25 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(
        `  [${start || 0}] ${ok}/${index.length}  ${(ok / el).toFixed(2)}/s  ` +
          `ETA ${((index.length - ok) / (ok / el) / 60).toFixed(1)}min`
      );
    }
    await sleep(80);
  }

  console.log(`✓ 区间 ${start || 0}-${(start || 0) + index.length}：新增 ${ok} 集，已存在 ${skip}，空页 ${empty}`);
}

const cmd = process.argv[2] || 'discover';
const limArg = process.argv.indexOf('--limit');
const limit = limArg > -1 ? Number(process.argv[limArg + 1]) : null;
const sArg = process.argv.indexOf('--start');
const start = sArg > -1 ? Number(process.argv[sArg + 1]) : 0;
const eArg = process.argv.indexOf('--end');
const end = eArg > -1 ? Number(process.argv[eArg + 1]) : null;

const { browser, page } = await openSession();
try {
  if (cmd === 'discover') await discover(page);
  else if (cmd === 'fetch') await fetchAll(page, limit, start, end);
  else console.log('未知命令:', cmd);
} finally {
  await browser.close();
}
