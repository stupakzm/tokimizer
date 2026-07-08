#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const {
  detectStateDir, readFileMap, writeFileMap, clearSessionBuffer
} = require('./lib/state');
const { calcTokenCost, coldStartScore } = require('./lib/scoring');
const { readClaudeIgnore, walkFiles } = require('./lib/walker');

/**
 * Core reindex function. Scans `cwd`, builds a fresh file-map.json, and
 * clears the session buffer. Returns the summary string.
 *
 * When `budgetPct` is omitted (defaults to 35), the existing file-map's
 * `config.token_budget_pct` is preserved so that a plain `reindex` run
 * does not silently reset a custom budget.
 *
 * @param {string} cwd        Absolute path to the project root.
 * @param {number} [budgetPct]  Integer 1–80. Omit to inherit from existing map.
 * @returns {string}          The summary line.
 */
function reindex(cwd, budgetPct) {
  const stateDir = detectStateDir(cwd);

  // Determine effective budget: explicit arg → existing config → fallback 35
  let budget;
  if (Number.isInteger(budgetPct)) {
    budget = budgetPct;
  } else {
    const existing = readFileMap(stateDir);
    budget = (existing && existing.config && Number.isInteger(existing.config.token_budget_pct))
      ? existing.config.token_budget_pct
      : 35;
  }

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

  return summary;
}

// CLI entry point — only runs when executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let budgetPct; // undefined means "inherit from existing file-map"

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

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write('[Tokimizer] Error: cwd does not exist or is not a directory: ' + cwd + '\n');
    process.exit(1);
  }

  const summary = reindex(cwd, budgetPct);
  process.stdout.write(summary + '\n');
}

module.exports = { reindex };
