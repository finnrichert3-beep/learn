---
description: Link a markdown file to this session so the lesson is mirrored there (read it rendered in Obsidian)
argument-hint: <path/to/file.md>
allowed-tools: Bash(node:*)
---

Link the session log by running this exact command with Bash:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/md-log.mjs" link "$ARGUMENTS"
```

If `${CLAUDE_PLUGIN_ROOT}` was not expanded into a real path, locate the script with `find ~/.claude/plugins "$CLAUDE_PROJECT_DIR" -path '*scripts/md-log.mjs' 2>/dev/null | head -1` and run that instead.

If no path was given, use `sessions/<YYYY-MM-DD>-<short-topic>.md` (inside `topics/<slug>/` when a curriculum is active).

Then reply with one line confirming the linked file. The conversation so far is backfilled when this turn ends.
