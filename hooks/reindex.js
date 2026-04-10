#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const {
  detectStateDir, writeFileMap, clearSessionBuffer
} = require('./lib/state');
const { calcTokenCost, coldStartScore } = require('./lib/scoring');

const HARD_EXCLUDES = ['.git/', 'node_modules/', '.claude/tokimizer/'];

/**
 * Read .claudeignore from cwd and return an array of raw pattern strings.
 * Returns [] if the file does not exist or cannot be read.
 */
function readClaudeIgnore(cwd) {
  const p = path.join(cwd, '.claudeignore');
  if (!fs.existsSync(p)) return [];
  try {
    return fs.readFileSync(p, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
  } catch (_) {
    return [];
  }
}

/**
 * Return true if the relative path should be excluded based on the given
 * .claudeignore patterns.  Supports:
 *   - trailing-slash patterns  → match the path as a directory prefix
 *   - glob wildcard `*`        → match within a single path segment
 *   - bare strings             → exact match or prefix match
 */
function matchesIgnore(relPath, patterns) {
  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
      // directory prefix pattern, e.g. "dist/"
      const dir = pattern.slice(0, -1);
      if (relPath === dir || relPath.startsWith(dir + '/')) return true;
    } else if (pattern.includes('*')) {
      // simple glob: convert to regex where * matches anything except /
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regexStr = escaped.replace(/\*/g, '[^/]*');
      const regex = new RegExp('^' + regexStr + '$');
      // match against the basename or the full relative path
      if (regex.test(relPath) || regex.test(path.basename(relPath))) return true;
    } else {
      // exact or prefix match
      if (relPath === pattern || relPath.startsWith(pattern + '/')) return true;
    }
  }
  return false;
}

/**
 * Recursively walk `dir` and yield paths relative to `rootCwd`.
 * Skips hard-excluded directories and any path matching ignorePatterns.
 */
function* walkFiles(dir, rootCwd, ignorePatterns) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(rootCwd, abs).replace(/\\/g, '/');

    // Check hard excludes — test as directory prefixes
    if (HARD_EXCLUDES.some(ex => rel === ex.slice(0, -1) || rel.startsWith(ex.slice(0, -1) + '/'))) {
      continue;
    }

    // Check .claudeignore patterns
    if (matchesIgnore(rel, ignorePatterns)) continue;

    if (entry.isDirectory()) {
      yield* walkFiles(abs, rootCwd, ignorePatterns);
    } else if (entry.isFile()) {
      yield { rel, abs };
    }
  }
}

/**
 * Core reindex function. Scans `cwd`, builds a fresh file-map.json, and
 * clears the session buffer. Returns the summary string that was printed.
 *
 * @param {string} cwd        Absolute path to the project root.
 * @param {number} budgetPct  Integer 1–80 (default 35).
 * @returns {string}          The summary line written to stdout.
 */
function reindex(cwd, budgetPct) {
  const budget = Number.isInteger(budgetPct) ? budgetPct : 35;
  const stateDir = detectStateDir(cwd);

  // Delete stale state
  const fileMapPath = path.join(stateDir, 'file-map.json');
  if (fs.existsSync(fileMapPath)) fs.unlinkSync(fileMapPath);
  clearSessionBuffer(stateDir);

  const ignorePatterns = readClaudeIgnore(cwd);

  const files = {};
  let projectTotalTokens = 0;

  for (const { rel, abs } of walkFiles(cwd, cwd, ignorePatterns)) {
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(abs).size;
    } catch (_) {
      continue;
    }
    const tokenCost = calcTokenCost(sizeBytes);
    projectTotalTokens += tokenCost;
    files[rel] = {
      score: coldStartScore(sizeBytes),
      access_count: 0,
      edit_count: 0,
      last_accessed: null,
      size_bytes: sizeBytes,
      sessions_unseen: 0,
      co_access: []
    };
  }

  const now = new Date().toISOString();
  const fileMap = {
    version: 1,
    config: {
      token_budget_pct: budget,
      project_total_tokens: projectTotalTokens,
      context_window: 200000,
      budget_set_at: now
    },
    last_updated: now,
    files
  };

  writeFileMap(stateDir, fileMap);

  const fileCount = Object.keys(files).length;
  const totalRounded = Math.round(projectTotalTokens / 1000) * 1000;
  const budgetTokens = Math.round(200000 * budget / 100 / 1000) * 1000;
  const summary = [
    `[Tokimizer] Indexed ${fileCount} files (~${totalRounded.toLocaleString()} tokens total).`,
    `Budget: ${budget}% → ~${budgetTokens.toLocaleString()} tokens per session.`,
    `Run /tokimizer:analyze to view the full breakdown.`
  ].join('\n');

  process.stdout.write(summary + '\n');
  return summary;
}

// CLI entry point — only runs when executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let budgetPct = 35;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = path.resolve(args[++i]);
    } else if (args[i] === '--budget' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 80) {
        budgetPct = parsed;
      } else {
        process.stderr.write('[Tokimizer] --budget must be an integer between 1 and 80. Using default 35.\n');
      }
    }
  }

  reindex(cwd, budgetPct);
}

module.exports = { reindex };
