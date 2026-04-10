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
