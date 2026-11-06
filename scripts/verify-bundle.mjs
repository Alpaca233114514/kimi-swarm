import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { patchBundle, SUPPORTED_KIMI_VERSION } from '../src/patch-bundle.mjs';
import { swarmEfforts, swarmDisplayEffort, swarmColor, swarmTintStatusLine, SWARM_DESCRIPTION } from '../src/runtime.mjs';

const packageRoot = resolve(process.argv[2] ?? '.cache/package');
const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const original = await readFile(join(packageRoot, 'dist/main.mjs'), 'utf8');
const { source, changes } = patchBundle(original, pkg.version);
assert.throws(() => patchBundle(source, pkg.version), /already contains/);

function nativeFunction(name) {
  const from = source.indexOf(`function ${name}(`);
  assert.ok(from >= 0, name);
  const start = source.slice(from - 6, from) === 'async ' ? from - 6 : from;
  return source.slice(start, source.indexOf('\n}', from) + 2);
}

function nativeClass(name) {
  const start = source.indexOf(`${name} = class extends Container {`);
  assert.ok(start >= 0, name);
  return `var ${source.slice(start, source.indexOf('\n\t};', start) + 4)}`;
}

const painter = { hex: hex => {
  const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const paint = text => `\x1b[38;2;${rgb.join(';')}m${text}\x1b[39m`;
  paint.bold = paint;
  return paint;
} };
const context = vm.createContext({
  swarmEfforts, swarmDisplayEffort, swarmColor, SWARM_DESCRIPTION, chalk: painter,
  swarmEnabled: async host => host.enabled,
  effectiveModelAlias: model => model,
  effectiveModelForHost: (_host, model) => model,
  Container: class {},
  SearchableList: class {
    constructor(opts) { this.opts = opts; }
    selected() { return this.opts.items[this.opts.initialIndex]; }
    handleKey() { return false; }
    clearQuery() { return false; }
  },
  Key: { escape: 'esc', left: 'left', right: 'right', enter: 'enter', alt: key => `alt-${key}` },
  matchesKey: (input, key) => input === key,
  currentTheme: { palette: { text: '#E0E0E0' }, fg: (_color, text) => text, boldFg: (_color, text) => text },
  truncateToWidth: (text, width) => text.slice(0, width),
  wrapTextWithAnsi: text => [text],
  hasConversationHistory: () => false,
  ensureEffortSwitchConfig: async () => {},
  effortDescriptions: () => undefined,
  confirmThenPerformEffortSwitch: async (host, effort, persist) => { host.selected = { effort, persist }; },
});
for (const name of ['modelDisplayName$1', 'providerDisplayName', 'createModelChoices',
  'thinkingAvailability', 'effortsOf', 'segmentsFor', 'effortLabel', 'defaultThinkingEffortFor', 'commitEffort',
  'handleEffortCommand', 'showEffortPicker']) vm.runInContext(nativeFunction(name), context);
for (const name of ['ModelSelectorComponent', 'EffortSelectorComponent']) vm.runInContext(nativeClass(name), context);

const model = { provider: 'local', model: 'kimi-test', supportEfforts: ['high', 'max'], capabilities: ['always_thinking'] };
const errors = [];
const host = { enabled: true, state: { appState: { model: 'kimi', thinkingEffort: 'max', swarmMode: false,
  availableModels: { kimi: model }, availableProviders: {} } },
  mountEditorReplacement(panel) { this.panel = panel; }, restoreEditor() {},
  showError(message) { errors.push(message); }, showStatus() {},
};
await context.handleEffortCommand(host, '');
assert.match(host.panel.render(100).join('\n'), /Swarm/);
host.panel.handleInput('right');
host.panel.handleInput('enter');
assert.equal(host.selected.effort, 'swarm');
host.panel.handleInput('left');
host.panel.handleInput('alt-s');
assert.equal(host.selected.effort, 'max');
assert.equal(host.selected.persist, 'session');

