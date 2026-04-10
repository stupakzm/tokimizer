---
description: Show a quick status summary — plugin state, last flush, budget, and pending actions
---

# /tokimizer:status

Show a concise status snapshot for Tokimizer: whether the plugin is active, where state is stored, when scores were last flushed, current token budget, session buffer activity, and any pending ignore suggestions.

## Steps

1. Locate the state directory using the same global/local detection logic as session-start:
   - Check `.claude/settings.json` in the project root for `enabledPlugins.tokimizer: true`.
   - If found, the state directory is `.claude/tokimizer/` (local install).
   - Otherwise the state directory is `~/.claude/tokimizer/<project-hash>/` (global install).

2. If `file-map.json` does not exist in the state directory, report:
   ```
   [Tokimizer] Not initialized. Run /tokimizer:reindex to set up this project.
   ```
   Then stop.

3. Read `file-map.json`. Extract:
   - `config.token_budget_pct` — budget percentage (e.g. `35`)
   - `config.context_window` — context window size (e.g. `200000`)
   - `config.project_total_tokens` — total indexed tokens
   - `last_updated` — ISO timestamp of the last score flush
   - Count of keys in the `files` object — number of tracked files

4. Read `session-buffer.json` if it exists. Extract the length of the `accesses` array. If the file does not exist, treat access count as 0 and mark the buffer as empty.

5. Read `suggestions.txt` if it exists. Count the non-empty lines. If the file does not exist or is empty, pending count is 0.

6. Compute derived values:
   - `budget_tokens = floor(config.context_window * config.token_budget_pct / 100)`
   - `time_ago` — human-readable elapsed time since `last_updated` (e.g. "3 hours ago", "2 days ago")

7. Display the formatted status block:

```
=== Tokimizer Status ===

Plugin:   active
State:    ~/.claude/tokimizer/a3f9c2/ (global)
          — or —
State:    .claude/tokimizer/ (local)

Last flush:    2026-04-10 09:12 UTC (3 hours ago)
Files tracked: 847
Budget:        35% of 200,000 tokens → ~70,000 tokens/session

Session buffer: active (12 accesses buffered)
              — or —
Session buffer: empty

Pending ignores: 3 candidates (run /tokimizer:optimize)
              — or —
Pending ignores: none
```

Use the actual values read from the files, not the example values above. Show the "global" or "local" label to match the detected install type. Show the "active (N accesses buffered)" variant when access count > 0, and "empty" when access count is 0 or the file is missing. Show the "N candidates (run /tokimizer:optimize)" variant when pending count > 0, and "none" when pending count is 0.
