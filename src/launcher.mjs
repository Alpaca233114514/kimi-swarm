import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const active = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'));
  const child = spawn(process.execPath, [active.main, ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, KIMI_CODE_HOME: process.env.KIMI_CODE_HOME ?? active.home },
  });
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
} catch (error) {
  console.error(`kimi-swarm: ${error.message}`);
  process.exitCode = 1;
}
