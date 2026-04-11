'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectStateDir, readFileMap, writeFileMap,
  readSessionBuffer, writeSessionBuffer, clearSessionBuffer,
  readSuggestions, appendSuggestions, clearSuggestions
} = require('../hooks/lib/state');

const GLOBAL_BASE = path.join(os.homedir(), '.claude', 'tokimizer');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-test-'));
}

// ---------------------------------------------------------------------------
// detectStateDir — UUID-based project identity
// ---------------------------------------------------------------------------

test('detectStateDir returns a path inside global tokimizer base', () => {
  const tmpCwd = mkTmp();
  const stateDir = detectStateDir(tmpCwd);
  assert.ok(
    stateDir.startsWith(GLOBAL_BASE),
    `expected path under ${GLOBAL_BASE}, got ${stateDir}`
  );
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir creates a project-id file on first call', () => {
  const tmpCwd = mkTmp();
  const stateDir = detectStateDir(tmpCwd);
  const idFile = path.join(tmpCwd, '.claude', 'tokimizer', 'project-id');
  assert.ok(fs.existsSync(idFile), 'project-id file should be created');
  const uuid = fs.readFileSync(idFile, 'utf8').trim();
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'project-id should be a UUID');
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir returns same state dir on repeated calls', () => {
  const tmpCwd = mkTmp();
  const first = detectStateDir(tmpCwd);
  const second = detectStateDir(tmpCwd);
  assert.strictEqual(first, second, 'should return the same state dir on repeated calls');
  fs.rmSync(first, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir state dir name matches the UUID in project-id file', () => {
  const tmpCwd = mkTmp();
  const stateDir = detectStateDir(tmpCwd);
  const uuid = fs.readFileSync(path.join(tmpCwd, '.claude', 'tokimizer', 'project-id'), 'utf8').trim();
  assert.ok(stateDir.endsWith(uuid), `state dir should end with UUID ${uuid}, got ${stateDir}`);
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir uses existing project-id without overwriting it', () => {
  const tmpCwd = mkTmp();
  const idDir = path.join(tmpCwd, '.claude', 'tokimizer');
  fs.mkdirSync(idDir, { recursive: true });
  const existingUuid = crypto.randomUUID();
  fs.writeFileSync(path.join(idDir, 'project-id'), existingUuid, 'utf8');

  const stateDir = detectStateDir(tmpCwd);
  assert.ok(stateDir.endsWith(existingUuid), `should use existing UUID, got ${stateDir}`);
  const idOnDisk = fs.readFileSync(path.join(idDir, 'project-id'), 'utf8').trim();
  assert.strictEqual(idOnDisk, existingUuid, 'project-id file should not be overwritten');
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir migrates legacy hash-based file-map on first call', () => {
  const tmpCwd = mkTmp();
  // Seed a legacy hash-keyed state dir with a file-map
  const legacyHash = crypto.createHash('sha256').update(tmpCwd).digest('hex').slice(0, 8);
  const legacyDir = path.join(GLOBAL_BASE, legacyHash);
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyData = { version: 1, files: { 'legacy.js': { score: 2.5 } } };
  fs.writeFileSync(path.join(legacyDir, 'file-map.json'), JSON.stringify(legacyData));

  const stateDir = detectStateDir(tmpCwd);
  const migratedPath = path.join(stateDir, 'file-map.json');
  assert.ok(fs.existsSync(migratedPath), 'file-map.json should be migrated to UUID dir');
  const migrated = JSON.parse(fs.readFileSync(migratedPath, 'utf8'));
  assert.deepStrictEqual(migrated, legacyData, 'migrated data should match legacy data');

  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(legacyDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir does not overwrite existing file-map when migrating', () => {
  const tmpCwd = mkTmp();
  // Seed a legacy hash dir
  const legacyHash = crypto.createHash('sha256').update(tmpCwd).digest('hex').slice(0, 8);
  const legacyDir = path.join(GLOBAL_BASE, legacyHash);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'file-map.json'), JSON.stringify({ version: 1, files: {} }));

  // First call: migrates
  const stateDir = detectStateDir(tmpCwd);
  // Write a newer file-map to the UUID dir
  const newerData = { version: 1, files: { 'newer.js': { score: 9.9 } } };
  fs.writeFileSync(path.join(stateDir, 'file-map.json'), JSON.stringify(newerData));

  // Second call: project-id exists, no migration attempted → newer map untouched
  const stateDir2 = detectStateDir(tmpCwd);
  assert.strictEqual(stateDir2, stateDir);
  const onDisk = JSON.parse(fs.readFileSync(path.join(stateDir, 'file-map.json'), 'utf8'));
  assert.deepStrictEqual(onDisk, newerData, 'existing file-map should not be overwritten on second call');

  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(legacyDir, { recursive: true, force: true });
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

