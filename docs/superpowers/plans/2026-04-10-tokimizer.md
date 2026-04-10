# Tokimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Claude Code plugin that learns which files matter in a project and minimizes token usage through adaptive, self-improving session briefings.

**Architecture:** Six Node.js hook scripts share three lib modules (`state.js`, `scoring.js`, `briefing.js`). Hooks fire on Claude Code lifecycle events to buffer file access, batch-flush scores, and inject context briefings. Three slash command `.md` files provide user-facing control. `SKILL.md` provides behavioral guidance to Claude.

**Tech Stack:** Node.js 18+ (CommonJS), `node:test` (built-in test runner), `node:crypto`, `node:fs`, `node:path`, `node:os`. Zero external dependencies.

---

## File Map

| File | Role |
|------|------|
| `plugin.json` | Plugin manifest — declares hooks, commands, skills |
| `hooks/hooks.json` | Hook event registrations |
| `hooks/lib/state.js` | State dir resolution, file-map/buffer/suggestions read-write |
| `hooks/lib/scoring.js` | Scoring formula, recency decay, cold-start score |
| `hooks/lib/briefing.js` | Generates `additionalContext` briefing string from file-map |
| `hooks/session-start.js` | SessionStart: inject briefing, init session buffer |
| `hooks/track-access.js` | PostToolUse Read\|Glob\|Grep\|Write\|Edit: buffer file paths |
| `hooks/flush-scores.js` | Stop: batch flush buffer → update scores, detect candidates |
| `hooks/post-compact.js` | PostCompact: re-inject briefing after context compaction |
| `hooks/session-end.js` | SessionEnd: safety-net flush if Stop didn't fire |
| `commands/optimize.md` | `/tokimizer:optimize` slash command doc |
| `commands/analyze.md` | `/tokimizer:analyze` slash command doc |
| `commands/reindex.md` | `/tokimizer:reindex` slash command doc |
| `skills/tokimizer/SKILL.md` | Background behavioral guide for Claude |
| `tests/state.test.js` | Tests for state.js |
| `tests/scoring.test.js` | Tests for scoring.js |
| `tests/briefing.test.js` | Tests for briefing.js |
| `tests/track-access.test.js` | Tests for path extraction logic |
| `tests/flush-scores.test.js` | Tests for flush logic |
| `package.json` | Node project (scripts only, no runtime deps) |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `hooks/lib/.gitkeep`
- Create: `tests/.gitkeep`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "tokimizer",
  "version": "1.0.0",
  "description": "Self-learning Claude Code context optimizer",
  "main": "plugin.json",
  "scripts": {
    "test": "node --test tests/*.test.js"
  },
  "engines": { "node": ">=18.0.0" }
}
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p hooks/lib tests commands skills/tokimizer
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.claude/tokimizer/
```

- [ ] **Step 4: Verify structure**

```bash
find . -type d | sort
```

Expected output includes: `./hooks`, `./hooks/lib`, `./tests`, `./commands`, `./skills/tokimizer`

- [ ] **Step 5: Commit**

```bash
git init
git add package.json .gitignore
git commit -m "chore: scaffold tokimizer plugin project"
```

---

### Task 2: hooks/lib/state.js

**Files:**
- Create: `hooks/lib/state.js`
- Create: `tests/state.test.js`

- [ ] **Step 1: Write failing tests**

`tests/state.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// We require the module after writing it — placeholder until Task 2 Step 2
const {
  detectStateDir, readFileMap, writeFileMap,
  readSessionBuffer, writeSessionBuffer, clearSessionBuffer,
  readSuggestions, appendSuggestions, clearSuggestions
} = require('../hooks/lib/state');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokimizer-test-'));
}

function makeLocalProject(tmpCwd) {
  const claudeDir = path.join(tmpCwd, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { tokimizer: true } })
  );
}

