---
description: Show token usage report and file scoring stats for this project
---

# /tokimizer:analyze

Display a full token usage and file scoring report for the current project.

## Steps

1. Locate `file-map.json` in the state directory (global or local, same detection as session-start).

2. If missing, report:
   ```
   [Tokimizer] No data yet. Run /tokimizer:reindex to initialize.
   ```
   Then stop.

3. Read `file-map.json`. Display the following report:

### Report Format

```
=== Tokimizer Analysis ===

Config:
  Context window:  200,000 tokens
  Budget:          35% → 70,000 tokens
  Project total:   94,000 tokens (tracked)
  Budget set:      2026-04-10

Coverage:
  Tracked files:   847
  Files in budget: ~320 (estimated at current scores)
  Pending ignores: 3 candidates in suggestions.txt

Top 10 files by score (highest value per token):
  #  File                          Score   Accesses  Edits  Tokens
  1  src/index.ts                  4.20    18        3      310
  2  src/api/auth.ts               3.10    12        2      420
  ...

Bottom 10 files by score (waste candidates):
  #  File                          Score   Size      Unseen sessions
  1  dist/bundle.js                0.02    488 KB    12
  2  coverage/report/index.html    0.01    2.1 MB    8
  ...
```

4. If `suggestions.txt` has entries, append: "Run /tokimizer:optimize to review ignore candidates."
