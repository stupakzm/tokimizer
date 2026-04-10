'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildColdStartFileMap } = require('../hooks/lib/cold-start');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-cold-test-'));
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ---------------------------------------------------------------------------
// Shape of the returned object
// ---------------------------------------------------------------------------

test('returns object with version, config, and files', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'index.js', 'console.log("hi");');
  const result = await buildColdStartFileMap(cwd);
  assert.strictEqual(result.version, 1);
  assert.ok(result.config, 'missing config');
  assert.ok(result.files && typeof result.files === 'object', 'missing files');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('config has token_budget_pct: 35 and context_window: 200000', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'a.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  assert.strictEqual(result.config.token_budget_pct, 35);
  assert.strictEqual(result.config.context_window, 200000);
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// File entry shape
// ---------------------------------------------------------------------------

test('each file entry has required fields', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'src/app.js', 'const x = 1;');
  const result = await buildColdStartFileMap(cwd);
  const entry = result.files['src/app.js'];
  assert.ok(entry, 'src/app.js not found in files');
  assert.ok(typeof entry.score === 'number', 'score must be a number');
  assert.strictEqual(entry.access_count, 0);
  assert.strictEqual(entry.edit_count, 0);
  assert.strictEqual(entry.last_accessed, null);
  assert.ok(typeof entry.size_bytes === 'number' && entry.size_bytes >= 0, 'size_bytes must be a non-negative number');
  assert.strictEqual(entry.sessions_unseen, 0);
  assert.deepStrictEqual(entry.co_access, []);
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Cold-start score formula: score = 1 / ceil(size_bytes / 4)
// ---------------------------------------------------------------------------

test('score is 1 / ceil(size_bytes / 4) for a 400-byte file', async () => {
  const cwd = mkTmp();
  // Write exactly 400 bytes
  writeFile(cwd, 'exact.js', 'x'.repeat(400));
  const result = await buildColdStartFileMap(cwd);
  const entry = result.files['exact.js'];
  assert.ok(entry, 'exact.js not found');
  // ceil(400/4) = 100, score = 1/100
  assert.strictEqual(entry.score, 1 / 100);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('score is 1 / ceil(size_bytes / 4) for a 1-byte file', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'tiny.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const entry = result.files['tiny.js'];
  assert.ok(entry, 'tiny.js not found');
  // ceil(1/4) = 1, score = 1/1 = 1
  assert.strictEqual(entry.score, 1);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('score is 1 / ceil(size_bytes / 4) for a 401-byte file', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'odd.js', 'x'.repeat(401));
  const result = await buildColdStartFileMap(cwd);
  const entry = result.files['odd.js'];
  assert.ok(entry, 'odd.js not found');
  // ceil(401/4) = 101, score = 1/101
  assert.strictEqual(entry.score, 1 / 101);
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Keys are relative paths (forward slashes)
// ---------------------------------------------------------------------------

test('file keys are relative paths with forward slashes', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'src/utils/helpers.js', 'module.exports = {};');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(
    keys.includes('src/utils/helpers.js'),
    `expected 'src/utils/helpers.js' in [${keys.join(', ')}]`
  );
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Exclusions: .git/, node_modules/, .claude/tokimizer/
// ---------------------------------------------------------------------------

test('excludes .git/ files', async () => {
  const cwd = mkTmp();
  writeFile(cwd, '.git/config', '[core]');
  writeFile(cwd, 'real.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(!keys.some(k => k.startsWith('.git/')), `.git/ file leaked into: ${keys}`);
  assert.ok(keys.includes('real.js'), 'real.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('excludes node_modules/ files', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'node_modules/lodash/index.js', 'x');
  writeFile(cwd, 'src/main.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(!keys.some(k => k.startsWith('node_modules/')), `node_modules leaked into: ${keys}`);
  assert.ok(keys.includes('src/main.js'), 'src/main.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('excludes .claude/tokimizer/ files', async () => {
  const cwd = mkTmp();
  writeFile(cwd, '.claude/tokimizer/file-map.json', '{}');
  writeFile(cwd, 'app.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(
    !keys.some(k => k.startsWith('.claude/tokimizer/')),
    `.claude/tokimizer/ leaked into: ${keys}`
  );
  assert.ok(keys.includes('app.js'), 'app.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// .claudeignore support
// ---------------------------------------------------------------------------

test('respects .claudeignore — skips files matching listed patterns', async () => {
  const cwd = mkTmp();
  writeFile(cwd, '.claudeignore', 'dist/\n*.log\n');
  writeFile(cwd, 'dist/bundle.js', 'x');
  writeFile(cwd, 'server.log', 'x');
  writeFile(cwd, 'src/index.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(!keys.some(k => k.startsWith('dist/')), `dist/ leaked: ${keys}`);
  assert.ok(!keys.includes('server.log'), `server.log leaked: ${keys}`);
  assert.ok(keys.includes('src/index.js'), 'src/index.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('works normally when .claudeignore is absent', async () => {
  const cwd = mkTmp();
  writeFile(cwd, 'hello.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  assert.ok(Object.keys(result.files).includes('hello.js'), 'hello.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('.claudeignore with blank lines and comment lines does not crash', async () => {
  const cwd = mkTmp();
  writeFile(cwd, '.claudeignore', '# ignore build output\n\ndist/\n\n');
  writeFile(cwd, 'dist/out.js', 'x');
  writeFile(cwd, 'index.js', 'x');
  const result = await buildColdStartFileMap(cwd);
  const keys = Object.keys(result.files);
  assert.ok(!keys.some(k => k.startsWith('dist/')), `dist/ leaked: ${keys}`);
  assert.ok(keys.includes('index.js'), 'index.js missing');
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Empty project
// ---------------------------------------------------------------------------

test('returns empty files object for a project with no files', async () => {
  const cwd = mkTmp();
  const result = await buildColdStartFileMap(cwd);
  assert.deepStrictEqual(result.files, {});
  fs.rmSync(cwd, { recursive: true, force: true });
});
