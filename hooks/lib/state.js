'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const GLOBAL_BASE = path.join(os.homedir(), '.claude', 'tokimizer');

// ---------------------------------------------------------------------------
// Project identity
// ---------------------------------------------------------------------------

/**
 * Return the UUID stored in `{cwd}/.claude/tokimizer/project-id`, or null.
 */
function readProjectId(cwd) {
  const idFile = path.join(cwd, '.claude', 'tokimizer', 'project-id');
  if (!fs.existsSync(idFile)) return null;
  return fs.readFileSync(idFile, 'utf8').trim() || null;
}

/**
 * Write a UUID to `{cwd}/.claude/tokimizer/project-id`.
 * Creates the directory if necessary.
 */
function writeProjectId(cwd, uuid) {
  const idDir = path.join(cwd, '.claude', 'tokimizer');
  fs.mkdirSync(idDir, { recursive: true });
  fs.writeFileSync(path.join(idDir, 'project-id'), uuid, 'utf8');
}

// ---------------------------------------------------------------------------
// State directory detection
// ---------------------------------------------------------------------------

/**
 * Resolve the state directory for `cwd`.
 *
 * State is always stored in the global base (`~/.claude/tokimizer/<uuid>/`).
 * The UUID is a stable project identity written to `{cwd}/.claude/tokimizer/project-id`
 * on first use — so it survives directory renames and path moves.
 *
 * Migration: if this is the first call for a project that previously used the
 * legacy cwd-hash approach, the old `file-map.json` is copied forward so no
 * scoring history is lost.
 */
function detectStateDir(cwd) {
  let uuid = readProjectId(cwd);
  let isFreshId = false;

  if (!uuid) {
    uuid = crypto.randomUUID();
    isFreshId = true;
    try {
      writeProjectId(cwd, uuid);
    } catch (e) {
      process.stderr.write(
        `[tokimizer] Warning: could not write project-id to ${cwd}/.claude/tokimizer/project-id: ${e.message}\n`
      );
      // Fallback: derive a key from the path — no persistence, but doesn't crash.
      uuid = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8);
      isFreshId = false;
    }
  }

  const globalDir = path.join(GLOBAL_BASE, uuid);
  fs.mkdirSync(globalDir, { recursive: true });

  // One-time migration from the legacy cwd-hash state directory.
  if (isFreshId) {
    const legacyHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8);
    const legacyFileMap = path.join(GLOBAL_BASE, legacyHash, 'file-map.json');
    if (fs.existsSync(legacyFileMap)) {
      try {
        fs.copyFileSync(legacyFileMap, path.join(globalDir, 'file-map.json'));
        process.stderr.write('[tokimizer] Migrated state from legacy path-hash to stable project ID.\n');
      } catch (_) { /* best-effort */ }
    }
  }

  return globalDir;
}

// ---------------------------------------------------------------------------
// Generic JSON helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// File-map
// ---------------------------------------------------------------------------

function readFileMap(stateDir) {
  return readJson(path.join(stateDir, 'file-map.json'));
}

function writeFileMap(stateDir, data) {
  writeJson(path.join(stateDir, 'file-map.json'), data);
}

// ---------------------------------------------------------------------------
// Session buffer
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function readSuggestions(stateDir) {
  const p = path.join(stateDir, 'suggestions.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => {
    const pipeIdx = line.indexOf('|');
    if (pipeIdx === -1) return { path: line, addedAt: null };
    return { path: line.slice(0, pipeIdx), addedAt: line.slice(pipeIdx + 1) };
  });
}

function appendSuggestions(stateDir, candidates) {
  const existing = new Set(readSuggestions(stateDir).map(e => e.path));
  const newOnes = candidates.filter(c => !existing.has(c));
  if (newOnes.length === 0) return;
  const now = new Date().toISOString();
  const lines = newOnes.map(c => `${c}|${now}`).join('\n') + '\n';
  fs.appendFileSync(path.join(stateDir, 'suggestions.txt'), lines);
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
