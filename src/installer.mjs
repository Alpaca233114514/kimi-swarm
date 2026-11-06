import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchBundle, SUPPORTED_KIMI_VERSION } from './patch-bundle.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed (${result.status}): ${(result.stderr ?? '').trim()}`);
  return (result.stdout ?? '').trim();
}

export function npmCli() {
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const found = candidates.find(p => p?.endsWith('npm-cli.js') && existsSync(p));
  if (!found) throw new Error('npm-cli.js was not found. Run the installer using npm run install:cli.');
  return found;
}

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

export async function patchPackage(packageRoot) {
  const pkg = await readJson(join(packageRoot, 'package.json'));
  if (pkg?.name !== '@moonshot-ai/kimi-code') throw new Error('Expected the official @moonshot-ai/kimi-code package.');
  const main = join(packageRoot, 'dist', 'main.mjs');
  const source = await readFile(main, 'utf8');
  const patched = patchBundle(source, pkg.version);
  const backup = main + '.before-kimi-swarm';
  // 先保留原包，再写入完整验证过的变更。 / Preserve the original before writing the checked transformation.
  await writeFile(backup, source, { flag: 'wx' });
  await copyFile(join(projectRoot, 'src', 'runtime.mjs'), join(packageRoot, 'dist', 'kimi-swarm-runtime.mjs'));
  await writeFile(main, patched.source);
  run(process.execPath, ['--check', main]);
  const smokeHome = join(packageRoot, '.swarm-smoke-home');
  await mkdir(smokeHome);
  const smokeOptions = { env: { ...process.env, KIMI_CODE_HOME: smokeHome } };
  const version = run(process.execPath, [main, '--version'], smokeOptions);
  if (version !== SUPPORTED_KIMI_VERSION) throw new Error(`Patched CLI reported unexpected version: ${version}`);
  run(process.execPath, [main, '--help'], smokeOptions);
  return { main, backup, changes: patched.changes };
}

function batchQuote(value) {
  if (/[\r\n"]/u.test(value)) throw new Error('Unsupported launcher path.');
  return '"' + value.replaceAll('%', '%%') + '"';
}

export async function writeLaunchers(root) {
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  for (const file of ['launcher.mjs', 'kimi.cmd', 'kimi-swarm.cmd']) {
    const target = join(bin, file);
    if (existsSync(target)) await copyFile(target, `${target}.before-${Date.now()}`);
  }
  await cp(join(projectRoot, 'src', 'launcher.mjs'), join(bin, 'launcher.mjs'));
  const cmd = `@echo off\r\nrem kimi-swarm managed launcher\r\n${batchQuote(process.execPath)} ${batchQuote(join(bin, 'launcher.mjs'))} %*\r\nexit /b %errorlevel%\r\n`;
  for (const name of ['kimi', 'kimi-swarm']) await writeFile(join(bin, `${name}.cmd`), cmd);
  return bin;
}

export function setWindowsPath(bin, mode) {
  if (process.platform !== 'win32') throw new Error('Automatic PATH activation currently supports Windows only; use --no-activate.');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    join(projectRoot, 'scripts', 'path.ps1'), '-Bin', bin, '-Mode', mode]);
}
