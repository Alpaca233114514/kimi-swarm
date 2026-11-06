import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SWARM_DESCRIPTION = 'Persistent Max thinking; native AgentSwarm required';
export const SWARM_COLORS = Object.freeze({ light: '#4941cf', dark: '#a5a0ff' });
const selecting = new WeakSet();

export function swarmColor(palette) {
  const text = /^#([\da-f]{6})$/i.exec(palette?.text ?? '');
  if (!text) return SWARM_COLORS.dark;
  const rgb = [0, 2, 4].map(offset => Number.parseInt(text[1].slice(offset, offset + 2), 16));
  // 宿主只暴露前景色，用其亮度选择明暗配色。 / The host exposes foreground colors, not a theme mode.
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128 ? SWARM_COLORS.light : SWARM_COLORS.dark;
}

export function swarmTintStatusLine(line, state, palette, painter) {
  if (swarmDisplayEffort(state) !== 'swarm' || !line.includes('\x1b[')) return line;
  return line.replace(/(思考[ \t]+|thinking(?:[ \t]+effort)?[ \t]*:?[ \t]+)(swarm)(?=\s|\x1b|$)/gi,
    (_match, prefix, label) => prefix + painter.hex(swarmColor(palette))(label));
}

export function swarmEfforts(efforts, enabled) {
  return enabled && efforts.includes('max') && !efforts.includes('swarm')
    ? [...efforts, 'swarm'] : [...efforts];
}

export function swarmDisplayEffort(state) {
  return state.swarmMode === true && state.thinkingEffort === 'max'
    ? 'swarm' : state.thinkingEffort;
}

export async function swarmEnabled(host) {
  const api = host.harness ?? host;
  const plugins = await api.listPlugins();
  return plugins.some(p => p.id === 'kimi-swarm' && p.enabled && p.state === 'ok' && !p.hasErrors);
}

function preferenceFile() {
  return join(process.env.KIMI_SWARM_STATE_DIR ?? join(
    process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'), 'swarm'), 'preferences.json');
}

async function readPreference() {
  try {
    const value = JSON.parse(await readFile(preferenceFile(), 'utf8'));
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.model !== 'string') {
      throw new Error('Invalid kimi-swarm preferences');
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, enabled: false, model: '' };
    throw error;
  }
}

async function savePreference(enabled, model) {
  const file = preferenceFile();
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify({ version: 1, enabled, model }) + '\n', { flag: 'wx' });
  await rename(temp, file);
}

function requireIdle(host, session) {
  if (host.state.appState.streamingPhase !== 'idle' || host.state.appState.isCompacting ||
      host.state.appState.isReplaying || host.sessionReplacementInFlight) {
    throw new Error('Wait for the current turn to finish before switching Swarm effort.');
  }
  if (session !== undefined && host.session !== session) throw new Error('Session changed during effort selection.');
}

function sync(host, session, status) {
  if (host.session !== session) return;
  host.setAppState({
    model: status.model ?? host.state.appState.model,
    thinkingEffort: status.thinkingEffort,
    swarmMode: status.swarmMode === true,
  });
  host.state.swarmModeEntry = status.swarmMode ? 'manual' : undefined;
}

async function rollback(session, before) {
  const current = await session.getStatus();
  if (before.model !== undefined && current.model !== before.model) await session.setModel(before.model);
  if (current.thinkingEffort !== before.thinkingEffort || current.model !== before.model) {
    await session.setThinking(before.thinkingEffort);
  }
  if (current.swarmMode !== before.swarmMode) await session.setSwarmMode(before.swarmMode === true, 'manual');
}

