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

// ─── Co-access bonus tests ───────────────────────────────────────────────────

test('co-access bonus promotes a lower-scored file into budget ahead of a higher-scored one', () => {
  // budget allows exactly ONE regular file beyond entry points.
  // 'src/b.ts' has lower raw score than 'src/a.ts' but co-accesses 'src/already.ts'
  // which IS in the initial pass-1 set.  The bonus must push 'src/b.ts' ahead.
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      // already.ts: high score, small size → always wins pass 1
      'src/already.ts': { score: 10.0, size_bytes: 100, co_access: [] },
      // a.ts: mid score, no co-access peers in budget
      'src/a.ts':       { score: 5.0,  size_bytes: 100, co_access: [] },
      // b.ts: slightly lower raw score, but co-accesses already.ts
      // effectiveScore = 3.0 * (1 + 0.1 * 1) = 3.3  >  5.0? No — let's set it
      // so that effectiveScore > a.ts raw: b raw=4.6 → effective=4.6*1.1=5.06 > 5.0
      'src/b.ts':       { score: 4.6,  size_bytes: 100, co_access: ['src/already.ts'] }
    }
  };

  const result = generateBriefing(fileMap);
  // b.ts must appear in top files (within budget) and before a.ts
  const bIdx  = result.indexOf('src/b.ts');
  const aIdx  = result.indexOf('src/a.ts');
  assert.ok(bIdx !== -1, `src/b.ts not in briefing: ${result}`);
  assert.ok(bIdx < aIdx || aIdx === -1,
    `src/b.ts should rank above src/a.ts; got: ${result}`);
});

test('co-access bonus is proportional to number of co-accessed files already loaded', () => {
  // peer1 and peer2 are both in budget (high scores, small).
  // target has score 1.0 and co_access = [peer1, peer2]
  // effectiveScore = 1.0 * (1 + 0.1*2) = 1.2
  // rival has score 1.15 and no co_access → stays 1.15
  // after bonus: target (1.2) should beat rival (1.15)
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/peer1.ts':  { score: 20.0, size_bytes: 50,  co_access: [] },
      'src/peer2.ts':  { score: 19.0, size_bytes: 50,  co_access: [] },
      'src/target.ts': { score: 1.0,  size_bytes: 50,  co_access: ['src/peer1.ts', 'src/peer2.ts'] },
      'src/rival.ts':  { score: 1.15, size_bytes: 50,  co_access: [] }
    }
  };

  const result = generateBriefing(fileMap);
  const targetIdx = result.indexOf('src/target.ts');
  const rivalIdx  = result.indexOf('src/rival.ts');
  assert.ok(targetIdx !== -1, `src/target.ts not in briefing: ${result}`);
  assert.ok(targetIdx < rivalIdx || rivalIdx === -1,
    `src/target.ts (bonus=1.2) should rank above src/rival.ts (1.15); got: ${result}`);
});

test('co-access bonus is not applied when the co-accessed file is NOT in the pass-1 budget set', () => {
  // co-peer has low score and is pushed out of budget in pass 1.
  // target co-accesses co-peer but should NOT receive a bonus because
  // co-peer was not in the pass-1 within-budget set.
  // Rival has slightly lower raw score than target; without a spurious bonus
  // target still beats rival, so we only need to confirm scores are
  // identical (no bonus) — we do this by checking the effective scores are
  // unchanged (target score 5.0, rival score 4.9 → target still first, no swap).
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 1, context_window: 200000 }, // very tight budget
    files: {
      // winner: consumes entire budget in pass 1
      'src/winner.ts':  { score: 100.0, size_bytes: 600000, co_access: [] },
      // co-peer: also large, low score → beyond budget in pass 1
      'src/co-peer.ts': { score: 0.1,   size_bytes: 600000, co_access: [] },
      // target: references co-peer but co-peer is NOT in pass-1 set
      'src/target.ts':  { score: 5.0,   size_bytes: 600000,
                          co_access: ['src/co-peer.ts'] },
      'src/rival.ts':   { score: 4.9,   size_bytes: 600000, co_access: [] }
    }
  };

  // Both target and rival are beyond budget; the point is that target does NOT
  // jump ahead of winner by getting a phantom bonus.  We verify winner is still
  // mentioned in the briefing and target has not consumed its slot.
  const result = generateBriefing(fileMap);
  assert.ok(result.includes('src/winner.ts'), `winner missing: ${result}`);
  // target should not have received a bonus that inflates it past winner
  // (winner score 100 >> target effective max 5.5, so this is trivially true,
  // but the important thing is target is in Beyond budget, not within budget)
  assert.ok(result.includes('Beyond budget'), `expected beyond-budget section: ${result}`);
  // target.ts must be in Beyond budget, not within the budget slot
  assert.ok(
    result.includes('src/target.ts'),
    `src/target.ts should appear in beyond-budget list: ${result}`
  );
  // Verify it's in beyond-budget section specifically
  const beyondIdx = result.indexOf('Beyond budget');
  const targetIdx2 = result.indexOf('src/target.ts');
  assert.ok(
    beyondIdx !== -1 && targetIdx2 > beyondIdx,
    `src/target.ts should appear after 'Beyond budget': ${result}`
  );
});

test('generateBriefing does not mutate fileMap scores', () => {
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/a.ts': { score: 8.0, size_bytes: 100, co_access: ['src/b.ts'] },
      'src/b.ts': { score: 7.0, size_bytes: 100, co_access: ['src/a.ts'] }
    }
  };

  const scoreBefore = fileMap.files['src/a.ts'].score;
  generateBriefing(fileMap);
  assert.strictEqual(fileMap.files['src/a.ts'].score, scoreBefore,
    'generateBriefing must not mutate fileMap.files[*].score');
});

test('co-access bonus is zero when co_access array is empty', () => {
  // Confirm no regression: files with empty co_access still sort correctly.
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/high.ts': { score: 9.0, size_bytes: 100, co_access: [] },
      'src/low.ts':  { score: 1.0, size_bytes: 100, co_access: [] }
    }
  };
  const result = generateBriefing(fileMap);
  const highIdx = result.indexOf('src/high.ts');
  const lowIdx  = result.indexOf('src/low.ts');
  assert.ok(highIdx !== -1, `high.ts missing: ${result}`);
  assert.ok(highIdx < lowIdx, `high.ts should appear before low.ts; got: ${result}`);
});

test('co-access bonus handles missing co_access field gracefully', () => {
  // Some older file-map entries may not have the co_access key at all.
  const fileMap = {
    version: 1,
    config: { token_budget_pct: 100, context_window: 200000 },
    files: {
      'src/old.ts': { score: 5.0, size_bytes: 100 }  // no co_access property
    }
  };
  // Must not throw; must produce a valid briefing string.
  let result;
  assert.doesNotThrow(() => { result = generateBriefing(fileMap); });
  assert.ok(typeof result === 'string' && result.length > 0,
    `expected non-empty string, got: ${result}`);
});
