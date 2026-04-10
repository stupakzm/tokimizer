# Tokimizer — Design Spec
**Date:** 2026-04-10  
**Status:** Approved  

---

## 1. Purpose

Tokimizer is a standalone Claude Code plugin that learns which files matter in a project and uses that knowledge to minimize token usage without losing functionality. It tracks file access across sessions, scores files by token efficiency, injects a compact context briefing at session start, and suggests `.claudeignore` updates based on observed usage.

Goals:
- Eliminate blind codebase exploration at session start
- Reduce token usage 60–90% on repeat sessions
- Improve Claude's precision by giving it better, learned context
- Require zero configuration to start working

---

## 2. Architecture

```
tokimizer/
├── plugin.json
├── hooks/
│   ├── hooks.json
│   ├── session-start.js     # inject briefing as additionalContext
│   ├── track-access.js      # buffer file accesses per tool call
│   ├── flush-scores.js      # batch flush buffer → update scores on Stop
│   ├── post-compact.js      # re-inject briefing after context compaction
│   └── session-end.js       # safety-net flush on SessionEnd
├── commands/
│   ├── optimize.md          # /tokimizer:optimize
│   ├── analyze.md           # /tokimizer:analyze
│   └── reindex.md           # /tokimizer:reindex
└── skills/
    └── tokimizer/
        └── SKILL.md         # background behavioral guide
```

**No superpowers dependency.** Works as a standalone plugin alongside any other plugins or skills.

---

## 3. State

State location mirrors the plugin install scope:

| Install scope | State path |
|---------------|-----------|
| Global (`~/.claude/`) | `~/.claude/tokimizer/<project-hash>/` |
| Local (`.claude/`) | `.claude/tokimizer/` |

`<project-hash>` is a short SHA of the project's `cwd` path, ensuring per-project isolation under a global install.

### 3.1 `file-map.json`

Primary scored index of all observed files.

```json
{
  "version": 1,
  "project_hash": "a3f9c2",
  "last_updated": "2026-04-10T10:45:00Z",
  "config": {
    "token_budget_pct": 35,
    "project_total_tokens": 94000,
    "context_window": 200000,
    "budget_set_at": "2026-04-10T10:45:00Z"
  },
  "files": {
    "src/index.ts": {
      "score": 4.2,
      "access_count": 18,
      "edit_count": 3,
      "last_accessed": "2026-04-10T09:12:00Z",
      "size_bytes": 1240,
      "sessions_unseen": 0,
      "co_access": ["src/server.ts", "src/api/auth.ts"]
    }
  }
}
```

### 3.2 `session-buffer.json`

Ephemeral. Holds accesses for the current session. Flushed to `file-map.json` on Stop or SessionEnd.

```json
{
  "session_id": "abc123",
  "accesses": [
    { "path": "src/index.ts", "type": "read", "ts": 1744000000 },
    { "path": "src/api/auth.ts", "type": "edit", "ts": 1744000010 }
  ]
}
```

### 3.3 `suggestions.txt`

Line-delimited list of `.claudeignore` candidates pending user review.  
Never auto-applied. Cleared after `/tokimizer:optimize` is run.

---

## 4. Scoring

### Formula

```
base_score  = (access_count + edit_count × 3) × recency_decay
token_cost  = size_bytes / 4
score       = base_score / token_cost
```

**Recency decay:** `0.95 ^ days_since_last_access`  
A file untouched for 14 days is at ~49% of its peak score. Files naturally deprioritize themselves without any manual curation.

**Edit multiplier:** Files Claude writes or edits receive 3× weight vs reads. Edits are higher signal — Claude was actively working in that file.

**Co-access bonus:** +10% score applied at context-load time when a co-accessed file is already within the token budget window.

### Cold start

On first run, `file-map.json` is empty. Cold-start score defaults to:

```
score = 1 / token_cost
```

Smallest files load first. Real signal accumulates from the first session onward. No user prompting, no hardcoded filename heuristics.

### Token budget

Determined dynamically on first run (or `/tokimizer:reindex`) by scanning the full project:

1. Glob all files (respecting `.claudeignore`)
2. Sum `size_bytes / 4` → **actual project token cost**
3. Compare against context window size
4. Present the user with a recommendation:

```
Your project: 847 files → ~94,000 tokens total
Context window: 200,000 tokens

Recommended budget options:
  A) Conservative 20% (~18,000 tokens) — fastest, highest precision
  B) Balanced     35% (~33,000 tokens) — recommended ✓
  C) Generous     50% (~47,000 tokens) — more coverage, less filtering
  D) Custom: enter your own %
```

If the full project fits comfortably in context, skip filtering entirely:

```
Your project: 42 files → ~8,200 tokens total
Context window: 200,000 tokens
→ Full project fits in 4% of context. Loading everything — no filtering needed.
```

The selected `token_budget_pct` is stored in `file-map.json` config and used for all subsequent sessions. User can re-run `/tokimizer:reindex` at any time to recalculate as the project grows.

---

## 5. Hook Behaviors

### 5.1 `SessionStart` → `session-start.js`

