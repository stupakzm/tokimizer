'use strict';
const fs = require('fs');
const path = require('path');
const { coldStartScore } = require('./scoring');
const { readClaudeIgnore, walkFiles } = require('./walker');

/**
 * Build a cold-start file map for the given project root.
 * Globs all files, excludes noise, stats each file, and computes cold-start scores.
 *
 * NOTE: All internal I/O is synchronous. The function signature is synchronous
 * to match actual behaviour — callers do not need to await it.
 *
 * @param {string} cwd  absolute path to project root
 * @returns {{version: number, config: object, last_updated: string, files: object}}
 */
function buildColdStartFileMap(cwd) {
  const ignorePatterns = readClaudeIgnore(cwd);

  const files = {};
  for (const { rel, abs } of walkFiles(cwd, cwd, ignorePatterns)) {
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(abs).size;
    } catch (_) {
      // File disappeared between walk and stat — skip it
      continue;
    }
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

  return {
    version: 1,
    config: {
      token_budget_pct: 35,
      context_window: 200000
    },
    last_updated: new Date().toISOString(),
    files
  };
}

module.exports = { buildColdStartFileMap };
