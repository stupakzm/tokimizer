# Tokimizer

A self-learning Claude Code plugin that tracks which files matter in your project and injects a ranked context briefing at every session start — eliminating blind codebase exploration and reducing token usage on repeat sessions.

## How it works

Every time you use Claude Code, Tokimizer silently watches which files get read and edited. After each session it scores every file by how often it's accessed, how recently, and how large it is (smaller files score higher per token). At the next session start, it injects a compact briefing into Claude's context:

```
[Tokimizer] Context loaded: 12 files, ~8,400 tokens (28% of budget)
Top files: src/index.ts (4.2), src/api/auth.ts (3.1), src/config.ts (2.8)
```

The more you use it, the better it gets. No configuration required.

## Requirements

- Claude Code with plugin support
- Node.js 18+

## Installation

**1. Clone or download this repo:**

```bash
git clone https://github.com/youruser/tokimizer ~/.claude/plugins/tokimizer
# or place it anywhere — the path is what matters
```

**2. Register the plugin in `~/.claude/settings.json`:**

```json
{
  "enabledPlugins": {
    "tokimizer": true
  }
}
```

**3. Add the install path to `~/.claude/plugins/installed_plugins.json`:**

```json
{
  "plugins": {
    "tokimizer": [
      {
        "scope": "user",
        "installPath": "/absolute/path/to/tokimizer",
        "version": "1.0.0",
        "installedAt": "2026-04-10T00:00:00.000Z",
        "lastUpdated": "2026-04-10T00:00:00.000Z"
      }
    ]
  }
}
```

**4. Run `/tokimizer:reindex` in your first session** to scan your project and set a token budget.

## Commands

| Command | Purpose |
|---------|---------|
| `/tokimizer:reindex` | Scan the full project and set token budget. Run once on first use or after major restructuring. |
| `/tokimizer:analyze` | Show a full token usage report — top files by score, bottom files by waste, budget status. |
| `/tokimizer:optimize` | Review and selectively apply `.claudeignore` suggestions for large, stale files. |

## Scoring formula

```
score = (access_count + edit_count × 3) × recency_decay / token_cost
```

- **Edit multiplier:** Files Claude writes or edits count 3× more than reads — edits are higher signal.
- **Recency decay:** `0.95 ^ days_since_last_access` — a file untouched for 14 days is at ~49% of its peak score. Files naturally deprioritize without manual curation.
- **Token cost:** `ceil(size_bytes / 4)` — larger files cost more to load and score lower per access.
- **Cold start:** On first use, score defaults to `1 / token_cost` (smallest files load first).

## Token budget

On first run, `/tokimizer:reindex` scans your project, calculates total token cost, and lets you choose:

```
Your project: 847 files → ~94,000 tokens total
Context window: 200,000 tokens

Recommended budget options:
  A) Conservative 20% (~18,000 tokens) — fastest, highest precision
  B) Balanced     35% (~33,000 tokens) — recommended ✓
  C) Generous     50% (~47,000 tokens) — more coverage, less filtering
  D) Custom: enter your own %
```

If your whole project fits comfortably in context, Tokimizer skips filtering entirely and loads everything.

## State storage

State is stored per-project, isolated by a hash of the project path.

| Install scope | State location |
|---------------|----------------|
| Global | `~/.claude/tokimizer/<project-hash>/` |
| Local (`.claude/` in project) | `.claude/tokimizer/` |

Three files are maintained:
- **`file-map.json`** — scored index of all observed files
- **`session-buffer.json`** — ephemeral buffer for the current session (cleared after each flush)
- **`suggestions.txt`** — `.claudeignore` candidates pending your review

## `.claudeignore` suggestions

Tokimizer never automatically modifies `.claudeignore`. When it detects files that score below 0.1, are larger than 20 KB, and haven't been seen in 5+ sessions, it queues them as suggestions. Run `/tokimizer:optimize` to review and apply them interactively.

## Project structure

```
tokimizer/
├── plugin.json               # Plugin manifest
├── hooks/
│   ├── hooks.json            # Hook event registrations
│   ├── lib/
│   │   ├── state.js          # File-map / buffer / suggestions I/O
│   │   ├── scoring.js        # Scoring formula and recency decay
│   │   └── briefing.js       # Context briefing generator
│   ├── session-start.js      # SessionStart: inject briefing
│   ├── track-access.js       # PostToolUse: buffer file accesses
│   ├── flush-scores.js       # Stop: batch flush scores
│   ├── post-compact.js       # PostCompact: re-inject briefing
│   └── session-end.js        # SessionEnd: safety-net flush
├── commands/
│   ├── optimize.md           # /tokimizer:optimize
│   ├── analyze.md            # /tokimizer:analyze
│   └── reindex.md            # /tokimizer:reindex
└── skills/
    └── tokimizer/
        └── SKILL.md          # Behavioral guide for Claude
```

## Tests

```bash
node --test tests/*.test.js
```

36 tests across state, scoring, briefing, track-access, and flush-scores modules. Zero external dependencies.

## License

MIT