let selected;
const picker = new context.ModelSelectorComponent({ models: { kimi: model }, currentValue: 'kimi',
  currentThinkingEffort: 'max', swarmEffort: true, onSelect: value => { selected = value; }, onCancel() {} });
picker.handleInput('right');
assert.match(picker.renderThinkingControl(picker.selectedChoice()), /\[ Swarm \]/);
picker.handleInput('enter');
assert.equal(selected.thinking, 'swarm');
picker.handleInput('left');
picker.handleInput('enter');
assert.equal(selected.thinking, 'max');

host.enabled = false;
host.state.appState.swarmMode = true;
await context.handleEffortCommand(host, 'swarm');
assert.match(errors.at(-1), /enabled kimi-swarm plugin/);
await context.handleEffortCommand(host, '');
assert.doesNotMatch(host.panel.render(100).join('\n'), /Swarm/);
assert.match(host.panel.render(100).join('\n'), /\[ Max \]/);

const colorChecks = [];
host.enabled = true;
for (const [text, expected] of [['#1A1A1A', '#4941cf'], ['#E0E0E0', '#a5a0ff']]) {
  context.currentTheme.palette = { text };
  await context.handleEffortCommand(host, '');
  const label = painter.hex(expected)('[ Swarm ]');
  assert.ok(host.panel.render(120).join('\n').includes(label));
  picker.handleInput('right');
  assert.ok(picker.renderThinkingControl(picker.selectedChoice()).includes(label));
  picker.handleInput('left');
  colorChecks.push(expected);
}

const start = source.indexOf('\t\tstatusLinePayload() {');
const end = source.indexOf('\n\t\tsyncGoalClock(', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(`class FooterProbe { ${source.slice(start, end)} }; globalThis.FooterProbe = FooterProbe;`, context);
context.modelDisplayName = state => state.model;
context.sessionWorkDir = state => state.workDir;
const footer = new context.FooterProbe();
footer.gitCache = { getStatus: () => null };
footer.state = { ...host.state.appState, swarmMode: true, sessionId: 'test', workDir: '/test',
  version: SUPPORTED_KIMI_VERSION, permissionMode: 'manual', contextTokens: 100, maxContextTokens: 1000 };
const payload = footer.statusLinePayload();
assert.equal(payload.thinkingEffort, 'swarm');
assert.equal(payload.reasoningEffort, 'max');
assert.equal(payload.permissionMode, 'manual');

const monitor = process.env.KIMI_MONITOR_PY;
const monitorModule = process.env.KIMI_MONITOR_MODULE;
let monitorResult = 'not requested';
if (monitor || monitorModule) {
  let output;
  if (monitorModule) {
    const { render } = await import(pathToFileURL(resolve(monitorModule)));
    output = render(payload, {}, 120, true);
  } else {
    const result = spawnSync(process.env.PYTHON ?? 'python', ['-I', '-S', monitor, '--no-wire', '--no-quota', '--color', 'always', '--width', '120'], {
      input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    output = result.stdout;
  }
  assert.match(output, /思考 swarm/);
  const colored = swarmTintStatusLine(output, footer.state, { text: '#E0E0E0' }, painter);
  assert.ok(colored.includes('思考 ' + painter.hex('#a5a0ff')('swarm')));
  const strip = text => text.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(strip(colored), strip(output));
  const plain = swarmTintStatusLine(strip(output), footer.state, { text: '#E0E0E0' }, painter);
  assert.equal(plain, strip(output));
  monitorResult = `actual ${monitorModule ? 'Node' : 'Python'} monitor rendered 思考 swarm; CLI tint verified, plain output preserved`;
}
await mkdir('.cache/verification', { recursive: true });
const report = { version: pkg.version, anchors: changes, nativeEffortPicker: true, nativeModelPicker: true, colors: colorChecks,
  nativeStatusPayload: payload, monitor: monitorResult, limitation: 'Controller and renderer verification; no live model task.' };
await writeFile('.cache/verification/bundle.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