1. Detect state dir (global vs local scope via `cwd` + presence of `.claude/tokimizer/`)
2. Load `file-map.json`; if absent, initialize with cold-start scores via Glob
3. Sort files by score descending, walk until token budget is reached
4. Apply co-access bonus for files already in the loaded set
5. Output as `additionalContext`:

```
[Tokimizer] Context loaded: 12 files, ~8,400 tokens (28% of budget)
Top files: src/index.ts (4.2), src/api/auth.ts (3.1), src/config.ts (2.8)
Ignore candidates pending review: dist/, .next/ — run /tokimizer:optimize
```

6. Initialize empty `session-buffer.json` with current session ID

### 5.2 `PostToolUse` → `track-access.js`

**Matcher:** `Read|Glob|Grep|Write|Edit`

- Extract file path(s) from tool input JSON
- Append to `session-buffer.json` with type (`read` or `edit`) and Unix timestamp
- Never touches `file-map.json` — buffer only, no disk I/O beyond the buffer append

### 5.3 `Stop` → `flush-scores.js`

1. Read `session-buffer.json`; exit cleanly if empty
2. Apply recency decay to all existing scores in `file-map.json`
3. Merge session accesses: increment `access_count`/`edit_count`, update `last_accessed`
4. Update `co_access` arrays for files accessed in the same session
5. Recalculate scores
6. Increment `sessions_unseen` for files not accessed this session; reset to 0 for files that were
7. Identify ignore candidates: `score < 0.1` AND `size_bytes > 20000` AND `sessions_unseen >= 5`
8. Append new candidates to `suggestions.txt` (no duplicates)
9. Write updated `file-map.json`
10. Clear `session-buffer.json`

### 5.4 `PostCompact` → `post-compact.js`

Runs identical briefing logic as `session-start.js` step 3–5.  
Adds prefix: `[Tokimizer] Context re-loaded after compaction`  
Does not reinitialize `session-buffer.json` (session is still active).

### 5.5 `SessionEnd` → `session-end.js`

- Check if `session-buffer.json` is non-empty
- If so, run flush logic from `flush-scores.js`
- Safety net only — no duplicate work if buffer is already empty

---

## 6. Slash Commands

### `/tokimizer:optimize`

1. Read `suggestions.txt`
2. For each candidate, display: path, size, score, days since last access
3. Ask: approve all / approve individually / skip
4. On approval: append entries to `.claudeignore`, remove from `file-map.json`, clear `suggestions.txt`
5. Report: N entries added to `.claudeignore`

### `/tokimizer:analyze`

Report includes:
- Top 10 files by score (name, score, access count, token cost)
- Bottom 10 files by score (waste candidates)
- Total tracked files, total unique sessions
- Estimated tokens loaded last session vs budget
- Budget utilization % and config values

### `/tokimizer:reindex`

1. Delete `file-map.json` and `session-buffer.json`
2. Glob all files across project root (respecting existing `.claudeignore`)
3. Sum total project token cost (`size_bytes / 4`)
4. Detect context window size from session data
5. Present budget recommendation (Conservative / Balanced / Generous / Custom)
6. Wait for user selection
7. Assign cold-start scores (`1 / token_cost`) to all discovered files
8. Write fresh `file-map.json` with selected `token_budget_pct` and project totals
9. Report: N files indexed, total project tokens, selected budget, estimated files per session

---

## 7. SKILL.md Behavioral Guide

Loaded as background context when the plugin is active. Kept under 60 lines.

Instructs Claude to:
- Read `file-map.json` before exploring unfamiliar directories
- Prefer high-score files when multiple candidates exist for a task
- Never scan large directories without first checking `suggestions.txt`
- Respond to `/tokimizer:*` commands using the command docs
- Treat the SessionStart briefing as the authoritative starting point for project orientation

---

## 8. `plugin.json`

```json
{
  "name": "tokimizer",
  "version": "1.0.0",
  "description": "Self-learning context optimizer. Tracks file usage, scores by token efficiency, injects smart briefings at session start.",
  "hooks": "hooks/hooks.json",
  "commands": "commands/",
  "skills": "skills/"
}
```

---

## 9. Non-Goals

- No semantic/embedding-based ranking (v1 stays purely usage-based)
- No Bash command parsing for `cat`/`ls`/`find` (v2)
- No cloud sync of state between machines
- No automatic `.claudeignore` writes — always suggest-only

---

## 10. Future Extensions (Post v1)

- **Bash coverage:** parse Bash tool inputs for file access patterns (`cat`, `find`, `ls`)
- **Embedding ranking:** semantic similarity boost for task-relevant files
- **CLI wrapper:** `tokimizer run "fix auth bug"` that pre-injects context before spawning Claude
- **Git-aware signals:** boost files modified in recent commits
- **Status bar usage indicator:** live progress bar in the Claude Code status line (the bar under the input field showing model, project folder, etc.) displaying current session token usage vs selected budget — e.g. `tokimizer ▓▓▓▓▓░░░░░ 47%` — implemented as a `statusLine` command hook alongside the existing GSD statusline
