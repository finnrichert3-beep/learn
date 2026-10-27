---
name: md-log
description: Link a markdown notes file to this session so the lesson (your prompts, Claude's explanations, quizzes and answers) is mirrored into it for reading rendered in Obsidian. Usage — /md-log notes/<topic>.md to start, /md-log off to stop, /md-log status.
argument-hint: "notes/<topic>.md | off | status"
disable-model-invocation: true
allowed-tools: Bash(python3 .claude/hooks/md_log.py:*), Bash(python .claude/hooks/md_log.py:*)
---

The user ran `/md-log $ARGUMENTS`.

Run exactly one command from the project root, then relay its one-line output to the user and stop (no other tools, no extra commentary):

- If the argument is empty: tell the user the usage (`/md-log notes/<topic>.md`, `/md-log off`, `/md-log status`) and suggest a filename in `notes/` based on the current topic, if there is one.
- If the argument is `off` or `stop`: `python3 .claude/hooks/md_log.py unlink`
- If the argument is `status`: `python3 .claude/hooks/md_log.py status`
- Otherwise: `python3 .claude/hooks/md_log.py link "<the argument>"` (if it's a bare name like `thermo`, use `notes/thermo.md`).

If `python3` isn't found, retry the same command with `python`. If neither exists, tell the user md-log needs Python 3 (https://www.python.org/downloads/).

After linking, mention in one line that the notes render best by opening this project folder as a vault in Obsidian (math, mermaid maps and diagrams all render there), but any markdown viewer works.
