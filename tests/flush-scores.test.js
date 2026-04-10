'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileMap, writeSessionBuffer, readFileMap, readSuggestions } = require('../hooks/lib/state');
const { flush } = require('../hooks/flush-scores');

function mkLocalProject() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-flush-'));
  const claudeDir = path.join(tmpCwd, '.claude');
  const stateDir = path.join(claudeDir, 'tokimizer');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { tokimizer: true } })
  );
  return { tmpCwd, stateDir };
}

test('flush creates new file entry from session access', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.mkdirSync(path.join(tmpCwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'src', 'index.ts'), 'const x = 1;');

  writeSessionBuffer(stateDir, {
    session_id: 'sess1',
    accesses: [{ path: 'src/index.ts', type: 'read', ts: Math.floor(Date.now() / 1000) }]
  });

  flush(tmpCwd, 'sess1');

  const fm = readFileMap(stateDir);
  assert.ok(fm.files['src/index.ts'], 'file entry should exist');
  assert.strictEqual(fm.files['src/index.ts'].access_count, 1);
  assert.strictEqual(fm.files['src/index.ts'].edit_count, 0);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush increments edit_count for edit type', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.mkdirSync(path.join(tmpCwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'src', 'api.ts'), 'export default {}');

  writeSessionBuffer(stateDir, {
    session_id: 'sess1',
    accesses: [{ path: 'src/api.ts', type: 'edit', ts: Math.floor(Date.now() / 1000) }]
  });

  flush(tmpCwd, 'sess1');

  const fm = readFileMap(stateDir);
  assert.strictEqual(fm.files['src/api.ts'].edit_count, 1);
  assert.strictEqual(fm.files['src/api.ts'].access_count, 0);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush clears session buffer after writing', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  const { readSessionBuffer } = require('../hooks/lib/state');

  writeSessionBuffer(stateDir, { session_id: 'sess1', accesses: [] });
  flush(tmpCwd, 'sess1');

  assert.strictEqual(readSessionBuffer(stateDir), null);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush exits cleanly with empty buffer', () => {
  const { tmpCwd } = mkLocalProject();
  // No buffer written — flush should not throw
  assert.doesNotThrow(() => flush(tmpCwd, 'sess1'));
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush adds ignore candidate for large stale file', () => {
  const { tmpCwd, stateDir } = mkLocalProject();

  writeFileMap(stateDir, {
    version: 1, config: {}, last_updated: new Date().toISOString(),
    files: {
      'dist/bundle.js': {
        score: 0.05, access_count: 0, edit_count: 0,
        last_accessed: new Date(Date.now() - 86400000 * 30).toISOString(),
        size_bytes: 500000, sessions_unseen: 5, co_access: []
      }
    }
  });

  writeSessionBuffer(stateDir, { session_id: 'sess1', accesses: [] });
  flush(tmpCwd, 'sess1');

  const suggestions = readSuggestions(stateDir);
  assert.ok(
    suggestions.some(s => s.path === 'dist/bundle.js'),
    `expected dist/bundle.js in ${JSON.stringify(suggestions)}`
  );

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush updates co_access for files accessed together', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.mkdirSync(path.join(tmpCwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'src', 'a.ts'), '');
  fs.writeFileSync(path.join(tmpCwd, 'src', 'b.ts'), '');

  writeSessionBuffer(stateDir, {
    session_id: 'sess1',
    accesses: [
      { path: 'src/a.ts', type: 'read', ts: 1000 },
      { path: 'src/b.ts', type: 'read', ts: 1001 }
    ]
  });

  flush(tmpCwd, 'sess1');

  const fm = readFileMap(stateDir);
  assert.ok(fm.files['src/a.ts'].co_access.includes('src/b.ts'));
  assert.ok(fm.files['src/b.ts'].co_access.includes('src/a.ts'));

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush with null buffer does not create file-map.json', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  // No buffer written — file-map.json must not be created
  const fileMapPath = path.join(stateDir, 'file-map.json');

  flush(tmpCwd, 'sess1');

  assert.strictEqual(
    fs.existsSync(fileMapPath),
    false,
    'file-map.json should not be created when buffer is null'
  );

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('flush with empty accesses does not modify existing file-map.json', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  const fileMapPath = path.join(stateDir, 'file-map.json');

  // Write a known file-map before flushing
  const originalMap = {
    version: 1,
    config: {},
    last_updated: '2026-01-01T00:00:00.000Z',
    files: {
      'src/existing.ts': {
        score: 0.8, access_count: 3, edit_count: 1,
        last_accessed: '2026-01-01T00:00:00.000Z',
        size_bytes: 512, sessions_unseen: 0, co_access: []
      }
    }
  };
  writeFileMap(stateDir, originalMap);

  // Capture mtime before flush
  const mtimeBefore = fs.statSync(fileMapPath).mtimeMs;

  // Write a buffer with empty accesses
  writeSessionBuffer(stateDir, { session_id: 'sess1', accesses: [] });
  flush(tmpCwd, 'sess1');

  // file-map.json must still exist and be byte-for-byte identical
  const mtimeAfter = fs.statSync(fileMapPath).mtimeMs;
  assert.strictEqual(
    mtimeAfter,
    mtimeBefore,
    'file-map.json mtime should not change when accesses is empty'
  );

  // Content must be unchanged
  const mapAfter = readFileMap(stateDir);
  assert.strictEqual(
    mapAfter.last_updated,
    originalMap.last_updated,
    'last_updated must not be mutated'
  );
  assert.strictEqual(
    mapAfter.files['src/existing.ts'].access_count,
    3,
    'access_count must not be incremented'
  );

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});
