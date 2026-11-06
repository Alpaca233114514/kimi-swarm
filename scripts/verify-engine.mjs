import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const active = JSON.parse(await readFile(resolve(process.argv[2] ?? '.cache/installed/active.json'), 'utf8'));
await mkdir('.cache/verification', { recursive: true });
const home = await mkdtemp(resolve('.cache/verification/engine-'));
const workDir = join(home, 'workspace');
await mkdir(workDir);
process.env.KIMI_CODE_HOME = home;
process.env.KIMI_SWARM_STATE_DIR = join(home, 'swarm');
const source = await readFile(active.main, 'utf8');
const entry = '\nmain();\nasync function logStartupFailure';
assert.equal(source.split(entry).length - 1, 1);
const moduleFile = join(dirname(active.main), 'kimi-swarm-engine-probe.mjs');
await copyFile(resolve('src/runtime.mjs'), join(dirname(active.main), 'kimi-swarm-probe-runtime.mjs'));
await writeFile(moduleFile, source.replace(entry, '\nasync function logStartupFailure')
  .replace("from './kimi-swarm-runtime.mjs'", "from './kimi-swarm-probe-runtime.mjs'") +
  '\nexport { createKimiHarness, createKimiCodeHostIdentity, performModelSwitch };\n');
const { createKimiHarness, createKimiCodeHostIdentity, performModelSwitch } = await import(pathToFileURL(moduleFile));
const harness = createKimiHarness({ homeDir: home, identity: createKimiCodeHostIdentity('2.4.1'), uiMode: 'tui' });
let session;
try {
  await harness.ensureConfigFile();
  await harness.setConfig({ telemetry: false, defaultModel: 'local-test',
    providers: { 'local-test': { type: 'openai', baseUrl: 'http://127.0.0.1:1/v1' } },
    models: { 'local-test': { provider: 'local-test', model: 'fixture', maxContextSize: 32768,
      capabilities: ['thinking'], supportEfforts: ['high', 'max'], defaultEffort: 'high' } },
  });
  await harness.installPlugin(active.pluginRoot);
  const plugins = await harness.listPlugins();
  assert.ok(plugins.some(p => p.id === 'kimi-swarm' && p.enabled && !p.hasErrors));
  const pluginInfo = await harness.getPluginInfo('kimi-swarm');
  assert.match(pluginInfo.manifest.systemPrompt, /These instructions apply ONLY/);
  session = await harness.createSession({ workDir, model: 'local-test', thinking: 'high', permission: 'manual' });
  const config = await harness.getConfig();
  const errors = [];
  const statuses = [];
  const host = {
    harness, session,
    state: { appState: { model: 'local-test', thinkingEffort: 'high', swarmMode: false, streamingPhase: 'idle',
      availableModels: config.models, availableProviders: config.providers } },
    async ensureSession() { return session; }, async waitForSessionAssembly() {},
    setAppState(patch) { Object.assign(this.state.appState, patch); },
    showError(message) { errors.push(message); }, showStatus(message) { statuses.push(message); }, track() {},
  };
  assert.equal(await performModelSwitch(host, 'local-test', 'swarm', 'model'), true, errors.join('\n'));
  const swarm = await session.getStatus();
  assert.equal(swarm.swarmMode, true);
  assert.equal(swarm.thinkingEffort, 'max');
  assert.equal(swarm.permission, 'manual');
  const fresh = await harness.createSession({ workDir, model: 'local-test', permission: 'manual' });
  const freshStatus = await fresh.getStatus();
  assert.equal(freshStatus.swarmMode, false);
  assert.equal(freshStatus.thinkingEffort, 'high');
  await fresh.close();
  assert.equal(await performModelSwitch(host, 'local-test', 'high', 'model'), true, errors.join('\n'));
  const high = await session.getStatus();
  assert.equal(high.swarmMode, false);
  assert.equal(high.thinkingEffort, 'high');
  assert.equal(high.permission, 'manual');
  const sessionId = session.id;
  await session.close();
  session = await harness.resumeSession({ id: sessionId });
  const resumed = await session.getStatus();
  assert.equal(resumed.swarmMode, false);
  assert.equal(resumed.thinkingEffort, 'high');
  const report = { version: '2.4.1', nativePluginLoaded: true,
    swarm: { effort: swarm.thinkingEffort, enabled: swarm.swarmMode, permission: swarm.permission },
    freshSessionDefault: freshStatus.swarmMode, high: { effort: high.thinkingEffort, enabled: high.swarmMode },
    resumed: { effort: resumed.thinkingEffort, enabled: resumed.swarmMode }, statuses,
    limitation: 'Real native SDK/engine state transitions; no model request or subagent execution.' };
  await writeFile('.cache/verification/engine.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await session?.close();
  await harness.close();
}
