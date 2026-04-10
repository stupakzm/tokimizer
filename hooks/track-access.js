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