test('detectStateDir uses global path for unknown project', () => {
  const tmpCwd = mkTmp();
  const stateDir = detectStateDir(tmpCwd);
  assert.ok(
    stateDir.includes(path.join('.claude', 'tokimizer')),
    `expected global tokimizer path, got ${stateDir}`
  );
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('detectStateDir uses local path when local settings enables tokimizer', () => {
  const tmpCwd = mkTmp();
  makeLocalProject(tmpCwd);
  const stateDir = detectStateDir(tmpCwd);
  assert.ok(stateDir.startsWith(tmpCwd), `expected local path under ${tmpCwd}, got ${stateDir}`);
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

test('appendSuggestions deduplicates entries', () => {
  const tmpDir = mkTmp();
  appendSuggestions(tmpDir, ['dist/', 'node_modules/']);
  appendSuggestions(tmpDir, ['dist/', '.next/']);
  const result = readSuggestions(tmpDir);
  assert.deepStrictEqual(result, ['dist/', 'node_modules/', '.next/']);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('clearSuggestions removes file', () => {
  const tmpDir = mkTmp();
  appendSuggestions(tmpDir, ['dist/']);
  clearSuggestions(tmpDir);
  assert.deepStrictEqual(readSuggestions(tmpDir), []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --test tests/state.test.js
```

Expected: error `Cannot find module '../hooks/lib/state'`

- [ ] **Step 3: Implement hooks/lib/state.js**

```js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const GLOBAL_BASE = path.join(os.homedir(), '.claude', 'tokimizer');

function projectHash(cwd) {
  return crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8);
}

function detectStateDir(cwd) {
  const localSettings = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(localSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(localSettings, 'utf8'));
      if (s.enabledPlugins && s.enabledPlugins.tokimizer) {
        const localDir = path.join(cwd, '.claude', 'tokimizer');
        fs.mkdirSync(localDir, { recursive: true });
        return localDir;
      }
    } catch (_) {}
  }
  const globalDir = path.join(GLOBAL_BASE, projectHash(cwd));
  fs.mkdirSync(globalDir, { recursive: true });
  return globalDir;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readFileMap(stateDir) {
  return readJson(path.join(stateDir, 'file-map.json'));
}

function writeFileMap(stateDir, data) {
  writeJson(path.join(stateDir, 'file-map.json'), data);
}

function readSessionBuffer(stateDir) {
  return readJson(path.join(stateDir, 'session-buffer.json'));
}

function writeSessionBuffer(stateDir, data) {
  writeJson(path.join(stateDir, 'session-buffer.json'), data);
}

function clearSessionBuffer(stateDir) {
  const p = path.join(stateDir, 'session-buffer.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function readSuggestions(stateDir) {
  const p = path.join(stateDir, 'suggestions.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function appendSuggestions(stateDir, candidates) {
  const existing = new Set(readSuggestions(stateDir));
  const newOnes = candidates.filter(c => !existing.has(c));
  if (newOnes.length === 0) return;
  fs.appendFileSync(path.join(stateDir, 'suggestions.txt'), newOnes.join('\n') + '\n');
}

function clearSuggestions(stateDir) {
  const p = path.join(stateDir, 'suggestions.txt');
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = {
  detectStateDir,
  readFileMap, writeFileMap,
  readSessionBuffer, writeSessionBuffer, clearSessionBuffer,
  readSuggestions, appendSuggestions, clearSuggestions
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --test tests/state.test.js
```

Expected: all 8 tests pass, 0 failures

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/state.js tests/state.test.js
git commit -m "feat: add state module for file-map/buffer/suggestions IO"
```

---

### Task 3: hooks/lib/scoring.js

**Files:**
- Create: `hooks/lib/scoring.js`
- Create: `tests/scoring.test.js`

- [ ] **Step 1: Write failing tests**

`tests/scoring.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { calcTokenCost, calcRecencyDecay, calcScore, coldStartScore } = require('../hooks/lib/scoring');

test('calcTokenCost: size/4 ceiling, minimum 1', () => {
  assert.strictEqual(calcTokenCost(400), 100);
  assert.strictEqual(calcTokenCost(401), 101);
  assert.strictEqual(calcTokenCost(3),   1);
  assert.strictEqual(calcTokenCost(0),   1);
});

test('calcRecencyDecay: returns 1 for null or undefined', () => {
  assert.strictEqual(calcRecencyDecay(null), 1);
  assert.strictEqual(calcRecencyDecay(undefined), 1);
});

test('calcRecencyDecay: returns ~0.95 for a file accessed 1 day ago', () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const decay = calcRecencyDecay(yesterday);
  assert.ok(decay > 0.93 && decay < 0.97, `expected ~0.95, got ${decay}`);
});

test('calcRecencyDecay: returns ~0.49 for a file accessed 14 days ago', () => {
  const old = new Date(Date.now() - 86400000 * 14).toISOString();
  const decay = calcRecencyDecay(old);
  assert.ok(decay > 0.44 && decay < 0.54, `expected ~0.49, got ${decay}`);
});

test('calcScore: (reads + edits*3) * decay / tokenCost', () => {
  const entry = {
    access_count: 10,
    edit_count: 0,
    last_accessed: new Date().toISOString(),
    size_bytes: 400
  };
  // base = (10 + 0) * ~1 = 10, cost = 100, score = 0.1
  const score = calcScore(entry);
  assert.ok(score > 0.09 && score < 0.11, `expected ~0.1, got ${score}`);
});

test('calcScore: edit_count weighted 3x', () => {
  const readOnly = { access_count: 3, edit_count: 0, last_accessed: new Date().toISOString(), size_bytes: 400 };
  const withEdit = { access_count: 0, edit_count: 1, last_accessed: new Date().toISOString(), size_bytes: 400 };
  // reads: 3/100 = 0.03; edit: 3/100 = 0.03 — equal
  assert.ok(Math.abs(calcScore(readOnly) - calcScore(withEdit)) < 0.001);
});

test('coldStartScore: 1 / tokenCost', () => {
  assert.strictEqual(coldStartScore(400), 1 / 100);
  assert.strictEqual(coldStartScore(4000), 1 / 1000);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --test tests/scoring.test.js
```

Expected: error `Cannot find module '../hooks/lib/scoring'`

- [ ] **Step 3: Implement hooks/lib/scoring.js**

```js
'use strict';

function calcTokenCost(sizeBytes) {
  return Math.max(1, Math.ceil(sizeBytes / 4));
}

function calcRecencyDecay(lastAccessedISO) {
  if (!lastAccessedISO) return 1;
  const days = (Date.now() - new Date(lastAccessedISO).getTime()) / 86400000;
  return Math.pow(0.95, Math.max(0, days));
}

function calcScore(entry) {
  const base = (entry.access_count + entry.edit_count * 3) * calcRecencyDecay(entry.last_accessed);
  return base / calcTokenCost(entry.size_bytes);
}

function coldStartScore(sizeBytes) {
  return 1 / calcTokenCost(sizeBytes);
}

module.exports = { calcTokenCost, calcRecencyDecay, calcScore, coldStartScore };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --test tests/scoring.test.js
```

Expected: all 7 tests pass, 0 failures

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/scoring.js tests/scoring.test.js
git commit -m "feat: add scoring module with recency decay formula"
```

---

### Task 4: hooks/lib/briefing.js

**Files:**
- Create: `hooks/lib/briefing.js`
- Create: `tests/briefing.test.js`

- [ ] **Step 1: Write failing tests**

`tests/briefing.test.js`:
```js
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --test tests/briefing.test.js
```

Expected: error `Cannot find module '../hooks/lib/briefing'`

- [ ] **Step 3: Implement hooks/lib/briefing.js**

```js
'use strict';
const { calcTokenCost } = require('./scoring');

const ENTRY_POINT_SUFFIXES = ['package.json', 'CLAUDE.md'];

function isEntryPoint(filePath) {
  return ENTRY_POINT_SUFFIXES.some(ep => filePath === ep || filePath.endsWith('/' + ep));
}

function generateBriefing(fileMap, prefix) {
  const label = prefix || '[Tokimizer]';

  if (!fileMap || !fileMap.files || Object.keys(fileMap.files).length === 0) {
    return `${label} No file map yet. Run /tokimizer:reindex to initialize.`;
  }

  const config = fileMap.config || {};
  const budgetPct = config.token_budget_pct || 35;
  const contextWindow = config.context_window || 200000;
  const budget = Math.round(contextWindow * budgetPct / 100);

  const entries = Object.entries(fileMap.files);
  const sorted = entries.slice().sort(([, a], [, b]) => b.score - a.score);

  let tokensUsed = 0;
  const withinBudget = [];
  const beyondBudget = [];

  for (const [filePath, entry] of sorted) {
    const cost = calcTokenCost(entry.size_bytes);
    if (isEntryPoint(filePath) || tokensUsed + cost <= budget) {
      withinBudget.push({ path: filePath, score: entry.score, cost });
      tokensUsed += cost;
    } else {
      beyondBudget.push(filePath);
    }
  }

  const pctUsed = Math.round((tokensUsed / budget) * 100);
  const topFiles = withinBudget
    .slice(0, 5)
    .map(f => `${f.path} (${f.score.toFixed(1)})`)
    .join(', ');

  let out = `${label} Context loaded: ${withinBudget.length} files, ~${tokensUsed.toLocaleString()} tokens (${pctUsed}% of budget)\n`;
  if (topFiles) out += `Top files: ${topFiles}\n`;

  if (beyondBudget.length > 0) {
    const preview = beyondBudget.slice(0, 10).join(', ');
    const extra = beyondBudget.length > 10 ? ` +${beyondBudget.length - 10} more` : '';
    out += `Beyond budget (${beyondBudget.length} files — load on demand if relevant): ${preview}${extra}\n`;
  }

  return out.trim();
}

module.exports = { generateBriefing };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --test tests/briefing.test.js
```

Expected: all 7 tests pass, 0 failures

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/briefing.js tests/briefing.test.js
git commit -m "feat: add briefing module for session context injection"
```

---

### Task 5: hooks/session-start.js

**Files:**
- Create: `hooks/session-start.js`

- [ ] **Step 1: Write hooks/session-start.js**

```js
#!/usr/bin/env node
'use strict';
const { detectStateDir, readFileMap, readSuggestions, writeSessionBuffer } = require('./lib/state');
const { generateBriefing } = require('./lib/briefing');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    const sessionId = data.session_id || 'unknown';

    const stateDir = detectStateDir(cwd);
    const fileMap = readFileMap(stateDir);
    const suggestions = readSuggestions(stateDir);

    let briefing = generateBriefing(fileMap);
    if (suggestions.length > 0) {
      briefing += `\nIgnore candidates pending review: ${suggestions.length} entries — run /tokimizer:optimize`;
    }

    // Initialize fresh session buffer
    writeSessionBuffer(stateDir, { session_id: sessionId, accesses: [] });

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: briefing
      }
    }));
  } catch (_) {
    process.exit(0);
  }
});
```

- [ ] **Step 2: Smoke test manually**

```bash
echo '{"session_id":"test-123","cwd":"C:/Users/TopAide/projects/tokinizer","hook_event_name":"SessionStart","source":"startup"}' | node hooks/session-start.js
```

Expected: JSON output containing `hookSpecificOutput.additionalContext` with "No file map yet. Run /tokimizer:reindex"

- [ ] **Step 3: Commit**

```bash
git add hooks/session-start.js
git commit -m "feat: add session-start hook for context briefing injection"
```

---

### Task 6: hooks/track-access.js

**Files:**
- Create: `hooks/track-access.js`
- Create: `tests/track-access.test.js`

- [ ] **Step 1: Write failing tests**

`tests/track-access.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// extractPath is the pure logic — extracted here for testing without stdin side-effects
function extractPath(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'Grep') {
    const p = toolInput.path;
    if (p && path.extname(p)) return p;
  }
  return null;
}

test('Read: returns file_path', () => {
  assert.strictEqual(extractPath('Read', { file_path: 'src/index.ts' }), 'src/index.ts');
});

test('Write: returns file_path', () => {
  assert.strictEqual(extractPath('Write', { file_path: 'src/new.ts' }), 'src/new.ts');
});

test('Edit: returns file_path', () => {
  assert.strictEqual(extractPath('Edit', { file_path: 'src/old.ts', old_string: 'x', new_string: 'y' }), 'src/old.ts');
});

test('Grep with file path: returns path', () => {
  assert.strictEqual(extractPath('Grep', { path: 'src/index.ts', pattern: 'foo' }), 'src/index.ts');
});

test('Grep with directory path: returns null', () => {
  assert.strictEqual(extractPath('Grep', { path: 'src/', pattern: 'foo' }), null);
});

test('Glob: returns null (patterns are not file paths)', () => {
  assert.strictEqual(extractPath('Glob', { pattern: '**/*.ts' }), null);
});

test('null input: returns null', () => {
  assert.strictEqual(extractPath('Read', null), null);
});
```

- [ ] **Step 2: Run tests — verify they pass immediately** (pure logic, no module to write)

```bash
node --test tests/track-access.test.js
```

Expected: all 7 tests pass

- [ ] **Step 3: Write hooks/track-access.js**

```js
#!/usr/bin/env node
'use strict';
const path = require('path');
const { detectStateDir, readSessionBuffer, writeSessionBuffer } = require('./lib/state');

const WRITE_TOOLS = new Set(['Write', 'Edit']);

function extractPath(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'Grep') {
    const p = toolInput.path;
    if (p && path.extname(p)) return p;
  }
  return null;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();
    const toolName = data.tool_name;
    const toolInput = data.tool_input;

    const rawPath = extractPath(toolName, toolInput);
    if (!rawPath) { process.exit(0); return; }

    // Normalize to relative path from cwd
    const rel = path.isAbsolute(rawPath) ? path.relative(cwd, rawPath) : rawPath;

    // Skip tokimizer's own state files to avoid self-tracking loops
    if (rel.startsWith('.claude' + path.sep + 'tokimizer') ||
        rel.startsWith('.claude/tokimizer')) {
      process.exit(0); return;
    }

    const type = WRITE_TOOLS.has(toolName) ? 'edit' : 'read';
    const stateDir = detectStateDir(cwd);
    const buffer = readSessionBuffer(stateDir) || { session_id: data.session_id || 'unknown', accesses: [] };
    buffer.accesses.push({ path: rel, type, ts: Math.floor(Date.now() / 1000) });
    writeSessionBuffer(stateDir, buffer);

    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
});
```

- [ ] **Step 4: Smoke test**

```bash
echo '{"session_id":"test","cwd":"C:/Users/TopAide/projects/tokinizer","tool_name":"Read","tool_input":{"file_path":"C:/Users/TopAide/projects/tokinizer/src/index.ts"}}' | node hooks/track-access.js && echo "exit 0 OK"
```

Expected: `exit 0 OK` (no output, just exits cleanly)

- [ ] **Step 5: Commit**

```bash
git add hooks/track-access.js tests/track-access.test.js
git commit -m "feat: add track-access hook to buffer file access events"
```

---

### Task 7: hooks/flush-scores.js

**Files:**
- Create: `hooks/flush-scores.js`
- Create: `tests/flush-scores.test.js`

- [ ] **Step 1: Write failing tests**

`tests/flush-scores.test.js`:
```js
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
  assert.ok(suggestions.includes('dist/bundle.js'), `expected dist/bundle.js in ${JSON.stringify(suggestions)}`);

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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --test tests/flush-scores.test.js
```

Expected: error `Cannot find module '../hooks/flush-scores'`

- [ ] **Step 3: Implement hooks/flush-scores.js**

```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const {
  detectStateDir, readFileMap, writeFileMap,
  readSessionBuffer, clearSessionBuffer, appendSuggestions
} = require('./lib/state');
const { calcTokenCost, calcScore } = require('./lib/scoring');

function flush(cwd, sessionId) {
  const stateDir = detectStateDir(cwd);
  const buffer = readSessionBuffer(stateDir);
  if (!buffer || !buffer.accesses || buffer.accesses.length === 0) {
    clearSessionBuffer(stateDir); // clean up even if empty
    return;
  }

  const fileMap = readFileMap(stateDir) || { version: 1, config: {}, files: {} };
  const files = fileMap.files;

  const accessedPaths = new Set(buffer.accesses.map(a => a.path));
  const sessionPaths = [...accessedPaths];
  const now = new Date().toISOString();

  // Increment sessions_unseen for all existing files
  for (const [filePath, entry] of Object.entries(files)) {
    if (accessedPaths.has(filePath)) {
      entry.sessions_unseen = 0;
    } else {
      entry.sessions_unseen = (entry.sessions_unseen || 0) + 1;
    }
  }

  // Merge session accesses into file entries
  for (const access of buffer.accesses) {
    const p = access.path;
    if (!files[p]) {
      let sizeBytes = 1000;
      try {
        const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
        if (fs.existsSync(abs)) sizeBytes = fs.statSync(abs).size;
      } catch (_) {}
      files[p] = {
        score: 0, access_count: 0, edit_count: 0,
        last_accessed: null, size_bytes: sizeBytes,
        sessions_unseen: 0, co_access: []
      };
    }
    const entry = files[p];
    if (access.type === 'edit') {
      entry.edit_count = (entry.edit_count || 0) + 1;
    } else {
      entry.access_count = (entry.access_count || 0) + 1;
    }
    entry.last_accessed = now;
    entry.sessions_unseen = 0;

    // Update co_access
    const coSet = new Set(entry.co_access || []);
    for (const other of sessionPaths) {
      if (other !== p) coSet.add(other);
    }
    entry.co_access = [...coSet].slice(0, 20);
  }

  // Recalculate scores for all files
  for (const entry of Object.values(files)) {
    entry.score = calcScore(entry);
  }

  // Identify ignore candidates
  const candidates = Object.entries(files)
    .filter(([, e]) =>
      e.score < 0.1 &&
      e.size_bytes > 20000 &&
      (e.sessions_unseen || 0) >= 5
    )
    .map(([p]) => p);

  if (candidates.length > 0) appendSuggestions(stateDir, candidates);

  fileMap.last_updated = now;
  writeFileMap(stateDir, fileMap);
  clearSessionBuffer(stateDir);
}

// Only run stdin handler when executed directly (not when required)
if (require.main === module) {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 10000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      flush(data.cwd || process.cwd(), data.session_id);
      process.exit(0);
    } catch (_) {
      process.exit(0);
    }
  });
}

module.exports = { flush };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --test tests/flush-scores.test.js
```

Expected: all 6 tests pass, 0 failures

- [ ] **Step 5: Commit**

```bash
git add hooks/flush-scores.js tests/flush-scores.test.js
git commit -m "feat: add flush-scores hook for batch score updates on Stop"
```

---

### Task 8: hooks/post-compact.js and hooks/session-end.js

**Files:**
- Create: `hooks/post-compact.js`
- Create: `hooks/session-end.js`

- [ ] **Step 1: Write hooks/post-compact.js**

```js
#!/usr/bin/env node
'use strict';
const { detectStateDir, readFileMap, readSuggestions } = require('./lib/state');
const { generateBriefing } = require('./lib/briefing');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();

    const stateDir = detectStateDir(cwd);
    const fileMap = readFileMap(stateDir);
    const suggestions = readSuggestions(stateDir);

    let briefing = generateBriefing(fileMap, '[Tokimizer] Context re-loaded after compaction');
    if (suggestions.length > 0) {
      briefing += `\nIgnore candidates pending review: ${suggestions.length} entries — run /tokimizer:optimize`;
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: briefing
      }
    }));
  } catch (_) {
    process.exit(0);
  }
});
```

- [ ] **Step 2: Smoke test post-compact.js**

```bash
echo '{"session_id":"test","cwd":"C:/Users/TopAide/projects/tokinizer","hook_event_name":"PostCompact","trigger":"auto"}' | node hooks/post-compact.js
```

Expected: JSON with `additionalContext` containing "Context re-loaded after compaction"

- [ ] **Step 3: Write hooks/session-end.js**

```js
#!/usr/bin/env node
'use strict';
const { detectStateDir, readSessionBuffer } = require('./lib/state');
const { flush } = require('./flush-scores');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();

    const stateDir = detectStateDir(cwd);
    const buffer = readSessionBuffer(stateDir);

    // Safety-net: only flush if Stop hook didn't already clear the buffer
    if (buffer && buffer.accesses && buffer.accesses.length > 0) {
      flush(cwd, data.session_id);
    }

    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
});
```

- [ ] **Step 4: Smoke test session-end.js**

```bash
echo '{"session_id":"test","cwd":"C:/Users/TopAide/projects/tokinizer","hook_event_name":"SessionEnd","reason":"clear"}' | node hooks/session-end.js && echo "exit 0 OK"
```

Expected: `exit 0 OK`

- [ ] **Step 5: Commit**

```bash
git add hooks/post-compact.js hooks/session-end.js
git commit -m "feat: add post-compact and session-end safety hooks"
```

---

### Task 9: Run full test suite

**Files:** (no new files)

- [ ] **Step 1: Run all tests**

```bash
node --test tests/*.test.js
```

Expected: all tests pass, 0 failures across state, scoring, briefing, track-access, flush-scores

- [ ] **Step 2: Fix any failures before proceeding**

If any test fails, read the error, fix the implementation, re-run until all pass.

---

### Task 10: plugin.json and hooks/hooks.json

**Files:**
- Create: `plugin.json`
- Create: `hooks/hooks.json`

- [ ] **Step 1: Write plugin.json**

```json
{
  "name": "tokimizer",
  "version": "1.0.0",
  "description": "Self-learning Claude Code context optimizer. Tracks file usage, scores by token efficiency, injects smart briefings at session start.",
  "hooks": "hooks/hooks.json",
  "commands": "commands/",
  "skills": "skills/"
}
```

- [ ] **Step 2: Determine the absolute install path**

```bash
pwd
```

Note the output — this is `PLUGIN_DIR`. On this machine it should be `C:/Users/TopAide/projects/tokinizer`. Use forward slashes in the JSON.

- [ ] **Step 3: Write hooks/hooks.json** (replace `PLUGIN_DIR` with actual path from Step 2)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node \"PLUGIN_DIR/hooks/session-start.js\"",
        "timeout": 10
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read|Glob|Grep|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"PLUGIN_DIR/hooks/track-access.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "node \"PLUGIN_DIR/hooks/flush-scores.js\"",
        "timeout": 15
      }
    ],
    "PostCompact": [
      {
        "type": "command",
        "command": "node \"PLUGIN_DIR/hooks/post-compact.js\"",
        "timeout": 10
      }
    ],
    "SessionEnd": [
      {
        "type": "command",
        "command": "node \"PLUGIN_DIR/hooks/session-end.js\"",
        "timeout": 15
      }
    ]
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add plugin.json hooks/hooks.json
git commit -m "feat: add plugin manifest and hook registrations"
```

---

### Task 11: commands/optimize.md

**Files:**
- Create: `commands/optimize.md`

- [ ] **Step 1: Write commands/optimize.md**

```markdown
---
description: Review and apply pending .claudeignore suggestions from Tokimizer
---

# /tokimizer:optimize

Review Tokimizer's suggested `.claudeignore` additions and selectively apply them.

## Steps

1. Read the state directory for this project:
   - Global install: `~/.claude/tokimizer/<project-hash>/suggestions.txt`
   - Local install: `.claude/tokimizer/suggestions.txt`

2. If `suggestions.txt` is empty or missing, report:
   ```
   [Tokimizer] No suggestions pending. The system will generate candidates as sessions accumulate.
   ```
   Then stop.

3. For each line in `suggestions.txt`, display:
   - Path
   - `size_bytes` from `file-map.json` (formatted as KB)
   - `score` from `file-map.json` (rounded to 2 decimal places)
   - Days since `last_accessed`

   Example display:
   ```
   Ignore candidates:
   1. dist/bundle.js       — 488 KB, score: 0.02, last seen: 32 days ago
   2. .next/cache/         — 12 MB, score: 0.00, last seen: 45 days ago
   3. coverage/lcov-report/— 2.1 MB, score: 0.01, last seen: 12 days ago
   ```

4. Ask the user: "Approve all, approve individually, or skip? (all/individual/skip)"

5. On **all**: append every entry to `.claudeignore`, remove each from `file-map.json`, clear `suggestions.txt`.

6. On **individual**: present each entry one by one, ask "Add to .claudeignore? (y/n)", apply only approved ones.

7. On **skip**: do nothing, exit.

8. When adding to `.claudeignore`:
   - If `.claudeignore` does not exist, create it
   - Append each approved path on its own line
   - Do not add duplicates

9. Report: "Added N entries to .claudeignore."
```

- [ ] **Step 2: Commit**

```bash
git add commands/optimize.md
git commit -m "feat: add /tokimizer:optimize command"
```

---

### Task 12: commands/analyze.md

**Files:**
- Create: `commands/analyze.md`

- [ ] **Step 1: Write commands/analyze.md**

```markdown
---
description: Show token usage report and file scoring stats for this project
---

# /tokimizer:analyze

Display a full token usage and file scoring report for the current project.

## Steps

1. Locate `file-map.json` in the state directory (global or local, same detection as session-start).

2. If missing, report:
   ```
   [Tokimizer] No data yet. Run /tokimizer:reindex to initialize.
   ```
   Then stop.

3. Read `file-map.json`. Display the following report:

### Report Format

```
=== Tokimizer Analysis ===

Config:
  Context window:  200,000 tokens
  Budget:          35% → 70,000 tokens
  Project total:   94,000 tokens (tracked)
  Budget set:      2026-04-10

Coverage:
  Tracked files:   847
  Files in budget: ~320 (estimated at current scores)
  Pending ignores: 3 candidates in suggestions.txt

Top 10 files by score (highest value per token):
  #  File                          Score   Accesses  Edits  Tokens
  1  src/index.ts                  4.20    18        3      310
  2  src/api/auth.ts               3.10    12        2      420
  ...

Bottom 10 files by score (waste candidates):
  #  File                          Score   Size      Unseen sessions
  1  dist/bundle.js                0.02    488 KB    12
  2  coverage/report/index.html    0.01    2.1 MB    8
  ...
```

4. If `suggestions.txt` has entries, append: "Run /tokimizer:optimize to review ignore candidates."
```

- [ ] **Step 2: Commit**

```bash
git add commands/analyze.md
git commit -m "feat: add /tokimizer:analyze command"
```

---

### Task 13: commands/reindex.md

**Files:**
- Create: `commands/reindex.md`

- [ ] **Step 1: Write commands/reindex.md**

```markdown
---
description: Rebuild the file map from scratch and set token budget
---

# /tokimizer:reindex

Scan the full project, calculate total token cost, and let the user set a context budget. Run this on first use or after major project restructuring.

## Steps

1. Delete `file-map.json` and `session-buffer.json` from the state directory if they exist.

2. Glob all files from the project root. Respect `.claudeignore` if it exists. Exclude:
   - `.git/`
   - `.claude/tokimizer/`
   - `node_modules/`

3. For each file, calculate:
   - `size_bytes` via filesystem stat
   - `token_cost = ceil(size_bytes / 4)`

4. Sum all `token_cost` values → `project_total_tokens`.

5. Get the current context window size. Use 200,000 as default for Claude models. Store it.

6. Calculate budget options:
   - If `project_total_tokens <= context_window * 0.10`: report "Full project fits comfortably. Loading everything — no filtering needed." Set `token_budget_pct: 100`. Skip to step 9.
   - Otherwise present:

   ```
   Your project: N files → ~X tokens total
   Context window: 200,000 tokens

   Recommended budget options:
     A) Conservative 20% (~Y tokens) — fastest, highest precision
     B) Balanced     35% (~Z tokens) — recommended ✓
     C) Generous     50% (~W tokens) — more coverage, less filtering
     D) Custom: enter your own %

   Select (A/B/C/D):
   ```

7. Wait for user selection. For D, ask: "Enter percentage (1–80):"

8. Assign cold-start scores to all discovered files:
   ```
   score = 1 / ceil(size_bytes / 4)
   ```
   Build file entries with `access_count: 0`, `edit_count: 0`, `last_accessed: null`, `sessions_unseen: 0`, `co_access: []`.

9. Write `file-map.json` with:
   - All file entries
   - `config.token_budget_pct` = selected value
   - `config.project_total_tokens` = calculated total
   - `config.context_window` = 200000
   - `config.budget_set_at` = current ISO timestamp

10. Report:
    ```
    [Tokimizer] Indexed N files (~X tokens total).
    Budget: Y% → ~Z tokens per session (~M files estimated).
    Run /tokimizer:analyze to view the full breakdown.
    ```
```

- [ ] **Step 2: Commit**

```bash
git add commands/reindex.md
git commit -m "feat: add /tokimizer:reindex command with dynamic budget selection"
```

---

### Task 14: skills/tokimizer/SKILL.md

**Files:**
- Create: `skills/tokimizer/SKILL.md`

- [ ] **Step 1: Write skills/tokimizer/SKILL.md**

```markdown
# Tokimizer

Tokimizer is active. It has pre-loaded a ranked list of high-value files for this project into your session context (see the [Tokimizer] briefing above).

## How to use this

- **Before exploring the codebase:** Check the top files listed in the session briefing. Prefer those over blind directory scanning.
- **Before scanning a large directory:** Check if it appears in the ignore candidates list. If so, skip it unless the task specifically requires it.
- **When multiple files could answer a question:** Read the highest-scored one first.
- **Files listed as "Beyond budget":** They exist but are lower priority. Load them only if your current task requires them.

## Commands

| Command | Purpose |
|---------|---------|
| `/tokimizer:reindex` | Scan full project, set token budget (run once on first use) |
| `/tokimizer:analyze` | Show token usage report and file scores |
| `/tokimizer:optimize` | Review and apply .claudeignore suggestions |

## What Tokimizer does automatically

- Injects a project context briefing at session start (what you see above)
- Tracks which files you read and edit during each session
- Updates file scores after each response based on usage
- Detects large, unused files and queues them for ignore suggestions
- Re-injects briefing after context compaction

You do not need to call any commands unless you want to review scores or apply ignore suggestions.
```

- [ ] **Step 2: Commit**

```bash
git add skills/tokimizer/SKILL.md
git commit -m "feat: add SKILL.md behavioral guide"
```

---

### Task 15: Register plugin in Claude Code

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Read current settings.json**

```bash
cat ~/.claude/settings.json
```

- [ ] **Step 2: Add tokimizer to enabledPlugins**

In `~/.claude/settings.json`, add to the `enabledPlugins` block:

```json
"tokimizer": true
```

The `enabledPlugins` section should look like:
```json
"enabledPlugins": {
  "superpowers@claude-plugins-official": true,
  "tokimizer": true
}
```

- [ ] **Step 3: Register plugin install path**

First try the CLI (if local installs are supported):
```
/plugin install local:C:/Users/TopAide/projects/tokinizer
```

If the CLI command doesn't work, manually add tokimizer to `~/.claude/plugins/installed_plugins.json` under the `plugins` key:

```json
"tokimizer": [
  {
    "scope": "user",
    "installPath": "C:/Users/TopAide/projects/tokinizer",
    "version": "1.0.0",
    "installedAt": "<current ISO timestamp>",
    "lastUpdated": "<current ISO timestamp>"
  }
]
```

- [ ] **Step 4: Reload plugins in Claude Code**

In the Claude Code interface, run:

```
/reload-plugins
```

Expected output includes: tokimizer in the reloaded plugins list

- [ ] **Step 5: Verify SessionStart fires**

Start a new session or run `/clear`. You should see a `[Tokimizer]` line in the context.

If it shows "No file map yet. Run /tokimizer:reindex to initialize." — that is correct first-run behavior.

- [ ] **Step 6: Run /tokimizer:reindex**

```
/tokimizer:reindex
```

Follow the prompts to set your token budget.

- [ ] **Step 7: Commit final state**

```bash
git add .
git commit -m "feat: complete tokimizer v1.0.0 plugin"
```

---

## Spec Coverage Check

| Spec Section | Covered By |
|---|---|
| SessionStart briefing injection | Task 5 (session-start.js) |
| PostToolUse file tracking | Task 6 (track-access.js) |
| Stop batch flush + scoring | Task 7 (flush-scores.js) |
| PostCompact re-injection | Task 8 (post-compact.js) |
| SessionEnd safety net | Task 8 (session-end.js) |
| Recency decay formula | Task 3 (scoring.js) |
| Edit 3× multiplier | Task 7 (flush-scores.js) |
| Co-access tracking | Task 7 (flush-scores.js) |
| Token budget (dynamic) | Task 13 (reindex.md) |
| Cold-start scoring | Task 13 (reindex.md) |
| Entry point guarantee | Task 4 (briefing.js) |
| Beyond-budget visibility | Task 4 (briefing.js) |
| Suggest-only .claudeignore | Task 11 (optimize.md) |
| sessions_unseen counter | Task 7 (flush-scores.js) |
| Ignore candidate threshold | Task 7 (flush-scores.js) |
| Global vs local state scope | Task 2 (state.js) |
| /tokimizer:analyze | Task 12 |
| /tokimizer:reindex | Task 13 |
| /tokimizer:optimize | Task 11 |
| SKILL.md behavioral guide | Task 14 |
| plugin.json manifest | Task 10 |
| Zero external dependencies | Task 1 (package.json) |
