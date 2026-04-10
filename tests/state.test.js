'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectStateDir, readFileMap, writeFileMap,
  readSessionBuffer, writeSessionBuffer, clearSessionBuffer,
  readSuggestions, appendSuggestions, clearSuggestions
} = require('../hooks/lib/state');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-test-'));
}

function makeLocalProject(tmpCwd) {
  const claudeDir = path.join(tmpCwd, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { tokimizer: true } })
  );
}

test('detectStateDir uses global path for unknown project', () => {
  const tmpCwd = mkTmp();
  const stateDir = detectStateDir(tmpCwd);
  assert.ok(
    stateDir.includes(path.join('.claude', 'tokimizer')),
    `expected global tokimizer path, got ${stateDir}`
  );
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir uses local path when local settings enables tokimizer', () => {
  const tmpCwd = mkTmp();
  makeLocalProject(tmpCwd);
  const stateDir = detectStateDir(tmpCwd);
  assert.ok(stateDir.startsWith(tmpCwd), `expected local path under ${tmpCwd}, got ${stateDir}`);
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('readFileMap returns null when file does not exist', () => {
  const tmpDir = mkTmp();
  assert.strictEqual(readFileMap(tmpDir), null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('writeFileMap and readFileMap round-trip', () => {
  const tmpDir = mkTmp();
  const data = { version: 1, files: { 'src/index.js': { score: 1.5 } } };
  writeFileMap(tmpDir, data);
  assert.deepStrictEqual(readFileMap(tmpDir), data);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readSessionBuffer returns null when file does not exist', () => {
  const tmpDir = mkTmp();
  assert.strictEqual(readSessionBuffer(tmpDir), null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('writeSessionBuffer and readSessionBuffer round-trip', () => {
  const tmpDir = mkTmp();
  const buf = { session_id: 'abc', accesses: [{ path: 'src/a.ts', type: 'read', ts: 1000 }] };
  writeSessionBuffer(tmpDir, buf);
  assert.deepStrictEqual(readSessionBuffer(tmpDir), buf);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('clearSessionBuffer removes file', () => {
  const tmpDir = mkTmp();
  writeSessionBuffer(tmpDir, { session_id: 'x', accesses: [] });
  clearSessionBuffer(tmpDir);
  assert.strictEqual(readSessionBuffer(tmpDir), null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('appendSuggestions deduplicates entries by path', () => {
  const tmpDir = mkTmp();
  appendSuggestions(tmpDir, ['dist/', 'node_modules/']);
  appendSuggestions(tmpDir, ['dist/', '.next/']);
  const result = readSuggestions(tmpDir);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result.map(r => r.path), ['dist/', 'node_modules/', '.next/']);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('clearSuggestions removes file', () => {
  const tmpDir = mkTmp();
  appendSuggestions(tmpDir, ['dist/']);
  clearSuggestions(tmpDir);
  assert.deepStrictEqual(readSuggestions(tmpDir), []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readSuggestions returns objects with path and addedAt fields', () => {
  const tmpDir = mkTmp();
  const before = new Date().toISOString();
  appendSuggestions(tmpDir, ['dist/bundle.js', 'node_modules/.cache/file.js']);
  const after = new Date().toISOString();
  const result = readSuggestions(tmpDir);

  assert.strictEqual(result.length, 2);

  for (const entry of result) {
    assert.ok(typeof entry === 'object' && entry !== null, 'entry must be an object');
    assert.ok(typeof entry.path === 'string', 'entry.path must be a string');
    assert.ok(typeof entry.addedAt === 'string', 'entry.addedAt must be a string');
    const ts = new Date(entry.addedAt).getTime();
    assert.ok(!Number.isNaN(ts), `entry.addedAt must be a valid date, got ${entry.addedAt}`);
    assert.ok(entry.addedAt >= before, `addedAt ${entry.addedAt} should be >= ${before}`);
    assert.ok(entry.addedAt <= after, `addedAt ${entry.addedAt} should be <= ${after}`);
  }

  assert.strictEqual(result[0].path, 'dist/bundle.js');
  assert.strictEqual(result[1].path, 'node_modules/.cache/file.js');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readSuggestions handles old-format lines (no pipe) as addedAt: null', () => {
  const tmpDir = mkTmp();
  fs.writeFileSync(
    path.join(tmpDir, 'suggestions.txt'),
    'dist/bundle.js\nnode_modules/.cache/file.js\n'
  );
  const result = readSuggestions(tmpDir);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].path, 'dist/bundle.js');
  assert.strictEqual(result[0].addedAt, null);
  assert.strictEqual(result[1].path, 'node_modules/.cache/file.js');
  assert.strictEqual(result[1].addedAt, null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readSuggestions handles mixed old- and new-format lines', () => {
  const tmpDir = mkTmp();
  fs.writeFileSync(
    path.join(tmpDir, 'suggestions.txt'),
    'dist/bundle.js\nnode_modules/.cache/file.js|2026-03-28T14:00:00Z\n'
  );
  const result = readSuggestions(tmpDir);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].path, 'dist/bundle.js');
  assert.strictEqual(result[0].addedAt, null);
  assert.strictEqual(result[1].path, 'node_modules/.cache/file.js');
  assert.strictEqual(result[1].addedAt, '2026-03-28T14:00:00Z');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('appendSuggestions deduplicates by path even when existing entry has a timestamp', () => {
  const tmpDir = mkTmp();
  appendSuggestions(tmpDir, ['dist/bundle.js']);
  appendSuggestions(tmpDir, ['dist/bundle.js', '.next/static/chunks/app.js']);
  const result = readSuggestions(tmpDir);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].path, 'dist/bundle.js');
  assert.strictEqual(result[1].path, '.next/static/chunks/app.js');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('detectStateDir falls back to global path when settings.json is malformed JSON', () => {
  const tmpCwd = mkTmp();
  const claudeDir = path.join(tmpCwd, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ "enabledPlugins": { INVALID JSON }');

  const stateDir = detectStateDir(tmpCwd);

  // Must NOT be under tmpCwd (i.e. must not be the local path)
  assert.ok(
    !stateDir.startsWith(tmpCwd),
    `expected global fallback path, got local path ${stateDir}`
  );
  // Must be under the global tokimizer base
  assert.ok(
    stateDir.includes(path.join('.claude', 'tokimizer')),
    `expected global tokimizer path, got ${stateDir}`
  );

  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});
