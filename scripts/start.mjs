/** 启动 Electron。清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会退化成纯 Node 跑。 */
import { spawn } from 'node:child_process';
import electron from 'electron';
import { childEnv } from './env.mjs';

const child = spawn(electron, ['.'], { stdio: 'inherit', env: childEnv() });
child.on('close', (code) => process.exit(code ?? 0));
