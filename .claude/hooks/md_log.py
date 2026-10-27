#!/usr/bin/env python3
"""
md-log — mirror a Claude Code session into a markdown file for comfortable reading.

Designed for long teaching sessions where the terminal is hard on the eyes and
math/diagrams don't render. The linked .md file is meant to be viewed rendered
(e.g. in Obsidian), so $...$ math, mermaid blocks, and ![[viz-...png]] embeds
render natively — no rendering work here.

Captures only reading-relevant content:
  - your prompts (and /slash commands)
  - assistant text (lesson prose, quiz feedback)
  - AskUserQuestion questions + your answers (quizzes and preference questions)
Other tools (bash, read, write, subagents, ...) are omitted.

Usage (normally via the /md-log skill):
  python3 .claude/hooks/md_log.py link notes/thermo.md   # link + backfill this session
  python3 .claude/hooks/md_log.py unlink                 # stop logging
  python3 .claude/hooks/md_log.py status

Hook mode (wired up in .claude/settings.json on Stop and PreToolUse:AskUserQuestion):
  python3 .claude/hooks/md_log.py hook   < hook JSON on stdin

How it works: the hook receives the session's transcript path, reads any
transcript lines it hasn't seen yet (tracked by byte offset), and appends them
to the linked file. Append-only — your own edits to the file are never
overwritten, but don't edit the very end of it while a lesson is running.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])
STATE_FILE = PROJECT_DIR / ".claude" / "md-log-state.json"
DONT_KNOW = "i don't know"


# ── state ────────────────────────────────────────────────────────────────────

def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {"pending": None, "sessions": {}}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


# ── formatting ───────────────────────────────────────────────────────────────

def callout(kind, title, body_lines):
    lines = [f"> [!{kind}] {title}"]
    for line in body_lines:
        lines.append(">" if not line else f"> {line}")
    return "\n".join(lines)


def user_block(text):
    return f"> [!quote] YOU\n\n{text}"


def assistant_block(text):
    return f"> [!abstract] CLAUDE\n\n{text}"


SYS_REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
COMMAND = re.compile(r"<command-name>(.*?)</command-name>", re.S)
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)


def clean_user_text(text):
    text = SYS_REMINDER.sub("", text).strip()
    if not text:
        return None
    m = COMMAND.search(text)
    if m:
        name = m.group(1).strip()
        if name.lstrip("/") in ("md-log", "md-unlog"):
            return None
        args = COMMAND_ARGS.search(text)
        args = args.group(1).strip() if args else ""
        return ("cmd", f"{name if name.startswith('/') else '/' + name} {args}".strip())
    if text.startswith(("<local-command", "<command-", "<bash-", "Caveat:", "[Request interrupted")):
        return None
    return ("text", text)


def question_blocks(tool_input):
    out = []
    for q in tool_input.get("questions") or []:
        options = q.get("options") or []
        is_quiz = any(str(o.get("label", "")).strip().lower() == DONT_KNOW for o in options)
        body = [line for line in str(q.get("question", "")).split("\n")]
        if options:
            body.append("")
            for i, o in enumerate(options, 1):
                body.append(f"{i}. {o.get('label', '')}")
        if q.get("multiSelect"):
            body.append("")
            body.append("*(select all that apply)*")
        title = "Quiz" if is_quiz else "Question"
        header = q.get("header")
        if header:
            title += f" — {header}"
        out.append(callout("question", title, body))
    return out


ANSWER_PAIR = re.compile(r'"(.*?)"\s*=\s*"(.*?)"(?=,\s*"|\.\s|\.?$)', re.S)


def answer_block(entry, result_block):
    content = result_block.get("content")
    if isinstance(content, list):
        content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    content = str(content or "")

    answers = None
    tur = entry.get("toolUseResult")
    if isinstance(tur, dict) and isinstance(tur.get("answers"), dict):
        answers = tur["answers"]
    elif "answered" in content:
        pairs = ANSWER_PAIR.findall(content)
        if pairs:
            answers = dict(pairs)

    if not answers:
        if result_block.get("is_error") or "doesn't want" in content or "rejected" in content.lower():
            return callout("warning", "Skipped", ["(question dismissed)"])
        return callout("example", "Answer", [content.strip()[:500] or "(no answer)"])

    body = []
    multi = len(answers) > 1
    for q, a in answers.items():
        if multi:
            body.append(f"**{q}**")
        body.append(f"Your answer: {a}")
        if multi:
            body.append("")
    return callout("example", "Answer", body[:-1] if multi else body)


# ── transcript → markdown ────────────────────────────────────────────────────

def render_entries(lines, seen_question_ids):
    chunks = []
    for raw in lines:
        try:
            entry = json.loads(raw)
        except Exception:
            continue
        if entry.get("isSidechain") or entry.get("isMeta") or entry.get("isCompactSummary"):
            continue
        etype = entry.get("type")
        msg = entry.get("message") or {}
        content = msg.get("content")

        if etype == "user":
            if isinstance(content, str):
                cleaned = clean_user_text(content)
                if cleaned:
                    kind, text = cleaned
                    chunks.append(callout("note", text, []) if kind == "cmd" else user_block(text))
                continue
            for block in content or []:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    cleaned = clean_user_text(block.get("text", ""))
                    if cleaned:
                        kind, text = cleaned
                        chunks.append(callout("note", text, []) if kind == "cmd" else user_block(text))
                elif block.get("type") == "tool_result" and block.get("tool_use_id") in seen_question_ids:
                    chunks.append(answer_block(entry, block))
                    seen_question_ids.discard(block.get("tool_use_id"))

        elif etype == "assistant":
            if entry.get("isApiErrorMessage"):
                continue
            for block in content or []:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    text = block.get("text", "").strip()
                    if text and text != "(no content)":
                        chunks.append(assistant_block(text))
                elif btype == "tool_use" and block.get("name") == "AskUserQuestion":
                    chunks.extend(question_blocks(block.get("input") or {}))
                    seen_question_ids.add(block.get("id"))
                elif btype == "tool_use" and block.get("name") == "Skill":
                    name = (block.get("input") or {}).get("skill", "?")
                    if name not in ("md-log",):
                        chunks.append(callout("note", f"SKILL loaded: {name}", []))
    return chunks


def append(path: Path, chunks):
    if not chunks:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    with path.open("a", encoding="utf-8") as f:
        if not existing.strip():
            f.write(f"# {path.stem}\n\n*Lesson log started {time.strftime('%Y-%m-%d %H:%M')}*\n")
        for chunk in chunks:
            f.write("\n\n" + chunk + "\n")


def flush(sess):
    transcript = Path(sess["transcript"])
    if not transcript.exists():
        return
    with transcript.open("rb") as f:
        f.seek(sess.get("offset", 0))
        data = f.read()
    end = data.rfind(b"\n")
    if end < 0:
        return
    complete = data[: end + 1]
    lines = complete.decode("utf-8", errors="replace").splitlines()
    seen = set(sess.get("open_questions", []))
    chunks = render_entries(lines, seen)
    append(Path(sess["file"]), chunks)
    sess["offset"] = sess.get("offset", 0) + len(complete)
    sess["open_questions"] = sorted(q for q in seen if q)


# ── entry points ─────────────────────────────────────────────────────────────

def cmd_link(target):
    path = Path(target).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    if path.suffix.lower() != ".md":
        path = path.with_suffix(path.suffix + ".md") if path.suffix else path.with_suffix(".md")
    path.parent.mkdir(parents=True, exist_ok=True)
    state = load_state()
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID")
    if sid and sid in state["sessions"]:
        state["sessions"][sid].update({"file": str(path), "offset": 0, "open_questions": []})
    else:
        state["pending"] = {"action": "link", "file": str(path), "session": sid}
    save_state(state)
    try:
        shown = path.relative_to(PROJECT_DIR)
    except ValueError:
        shown = path
    print(f"md-log: linked {shown}. The whole session so far is backfilled into it when this turn ends, "
          f"and every later turn is appended.")


def cmd_unlink():
    state = load_state()
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID")
    if sid and sid in state["sessions"]:
        state["sessions"][sid]["stop_after_flush"] = True
    else:
        state["pending"] = {"action": "unlink", "session": sid}
    save_state(state)
    print("md-log: logging stops at the end of this turn.")


def cmd_status():
    state = load_state()
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID")
    if sid and sid in state["sessions"]:
        print(f"md-log: this session logs to {state['sessions'][sid]['file']}")
    elif state.get("pending"):
        print(f"md-log: pending {state['pending']}")
    elif state["sessions"]:
        for s, v in state["sessions"].items():
            print(f"md-log: session {s[:8]} → {v['file']}")
    else:
        print("md-log: not linked")


def cmd_hook():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    sid = payload.get("session_id")
    transcript = payload.get("transcript_path")
    if not sid or not transcript:
        return
    state = load_state()
    sessions = state.setdefault("sessions", {})
    pending = state.get("pending")

    if pending and pending.get("session") in (None, sid):
        if pending.get("action") == "link":
            sessions[sid] = {"file": pending["file"], "transcript": transcript, "offset": 0, "open_questions": []}
        elif pending.get("action") == "unlink" and sid in sessions:
            sessions[sid]["stop_after_flush"] = True
        state["pending"] = None

    sess = sessions.get(sid)
    if not sess:
        save_state(state)
        return
    sess["transcript"] = transcript
    try:
        flush(sess)
    except Exception as e:  # never break the session over logging
        sess["last_error"] = repr(e)
    if sess.get("stop_after_flush") and payload.get("hook_event_name") == "Stop":
        sessions.pop(sid, None)
    save_state(state)


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if args[0] == "hook":
        cmd_hook()
    elif args[0] == "link" and len(args) > 1:
        cmd_link(" ".join(args[1:]))
    elif args[0] in ("unlink", "off"):
        cmd_unlink()
    elif args[0] == "status":
        cmd_status()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
