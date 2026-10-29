/**
 * Electron 主进程
 *
 * 职责：
 *  1. 起一个本地 HTTP 服务器（127.0.0.1，随机端口），统一提供 渲染层静态文件 / 素材 / 数据。
 *     用 http 而不是 file:// 是为了让 fetch()、WebGL 贴图、<audio> 都不踩跨域限制。
 *  2. 提供存档读写 IPC（存档落在 userData/save.json）。
 *  3. 素材目录可配置（默认指向仓库里的 resources/）。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_RES = path.join(ROOT, 'resources');
const DATA_DIR = path.join(ROOT, 'data');

// 所有运行时数据（存档、缓存、GPU shader、日志）都落在工作目录，不占 C 盘
const USER_DIR = path.join(ROOT, '.userdata');
app.setPath('userData', USER_DIR);
app.setPath('sessionData', path.join(USER_DIR, 'session'));
app.setPath('logs', path.join(USER_DIR, 'logs'));
try {
  app.setPath('cache', path.join(USER_DIR, 'cache'));
} catch {
  /* 部分平台不支持 cache 路径，忽略 */
}

// Chromium / V8 / 崩溃转储默认写 %TEMP%（在 C 盘），这里统一改到 .userdata/tmp。
// 必须在 app ready 之前设置，Chromium 初始化后就不认了。
const TMP_DIR = path.join(USER_DIR, 'tmp');
try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
  process.env.TMPDIR = TMP_DIR;
} catch {
  /* 目录不可写时保持系统默认，不阻塞启动 */
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.skel': 'application/octet-stream',
  '.atlas': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

interface AppConfig {
  /** 素材根目录，默认仓库里的 resources/ */
  resourceDir: string;
  /** 游戏解包目录（含 assets-_mx-uisprite 的那层），没有则 null */
  gameDir: string | null;
  /** 额外素材目录，留作多目录扩展 */
  wikiDir: string | null;
  /** 首次启动向导是否完成；false 时进主界面前先弹向导 */
  setupDone: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  resourceDir: DEFAULT_RES,
  gameDir: null,
  wikiDir: null,
  setupDone: false,
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

/** 目录字段统一做存在性校验，失效就退回默认值，避免把坏路径带进运行期 */
function readConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<AppConfig>;
    const dirOk = typeof raw.resourceDir === 'string' && fs.existsSync(raw.resourceDir);
    return {
      resourceDir: dirOk ? (raw.resourceDir as string) : DEFAULT_RES,
      gameDir: typeof raw.gameDir === 'string' && fs.existsSync(raw.gameDir) ? raw.gameDir : null,
      wikiDir: typeof raw.wikiDir === 'string' && fs.existsSync(raw.wikiDir) ? raw.wikiDir : null,
      setupDone: raw.setupDone === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

let currentConfig: AppConfig = { ...DEFAULT_CONFIG };
let currentRes = DEFAULT_RES;

/** 把 URL 路径安全地映射到磁盘路径，禁止越权访问 */
function resolveSafe(baseDir: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\\/g, '/');
  const target = path.resolve(baseDir, '.' + (clean.startsWith('/') ? clean : '/' + clean));
  const rel = path.relative(baseDir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404).end('404');
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(404).end('404');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const range = req.headers.range;

  // 音频拖动需要 Range 支持
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-cache',
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

function startServer(): Promise<number> {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url.startsWith('/res/')) {
      const file = resolveSafe(currentRes, url.slice(4));
      if (!file) return void res.writeHead(403).end('403');
      return serveFile(req, res, file);
    }
    if (url.startsWith('/data/')) {
      const file = resolveSafe(DATA_DIR, url.slice(5));
      if (!file) return void res.writeHead(403).end('403');
      return serveFile(req, res, file);
    }
    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ ok: true, resourceDir: currentRes }));
    }
    // 其余交给渲染层静态资源
    const file = resolveSafe(DIST, url === '/' ? '/index.html' : url);
    if (!file) return void res.writeHead(403).end('403');
    if (!fs.existsSync(file) && !path.extname(url)) {
      return serveFile(req, res, path.join(DIST, 'index.html'));
    }
    return serveFile(req, res, file);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

async function createWindow(port: number): Promise<void> {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    title: '什亭之匣 · Shittim Chest',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  currentConfig = readConfig();
  currentRes = currentConfig.resourceDir;

  ipcMain.handle('app:info', () => ({
    resourceDir: currentRes,
    defaultResourceDir: DEFAULT_RES,
    dataDir: DATA_DIR,
    userData: app.getPath('userData'),
    version: app.getVersion(),
    setupDone: currentConfig.setupDone,
    config: currentConfig,
  }));

  ipcMain.handle('config:get', () => currentConfig);

  // 只接受已知字段，目录字段一律做存在性校验
  ipcMain.handle('config:patch', (_e, patch: Partial<AppConfig>) => {
    const next: AppConfig = { ...currentConfig };
    if (typeof patch.resourceDir === 'string' && fs.existsSync(patch.resourceDir)) {
      next.resourceDir = patch.resourceDir;
    }
    if (patch.gameDir === null) next.gameDir = null;
    else if (typeof patch.gameDir === 'string' && fs.existsSync(patch.gameDir)) {
      next.gameDir = patch.gameDir;
    }
    if (patch.wikiDir === null) next.wikiDir = null;
    else if (typeof patch.wikiDir === 'string' && fs.existsSync(patch.wikiDir)) {
      next.wikiDir = patch.wikiDir;
    }
    if (typeof patch.setupDone === 'boolean') next.setupDone = patch.setupDone;
    currentConfig = next;
    currentRes = next.resourceDir;
    writeConfig(currentConfig);
    return currentConfig;
  });

  ipcMain.handle('dialog:pickDir', async (_e, title?: string) => {
    const r = await dialog.showOpenDialog({
      title: title || '选择目录',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('config:setResourceDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    currentRes = r.filePaths[0];
    currentConfig = { ...currentConfig, resourceDir: currentRes };
    writeConfig(currentConfig);
    return currentRes;
  });

  ipcMain.handle('save:read', () => {
    const p = path.join(app.getPath('userData'), 'save.json');
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('save:write', (_e, data: unknown) => {
    const p = path.join(app.getPath('userData'), 'save.json');
    const tmp = p + '.tmp';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, p);
    return true;
  });

  ipcMain.handle('save:reset', () => {
    const p = path.join(app.getPath('userData'), 'save.json');
    try {
      fs.unlinkSync(p);
    } catch {
      /* 不存在也无所谓 */
    }
    return true;
  });

  ipcMain.handle('shell:openResourceDir', () => {
    void shell.openPath(currentRes);
  });

  const port = await startServer();
  await createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
