/**
 * 统一的运行期环境
 *
 * 硬性约束：本项目所有工作（含临时文件、缓存）只允许落在 E 盘。
 * Chromium / Electron / esbuild 默认会把临时文件写到 %TEMP%（在 C 盘），
 * 所以凡是拉起子进程的地方，一律走 childEnv()，把 TEMP/TMP/TMPDIR 覆盖到项目 .tmp。
 *
 * 其它已收口的缓存：
 *   npm      -> .npmrc 里的 cache=E:/npm-cache、electron_config_cache=E:/npm-cache/electron
 *   pip      -> .venv/pip.ini 里的 cache-dir=E:/pip-cache
 *   Electron -> electron/main.ts 里 app.setPath('userData'|'sessionData'|'logs'|'cache')
 *               全部指向 .userdata
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const TMP_DIR = path.resolve('.tmp');
mkdirSync(TMP_DIR, { recursive: true });

// Playwright 用 os.tmpdir() 建浏览器 profile，os.tmpdir() 读的是当前进程的 TEMP。
// 所以除了传给子进程，必须把当前进程的环境变量也改掉，否则仍会在 C 盘落临时目录。
process.env.TEMP = TMP_DIR;
process.env.TMP = TMP_DIR;
process.env.TMPDIR = TMP_DIR;

/**
 * 生成子进程环境变量。
 * ELECTRON_RUN_AS_NODE 必须删掉，否则 Electron 会退化成纯 Node 进程。
 */
export function childEnv(extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    TEMP: TMP_DIR,
    TMP: TMP_DIR,
    TMPDIR: TMP_DIR,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
