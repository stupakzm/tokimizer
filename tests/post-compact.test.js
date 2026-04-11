'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectStateDir, writeFileMap, writeSessionBuffer, readSessionBuffer } = require('../hooks/lib/state');

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

const HOOK = path.resolve(__dirname, '../hooks/post-compact.js');

test('post-compact: no file-map — additionalContext contains "re-loaded after compaction" and "reindex"', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-b1' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(
    ctx.includes('re-loaded after compaction'),
    `expected "re-loaded after compaction" in: ${ctx}`
  );
  assert.ok(
    ctx.toLowerCase().includes('reindex'),
    `expected "reindex" in: ${ctx}`
  );

  cleanup();
});

test('post-compact: existing file-map — additionalContext contains "re-loaded after compaction" and "Context loaded"', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  writeFileMap(stateDir, {
    version: 1,
    config: {},
    last_updated: new Date().toISOString(),
    files: {
      'src/app.ts': {
        score: 0.85, access_count: 4, edit_count: 1,
        last_accessed: new Date().toISOString(),
        size_bytes: 2048, sessions_unseen: 0, co_access: []
      }
    }
  });

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-b2' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(
    ctx.includes('re-loaded after compaction'),
    `expected "re-loaded after compaction" in: ${ctx}`
  );
  assert.ok(
    ctx.includes('Context loaded'),
    `expected "Context loaded" in: ${ctx}`
  );

  cleanup();
});

test('post-compact: does not reinitialize session-buffer — existing buffer preserved as-is', () => {
  const { tmpCwd, stateDir, cleanup } = mkLocalProject();

  // Write a buffer with existing accesses that must not be cleared by post-compact
  const originalBuffer = {
    session_id: 'sess-b3',
    accesses: [
      { path: 'src/app.ts', type: 'read', ts: 1700000000 }
    ]
  };
  writeSessionBuffer(stateDir, originalBuffer);

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-b3' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);

  const bufferPath = path.join(stateDir, 'session-buffer.json');
  assert.ok(fs.existsSync(bufferPath), 'session-buffer.json must still exist after post-compact');

  const bufferAfter = JSON.parse(fs.readFileSync(bufferPath, 'utf8'));
  assert.strictEqual(bufferAfter.session_id, 'sess-b3', 'session_id must be unchanged');
  assert.strictEqual(bufferAfter.accesses.length, 1, 'accesses must be unchanged');
  assert.strictEqual(bufferAfter.accesses[0].path, 'src/app.ts', 'access path must be unchanged');

  cleanup();
});