export async function swarmSwitch(host, alias, effort, persist, nativeSwitch, effectiveModel) {
  if (selecting.has(host)) {
    host.showError('An effort selection is already being applied.');
    return false;
  }
  selecting.add(host);
  let session;
  let before;
  let transitionStarted = false;
  let committed = false;
  try {
    const enabled = await swarmEnabled(host);
    if (effort !== 'swarm' && (!enabled || !host.state.appState.swarmMode)) {
      const ok = await nativeSwitch(host, alias, effort, persist);
      if (ok) await savePreference(false, alias);
      return ok;
    }
    requireIdle(host);
    if (effort === 'swarm') {
      if (!enabled) throw new Error('Enable the kimi-swarm plugin before selecting Swarm.');
      const model = host.state.appState.availableModels[alias];
      if (!model || !effectiveModel(host, model).supportEfforts?.includes('max')) {
        throw new Error('Swarm effort requires a model that supports Max.');
      }
    }
    session = await host.ensureSession();
    if (!session) return false;
    requireIdle(host, session);
    before = await session.getStatus();
    requireIdle(host, session);
    transitionStarted = true;
    // 只向模型发送真实 effort；Swarm 由原生状态承载。 / Keep virtual effort out of provider requests.
    if (before.model !== alias) await session.setModel(alias);
    requireIdle(host, session);
    const realEffort = effort === 'swarm' ? 'max' : effort;
    await session.setThinking(realEffort);
    requireIdle(host, session);
    await session.setSwarmMode(effort === 'swarm', 'manual');
    const after = await session.getStatus();
    requireIdle(host, session);
    if (after.model !== alias || after.thinkingEffort !== realEffort ||
        (after.swarmMode === true) !== (effort === 'swarm')) {
      throw new Error('The host did not accept the requested effort.');
    }
    committed = true;
    sync(host, session, after);
    // 独立记住 Swarm，不受宿主 Max 默认值上限影响。 / Persist Swarm independently of native Max defaults.
    await savePreference(effort === 'swarm', alias);
    if (persist !== 'session') {
      // 复用宿主保存默认值，保留其错误处理。 / Reuse native default persistence and its errors.
      if (!(await nativeSwitch(host, alias, realEffort, 'model-and-effort'))) return false;
    }
    host.showStatus(effort === 'swarm'
      ? 'Thinking set to swarm. New sessions will use Swarm until you select another effort.'
      : `Thinking set to ${effort}. Swarm default cleared.`, 'success');
    return true;
  } catch (error) {
    let detail = error.message;
    if (transitionStarted && !committed && before && session) {
      try { await rollback(session, before); }
      catch (restoreError) { detail += ` Rollback failed: ${restoreError.message}`; }
    } else if (committed) {
      detail += ' The session changed, but its default could not be saved.';
    }
    if (session) {
      try { sync(host, session, await session.getStatus()); }
      catch { detail += ' Could not refresh session state.'; }
    }
    host.showError(detail);
    return false;
  } finally {
    selecting.delete(host);
  }
}

function supportsMax(config, alias, effectiveModel) {
  const model = config.models?.[alias];
  return !!model && effectiveModel(model, config.providers?.[model.provider]?.type ?? model.protocol)
    .supportEfforts?.includes('max') === true;
}

export async function swarmLazyDefaults(host, config, effectiveModel = model => model) {
  if (host.session !== undefined) return;
  const pref = await readPreference();
  if (!pref.enabled || !(await swarmEnabled(host))) return;
  if (supportsMax(config, host.state.appState.model, effectiveModel)) {
    host.setAppState({ thinkingEffort: 'max', swarmMode: true, lazySessionThinking: 'max' });
  }
}

export async function swarmDefaultForNewSession(harness, session, effectiveModel = model => model) {
  const pref = await readPreference();
  if (!pref.enabled || !(await swarmEnabled(harness))) return;
  const status = await session.getStatus();
  const config = await harness.getConfig();
  if (!supportsMax(config, status.model, effectiveModel)) return;
  try {
    await session.setThinking('max');
    if ((await session.getStatus()).thinkingEffort !== 'max') throw new Error('The host did not accept Max.');
    await session.setSwarmMode(true, 'manual');
    if ((await session.getStatus()).swarmMode !== true) throw new Error('The host did not enable native Swarm.');
  } catch (error) {
    try { await rollback(session, status); }
    catch (restoreError) { throw new Error(`Swarm default failed: ${error.message}. Rollback failed: ${restoreError.message}`); }
    throw new Error(`Swarm default failed: ${error.message}`);
  }
}
