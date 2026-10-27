# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

An AI learning system for **Claude Code**, adapted from Amos Blomqvist's pi-based system in [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU) ([original repo](https://github.com/amosblomqvist/learn)).

The teaching philosophy lives in a skill: build understanding as a **dependency graph**. Start from unconditional truths, then make every next step feel like something you could have discovered yourself. Each lesson runs **probe → plan → teach**. Claude quizzes you to find exactly where your knowledge ends, shows you a dependency map and waits for your OK, then teaches it node by node, checking each one with a quiz.

## What's in it

| Path | What it does |
|---|---|
| `CLAUDE.md` | Tells Claude this folder is a learning workspace and that every explanation follows the teach skill |
| `.claude/skills/teach/` | The philosophy and the process (`/teach <topic>`) |
| `.claude/skills/visualize/` | Adds a correct, minimal diagram to a lesson when an idea is clearer as a picture |
| `.claude/skills/md-log/` | `/md-log notes/<topic>.md`: mirrors the lesson into a markdown file for reading in Obsidian |
| `.claude/agents/researcher.md` | Subagent that fact-checks with web search before Claude teaches something it's unsure of |
| `.claude/agents/mermaid-maker.md`, `svg-maker.md` | Subagents that draw a diagram, render it, *look at it* to verify it's correct, and save it to `viz/` |
| `.claude/scripts/render.py` | Mermaid/SVG → PNG renderer used by the makers |
| `.claude/hooks/md_log.py` | The hook behind `/md-log` |
| `.claude/settings.json` | Wires the md-log hooks and pre-approves the system's own commands |
| `notes/`, `viz/` | Your lesson logs and diagrams |

### What changed from the pi version

| pi | Claude Code |
|---|---|
| `quiz` extension (graded popup) | Built-in `AskUserQuestion` + a grading protocol in the teach skill. There's always an `I don't know` option, the correct answer is never marked, and feedback (✓/✗, answer, why) comes right after you answer |
| `ask-user-question` extension | Built-in `AskUserQuestion` |
| `md-log` extension | `Stop` / `PreToolUse` hooks that append the session transcript to your notes file |
| `visual-tools` extension (`write_/edit_/render_*` tools) | The makers use Write/Edit plus `render.py` |
| `pi-interactive-subagents` | Claude Code's built-in subagents (`.claude/agents/`) |

## Setup

1. **Install Claude Code** and sign in: <https://claude.com/claude-code>
2. **Clone this repo** and open Claude Code inside it:
   ```bash
   git clone https://github.com/finnrichert3-beep/learn
   cd learn
   claude
   ```
   (Or open the folder in the Claude desktop app's Code tab.)
3. **Optional, for lesson notes:** Python 3 (`python3 --version`). Macs prompt you to install it on first use; on Windows, get it from python.org.
4. **Optional, for diagrams:**
   - Mermaid diagrams need **Node.js** (<https://nodejs.org>). The first render downloads the Mermaid CLI automatically. If Google Chrome is installed it's used directly; otherwise a browser is downloaded once.
   - SVG diagrams need any one of: `rsvg-convert` (`brew install librsvg`), ImageMagick (`brew install imagemagick`), or Google Chrome.
5. **Optional, Obsidian (recommended):** install [Obsidian](https://obsidian.md), choose **Open folder as vault**, and pick this repo folder. Math, Mermaid maps and diagrams in `notes/` all render there. No plugins are needed, and nothing has to be "connected": Obsidian just reads the files.

## Using it

```
/md-log notes/projectile-motion.md      ← optional: start a notes file (open it in Obsidian)
/teach projectile motion                ← full session: probe → plan → teach
```

- **Homework:** paste or attach the problem (or point Claude at a PDF in this folder). It teaches you the method on that problem rather than just handing you the answer, unless you ask for the full solution.
- **Exam prep:** `/teach exam prep for <course>, covers <topics>`. It probes across the topics and starts with your weakest.
- **Course material:** drop slides, notes or PDFs into this folder (e.g. `courses/phys1600/`) and reference them so lessons match your class's notation.
- **Any other skill:** `/teach chess endgames`, `/teach piano chord voicings`, and so on.
- **Quick question:** just ask. Claude still follows the teaching method, at a smaller scale.
- `/md-log off` stops logging; `/md-log status` shows where the log is going.

Edit `.claude/skills/teach/SKILL.md` to make the teaching fit how *you* learn best.
