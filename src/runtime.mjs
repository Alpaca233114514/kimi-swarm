import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SWARM_DESCRIPTION = 'Max thinking with proactive native subagents';
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
    requireIdle(host);
    const enabled = await swarmEnabled(host);
    requireIdle(host);
    if (effort !== 'swarm' && (!enabled || !host.state.appState.swarmMode)) {
      const ok = await nativeSwitch(host, alias, effort, persist);
      if (ok && enabled && persist !== 'session') await savePreference(false, alias);
      return ok;
    }
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
    let savedSwarm = false;
    if (persist !== 'session') {
      // 复用宿主保存默认值，保留其错误处理。 / Reuse native default persistence and its errors.
      if (!(await nativeSwitch(host, alias, realEffort, 'model-and-effort'))) return false;
      const config = await host.harness.getConfig({ reload: true });
      savedSwarm = effort === 'swarm' && config.thinking?.effort === 'max';
      await savePreference(savedSwarm, alias);
    }
    const sessionOnly = persist === 'session' || (effort === 'swarm' && !savedSwarm);
    host.showStatus(`Thinking set to ${effort}${sessionOnly ? ' for this session only' : ''}.`, 'success');
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

export async function swarmDefaultForNewSession(harness, session) {
  const pref = await readPreference();
  if (!pref.enabled || !(await swarmEnabled(harness))) return;
  const status = await session.getStatus();
  if (status.model === pref.model && status.thinkingEffort === 'max') {
    await session.setSwarmMode(true, 'manual');
  }
}
