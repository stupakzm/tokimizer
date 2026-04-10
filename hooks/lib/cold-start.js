'use strict';
const fs = require('fs');
const path = require('path');
const { coldStartScore } = require('./scoring');

const HARD_EXCLUDES = ['.git/', 'node_modules/', '.claude/tokimizer/'];

/**
 * Read .claudeignore from cwd and return an array of non-empty, non-comment patterns.
 * @param {string} cwd
 * @returns {string[]}
 */
function readClaudeIgnore(cwd) {
  const ignoreFile = path.join(cwd, '.claudeignore');
  if (!fs.existsSync(ignoreFile)) return [];
  return fs.readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Returns true if the relative path should be excluded.
 * Checks hard-coded exclusions first, then .claudeignore patterns.
 * A pattern ending in '/' matches any file whose path starts with it.
 * A pattern without '/' (e.g. "*.log") is matched against the basename only.
 * A pattern containing '/' (but not trailing-slash-only) is matched as a
 * prefix or exact substring from the start of the relative path.
 * @param {string} relPath  forward-slash relative path
 * @param {string[]} ignorePatterns
 * @returns {boolean}
 */
function shouldExclude(relPath, ignorePatterns) {
  // Hard excludes
  for (const prefix of HARD_EXCLUDES) {
    if (relPath.startsWith(prefix)) return true;
  }
  // .claudeignore patterns
  for (const pattern of ignorePatterns) {
    if (pattern.endsWith('/')) {
      // Directory prefix pattern: e.g. "dist/"
      if (relPath.startsWith(pattern)) return true;
    } else if (pattern.includes('/')) {
      // Path-anchored pattern: match as prefix of relPath
      if (relPath.startsWith(pattern) || relPath === pattern) return true;
    } else {
      // Basename pattern: e.g. "*.log", "secret.txt"
      const basename = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      if (matchGlobPattern(pattern, basename)) return true;
    }
  }
  return false;
}

/**
 * Minimal glob matcher that supports only '*' wildcards (no '**').
 * Sufficient for common .claudeignore patterns like "*.log".
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
function matchGlobPattern(pattern, str) {
  // Escape regex special chars except '*'
  const regexStr = pattern
    .split('*')
    .map(part => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regexStr}$`).test(str);
}

/**
 * Recursively walk a directory and yield relative file paths (forward slashes).
 * @param {string} cwd  absolute root
 * @param {string} dir  current directory being walked (absolute)
 * @param {string[]} ignorePatterns
 * @returns {string[]}  array of relative paths with forward slashes
 */
function walkDir(cwd, dir, ignorePatterns) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    // Compute relative path with forward slashes
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      // Apply directory-level exclusion (append '/' for prefix check)
      if (shouldExclude(rel + '/', ignorePatterns)) continue;
      results = results.concat(walkDir(cwd, abs, ignorePatterns));
    } else if (entry.isFile()) {
      if (!shouldExclude(rel, ignorePatterns)) {
        results.push(rel);
      }
    }
  }
  return results;
}

/**
 * Build a cold-start file map for the given project root.
 * Globs all files, excludes noise, stats each file, and computes cold-start scores.
 *
 * @param {string} cwd  absolute path to project root
 * @returns {Promise<{version: number, config: object, files: object}>}
 */
async function buildColdStartFileMap(cwd) {
  const ignorePatterns = readClaudeIgnore(cwd);
  const relPaths = walkDir(cwd, cwd, ignorePatterns);

  const files = {};
  for (const relPath of relPaths) {
    const abs = path.join(cwd, relPath);
    let sizeBytes = 0;
    try {
      const stat = fs.statSync(abs);
      sizeBytes = stat.size;
    } catch (_) {
      // File disappeared between walk and stat — skip it
      continue;
    }
    files[relPath] = {
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
    files
  };
}

module.exports = { buildColdStartFileMap };
