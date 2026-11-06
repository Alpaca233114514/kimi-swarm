export const SUPPORTED_KIMI_VERSION = '2.4.1';
export const UPSTREAM_COMMIT = '2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7';
export const PATCH_MARKER = '// kimi-swarm bridge 0.1.0';

export function patchBundle(input, version) {
  if (version !== SUPPORTED_KIMI_VERSION) throw new Error(`Unsupported Kimi version ${version}; supported: ${SUPPORTED_KIMI_VERSION}.`);
  if (input.includes(PATCH_MARKER)) throw new Error('This bundle already contains kimi-swarm.');
  let source = input;
  const changes = [];
  function replace(name, from, to, expected = 1) {
    const count = source.split(from).length - 1;
    if (count !== expected) throw new Error(`Incompatible Kimi bundle: ${name} expected ${expected} anchors, found ${count}. No file was written.`);
    source = source.split(from).join(to);
    changes.push({ name, count });
  }

  replace('effort-switch',
    'async function performModelSwitch(host, alias, effort, persist) {',
    `async function performModelSwitch(host, alias, effort, persist) {
  return swarmSwitch(host, alias, effort, persist, kimiSwarmNativeSwitch, effectiveModelForHost);
}
async function kimiSwarmNativeSwitch(host, alias, effort, persist) {`);
  replace('effort-options',
    'const segments = segmentsFor(effective);',
    'const segments = swarmEfforts(segmentsFor(effective), await swarmEnabled(host));');
  replace('unknown-swarm',
    'if (!segments.includes(arg)) {\n\t\tconst providerType',
    `if (arg === "swarm" && !segments.includes(arg)) {
    host.showError("Swarm requires the enabled kimi-swarm plugin and a Max-capable model.");
    return;
  }
  if (!segments.includes(arg)) {\n\t\tconst providerType`);
  replace('effort-current',
    'function showEffortPicker(host, model, segments) {\n\tconst liveEffort = host.state.appState.thinkingEffort;',
    'function showEffortPicker(host, model, segments) {\n\tconst liveEffort = segments.includes("swarm") ? swarmDisplayEffort(host.state.appState) : host.state.appState.thinkingEffort;');
  replace('effort-description',
    'descriptions: model.provider === "managed:kimi-code" ? effortDescriptions() : void 0,',
    'descriptions: { ...(model.provider === "managed:kimi-code" ? effortDescriptions() : {}), swarm: SWARM_DESCRIPTION },');
  replace('model-plugin-state',
    'async function showModelPicker(host, selectedValue = host.state.appState.model) {',
    'async function showModelPicker(host, selectedValue = host.state.appState.model) {\n\tconst swarmSelectable = await swarmEnabled(host);');
  replace('model-current',
    'selectedValue,\n\t\tcurrentThinkingEffort: host.state.appState.thinkingEffort,',
    'selectedValue,\n\t\tcurrentThinkingEffort: swarmSelectable ? swarmDisplayEffort(host.state.appState) : host.state.appState.thinkingEffort,\n\t\tswarmEffort: swarmSelectable,');
  replace('model-description',
    'effortDescriptions: effortDescriptions(),',
    'effortDescriptions: { ...effortDescriptions(), swarm: SWARM_DESCRIPTION },');
  replace('model-tabs',
    'thinkingControl: opts.thinkingControl,',
    'thinkingControl: opts.thinkingControl,\n\t\tswarmEffort: opts.swarmEffort,');
  replace('model-render',
    'const segments = segmentsFor(choice.model);',
    'const segments = swarmEfforts(segmentsFor(choice.model), this.opts.swarmEffort === true);', 2);
  replace('model-navigation',
    'const segments = segmentsFor(selected.model);',
    'const segments = swarmEfforts(segmentsFor(selected.model), this.opts.swarmEffort === true);');
  replace('native-confirmation',
    'function matchedEffortSwitchRule(host, thinking) {',
    'function matchedEffortSwitchRule(host, thinking) {\n\tif (thinking === "swarm") thinking = "max";');
  replace('native-footer',
    'const effort = state.thinkingEffort;',
    'const effort = swarmDisplayEffort(state);');
  replace('effort-color',
    'const label = effortLabel(effort);\n\t\t\t\treturn index === this.activeIndex',
    `const label = effortLabel(effort);
        if (effort === "swarm") {
          const paint = chalk.hex(swarmColor(currentTheme.palette));
          return index === this.activeIndex ? paint.bold(\`[ \${label} ]\`) : paint(\`  \${label}  \`);
        }
        return index === this.activeIndex`);
  replace('model-color',
    'const segment = (label, active) => active ? currentTheme.boldFg("primary", `[ ${label} ]`) : currentTheme.fg("text", `  ${label}  `);',
    `const segment = (label, active) => {
        if (label === "Swarm") {
          const paint = chalk.hex(swarmColor(currentTheme.palette));
          return active ? paint.bold(\`[ \${label} ]\`) : paint(\`  \${label}  \`);
        }
        return active ? currentTheme.boldFg("primary", \`[ \${label} ]\`) : currentTheme.fg("text", \`  \${label}  \`);
      };`);
  replace('footer-color',
    'let renderedModelLabel = chalk.hex(colors.text)(modelLabel);',
    `let renderedModelLabel = chalk.hex(colors.text)(modelLabel);
        if (effort === "swarm") renderedModelLabel = chalk.hex(colors.text)(\`\${model} thinking: \`) + chalk.hex(swarmColor(colors))("swarm");`);
  replace('swarm-badge-color',
    'chalk.hex(colors.accent).bold("swarm")',
    'chalk.hex(swarmColor(colors)).bold("swarm")');
  replace('monitor-color',
    'line1 = chalk.hex(colors.text)(customLine);',
    'line1 = chalk.hex(colors.text)(swarmTintStatusLine(customLine, state, colors, chalk));');
  replace('monitor-payload',
    'sessionId: state.sessionId,\n\t\t\t\tversion: state.version',
    `sessionId: state.sessionId,
        thinkingEffort: swarmDisplayEffort(state),
        reasoningEffort: state.thinkingEffort,
        swarmMode: state.swarmMode === true,
        version: state.version`);
  replace('new-session-default',
    'this.trackSessionEvent(session.id, "session_new");\n\t\t\treturn session;',
    'this.trackSessionEvent(session.id, "session_new");\n\t\t\tawait swarmDefaultForNewSession(this, session);\n\t\t\treturn session;');

  const bridgeImport = `${PATCH_MARKER}\nimport { swarmSwitch, swarmEnabled, swarmEfforts, swarmDisplayEffort, swarmDefaultForNewSession, swarmColor, swarmTintStatusLine, SWARM_DESCRIPTION } from './kimi-swarm-runtime.mjs';\n`;
  const start = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0;
  source = source.slice(0, start) + bridgeImport + source.slice(start);
  return { source, changes };
}
