# ADR 0001: Portable learning workflow

- Status: accepted
- Owner: repository maintainer

## Context

The teaching method is already written in Markdown, but the session UI and transcript logging depended on `pi` extensions. Visual generation also depended on a separate subagent extension and a machine-specific package path. Those dependencies made the repository difficult to use on another setup.

## Decision

Keep the teaching method as project-scoped Markdown skills. Ask questions, receive answers, and give feedback in the conversation, with one question per turn and no answer reveal before the learner responds. Treat research delegation and diagram rendering as optional capabilities. Write Markdown lesson notes only when requested, and append them to the destination the learner chooses.

Provide a small standalone renderer for Mermaid and SVG source. It uses available local converter commands and has no package dependency in the core teaching workflow.

## Consequences

- A fresh project can use the teaching workflow without installing packages or enabling extensions.
- The learner replies in a separate turn before a question is graded.
- Inline conversation replaces automatic mirroring of the full session transcript.
- PNG rendering remains optional and depends on local converter commands.
- A read-only researcher agent can be used where custom agent files are supported; the teaching skill can also research directly.
