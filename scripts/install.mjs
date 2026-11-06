import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { npmCli, patchPackage, projectRoot, readJson, run, installManager, originalKimiCommand,
  updatePluginRegistry, validateRuntimeVersion, writeJson, writeLaunchers } from '../src/installer.mjs';
import { PATCH_MARKER } from '../src/patch-bundle.mjs';
import { manageInstallation } from '../src/lifecycle.mjs';

const { values } = parseArgs({ options: {
  root: { type: 'string' }, home: { type: 'string' },
  'no-activate': { type: 'boolean' }, check: { type: 'boolean' },
  deactivate: { type: 'boolean' }, help: { type: 'boolean' },
  activate: { type: 'boolean' }, 'runtime-version': { type: 'string' }, 'original-command': { type: 'string' },
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
  if (values.deactivate || values.activate) {
    if (!active) throw new Error('No managed kimi-swarm installation.');
    console.log(JSON.stringify(await manageInstallation(root, values.activate ? 'enable' : 'uninstall'), null, 2));
    return;
  }
  if (!values['no-activate'] && process.platform !== 'win32') throw new Error('Use --no-activate on this platform.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 15)) throw new Error('Node.js >=24.15 is required.');
  const originalCommand = resolve(values['original-command'] ?? active?.originalCommand ?? originalKimiCommand());
  const detected = run(originalCommand, ['--version']);
  const targetVersion = values['runtime-version'] ?? detected;
  validateRuntimeVersion(targetVersion);
  const metadata = JSON.parse(run(process.execPath, [npmCli(), 'view', `@moonshot-ai/kimi-code@${targetVersion}`,
    'name', 'version', 'repository', 'scripts', '--json', '--registry=https://registry.npmjs.org', '--fetch-retries=0', '--fetch-timeout=15000']));
  if (metadata.name !== '@moonshot-ai/kimi-code' || metadata.version !== targetVersion ||
      metadata.repository?.url !== 'git+https://github.com/MoonshotAI/kimi-code.git') throw new Error('Unexpected Kimi package origin.');

  const id = `${targetVersion}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const release = join(root, 'releases', id);
  await mkdir(release, { recursive: true });
  const template = await readJson(join(projectRoot, 'runtime', 'package.json'));
  if (template.dependencies['@moonshot-ai/kimi-code'] === targetVersion) {
    for (const file of ['package.json', 'package-lock.json']) await copyFile(join(projectRoot, 'runtime', file), join(release, file));
  } else {
    await writeJson(join(release, 'package.json'), { ...template, dependencies: { '@moonshot-ai/kimi-code': targetVersion } });
    run(process.execPath, [npmCli(), 'install', '--prefix', release, '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--fetch-retries=0', '--fetch-timeout=30000'], { stdio: 'inherit' });
  }
  console.log(`Preparing official Kimi ${targetVersion}; lifecycle scripts disabled…`);
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
  const management = await installManager(release);
  const plugin = await readJson(join(pluginRoot, 'kimi.plugin.json'));
  const state = { version: 1, main: patched.main, home, pluginRoot,
    ...management, originalCommand, kimiVersion: targetVersion, pluginVersion: plugin.version,
    previousPlugin: active && updated.previous?.root === active.pluginRoot ? active.previousPlugin : updated.previous,
    activation: active?.activation ?? 'standalone', release };
  await writeJson(join(release, 'install-report.json'), { ...state, changes: patched.changes });
  const candidateFile = join(release, 'candidate.json');
  await writeJson(candidateFile, state);
  run(process.execPath, [join(projectRoot, 'scripts', 'verify-engine.mjs'), candidateFile], { cwd: projectRoot, stdio: 'inherit' });
  const bin = await writeLaunchers(root);
  if (active) await writeJson(join(release, 'active.before.json'), active);
  await writeJson(registryFile, updated.registry);
  await writeJson(activeFile, state);
  run(process.execPath, [patched.main, '--version'], { env: { ...process.env, KIMI_CODE_HOME: home } });
  if (!values['no-activate']) {
    await manageInstallation(root, 'enable');
  }
  console.log(`Installed and smoke-checked: ${patched.main}`);
  console.log(`Launcher: ${join(bin, 'kimi-swarm.cmd')}`);
  console.log(values['no-activate'] ? 'PATH unchanged. Use the launcher directly.' : 'Open a new terminal, then run kimi. If a system PATH entry shadows it, use the displayed launcher.');
}

main().catch(error => { console.error(`kimi-swarm: ${error.message}`); process.exitCode = 1; });
