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
