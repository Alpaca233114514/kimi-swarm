import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { swarmEfforts, swarmDisplayEffort, swarmSwitch, swarmDefaultForNewSession } from '../src/runtime.mjs';

await mkdir('.cache/tests', { recursive: true });
process.env.KIMI_SWARM_STATE_DIR = await mkdtemp(resolve('.cache/tests/runtime-'));

function fixture({ enabled = true, max = true } = {}) {
  const calls = [];
  const state = { model: 'kimi', thinkingEffort: 'high', swarmMode: false, permission: 'manual' };
  const session = {
    async getStatus() { return { ...state }; },
    async setModel(model) { calls.push(['model', model]); state.model = model; },
    async setThinking(effort) { assert.notEqual(effort, 'swarm'); calls.push(['thinking', effort]); state.thinkingEffort = effort; },
    async setSwarmMode(value, trigger) { calls.push(['swarm', value, trigger]); state.swarmMode = value; },
  };
  const errors = [];
  const host = {
    session, state: { appState: { ...state, streamingPhase: 'idle',
      availableModels: { kimi: { supportEfforts: max ? ['high', 'max'] : ['high'] } } } },
    harness: {
      async listPlugins() { return [{ id: 'kimi-swarm', enabled, state: 'ok', hasErrors: false }]; },
      async getConfig() { return { thinking: { effort: state.thinkingEffort } }; },
    },
    async ensureSession() { return session; },
    setAppState(patch) { Object.assign(this.state.appState, patch); },
    showError(message) { errors.push(message); }, showStatus() {},
  };
  async function native(h, alias, effort, persist) {
    assert.notEqual(effort, 'swarm'); calls.push(['native', alias, effort, persist]);
    state.model = alias; state.thinkingEffort = effort;
    h.setAppState({ model: alias, thinkingEffort: effort });
    return true;
  }
  const select = (effort, persist = 'session') => swarmSwitch(host, 'kimi', effort, persist, native, (_h, m) => m);
  return { host, state, session, calls, errors, native, select };
}

test('Swarm appears alongside native efforts only with Max support', () => {
  const native = ['high', 'max'];
  assert.deepEqual(swarmEfforts(native, true), ['high', 'max', 'swarm']);
  assert.deepEqual(native, ['high', 'max']);
  assert.deepEqual(swarmEfforts(native, false), native);
  assert.deepEqual(swarmEfforts(['high'], true), ['high']);
});

test('main effort stays Max, native swarm runs, and permissions stay manual', async () => {
  const f = fixture();
  assert.equal(await f.select('swarm'), true);
  assert.equal(f.state.thinkingEffort, 'max');
  assert.equal(f.state.swarmMode, true);
  assert.equal(f.state.permission, 'manual');
  assert.equal(swarmDisplayEffort(f.host.state.appState), 'swarm');
  assert.deepEqual(f.calls, [['thinking', 'max'], ['swarm', true, 'manual']]);
});

for (const effort of ['high', 'max']) test(`switching from Swarm to ${effort} disables delegation`, async () => {
  const f = fixture();
  await f.select('swarm');
  assert.equal(await f.select(effort), true);
  assert.equal(f.state.swarmMode, false);
  assert.equal(swarmDisplayEffort(f.host.state.appState), effort);
});

test('disabled plugin passes ordinary selection to native code', async () => {
  const f = fixture({ enabled: false });
  assert.equal(await f.select('max'), true);
  assert.deepEqual(f.calls, [['native', 'kimi', 'max', 'session']]);
  assert.equal(await f.select('swarm'), false);
  assert.match(f.errors.at(-1), /Enable/);
});

test('unsupported models and busy sessions have no mutations', async () => {
  const f = fixture({ max: false });
  assert.equal(await f.select('swarm'), false);
  assert.deepEqual(f.calls, []);
  f.host.state.appState.streamingPhase = 'running';
  assert.equal(await f.select('max'), false);
  assert.deepEqual(f.calls, []);
});

test('a failed Swarm RPC restores the original effort', async () => {
  const f = fixture();
  f.session.setSwarmMode = async () => { throw new Error('RPC rejected'); };
  assert.equal(await f.select('swarm'), false);
  assert.equal(f.state.thinkingEffort, 'high');
  assert.equal(f.state.swarmMode, false);
  assert.equal(f.host.state.appState.thinkingEffort, 'high');
  assert.match(f.errors[0], /RPC rejected/);
});

test('a silently normalized provider effort never appears as successful Swarm', async () => {
  const f = fixture();
  f.session.setThinking = async () => {};
  assert.equal(await f.select('swarm'), false);
  assert.equal(f.state.swarmMode, false);
  assert.match(f.errors[0], /did not accept/);
});

test('selection is serialized before the first asynchronous operation', async () => {
  const f = fixture();
  let release;
  f.host.harness.listPlugins = () => new Promise(resolve => { release = resolve; });
  const first = f.select('swarm');
  assert.equal(await f.select('high'), false);
  release([{ id: 'kimi-swarm', enabled: true, state: 'ok' }]);
  assert.equal(await first, true);
  assert.match(f.errors[0], /already/);
});

test('an asynchronous session replacement prevents mutations', async () => {
  const f = fixture();
  f.session.getStatus = async () => { f.host.session = {}; return { ...f.state }; };
  assert.equal(await f.select('swarm'), false);
  assert.deepEqual(f.calls, []);
  assert.match(f.errors[0], /Session changed/);
});

test('Enter persists native Max plus the virtual default; Alt+S does not overwrite it', async () => {
  const f = fixture();
  assert.equal(await f.select('swarm', 'model'), true, f.errors.join('\n'));
  const file = join(process.env.KIMI_SWARM_STATE_DIR, 'preferences.json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, enabled: true, model: 'kimi' });
  assert.equal(await f.select('high'), true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, true);
  f.state.thinkingEffort = 'max';
  await swarmDefaultForNewSession(f.host.harness, f.session);
  assert.equal(f.state.swarmMode, true);
  assert.equal(await f.select('max', 'model'), true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, false);
});

test('ordinary native swarm at High is not mislabeled as Swarm effort', () => {
  assert.equal(swarmDisplayEffort({ thinkingEffort: 'high', swarmMode: true }), 'high');
});

test('native Max persistence ceiling is respected', async () => {
  const f = fixture();
  f.host.harness.getConfig = async () => ({ thinking: { enabled: true } });
  assert.equal(await f.select('swarm', 'model'), true);
  const pref = JSON.parse(await readFile(join(process.env.KIMI_SWARM_STATE_DIR, 'preferences.json'), 'utf8'));
  assert.equal(pref.enabled, false);
  assert.equal(f.state.swarmMode, true);
});

test('failed rollback is reported and the actual state is displayed', async () => {
  const f = fixture();
  f.session.setThinking = async value => {
    if (value === 'high') throw new Error('rollback unavailable');
    f.state.thinkingEffort = value;
  };
  f.session.setSwarmMode = async () => { throw new Error('swarm rejected'); };
  assert.equal(await f.select('swarm'), false);
  assert.match(f.errors[0], /Rollback failed: rollback unavailable/);
  assert.equal(f.host.state.appState.thinkingEffort, 'max');
  assert.equal(f.host.state.appState.swarmMode, false);
});
