#!/usr/bin/env node
/**
 * md-log — mirror a Claude Code session into a markdown file for comfortable
 * reading (rendered in Obsidian: math, mermaid, code, image embeds).
 *
 * Captures only reading-relevant content:
 *   - user prompts (slash commands shown as `/name args`)
 *   - assistant text (lesson prose, quiz grading)
 *   - AskUserQuestion questions and answers
 * Other tools, system reminders, skill bodies and subagent work are omitted.
 *
 *   node md-log.mjs link <file.md>   link a markdown file; the session is backfilled on the next hook
 *   node md-log.mjs unlink           stop logging
 *   node md-log.mjs status           show the linked file
 *   node md-log.mjs hook             hook entrypoint (reads hook JSON on stdin)
 *
 * State lives in <project>/.claude/md-log.json. A fresh link is unowned; the
 * first hook event to fire claims it for its session, so a second Claude
 * session in the same project never writes into the file.
 *
 * Every hook event syncs the transcript from the last byte offset, so ordering
 * always follows the transcript. PreToolUse/PostToolUse on AskUserQuestion also
 * write the question / answer straight from the hook input in case the
 * transcript hasn't been flushed yet; ids already written are skipped later.
 * Append-only. Never prints to stdout during hooks (UserPromptSubmit stdout
 * would be injected into the conversation).
 */

import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

const QUESTION_TOOL = "AskUserQuestion"
const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd()
const statePath = (dir = projectDir()) => join(dir, ".claude", "md-log.json")

function loadState(dir) {
  try {
    return JSON.parse(readFileSync(statePath(dir), "utf8"))
  } catch {
    return null
  }
}

function saveState(dir, state) {
  mkdirSync(dirname(statePath(dir)), { recursive: true })
  writeFileSync(statePath(dir), JSON.stringify(state, null, 2))
}

// ── formatting ───────────────────────────────────────────────────────────────

function callout(type, title, bodyLines) {
  return [`> [!${type}] ${title}`, ...bodyLines.map((l) => (l.length ? `> ${l}` : ">"))].join("\n")
}

function questionBlocks(input) {
  const questions = Array.isArray(input?.questions) ? input.questions : []
  return questions.map((q) => {
    const body = String(q.question ?? "").split("\n")
    const options = Array.isArray(q.options) ? q.options : []
    if (options.length) {
      body.push("")
      options.forEach((o, i) => body.push(`${i + 1}. ${o.label}`))
    }
    if (q.multiSelect) body.push("", "_(select all that apply)_")
    return callout("question", q.header || "Question", body)
  })
}

function answerBlock(result, isError) {
  if (isError) return callout("warning", "Question — skipped", ["(no answer)"])
  const answers = result?.answers
  const lines = []
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    const entries = Object.entries(answers)
    for (const [q, a] of entries) {
      if (entries.length > 1) lines.push(`**${q}**`)
      lines.push(...String(a).split("\n"), "")
    }
  } else if (typeof result === "string") {
    // Fallback: `"question"="answer", ...` from the tool_result text.
    for (const m of result.matchAll(/"[^"]*"="([^"]*)"/g)) lines.push(m[1])
  }
  while (lines.length && lines.at(-1) === "") lines.pop()
  return callout("example", "Answer", lines.length ? lines : ["(no answer)"])
}

function cleanUserText(text) {
  if (/<local-command-(stdout|stderr|caveat)>/.test(text)) return ""
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
    return `${cmd.startsWith("/") ? cmd : `/${cmd}`}${args ? ` ${args}` : ""}`
  }
  return text
    .replace(/<(system-reminder|task-notification|bash-input|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g, "")
    .replace(/<\/?pasted_content[^>]*>/g, "")
    .trim()
}

// ── writer ───────────────────────────────────────────────────────────────────

function makeWriter(state) {
  const write = (kind, text) => {
    if (!text) return
    let prefix = ""
    try {
      if (statSync(state.file).size > 0) prefix = "\n\n"
    } catch {}
    // Consecutive assistant chunks of one turn share a single CLAUDE header.
    const header = kind === "assistant" && state.lastKind !== "assistant" ? "> [!abstract] CLAUDE\n\n" : ""
    const headerUser = kind === "user" ? "> [!quote] YOU\n\n" : ""
    mkdirSync(dirname(state.file), { recursive: true })
    appendFileSync(state.file, prefix + headerUser + header + text + "\n")
    state.lastKind = kind
  }
  return {
    user: (t) => write("user", t),
    assistant: (t) => write("assistant", t),
    block: (t) => write("block", t),
  }
}

