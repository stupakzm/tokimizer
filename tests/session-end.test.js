'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectStateDir, writeFileMap, writeSessionBuffer, readSessionBuffer, readFileMap } = require('../hooks/lib/state');

function mkLocalProject() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-hook-'));
  const stateDir = detectStateDir(tmpCwd);
  const cleanup = () => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  };
  return { tmpCwd, stateDir, cleanup };
}

function runHook(hookFile, inputJson) {
  const result = spawnSync('node', [hookFile], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    timeout: 5000
  });
  return result;
}

const HOOK = path.resolve(__dirname, '../hooks/session-end.js');

test('session-end: non-empty buffer — file-map written and buffer cleared', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  // Create a real file on disk so flush can stat it
  fs.mkdirSync(path.join(tmpCwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'src', 'main.ts'), 'export const x = 1;');

  writeSessionBuffer(stateDir, {
    session_id: 'sess-c1',
    accesses: [
      { path: 'src/main.ts', type: 'read', ts: Math.floor(Date.now() / 1000) }
    ]
  });

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-c1' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);

  // file-map.json must have been written by flush
  const fileMapPath = path.join(stateDir, 'file-map.json');
  assert.ok(fs.existsSync(fileMapPath), 'file-map.json should exist after flush');
  const fm = readFileMap(stateDir);
  assert.ok(fm.files['src/main.ts'], 'src/main.ts should be tracked in file-map');

  // session-buffer.json must be cleared
  const bufferPath = path.join(stateDir, 'session-buffer.json');
  assert.ok(!fs.existsSync(bufferPath), 'session-buffer.json should be cleared after flush');

  cleanup();
});

test('session-end: empty buffer (accesses: []) — exits 0 and file-map not touched', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  // Write a known file-map before running the hook
  const originalMap = {
    version: 1,
    config: {},
    last_updated: '2026-01-01T00:00:00.000Z',
    files: {
      'src/existing.ts': {
        score: 0.7, access_count: 2, edit_count: 0,
        last_accessed: '2026-01-01T00:00:00.000Z',
        size_bytes: 512, sessions_unseen: 0, co_access: []
      }
    }
  };
  writeFileMap(stateDir, originalMap);

  const fileMapPath = path.join(stateDir, 'file-map.json');
  const mtimeBefore = fs.statSync(fileMapPath).mtimeMs;

  // Buffer exists but has no accesses — session-end should not call flush
  writeSessionBuffer(stateDir, { session_id: 'sess-c2', accesses: [] });

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-c2' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);

  // file-map.json mtime must be unchanged
  const mtimeAfter = fs.statSync(fileMapPath).mtimeMs;
  assert.strictEqual(
    mtimeAfter,
    mtimeBefore,
    'file-map.json must not be rewritten when buffer has no accesses'
  );

  cleanup();
});

test('session-end: no buffer file at all — exits 0 cleanly', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  // No session-buffer.json written — hook must not throw or create file-map
  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-c3' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);

  const fileMapPath = path.join(stateDir, 'file-map.json');
  assert.ok(
    !fs.existsSync(fileMapPath),
    'file-map.json must not be created when there is no buffer'
  );

  cleanup();
});
