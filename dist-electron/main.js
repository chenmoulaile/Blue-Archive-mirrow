"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron = require("electron");
var import_node_http = __toESM(require("node:http"));
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_fs2 = require("node:fs");
var ROOT = import_node_path.default.resolve(__dirname, "..");
var DIST = import_node_path.default.join(ROOT, "dist");
var DEFAULT_RES = import_node_path.default.join(ROOT, "resources");
var DATA_DIR = import_node_path.default.join(ROOT, "data");
var USER_DIR = import_node_path.default.join(ROOT, ".userdata");
import_electron.app.setPath("userData", USER_DIR);
import_electron.app.setPath("sessionData", import_node_path.default.join(USER_DIR, "session"));
import_electron.app.setPath("logs", import_node_path.default.join(USER_DIR, "logs"));
try {
  import_electron.app.setPath("cache", import_node_path.default.join(USER_DIR, "cache"));
} catch {
}
var TMP_DIR = import_node_path.default.join(USER_DIR, "tmp");
try {
  import_node_fs.default.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
  process.env.TMPDIR = TMP_DIR;
} catch {
}
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".skel": "application/octet-stream",
  ".atlas": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};
var DEFAULT_CONFIG = {
  resourceDir: DEFAULT_RES,
  gameDir: null,
  wikiDir: null,
  setupDone: false
};
function configPath() {
  return import_node_path.default.join(import_electron.app.getPath("userData"), "config.json");
}
function readConfig() {
  try {
    const raw = JSON.parse(import_node_fs.default.readFileSync(configPath(), "utf8"));
    const dirOk = typeof raw.resourceDir === "string" && import_node_fs.default.existsSync(raw.resourceDir);
    return {
      resourceDir: dirOk ? raw.resourceDir : DEFAULT_RES,
      gameDir: typeof raw.gameDir === "string" && import_node_fs.default.existsSync(raw.gameDir) ? raw.gameDir : null,
      wikiDir: typeof raw.wikiDir === "string" && import_node_fs.default.existsSync(raw.wikiDir) ? raw.wikiDir : null,
      setupDone: raw.setupDone === true
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function writeConfig(cfg) {
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(configPath()), { recursive: true });
  import_node_fs.default.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
}
var currentConfig = { ...DEFAULT_CONFIG };
var currentRes = DEFAULT_RES;
function resolveSafe(baseDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\\/g, "/");
  const target = import_node_path.default.resolve(baseDir, "." + (clean.startsWith("/") ? clean : "/" + clean));
  const rel = import_node_path.default.relative(baseDir, target);
  if (rel.startsWith("..") || import_node_path.default.isAbsolute(rel)) return null;
  return target;
}
function serveFile(req, res, file) {
  let stat;
  try {
    stat = import_node_fs.default.statSync(file);
  } catch {
    res.writeHead(404).end("404");
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(404).end("404");
    return;
  }
  const ext = import_node_path.default.extname(file).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Cache-Control": "no-cache"
      });
      (0, import_node_fs2.createReadStream)(file, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
  });
  (0, import_node_fs2.createReadStream)(file).pipe(res);
}
function startServer() {
  const server = import_node_http.default.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url.startsWith("/res/")) {
      const file2 = resolveSafe(currentRes, url.slice(4));
      if (!file2) return void res.writeHead(403).end("403");
      return serveFile(req, res, file2);
    }
    if (url.startsWith("/data/")) {
      const file2 = resolveSafe(DATA_DIR, url.slice(5));
      if (!file2) return void res.writeHead(403).end("403");
      return serveFile(req, res, file2);
    }
    if (url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return void res.end(JSON.stringify({ ok: true, resourceDir: currentRes }));
    }
    const file = resolveSafe(DIST, url === "/" ? "/index.html" : url);
    if (!file) return void res.writeHead(403).end("403");
    if (!import_node_fs.default.existsSync(file) && !import_node_path.default.extname(url)) {
      return serveFile(req, res, import_node_path.default.join(DIST, "index.html"));
    }
    return serveFile(req, res, file);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}
async function createWindow(port) {
  const win = new import_electron.BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    title: "\u4EC0\u4EAD\u4E4B\u5323 \xB7 Shittim Chest",
    webPreferences: {
      preload: import_node_path.default.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void import_electron.shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}
import_electron.app.whenReady().then(async () => {
  currentConfig = readConfig();
  currentRes = currentConfig.resourceDir;
  import_electron.ipcMain.handle("app:info", () => ({
    resourceDir: currentRes,
    defaultResourceDir: DEFAULT_RES,
    dataDir: DATA_DIR,
    userData: import_electron.app.getPath("userData"),
    version: import_electron.app.getVersion(),
    setupDone: currentConfig.setupDone,
    config: currentConfig
  }));
  import_electron.ipcMain.handle("config:get", () => currentConfig);
  import_electron.ipcMain.handle("config:patch", (_e, patch) => {
    const next = { ...currentConfig };
    if (typeof patch.resourceDir === "string" && import_node_fs.default.existsSync(patch.resourceDir)) {
      next.resourceDir = patch.resourceDir;
    }
    if (patch.gameDir === null) next.gameDir = null;
    else if (typeof patch.gameDir === "string" && import_node_fs.default.existsSync(patch.gameDir)) {
      next.gameDir = patch.gameDir;
    }
    if (patch.wikiDir === null) next.wikiDir = null;
    else if (typeof patch.wikiDir === "string" && import_node_fs.default.existsSync(patch.wikiDir)) {
      next.wikiDir = patch.wikiDir;
    }
    if (typeof patch.setupDone === "boolean") next.setupDone = patch.setupDone;
    currentConfig = next;
    currentRes = next.resourceDir;
    writeConfig(currentConfig);
    return currentConfig;
  });
  import_electron.ipcMain.handle("dialog:pickDir", async (_e, title) => {
    const r = await import_electron.dialog.showOpenDialog({
      title: title || "\u9009\u62E9\u76EE\u5F55",
      properties: ["openDirectory"]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });
  import_electron.ipcMain.handle("config:setResourceDir", async () => {
    const r = await import_electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    currentRes = r.filePaths[0];
    currentConfig = { ...currentConfig, resourceDir: currentRes };
    writeConfig(currentConfig);
    return currentRes;
  });
  import_electron.ipcMain.handle("save:read", () => {
    const p = import_node_path.default.join(import_electron.app.getPath("userData"), "save.json");
    try {
      return JSON.parse(import_node_fs.default.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  });
  import_electron.ipcMain.handle("save:write", (_e, data) => {
    const p = import_node_path.default.join(import_electron.app.getPath("userData"), "save.json");
    const tmp = p + ".tmp";
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(p), { recursive: true });
    import_node_fs.default.writeFileSync(tmp, JSON.stringify(data), "utf8");
    import_node_fs.default.renameSync(tmp, p);
    return true;
  });
  import_electron.ipcMain.handle("save:reset", () => {
    const p = import_node_path.default.join(import_electron.app.getPath("userData"), "save.json");
    try {
      import_node_fs.default.unlinkSync(p);
    } catch {
    }
    return true;
  });
  import_electron.ipcMain.handle("shell:openResourceDir", () => {
    void import_electron.shell.openPath(currentRes);
  });
  const port = await startServer();
  await createWindow(port);
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) void createWindow(port);
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
