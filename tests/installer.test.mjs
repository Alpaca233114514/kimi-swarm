import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePluginRegistry, validateRuntimeVersion } from '../src/installer.mjs';
import { patchBundle } from '../src/patch-bundle.mjs';

test('registration preserves unrelated plugins and metadata and returns the old entry', () => {
  const previous = { id: 'kimi-swarm', enabled: false, root: 'old' };
  const other = { id: 'kimi-cu-win', enabled: true };
  const registry = { version: 1, custom: 'retain', plugins: [other, previous] };
  const entry = { id: 'kimi-swarm', root: 'new', enabled: true };
  const result = updatePluginRegistry(registry, entry);
  assert.deepEqual(result.previous, previous);
  assert.deepEqual(result.registry, { version: 1, custom: 'retain', plugins: [other, entry] });
  assert.equal(registry.plugins[1], previous);
});

test('unknown registry formats and duplicate records are rejected', () => {
  assert.throws(() => updatePluginRegistry({ version: 2, plugins: [] }, {}), /Unrecognized/);
  assert.throws(() => updatePluginRegistry({ version: 1, plugins: [{ id: 'kimi-swarm' }, { id: 'kimi-swarm' }] }, {}), /Duplicate/);
});

test('old versions and changed bundles are rejected before writing', () => {
  assert.throws(() => patchBundle('anything', '2.3.0'), /Unsupported/);
  assert.throws(() => patchBundle('anything', '2.4.1'), /expected 1 anchors/);
  assert.throws(() => patchBundle('anything', '2.5.2'), /expected 1 anchors/);
});

test('new stable versions are candidates but prereleases and old versions are rejected', () => {
  for (const version of ['2.4.1', '2.5.2', '3.0.0']) assert.doesNotThrow(() => validateRuntimeVersion(version));
  for (const version of ['2.4.0', '2.5.2-rc.1', 'unknown']) assert.throws(() => validateRuntimeVersion(version), /Unsupported/);
});
