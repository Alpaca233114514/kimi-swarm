import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPlan } from './launch-plan.mjs';
import { ensureCompatible } from './compatibility.mjs';

try {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  let active = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'));
  const input = process.argv.slice(2);
  let plan = launchPlan(active, input);
  if (plan.action === 'repair') {
    active = await ensureCompatible(root, active, { force: true });
    console.log(active.compatibilityFailed ? 'Compatibility validation failed; original CLI remains available.' : 'Compatible runtime is ready.');
    process.exitCode = active.compatibilityFailed ? 1 : 0;
  } else {
  if (plan.manager) plan.args.push(root, plan.action);
  else {
    active = await ensureCompatible(root, active);
    plan = launchPlan(active, input);
    if (['upgrade', 'update'].includes(plan.args.at(-1)) && input.length === 1) plan = { file: active.originalCommand, args: input };
  }
  const child = spawn(plan.file, plan.args, {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, KIMI_CODE_HOME: process.env.KIMI_CODE_HOME ?? active.home },
  });
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
  }
} catch (error) {
  console.error(`kimi-swarm: ${error.message}`);
  process.exitCode = 1;
}