function syncTranscript(state, transcriptPath, w) {
  if (!transcriptPath || !existsSync(transcriptPath)) return
  const size = statSync(transcriptPath).size
  if (size <= state.offset) return
  const fd = openSync(transcriptPath, "r")
  const buf = Buffer.alloc(size - state.offset)
  readSync(fd, buf, 0, buf.length, state.offset)
  closeSync(fd)
  const lastNl = buf.lastIndexOf(0x0a)
  if (lastNl < 0) return
  const chunk = buf.subarray(0, lastNl + 1).toString("utf8")
  state.offset += lastNl + 1

  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.isSidechain || e.isMeta || e.isCompactSummary) continue
    const content = e.message?.content

    if (e.type === "assistant" && Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "text" && c.text?.trim()) w.assistant(c.text.trim())
        if (c.type === "tool_use" && c.name === QUESTION_TOOL) {
          state.pending.push(c.id)
          if (!state.asked.includes(c.id)) {
            state.asked.push(c.id)
            for (const b of questionBlocks(c.input)) w.block(b)
          }
        }
      }
    } else if (e.type === "user") {
      if (typeof content === "string") {
        w.user(cleanUserText(content))
        continue
      }
      if (!Array.isArray(content)) continue
      for (const c of content) {
        if (c.type === "tool_result") {
          if (!state.pending.includes(c.tool_use_id)) continue
          state.pending = state.pending.filter((id) => id !== c.tool_use_id)
          if (state.answered.includes(c.tool_use_id)) continue
          state.answered.push(c.tool_use_id)
          const text = typeof c.content === "string" ? c.content : c.content?.map?.((x) => x.text ?? "").join("\n")
          w.block(answerBlock(e.toolUseResult ?? text, c.is_error))
        } else if (c.type === "text") {
          w.user(cleanUserText(c.text ?? ""))
        }
      }
    }
  }
}

function hook(input) {
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const state = loadState(dir)
  if (!state?.file) return
  if (!state.session) state.session = input.session_id
  if (state.session !== input.session_id) return
  state.offset ??= 0
  state.asked ??= []
  state.answered ??= []
  state.pending ??= []

  const w = makeWriter(state)
  syncTranscript(state, input.transcript_path, w)

  const id = input.tool_use_id
  if (input.tool_name === QUESTION_TOOL && id) {
    if (input.hook_event_name === "PreToolUse" && !state.asked.includes(id)) {
      state.asked.push(id)
      for (const b of questionBlocks(input.tool_input)) w.block(b)
    }
    if (input.hook_event_name === "PostToolUse" && !state.answered.includes(id)) {
      if (!state.asked.includes(id)) {
        state.asked.push(id)
        for (const b of questionBlocks(input.tool_input)) w.block(b)
      }
      state.answered.push(id)
      w.block(answerBlock(input.tool_response, false))
    }
  }
  // Keep the dedupe lists bounded.
  state.asked = state.asked.slice(-200)
  state.answered = state.answered.slice(-200)
  saveState(dir, state)
}

// ── cli ──────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === "hook") {
  let raw = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (d) => (raw += d))
  process.stdin.on("end", () => {
    try {
      hook(JSON.parse(raw || "{}"))
    } catch {
      // Never break the session over logging.
    }
    process.exit(0)
  })
} else if (cmd === "link") {
  const arg = rest.join(" ").trim().replace(/^["']|["']$/g, "")
  if (!arg) {
    console.error("usage: md-log.mjs link <file.md>")
    process.exit(1)
  }
  const file = isAbsolute(arg) ? arg : resolve(projectDir(), arg)
  mkdirSync(dirname(file), { recursive: true })
  if (!existsSync(file)) writeFileSync(file, "")
  saveState(projectDir(), { file, session: null, offset: 0, asked: [], answered: [], pending: [], lastKind: null })
  console.log(`md-log linked → ${file}\nThe session so far is backfilled at the end of this turn; new content is appended live.`)
} else if (cmd === "unlink") {
  const p = statePath()
  if (existsSync(p)) unlinkSync(p)
  console.log("md-log unlinked.")
} else if (cmd === "status") {
  const s = loadState(projectDir())
  console.log(s?.file ? `md-log → ${s.file}` : "md-log: not linked")
} else {
  console.error("usage: md-log.mjs <link <file.md>|unlink|status|hook>")
  process.exit(1)
}
