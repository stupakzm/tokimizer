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
git clone https://github.com/youruser/tokimizer ~/projects/tokimizer
```

**2. Create the plugin install directory:**

```bash
mkdir -p ~/.claude/plugins/tokimizer
mkdir -p ~/.claude/commands/tokimizer
```

**3. Sync plugin files:**

```bash
# Sync hooks, skills, and plugin manifest
cp -r ~/projects/tokimizer/{commands,skills,hooks} ~/.claude/plugins/tokimizer/
cp ~/projects/tokimizer/.claude-plugin/plugin.json ~/.claude/plugins/tokimizer/plugin.json

# Sync commands for / autocomplete
cp ~/projects/tokimizer/commands/*.md ~/.claude/commands/tokimizer/
```

> Re-run the sync whenever you update the plugin. Slash command autocomplete (`/tokimizer:*`) is driven by `~/.claude/commands/tokimizer/` — the plugin `commands/` field alone is not enough.

**4. Register the plugin in `~/.claude/settings.json`:**

```json
{
  "enabledPlugins": {
    "tokimizer": true
  }
}
```

**5. Reload plugins** with `/reload-plugins`, then run `/tokimizer:reindex` in your first session to scan your project and set a token budget.

## Commands

| Command | Purpose |
|---------|---------|
| `/tokimizer:reindex` | Scan the full project and set token budget. Run once on first use or after major restructuring. |
| `/tokimizer:analyze` | Show a full token usage report — top files by score, bottom files by waste, budget status. |
| `/tokimizer:optimize` | Review and selectively apply `.claudeignore` suggestions for large, stale files. |
| `/tokimizer:status` | Quick status snapshot — plugin state, state location, last flush, budget, session buffer, and pending ignores. |

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

## `.claudeignore` support

Tokimizer respects a `.claudeignore` file at the project root (same format as `.gitignore`). Supported pattern types:

| Pattern | Behaviour |
|---------|-----------|
| `dist/` | Exclude directory by prefix |
| `*.log` | Exclude by basename glob |
| `src/*.test.ts` | Exclude by path glob (single-segment wildcard) |
| `**/*.generated.ts` | Exclude anywhere in the tree (multi-segment wildcard) |
| `config/secrets.json` | Exclude by exact path |

The `.claudeignore` file itself and the `.claude/` directory are always excluded and never indexed.

If you run `/tokimizer:reindex` without a `--budget` flag, the existing budget is preserved — it is never silently reset to the default.

## Project structure

```
tokimizer/
├── plugin.json               # Plugin manifest (source of truth)
├── .claude-plugin/
│   └── plugin.json           # Distribution manifest (copied to install root on sync)
├── hooks/
│   ├── hooks.json            # Hook event registrations
│   ├── lib/
│   │   ├── walker.js         # Shared file walker, glob matching, .claudeignore parsing
│   │   ├── state.js          # File-map / buffer / suggestions I/O
│   │   ├── scoring.js        # Scoring formula and recency decay
│   │   ├── cold-start.js     # Cold-start file map builder
│   │   └── briefing.js       # Context briefing generator
│   ├── session-start.js      # SessionStart: inject briefing (cold-starts if needed)
│   ├── track-access.js       # PostToolUse: buffer file accesses
│   ├── flush-scores.js       # Stop: batch flush scores
│   ├── post-compact.js       # PostCompact: re-inject briefing
│   ├── session-end.js        # SessionEnd: safety-net flush
│   └── reindex.js            # Standalone reindex script (also used by /tokimizer:reindex)
├── commands/
│   ├── analyze.md            # /tokimizer:analyze
│   ├── optimize.md           # /tokimizer:optimize
│   ├── reindex.md            # /tokimizer:reindex
│   └── status.md             # /tokimizer:status
└── skills/
    └── tokimizer/
        └── SKILL.md          # Behavioral guide for Claude
```

### Standalone reindex

`reindex.js` can be run directly outside of a Claude session:

```bash
node hooks/reindex.js                    # reindex cwd, preserve existing budget
node hooks/reindex.js --budget 20        # reindex and set budget to 20%
node hooks/reindex.js --cwd /path/to/project --budget 40
```

## Tests

```bash
node --test
```

87 tests across state, scoring, briefing, track-access, flush-scores, cold-start, reindex, and hook integration modules. Zero external dependencies.

## License

MIT
