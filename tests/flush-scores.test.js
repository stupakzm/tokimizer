'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectStateDir, writeFileMap, writeSessionBuffer, readFileMap, readSuggestions } = require('../hooks/lib/state');
const { flush } = require('../hooks/flush-scores');

function mkLocalProject() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-flush-'));
  const stateDir = detectStateDir(tmpCwd);
  const cleanup = () => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  };
  return { tmpCwd, stateDir, cleanup };
}

test('flush creates new file entry from session access', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
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

  cleanup();
});

test('flush increments edit_count for edit type', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
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

  cleanup();
});

test('flush clears session buffer after writing', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
  const { readSessionBuffer } = require('../hooks/lib/state');

  writeSessionBuffer(stateDir, { session_id: 'sess1', accesses: [] });
  flush(tmpCwd, 'sess1');

  assert.strictEqual(readSessionBuffer(stateDir), null);

  cleanup();
});

test('flush exits cleanly with empty buffer', () => {
  const { tmpCwd, cleanup } = mkLocalProject();
  // No buffer written — flush should not throw
  assert.doesNotThrow(() => flush(tmpCwd, 'sess1'));
  cleanup();
});

test('flush adds ignore candidate for large stale file', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

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

  cleanup();
});

test('flush updates co_access for files accessed together', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
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

  cleanup();
});

test('flush with null buffer does not create file-map.json', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
  // No buffer written — file-map.json must not be created
  const fileMapPath = path.join(stateDir, 'file-map.json');

  flush(tmpCwd, 'sess1');

  assert.strictEqual(
    fs.existsSync(fileMapPath),
    false,
    'file-map.json should not be created when buffer is null'
  );

  cleanup();
});

test('flush with empty accesses does not modify existing file-map.json', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();
  const fileMapPath = path.join(stateDir, 'file-map.json');
  const { readSessionBuffer } = require('../hooks/lib/state');

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

  // Capture serialized content before flush for reliable byte-level comparison
  const contentBefore = fs.readFileSync(fileMapPath, 'utf8');

  // Write a buffer with empty accesses
  writeSessionBuffer(stateDir, { session_id: 'sess1', accesses: [] });
  flush(tmpCwd, 'sess1');

  // file-map.json must be byte-for-byte identical (no rewrite occurred)
  const contentAfter = fs.readFileSync(fileMapPath, 'utf8');
  assert.strictEqual(
    contentAfter,
    contentBefore,
    'file-map.json content should not change when accesses is empty'
  );

  // session-buffer.json must be cleared even on the early-return path
  assert.strictEqual(
    readSessionBuffer(stateDir),
    null,
    'session buffer should be cleared after flush with empty accesses'
  );

  cleanup();
});
