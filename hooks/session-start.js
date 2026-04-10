#!/usr/bin/env node
'use strict';
const { detectStateDir, readFileMap, readSuggestions, writeFileMap, writeSessionBuffer } = require('./lib/state');
const { generateBriefing } = require('./lib/briefing');
const { buildColdStartFileMap } = require('./lib/cold-start');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  (async () => {
    try {
      const data = JSON.parse(input);
      const cwd = data.cwd || process.cwd();
      const sessionId = data.session_id || 'unknown';

      const stateDir = detectStateDir(cwd);
      let fileMap = readFileMap(stateDir);
      const suggestions = readSuggestions(stateDir);

      if (fileMap === null) {
        fileMap = await buildColdStartFileMap(cwd);
        writeFileMap(stateDir, fileMap);
      }

      let briefing = generateBriefing(fileMap);
      if (suggestions.length > 0) {
        briefing += `\nIgnore candidates pending review: ${suggestions.length} entries — run /tokimizer:optimize`;
      }

      // Initialize fresh session buffer
      writeSessionBuffer(stateDir, { session_id: sessionId, accesses: [] });

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: briefing
        }
      }));
    } catch (_) {
      process.exit(0);
    }
  })();
});
