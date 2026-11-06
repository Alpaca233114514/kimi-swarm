import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32, join } from 'node:path';
import { readJson, writeJson } from './state.mjs';

function execute(file, args, input) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, input });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || 'User PATH helper failed.');
  return result.stdout;
}

export function nativePathAdapter(helper) {
  return {
    read() { return JSON.parse(execute(helper, ['read'])); },
    write(before, value) { execute(helper, ['write'], JSON.stringify({ expected: before.userPath, value })); },
    exists: existsSync,
  };
}

function expand(value, env = process.env) {
  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
    return key === undefined ? whole : env[key];
  });
}

function normalized(value) {
  return win32.normalize(expand(value.trim().replace(/^"(.*)"$/, '$1'))).replace(/[\\/]+$/, '').toLowerCase();
}

export function hasManagedPath(raw, bin) {
  return (raw ?? '').split(';').some(entry => entry.trim() && normalized(entry) === normalized(bin));
}

export function removeManagedPath(raw, bin) {
  return (raw ?? '').split(';').filter(entry => !entry.trim() || normalized(entry) !== normalized(bin)).join(';');
}

export function prependManagedPath(raw, bin) {
  const rest = removeManagedPath(raw, bin);
  return rest ? bin + ';' + rest : bin;
}

export function firstKimi(raw, exists = existsSync) {
  for (const entry of (raw ?? '').split(';')) {
    if (!entry.trim()) continue;
    const directory = expand(entry.trim().replace(/^"(.*)"$/, '$1'));
    for (const extension of ['.com', '.exe', '.bat', '.cmd']) {
      const file = win32.join(directory, 'kimi' + extension);
      if (exists(file)) return file;
    }
  }
  return null;
}

export async function activatePath(root, bin, adapter) {
  const before = adapter.read();
  const machineKimi = firstKimi(before.machinePath, adapter.exists);
  if (machineKimi) throw new Error(`A system PATH entry takes precedence: ${machineKimi}. System settings were not changed.`);
  const receiptFile = join(root, 'path-receipt.json');
  let receipt = await readJson(receiptFile, null);
  if (!receipt || receipt.restored) {
    receipt = { version: 1, bin, before: before.userPath, inserted: !hasManagedPath(before.userPath, bin), restored: false };
    await writeJson(receiptFile, receipt);
  }
  const next = prependManagedPath(before.userPath, bin);
  if (next !== before.userPath) adapter.write(before, next);
  const current = adapter.read();
  if (normalized(firstKimi(current.userPath, adapter.exists) ?? '') !== normalized(win32.join(bin, 'kimi.cmd'))) {
    throw new Error('Managed kimi is not first in user PATH. Check the installation before using it.');
  }
}

export async function deactivatePath(root, bin, adapter) {
  const file = join(root, 'path-receipt.json');
  const receipt = await readJson(file, null);
  if (!receipt || receipt.restored) return;
  if (receipt.inserted) {
    const current = adapter.read();
    // 只移除自己的目录，保留安装后新增的 PATH。 / Remove only our directory, preserving later PATH edits.
    const next = removeManagedPath(current.userPath, bin);
    if (next !== current.userPath) adapter.write(current, next);
  }
  await writeJson(file, { ...receipt, restored: true });
}
