'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { generateBriefing } = require('../hooks/lib/briefing');

test('returns reindex prompt when fileMap is null', () => {
  const result = generateBriefing(null);
  assert.ok(result.includes('/tokimizer:reindex'), `got: ${result}`);
});

test('returns reindex prompt when files object is empty', () => {
  const result = generateBriefing({ version: 1, config: {}, files: {} });
  assert.ok(result.includes('/tokimizer:reindex'), `got: ${result}`);
});

test('includes Context loaded line with file count', () => {
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/index.ts': { score: 4.2, size_bytes: 400, co_access: [] },
      'src/api.ts':   { score: 3.1, size_bytes: 400, co_access: [] }
    }
  };
  const result = generateBriefing(fileMap);
  assert.ok(result.includes('Context loaded: 2 files'), `got: ${result}`);
});

test('lists top files with scores', () => {
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/index.ts': { score: 4.2, size_bytes: 400, co_access: [] }
    }
  };
  const result = generateBriefing(fileMap);
  assert.ok(result.includes('src/index.ts'), `got: ${result}`);
  assert.ok(result.includes('4.2'), `score missing in: ${result}`);
});

test('shows Beyond budget section when files exceed budget', () => {
  const files = {};
  for (let i = 0; i < 20; i++) {
    files[`src/file${i}.ts`] = { score: i * 0.1, size_bytes: 200000, co_access: [] };
  }
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 5, context_window: 200000 },
    files
  };
  const result = generateBriefing(fileMap);
  assert.ok(result.includes('Beyond budget'), `got: ${result}`);
});

test('always includes package.json regardless of score', () => {
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 1, context_window: 200000 },
    files: {
      'package.json':   { score: 0.001, size_bytes: 200, co_access: [] },
      'src/huge.ts':    { score: 999,   size_bytes: 5000000, co_access: [] }
    }
  };
  const result = generateBriefing(fileMap);
  assert.ok(result.includes('package.json'), `package.json not guaranteed in: ${result}`);
});

test('accepts custom prefix', () => {
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: { 'src/a.ts': { score: 1, size_bytes: 400, co_access: [] } }
  };
  const result = generateBriefing(fileMap, '[Tokimizer] Context re-loaded after compaction');
  assert.ok(result.startsWith('[Tokimizer] Context re-loaded after compaction'), `got: ${result}`);
});
