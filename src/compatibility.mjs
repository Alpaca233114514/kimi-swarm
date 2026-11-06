import { spawnSync } from 'node:child_process';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from './state.mjs';

export async function ensureCompatible(root, active, { force = false, run = spawnSync, warn = message => console.error(message) } = {}) {
  if ((!force && active.activation === 'inactive') || !active.updaterPath) return active;
  const versionProbe = run(active.originalCommand, ['--version'], { encoding: 'utf8', windowsHide: true });
  const version = versionProbe.stdout?.trim();
  if (versionProbe.status !== 0 || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    warn('kimi-swarm: original CLI version is unavailable; keeping the verified runtime.');
    return force ? { ...active, compatibilityFailed: true } : active;
  }
  if (version === active.kimiVersion && !force) return active;
  const failedFile = join(root, 'compatibility.json');
  const failed = await readJson(failedFile, null);
  const fallback = () => ({ ...active, activation: 'inactive', compatibilityFailed: true });
  if (!force && failed?.status === 'incompatible' && failed?.version === version && failed?.adapter === active.pluginVersion) {
    warn(`kimi-swarm: Swarm is unavailable for ${version}; running the original CLI. Use kimi swarm repair to retry.`);
    return fallback();
  }
  let lock;
  const lockFile = join(root, 'update.lock');
  try {
    lock = await open(lockFile, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    warn('kimi-swarm: another runtime update is in progress; running the original CLI for this invocation.');
    return fallback();
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, version }));
    warn(`kimi-swarm: preparing a compatible runtime for Kimi ${version}…`);
    const result = run(process.execPath, [active.updaterPath, '--root', root, '--home', active.home,
      '--no-activate', '--runtime-version', version, '--original-command', active.originalCommand], {
      stdio: ['ignore', 2, 2], windowsHide: true,
    });
    if (result.status === 0) {
      const next = await readJson(join(root, 'active.json'));
      if (next?.kimiVersion === version) {
        await writeJson(failedFile, { version, adapter: next.pluginVersion, status: 'compatible' });
        return next;
      }
    }
    await writeJson(failedFile, { version, adapter: active.pluginVersion, status: 'incompatible' });
    warn(`kimi-swarm: compatibility validation failed for ${version}; original CLI restored for this invocation.`);
    return fallback();
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
