import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchBundle, candidateVersion } from './patch-bundle.mjs';
import { readJson } from './state.mjs';
export { readJson, writeJson, updatePluginRegistry } from './state.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateRuntimeVersion(detected) {
  if (candidateVersion(detected)) return;
  throw new Error(`Unsupported Kimi version ${detected}; stable 2.4.1 or later is required.`);
}

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
  if (version !== pkg.version) throw new Error(`Patched CLI reported unexpected version: ${version}`);
  run(process.execPath, [main, '--help'], smokeOptions);
  return { main, backup, version, changes: patched.changes };
}

function batchQuote(value) {
  if (/[\r\n"]/u.test(value)) throw new Error('Unsupported launcher path.');
  return '"' + value.replaceAll('%', '%%') + '"';
}

export async function writeLaunchers(root) {
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  for (const file of ['launcher.mjs', 'launch-plan.mjs', 'compatibility.mjs', 'state.mjs', 'kimi.cmd', 'kimi-swarm.cmd']) {
    const target = join(bin, file);
    if (existsSync(target)) await copyFile(target, `${target}.before-${Date.now()}`);
  }
  for (const file of ['launcher.mjs', 'launch-plan.mjs', 'compatibility.mjs', 'state.mjs']) await cp(join(projectRoot, 'src', file), join(bin, file));
  for (const name of ['kimi', 'kimi-swarm']) {
    const prefix = name === 'kimi-swarm' ? ' --kimi-swarm-entry' : '';
    const cmd = `@echo off\r\nrem kimi-swarm managed launcher\r\n${batchQuote(process.execPath)} ${batchQuote(join(bin, 'launcher.mjs'))}${prefix} %*\r\nexit /b %errorlevel%\r\n`;
    await writeFile(join(bin, `${name}.cmd`), cmd);
  }
  return bin;
}

export function originalKimiCommand() {
  const name = process.platform === 'win32' ? 'kimi.exe' : 'kimi';
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const file = join(directory.replace(/^"(.*)"$/, '$1'), name);
    if (existsSync(file)) return resolve(file);
  }
  throw new Error('Original Kimi executable was not found.');
}

export async function installManager(release) {
  const manager = join(release, 'manager');
  await mkdir(manager);
  for (const file of ['manager.mjs', 'lifecycle.mjs', 'windows-path.mjs', 'state.mjs']) {
    await copyFile(join(projectRoot, 'src', file), join(manager, file));
  }
  if (process.platform === 'win32') {
    const windows = process.env.WINDIR ?? 'C:\\Windows';
    const compiler = ['Framework64', 'Framework'].map(part => join(windows, 'Microsoft.NET', part, 'v4.0.30319', 'csc.exe')).find(existsSync);
    if (!compiler) throw new Error('Windows .NET Framework compiler is required to prepare the user-PATH helper.');
    run(compiler, ['/nologo', '/target:exe', '/r:System.Web.Extensions.dll', '/out:' + join(manager, 'windows-path.exe'), join(projectRoot, 'src', 'windows-path.cs')]);
  }
  const updater = join(release, 'updater');
  for (const dir of ['src', 'scripts', 'runtime']) await cp(join(projectRoot, dir), join(updater, dir), { recursive: true });
  for (const file of ['package.json', 'kimi.plugin.json', 'SYSTEM.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) await copyFile(join(projectRoot, file), join(updater, file));
  return { managerPath: join(manager, 'manager.mjs'), updaterPath: join(updater, 'scripts', 'install.mjs') };
}
