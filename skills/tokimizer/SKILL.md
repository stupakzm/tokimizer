# Tokimizer

Tokimizer is active. It has pre-loaded a ranked list of high-value files for this project into your session context (see the [Tokimizer] briefing above).

## How to use this

- **Before exploring the codebase:** Check the top files listed in the session briefing. Prefer those over blind directory scanning.
- **Before scanning a large directory:** Check if it appears in the ignore candidates list. If so, skip it unless the task specifically requires it.
- **When multiple files could answer a question:** Read the highest-scored one first.
- **Files listed as "Beyond budget":** They exist but are lower priority. Load them only if your current task requires them.

## Commands

| Command | Purpose |
|---------|---------|
| `/tokimizer:reindex` | Scan full project, set token budget (run once on first use) |
| `/tokimizer:analyze` | Show token usage report and file scores |
| `/tokimizer:optimize` | Review and apply .claudeignore suggestions |

## What Tokimizer does automatically

- Injects a project context briefing at session start (what you see above)
- Tracks which files you read and edit during each session
- Updates file scores after each response based on usage
- Detects large, unused files and queues them for ignore suggestions
- Re-injects briefing after context compaction

You do not need to call any commands unless you want to review scores or apply ignore suggestions.
