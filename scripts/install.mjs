import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { npmCli, patchPackage, projectRoot, readJson, run, setWindowsPath,
  updatePluginRegistry, writeJson, writeLaunchers } from '../src/installer.mjs';
import { PATCH_MARKER, SUPPORTED_KIMI_VERSION } from '../src/patch-bundle.mjs';

const { values } = parseArgs({ options: {
  root: { type: 'string' }, home: { type: 'string' },
  'no-activate': { type: 'boolean' }, check: { type: 'boolean' },
  deactivate: { type: 'boolean' }, help: { type: 'boolean' },
} });
const home = resolve(values.home ?? process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'));
const root = resolve(values.root ?? join(home, 'swarm'));

async function main() {
  if (values.help) {
    console.log('node scripts/install.mjs [--root DIR] [--home DIR] [--no-activate | --check | --deactivate]');
    return;
  }
  const activeFile = join(root, 'active.json');
  const active = await readJson(activeFile, null);
  if (values.check) {
    if (!active) throw new Error('No managed kimi-swarm installation.');
    if (!(await readFile(active.main, 'utf8')).includes(PATCH_MARKER)) throw new Error('CLI bridge is missing.');
    const version = run(process.execPath, [active.main, '--version'], { env: { ...process.env, KIMI_CODE_HOME: active.home } });
    const registry = await readJson(join(active.home, 'plugins', 'installed.json'));
    const plugin = registry?.plugins?.find(p => p.id === 'kimi-swarm');
    console.log(JSON.stringify({ version, main: active.main, pluginEnabled: plugin?.enabled === true,
      pluginRootMatches: plugin?.root === active.pluginRoot, activation: active.activation }, null, 2));
    return;
  }
  if (values.deactivate) {
    if (!active) throw new Error('No managed kimi-swarm installation.');
    if (active.activation === 'user-path') setWindowsPath(join(root, 'bin'), 'deactivate');
    const registryFile = join(active.home, 'plugins', 'installed.json');
    const registry = await readJson(registryFile);
    const current = registry?.plugins?.find(p => p.id === 'kimi-swarm');
    if (current?.root === active.pluginRoot) {
      await copyFile(registryFile, registryFile + `.before-deactivate-${Date.now()}`);
      const replacement = active.previousPlugin ?? { ...current, enabled: false };
      await writeJson(registryFile, updatePluginRegistry(registry, replacement).registry);
    }
    await writeJson(activeFile, { ...active, activation: 'inactive' });
    console.log('Deactivated. Original CLI and all managed files are preserved. Open a new terminal.');
    return;
  }
  if (!values['no-activate'] && process.platform !== 'win32') throw new Error('Use --no-activate on this platform.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 15)) throw new Error('Node.js >=24.15 is required.');
  const detected = run(process.platform === 'win32' ? 'kimi.exe' : 'kimi', ['--version']);
  if (detected !== SUPPORTED_KIMI_VERSION) throw new Error(`Installed Kimi is ${detected}; this installer supports ${SUPPORTED_KIMI_VERSION} and will not upgrade it.`);

  const id = `${SUPPORTED_KIMI_VERSION}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const release = join(root, 'releases', id);
  await mkdir(release, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) await copyFile(join(projectRoot, 'runtime', file), join(release, file));
  console.log(`Preparing official Kimi ${SUPPORTED_KIMI_VERSION}; lifecycle scripts disabled…`);
  run(process.execPath, [npmCli(), 'ci', '--prefix', release, '--ignore-scripts',
    '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=30000'], { stdio: 'inherit' });
  const patched = await patchPackage(join(release, 'node_modules', '@moonshot-ai', 'kimi-code'));
  const pluginRoot = join(release, 'plugin');
  await mkdir(pluginRoot);
  for (const file of ['kimi.plugin.json', 'SYSTEM.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    await copyFile(join(projectRoot, file), join(pluginRoot, file));
  }
  const registryFile = join(home, 'plugins', 'installed.json');
  const registry = await readJson(registryFile, { version: 1, plugins: [] });
  const now = new Date().toISOString();
  const entry = { id: 'kimi-swarm', root: pluginRoot, source: 'local-path', enabled: true,
    installedAt: now, updatedAt: now, originalSource: projectRoot };
  const updated = updatePluginRegistry(registry, entry);
  await mkdir(join(home, 'plugins'), { recursive: true });
  await writeJson(join(release, 'registry.before.json'), registry);
  const bin = await writeLaunchers(root);
  const state = { version: 1, main: patched.main, home, pluginRoot,
    previousPlugin: active && updated.previous?.root === active.pluginRoot ? active.previousPlugin : updated.previous,
    activation: active?.activation === 'user-path' ? 'user-path' : 'standalone', release };
  await writeJson(join(release, 'install-report.json'), { ...state, changes: patched.changes });
  if (active) await writeJson(join(release, 'active.before.json'), active);
  await writeJson(registryFile, updated.registry);
  await writeJson(activeFile, state);
  run(process.execPath, [join(bin, 'launcher.mjs'), '--version'], { env: { ...process.env, KIMI_CODE_HOME: home } });
  if (!values['no-activate']) {
    setWindowsPath(bin, 'activate');
    state.activation = 'user-path';
    await writeJson(activeFile, state);
  }
  console.log(`Installed and smoke-checked: ${patched.main}`);
  console.log(`Launcher: ${join(bin, 'kimi-swarm.cmd')}`);
  console.log(values['no-activate'] ? 'PATH unchanged. Use the launcher directly.' : 'Open a new terminal, then run kimi. If a system PATH entry shadows it, use the displayed launcher.');
}

main().catch(error => { console.error(`kimi-swarm: ${error.message}`); process.exitCode = 1; });
