/**
 * 调项目 venv 里的 Python 跑图集导入
 *
 * 为什么不直接写 ".venv/Scripts/python.exe ..."：npm 在 Windows 上走 cmd，
 * 带前导点的相对路径会被当成命令名解析失败。这里用 node 统一转发，
 * 顺便把 TEMP/TMP 指到 .tmp（见 scripts/env.mjs）。
 *
 * 用法：npm run import:ui [-- --dry-run]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { childEnv } from './env.mjs';

const python = path.resolve('.venv/Scripts/python.exe');
const script = path.resolve('tools/fetch/import_ngui_atlas.py');

const child = spawn(python, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: childEnv(),
});
child.on('close', (code) => process.exit(code ?? 0));
