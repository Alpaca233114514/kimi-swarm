import { copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readJson, writeJson, updatePluginRegistry } from './state.mjs';
import { activatePath, deactivatePath, nativePathAdapter, hasManagedPath, firstKimi } from './windows-path.mjs';

export async function manageInstallation(root, action, adapter) {
  const activeFile = join(root, 'active.json');
  const active = await readJson(activeFile, null);
  if (!active) throw new Error('No managed kimi-swarm installation.');
  const registryFile = join(active.home, 'plugins', 'installed.json');
  const registry = await readJson(registryFile, { version: 1, plugins: [] });
  const entry = registry.plugins?.find(plugin => plugin.id === 'kimi-swarm');
  const bin = join(root, 'bin');
  const pathAdapter = adapter ?? (active.managerPath && process.platform === 'win32'
    ? nativePathAdapter(join(dirname(active.managerPath), 'windows-path.exe')) : null);
  if (action === 'status') {
    const paths = pathAdapter?.read();
    return { activation: active.activation, pluginEnabled: entry?.enabled === true,
      pluginRootMatches: entry?.root === active.pluginRoot,
      inUserPath: paths ? hasManagedPath(paths.userPath, bin) : null,
      resolvedKimi: paths ? firstKimi([paths.machinePath, paths.userPath].filter(Boolean).join(';'), pathAdapter.exists) : null,
      originalCommand: active.originalCommand ?? null, main: active.main };
  }
  if (!['enable', 'disable', 'uninstall'].includes(action)) throw new Error('Use status, enable, disable or uninstall.');
  if (action === 'enable') {
    if (!pathAdapter) throw new Error('Automatic activation requires Windows and the installed PATH helper.');
    await access(active.main);
    await access(join(active.pluginRoot, 'kimi.plugin.json'));
    await access(active.originalCommand);
    if (entry?.root !== active.pluginRoot && JSON.stringify(entry) !== JSON.stringify(active.previousPlugin)) {
      throw new Error('The kimi-swarm registration has changed; reinstall to select this copy.');
    }
    await activatePath(root, bin, pathAdapter);
    await copyFile(registryFile, `${registryFile}.before-enable-${Date.now()}`);
    const managed = { id: 'kimi-swarm', root: active.pluginRoot, source: 'local-path', enabled: true,
      installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(registryFile, updatePluginRegistry(registry, entry?.root === active.pluginRoot ? { ...entry, enabled: true } : managed).registry);
    await writeJson(activeFile, { ...active, activation: 'user-path' });
    return { activation: 'user-path', message: 'Enabled. Restart your terminal application once; then use kimi.' };
  }
  if (entry?.root === active.pluginRoot) {
    await copyFile(registryFile, `${registryFile}.before-disable-${Date.now()}`);
    const previous = action === 'uninstall' ? active.previousPlugin ?? { ...entry, enabled: false } : { ...entry, enabled: false };
    await writeJson(registryFile, updatePluginRegistry(registry, previous).registry);
  }
  // 先停用转发，旧终端缓存的入口也会立即运行原版。 / Stale terminal PATH entries must launch the original CLI.
  await writeJson(activeFile, { ...active, activation: 'inactive' });
  if (pathAdapter) await deactivatePath(root, bin, pathAdapter);
  return { activation: 'inactive', message: 'Disabled. Original CLI restored; all sessions, preferences and installation backups are preserved.' };
}
