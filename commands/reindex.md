---
description: Rebuild the file map from scratch and set token budget
---

# /tokimizer:reindex

Scan the full project, calculate total token cost, and let the user set a context budget. Run this on first use or after major project restructuring.

## Steps

1. Delete `file-map.json` and `session-buffer.json` from the state directory if they exist.

2. Glob all files from the project root. Respect `.claudeignore` if it exists. Exclude:
   - `.git/`
   - `.claude/tokimizer/`
   - `node_modules/`

3. For each file, calculate:
   - `size_bytes` via filesystem stat
   - `token_cost = ceil(size_bytes / 4)`

4. Sum all `token_cost` values → `project_total_tokens`.

5. Get the current context window size. Use 200,000 as default for Claude models. Store it.

6. Calculate budget options:
   - If `project_total_tokens <= context_window * 0.10`: report "Full project fits comfortably. Loading everything — no filtering needed." Set `token_budget_pct: 100`. Skip to step 9.
   - Otherwise present:

   ```
   Your project: N files → ~X tokens total
   Context window: 200,000 tokens

   Recommended budget options:
     A) Conservative 20% (~Y tokens) — fastest, highest precision
     B) Balanced     35% (~Z tokens) — recommended ✓
     C) Generous     50% (~W tokens) — more coverage, less filtering
     D) Custom: enter your own %

   Select (A/B/C/D):
   ```

7. Wait for user selection. For D, ask: "Enter percentage (1–80):"

8. Assign cold-start scores to all discovered files:
   ```
   score = 1 / ceil(size_bytes / 4)
   ```
   Build file entries with `access_count: 0`, `edit_count: 0`, `last_accessed: null`, `sessions_unseen: 0`, `co_access: []`.

9. Write `file-map.json` with:
   - All file entries
   - `config.token_budget_pct` = selected value
   - `config.project_total_tokens` = calculated total
   - `config.context_window` = 200000
   - `config.budget_set_at` = current ISO timestamp

10. Report:
    ```
    [Tokimizer] Indexed N files (~X tokens total).
    Budget: Y% → ~Z tokens per session (~M files estimated).
    Run /tokimizer:analyze to view the full breakdown.
    ```
