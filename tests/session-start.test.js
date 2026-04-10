'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeFileMap, writeSessionBuffer, readSessionBuffer } = require('../hooks/lib/state');

function mkLocalProject() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-hook-'));
  const claudeDir = path.join(tmpCwd, '.claude');
  const stateDir = path.join(claudeDir, 'tokimizer');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { tokimizer: true } })
  );
  return { tmpCwd, stateDir };
}

function runHook(hookFile, inputJson) {
  const result = spawnSync('node', [hookFile], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    timeout: 5000
  });
  return result;
}

const HOOK = path.resolve(__dirname, '../hooks/session-start.js');

test('session-start: no file-map — auto cold-start builds file-map and returns "Context loaded"', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  // Write a real file so cold-start has something to index
  fs.writeFileSync(path.join(tmpCwd, 'index.js'), 'const x = 1;');

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-a1' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  // Auto cold-start means we get "Context loaded" not "reindex"
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('Context loaded'),
    `expected "Context loaded" in: ${out.hookSpecificOutput.additionalContext}`
  );
  // file-map.json must have been persisted by cold-start
  const fileMapPath = path.join(stateDir, 'file-map.json');
  assert.ok(fs.existsSync(fileMapPath), 'file-map.json should be created by cold-start');

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('session-start: existing file-map with files — additionalContext contains "Context loaded"', () => {
  const { tmpCwd, stateDir } = mkLocalProject();

  writeFileMap(stateDir, {
    version: 1,
    config: {},
    last_updated: new Date().toISOString(),
    files: {
      'src/index.ts': {
        score: 0.9, access_count: 5, edit_count: 2,
        last_accessed: new Date().toISOString(),
        size_bytes: 1024, sessions_unseen: 0, co_access: []
      }
    }
  });

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-a2' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('Context loaded'),
    `expected "Context loaded" in: ${out.hookSpecificOutput.additionalContext}`
  );

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('session-start: creates session-buffer.json with the session_id from input', () => {
  const { tmpCwd, stateDir } = mkLocalProject();

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-a3' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);

  const bufferPath = path.join(stateDir, 'session-buffer.json');
  assert.ok(fs.existsSync(bufferPath), 'session-buffer.json should exist after session-start');

  const buffer = JSON.parse(fs.readFileSync(bufferPath, 'utf8'));
  assert.strictEqual(buffer.session_id, 'sess-a3', 'session_id in buffer must match input');
  assert.deepStrictEqual(buffer.accesses, [], 'accesses should be empty on init');

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('session-start: suggestions.txt populated — additionalContext mentions "Ignore candidates"', () => {
  const { tmpCwd, stateDir } = mkLocalProject();

  writeFileMap(stateDir, {
    version: 1,
    config: {},
    last_updated: new Date().toISOString(),
    files: {
      'src/index.ts': {
        score: 0.9, access_count: 5, edit_count: 2,
        last_accessed: new Date().toISOString(),
        size_bytes: 1024, sessions_unseen: 0, co_access: []
      }
    }
  });

  // Write a suggestions.txt with two candidates
  fs.writeFileSync(
    path.join(stateDir, 'suggestions.txt'),
    'dist/bundle.js\ndist/vendor.js\n'
  );

  const result = runHook(HOOK, { cwd: tmpCwd, session_id: 'sess-a4' });

  assert.strictEqual(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  const out = JSON.parse(result.stdout);
  assert.ok(
    out.hookSpecificOutput.additionalContext.includes('Ignore candidates'),
    `expected "Ignore candidates" in: ${out.hookSpecificOutput.additionalContext}`
  );

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});
