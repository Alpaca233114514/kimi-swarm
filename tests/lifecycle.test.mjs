import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, win32 } from 'node:path';
import { readJson, writeJson } from '../src/state.mjs';
import { manageInstallation } from '../src/lifecycle.mjs';
import { launchPlan } from '../src/launch-plan.mjs';
import { ensureCompatible } from '../src/compatibility.mjs';
import { activatePath, deactivatePath, hasManagedPath } from '../src/windows-path.mjs';

async function fixture() {
  await mkdir('.cache/tests', { recursive: true });
  const root = await mkdtemp(resolve('.cache/tests/lifecycle-'));
  const active = { home: join(root, 'home'), main: join(root, 'main.mjs'), pluginRoot: join(root, 'plugin'),
    originalCommand: join(root, 'original.exe'), managerPath: join(root, 'manager.mjs'),
    updaterPath: join(root, 'install.mjs'), activation: 'standalone', kimiVersion: '2.4.1', pluginVersion: '0.1.2',
    previousPlugin: { id: 'kimi-swarm', root: 'old-plugin', enabled: false } };
  await mkdir(active.pluginRoot);
  for (const file of [active.main, active.originalCommand, join(active.pluginRoot, 'kimi.plugin.json')]) await writeFile(file, 'fixture');
  const registryFile = join(active.home, 'plugins', 'installed.json');
  await writeJson(registryFile, { version: 1, plugins: [{ id: 'other', enabled: true }, { id: 'kimi-swarm', root: active.pluginRoot, enabled: true }] });
  await writeJson(join(root, 'active.json'), active);
  let paths = { userPath: 'C:\\original', machinePath: 'C:\\Windows' };
  const bin = join(root, 'bin');
  const adapter = { read: () => ({ ...paths }), write: (before, value) => { assert.equal(before.userPath, paths.userPath); paths.userPath = value; },
    exists: file => file === win32.join(bin, 'kimi.cmd') || file === 'C:\\original\\kimi.exe' };
  return { root, active, registryFile, adapter, paths, bin };
}

test('enable, disable, re-enable and uninstall preserve user data and unrelated PATH changes', async () => {
  const f = await fixture();
  await writeJson(join(f.root, 'preferences.json'), { enabled: true });
  await manageInstallation(f.root, 'enable', f.adapter);
  assert.equal((await manageInstallation(f.root, 'status', f.adapter)).resolvedKimi, win32.join(f.bin, 'kimi.cmd'));
  f.paths.userPath += ';C:\\later-tool';
  await manageInstallation(f.root, 'disable', f.adapter);
  assert.equal(f.paths.userPath, 'C:\\original;C:\\later-tool');
  assert.equal((await readJson(f.registryFile)).plugins.find(p => p.id === 'kimi-swarm').enabled, false);
  const disabled = await readJson(join(f.root, 'active.json'));
  assert.deepEqual(launchPlan(disabled, ['--version']), { file: f.active.originalCommand, args: ['--version'] });
  await manageInstallation(f.root, 'enable', f.adapter);
  await manageInstallation(f.root, 'uninstall', f.adapter);
  const registry = await readJson(f.registryFile);
  assert.deepEqual(registry.plugins.find(p => p.id === 'kimi-swarm'), f.active.previousPlugin);
  assert.deepEqual(registry.plugins.find(p => p.id === 'other'), { id: 'other', enabled: true });
  assert.deepEqual(await readJson(join(f.root, 'preferences.json')), { enabled: true });
  await manageInstallation(f.root, 'enable', f.adapter);
  assert.equal((await readJson(f.registryFile)).plugins.find(p => p.id === 'kimi-swarm').root, f.active.pluginRoot);
});

test('a system-wide Kimi blocks user PATH activation without rewriting PATH', async () => {
  const f = await fixture();
  f.paths.machinePath = 'C:\\original';
  await assert.rejects(activatePath(f.root, f.bin, f.adapter), /system PATH/);
  assert.equal(f.paths.userPath, 'C:\\original');
});

test('uninstall does not remove a pre-existing PATH entry', async () => {
  const f = await fixture();
  f.paths.userPath = f.bin + ';C:\\original';
  await activatePath(f.root, f.bin, f.adapter);
  await deactivatePath(f.root, f.bin, f.adapter);
  assert.equal(hasManagedPath(f.paths.userPath, f.bin), true);
});

test('management commands remain reachable when disabled and ordinary arguments pass through', () => {
  const active = { activation: 'inactive', managerPath: 'manager', originalCommand: 'original' };
  assert.equal(launchPlan(active, ['swarm', 'enable']).action, 'enable');
  assert.equal(launchPlan(active, ['--kimi-swarm-entry', 'uninstall']).action, 'uninstall');
  assert.deepEqual(launchPlan(active, ['--kimi-swarm-entry', '--prompt', 'swarm disable']), { file: 'original', args: ['--prompt', 'swarm disable'] });
});

test('unchanged version and disabled installation never run an updater', async () => {
  const f = await fixture();
  let calls = 0;
  const options = { run() { calls++; return { status: 0, stdout: '2.4.1\n' }; } };
  assert.equal(await ensureCompatible(f.root, f.active, options), f.active);
  assert.equal(calls, 1);
  await ensureCompatible(f.root, { ...f.active, activation: 'inactive' }, options);
  assert.equal(calls, 1);
});

test('failed upgrade falls back to original, caches failure, and explicit repair retries', async () => {
  const f = await fixture();
  let updates = 0;
  const options = { warn() {}, run(file) {
    if (file === f.active.originalCommand) return { status: 0, stdout: '2.5.2\n' };
    updates++; return { status: 1 };
  } };
  const result = await ensureCompatible(f.root, f.active, options);
  assert.equal(launchPlan(result, ['--version']).file, f.active.originalCommand);
  assert.equal((await readJson(join(f.root, 'active.json'))).kimiVersion, '2.4.1');
  await ensureCompatible(f.root, f.active, options);
  assert.equal(updates, 1);
  await ensureCompatible(f.root, f.active, { ...options, force: true });
  assert.equal(updates, 2);
});

test('a verified upgrade switches to the new runtime without altering activation', async () => {
  const f = await fixture();
  const next = { ...f.active, kimiVersion: '2.5.2', main: 'new-main', activation: 'user-path' };
  // 模拟安装器提交已验证副本。 / Simulate the installer committing its verified candidate.
  const options = { warn() {}, run(file, args) {
    if (file === f.active.originalCommand) return { status: 0, stdout: '2.5.2' };
    assert.ok(args.includes('--no-activate'));
    return { status: 0 };
  } };
  await writeJson(join(f.root, 'active.json'), next);
  assert.deepEqual(await ensureCompatible(f.root, f.active, options), next);
});
