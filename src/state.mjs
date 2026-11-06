import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, file);
}

export function updatePluginRegistry(registry, entry) {
  if (registry.version !== 1 || !Array.isArray(registry.plugins) ||
      registry.plugins.some(p => !p || typeof p.id !== 'string')) throw new Error('Unrecognized Kimi plugin registry.');
  const matching = registry.plugins.filter(p => p.id === 'kimi-swarm');
  if (matching.length > 1) throw new Error('Duplicate kimi-swarm plugin records.');
  return {
    previous: matching[0] ?? null,
    registry: { ...registry, plugins: [...registry.plugins.filter(p => p.id !== 'kimi-swarm'), entry] },
  };
}
