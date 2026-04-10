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

  // If no buffer at all, nothing to do
  if (!buffer) return;

  const fileMap = readFileMap(stateDir) || { version: 1, config: {}, files: {} };
  const files = fileMap.files;

  // If buffer is empty, still check existing files for ignore candidates then clean up
  if (!buffer.accesses || buffer.accesses.length === 0) {
    const candidates = Object.entries(files)
      .filter(([, e]) =>
        e.score < 0.1 &&
        e.size_bytes > 20000 &&
        (e.sessions_unseen || 0) >= 5
      )
      .map(([p]) => p);
    if (candidates.length > 0) appendSuggestions(stateDir, candidates);
    clearSessionBuffer(stateDir);
    return;
  }

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
