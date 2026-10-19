# learn — for Claude Code

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

A teaching system based on [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU) ([original pi version](https://github.com/amosblomqvist/learn)), packaged as a **Claude Code plugin**.

The core idea is **understanding over memorizing**. Claude builds a dependency graph in your head: unconditional truths first, then each new fact derived from them ("how could I have discovered this?"), and every node quiz-checked before anything is built on it.

## What's in it

| Piece | What it does |
|---|---|
| `skills/teach` | The philosophy and the probe → plan → teach process. Triggers on any explanation. |
| `skills/curriculum` | **New.** Multi-session plans for big topics: a module DAG, a learner model, and spaced review, kept on disk in `topics/<slug>/`. |
| `skills/visualize` | Adds one correct, minimal diagram when a picture carries the idea. |
| `agents/researcher` | Checks facts on the web before they get taught, and scopes a field for planning. |
| `agents/mermaid-maker`, `agents/svg-maker` | Write a diagram, render it to PNG, look at it, fix it, and publish it to `viz/`. |
| `hooks/` + `scripts/md-log.mjs` | Mirrors the session into a markdown file so you can read it rendered in Obsidian (LaTeX, mermaid, image embeds). |
| `commands/` | `/learn:plan`, `/learn:session`, `/learn:review`, `/learn:md-log`, `/learn:md-unlog` |

## Install

Use a separate folder for learning (ideally an Obsidian vault), and run Claude Code from there.

```bash
claude plugin marketplace add kalanjiyaVishnu/learn
```

```bash
claude plugin install learn@learn
```

To work on the plugin itself from a local checkout:

```bash
claude --plugin-dir /path/to/this/repo
```

Add `.claude/md-log.json` to your learning folder's `.gitignore`. It holds the current log link.

### Requirements

- Claude Code, and Node 18+ (already there if you installed Claude Code with npm).
- **Diagrams:** Google Chrome or Chromium. Mermaid renders through `npx @mermaid-js/mermaid-cli`; the first render takes a minute or two while it downloads, then it's cached. SVG renders with headless Chrome, falling back to `rsvg-convert` or ImageMagick.
- **Obsidian** (optional, recommended) to read the session log rendered.

## What changed from the pi version

| pi | Claude Code |
|---|---|
| `quiz` extension (graded TUI popup) | Built-in `AskUserQuestion` plus a **quiz protocol** in `teach`: Claude holds the answer key, shuffles where the correct option goes, always offers "I don't know", and grades right after you answer. |
| `ask-user-question` extension | Built-in `AskUserQuestion` |
| `md-log` extension | `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` hooks that sync from the session transcript. No dependencies. |
| `visual-tools` extension + `pi-interactive-subagents` | Native subagents with `Bash`/`Read`/`Write`/`Edit` and one render script (`viz.mjs`). They "look" by reading the PNG. |
| `.pi/agents/*.md` (`web_search`, `safe_bash`, openrouter models) | `agents/*.md` with `WebSearch`/`WebFetch`, `model: sonnet` |
| One-session lessons only | Adds `curriculum`: persistent roadmap, learner model, spaced review |

## Using it

### A quick explanation

Ask anything ("explain how TLS works"). `teach` takes over: it quizzes to find where your knowledge runs out, asks what you actually want, shows a plan with a dependency map, waits for your OK, then teaches node by node.

### A big topic (many sessions)

```
/learn:plan operating systems
```

Claude pins down a testable goal, sends researchers to map the field, runs a quick quiz across the main strands, and proposes a **module DAG**. Once you approve, it writes `topics/operating-systems/roadmap.md` and `learner.md`.

```
/learn:session operating-systems
```

Each session starts with any reviews that are due, then picks the next module whose prerequisites are solid. It opens an Obsidian log at `topics/<slug>/sessions/<date>-<module>.md`, teaches the module with `teach`, and finishes by updating the roadmap status and the learner model.

```
/learn:review operating-systems
```

Spaced retrieval of finished modules. If you pass, the next review is pushed further out. If you miss, the module is marked `shaky` and gets re-taught before anything that depends on it.

### Reading in Obsidian

`/learn:md-log notes/today.md` links a file (the session so far is backfilled at the end of the turn). `/learn:session` links one for you. Open the folder as a vault and keep the file open beside the terminal.

## Customize

The teaching skill was written for one learner. Edit `skills/teach/SKILL.md` to fit how you learn: the Socratic/expository default, how long the probe runs, quiz style.
