'use strict';
const fs = require('fs');
const path = require('path');

const HARD_EXCLUDES = ['.git/', 'node_modules/', '.claude/'];

// Files that are always excluded regardless of .claudeignore
const HARD_EXCLUDE_FILES = ['.claudeignore'];

/**
 * Read .claudeignore from cwd and return an array of non-empty, non-comment patterns.
 * Returns [] if the file does not exist or cannot be read.
 * @param {string} cwd
 * @returns {string[]}
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
 * Convert a glob pattern to a RegExp.
 * Supports:
 *   `**`  → matches any sequence of characters including path separators
 *   `*`   → matches any sequence of characters within a single path segment
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  let regexStr = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      regexStr += '[\\s\\S]*';
      i++; // consume second *
      // consume optional trailing slash so `**/foo` works
      if (pattern[i + 1] === '/') { regexStr += '/?'; i++; }
    } else if (ch === '*') {
      regexStr += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
  }
  return new RegExp('^' + regexStr + '$');
}

/**
 * Returns true if the relative path should be excluded based on ignore patterns.
 * Pattern semantics:
 *   trailing `/`  → directory prefix match
 *   `**`          → multi-segment wildcard, matched against full relative path
 *   `*`           → single-segment wildcard, matched against full path and basename
 *   contains `/`  → path-anchored prefix or exact match
 *   bare string   → basename or exact match
 * @param {string} relPath  forward-slash relative path
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesIgnore(relPath, patterns) {
  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
      // Directory prefix: e.g. "dist/"
      const dir = pattern.slice(0, -1);
      if (relPath === dir || relPath.startsWith(dir + '/')) return true;
    } else if (pattern.includes('**')) {
      // Multi-segment glob: match against full relative path
      if (globToRegex(pattern).test(relPath)) return true;
    } else if (pattern.includes('*')) {
      // Single-segment glob: match full path or basename
      const regex = globToRegex(pattern);
      if (regex.test(relPath)) return true;
      const basename = relPath.includes('/')
        ? relPath.slice(relPath.lastIndexOf('/') + 1)
        : relPath;
      if (regex.test(basename)) return true;
    } else if (pattern.includes('/')) {
      // Path-anchored literal: exact or directory prefix
      if (relPath === pattern || relPath.startsWith(pattern + '/')) return true;
    } else {
      // Bare name: match basename or exact path
      const basename = relPath.includes('/')
        ? relPath.slice(relPath.lastIndexOf('/') + 1)
        : relPath;
      if (basename === pattern || relPath === pattern) return true;
    }
  }
  return false;
}

/**
 * Recursively walk `dir` and yield `{rel, abs}` for each file.
 * Skips hard-excluded directories and paths matching ignorePatterns.
 * Follows symlinked directories (supports Windows junction points).
 *
 * @param {string} dir           current directory being walked (absolute)
 * @param {string} rootCwd       project root (absolute)
 * @param {string[]} ignorePatterns  patterns from .claudeignore
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

    // Hard-exclude specific files (.claudeignore itself)
    if (HARD_EXCLUDE_FILES.includes(entry.name)) continue;

    // Hard-exclude known noisy directories
    if (HARD_EXCLUDES.some(ex => {
      const prefix = ex.slice(0, -1); // strip trailing slash
      return rel === prefix || rel.startsWith(prefix + '/');
    })) continue;

    // .claudeignore exclusion
    if (matchesIgnore(rel, ignorePatterns)) continue;

    // Determine if this is a traversable directory, including Windows junctions
    const isDir = entry.isDirectory() ||
      (entry.isSymbolicLink() && (() => {
        try { return fs.statSync(abs).isDirectory(); } catch (_) { return false; }
      })());

    if (isDir) {
      yield* walkFiles(abs, rootCwd, ignorePatterns);
    } else if (entry.isFile()) {
      yield { rel, abs };
    }
  }
}

module.exports = { HARD_EXCLUDES, readClaudeIgnore, globToRegex, matchesIgnore, walkFiles };
