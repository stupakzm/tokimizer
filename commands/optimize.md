---
description: Review and apply pending .claudeignore suggestions from Tokimizer
---

# /tokimizer:optimize

Review Tokimizer's suggested `.claudeignore` additions and selectively apply them.

## Steps

1. Read the state directory for this project:
   - Global install: `~/.claude/tokimizer/<project-hash>/suggestions.txt`
   - Local install: `.claude/tokimizer/suggestions.txt`

2. If `suggestions.txt` is empty or missing, report:
   ```
   [Tokimizer] No suggestions pending. The system will generate candidates as sessions accumulate.
   ```
   Then stop.

3. For each line in `suggestions.txt`, display:
   - Path
   - `size_bytes` from `file-map.json` (formatted as KB)
   - `score` from `file-map.json` (rounded to 2 decimal places)
   - Days since `last_accessed`

   Example display:
   ```
   Ignore candidates:
   1. dist/bundle.js       — 488 KB, score: 0.02, last seen: 32 days ago
   2. .next/cache/         — 12 MB, score: 0.00, last seen: 45 days ago
   3. coverage/lcov-report/— 2.1 MB, score: 0.01, last seen: 12 days ago
   ```

4. Ask the user: "Approve all, approve individually, or skip? (all/individual/skip)"

5. On **all**: append every entry to `.claudeignore`, remove each from `file-map.json`, clear `suggestions.txt`.

6. On **individual**: present each entry one by one, ask "Add to .claudeignore? (y/n)", apply only approved ones.

7. On **skip**: do nothing, exit.

8. When adding to `.claudeignore`:
   - If `.claudeignore` does not exist, create it
   - Append each approved path on its own line
   - Do not add duplicates

9. Report: "Added N entries to .claudeignore."
