'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFileMap } = require('../hooks/lib/state');
const { reindex } = require('../hooks/reindex');

function mkLocalProject() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-reindex-'));
  const claudeDir = path.join(tmpCwd, '.claude');
  const stateDir = path.join(claudeDir, 'tokimizer');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { tokimizer: true } })
  );
  return { tmpCwd, stateDir };
}

test('reindex writes file-map.json with correct config block', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.writeFileSync(path.join(tmpCwd, 'index.js'), 'console.log("hello");');

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  assert.ok(fm, 'file-map.json should exist');
  assert.strictEqual(fm.version, 1);
  assert.strictEqual(fm.config.token_budget_pct, 35);
  assert.strictEqual(fm.config.context_window, 200000);
  assert.ok(typeof fm.config.project_total_tokens === 'number');
  assert.ok(fm.config.project_total_tokens > 0);
  assert.ok(typeof fm.config.budget_set_at === 'string');

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex writes an entry for each discovered file', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.mkdirSync(path.join(tmpCwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'src', 'a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(tmpCwd, 'src', 'b.ts'), 'export const b = 2;');
  fs.writeFileSync(path.join(tmpCwd, 'README.md'), '# hello');

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  const keys = Object.keys(fm.files);
  assert.ok(keys.some(k => k === 'src/a.ts'), `expected src/a.ts, got ${JSON.stringify(keys)}`);
  assert.ok(keys.some(k => k === 'src/b.ts'), `expected src/b.ts, got ${JSON.stringify(keys)}`);
  assert.ok(keys.some(k => k === 'README.md'), `expected README.md, got ${JSON.stringify(keys)}`);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex file entries have correct cold-start shape', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.writeFileSync(path.join(tmpCwd, 'app.js'), 'const x = 42;');

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  const entry = fm.files['app.js'];
  assert.ok(entry, 'app.js entry should exist');
  assert.ok(typeof entry.size_bytes === 'number');
  assert.ok(entry.size_bytes > 0);
  // score = 1 / ceil(size_bytes / 4)
  const expectedScore = 1 / Math.ceil(entry.size_bytes / 4);
  assert.strictEqual(entry.score, expectedScore);
  assert.strictEqual(entry.access_count, 0);
  assert.strictEqual(entry.edit_count, 0);
  assert.strictEqual(entry.last_accessed, null);
  assert.strictEqual(entry.sessions_unseen, 0);
  assert.deepStrictEqual(entry.co_access, []);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex excludes .git/, node_modules/, and .claude/tokimizer/', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.mkdirSync(path.join(tmpCwd, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, '.git', 'HEAD'), 'ref: refs/heads/main');
  fs.mkdirSync(path.join(tmpCwd, 'node_modules', 'lodash'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'node_modules', 'lodash', 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(tmpCwd, 'real.js'), 'const x = 1;');

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  const keys = Object.keys(fm.files);
  assert.ok(
    !keys.some(k => k.startsWith('.git/')),
    `.git/ should be excluded, got ${JSON.stringify(keys)}`
  );
  assert.ok(
    !keys.some(k => k.startsWith('node_modules/')),
    `node_modules/ should be excluded, got ${JSON.stringify(keys)}`
  );
  assert.ok(
    !keys.some(k => k.startsWith('.claude/tokimizer/')),
    `.claude/tokimizer/ should be excluded, got ${JSON.stringify(keys)}`
  );
  assert.ok(keys.some(k => k === 'real.js'), `real.js should be included, got ${JSON.stringify(keys)}`);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex respects .claudeignore patterns', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.writeFileSync(path.join(tmpCwd, '.claudeignore'), 'dist/\n*.log\n');
  fs.mkdirSync(path.join(tmpCwd, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(tmpCwd, 'dist', 'bundle.js'), 'bundled code');
  fs.writeFileSync(path.join(tmpCwd, 'debug.log'), 'log output');
  fs.writeFileSync(path.join(tmpCwd, 'index.js'), 'const x = 1;');

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  const keys = Object.keys(fm.files);
  assert.ok(
    !keys.some(k => k.startsWith('dist/')),
    `dist/ should be excluded via .claudeignore, got ${JSON.stringify(keys)}`
  );
  assert.ok(
    !keys.some(k => k.endsWith('.log')),
    `*.log should be excluded via .claudeignore, got ${JSON.stringify(keys)}`
  );
  assert.ok(keys.some(k => k === 'index.js'), `index.js should be included, got ${JSON.stringify(keys)}`);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex deletes pre-existing file-map.json and session-buffer.json', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  // Write stale state files
  fs.writeFileSync(path.join(stateDir, 'file-map.json'), JSON.stringify({ version: 1, stale: true }));
  fs.writeFileSync(path.join(stateDir, 'session-buffer.json'), JSON.stringify({ session_id: 'old' }));
  fs.writeFileSync(path.join(tmpCwd, 'app.js'), 'const x = 1;');

  reindex(tmpCwd, 35);

  // session-buffer.json should be gone
  assert.ok(
    !fs.existsSync(path.join(stateDir, 'session-buffer.json')),
    'session-buffer.json should be deleted'
  );
  // file-map.json should be freshly written (no stale flag)
  const fm = readFileMap(stateDir);
  assert.ok(fm, 'file-map.json should exist');
  assert.strictEqual(fm.stale, undefined, 'stale flag should not be present in new file-map');

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex project_total_tokens is sum of all file token costs', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  const content1 = 'a'.repeat(400); // 400 bytes → 100 tokens
  const content2 = 'b'.repeat(800); // 800 bytes → 200 tokens
  fs.writeFileSync(path.join(tmpCwd, 'file1.js'), content1);
  fs.writeFileSync(path.join(tmpCwd, 'file2.js'), content2);

  reindex(tmpCwd, 35);

  const fm = readFileMap(stateDir);
  let expectedTotal = 0;
  for (const entry of Object.values(fm.files)) {
    expectedTotal += Math.ceil(entry.size_bytes / 4);
  }
  assert.strictEqual(fm.config.project_total_tokens, expectedTotal);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('reindex honours --budget flag via budgetPct argument', () => {
  const { tmpCwd, stateDir } = mkLocalProject();
  fs.writeFileSync(path.join(tmpCwd, 'index.js'), 'const x = 1;');

  reindex(tmpCwd, 20);

  const fm = readFileMap(stateDir);
  assert.strictEqual(fm.config.token_budget_pct, 20);

  fs.rmSync(tmpCwd, { recursive: true, force: true });
});
