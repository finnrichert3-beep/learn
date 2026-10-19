---
name: visualize
description: "Add a correct, minimal visual to a lesson — a diagram or geometric picture — that renders inline in the Obsidian session log. Use when an idea is genuinely clearer as a picture: a dependency graph, system/flow, sequence, state machine, tree, comparison, or a spatial/geometric thing (coordinate geometry, number line, vectors, a plot, a physical layout). Delegates authoring+rendering to a maker subagent that verifies the image by looking at it, then you embed the returned file."
---

# Visualize

A picture earns its place only when it shows something words can't — shape, structure, direction, relationship, geometry. This skill produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), and drops it into the lesson so it renders inline in the Obsidian log.

You are the **creative director**: you decide the exact idea and distill it to its fewest carrying elements. A **maker subagent** authors, renders, visually verifies, and publishes, then returns a filename. You embed that filename.

## When to visualize (and when not to)

Reach for one when the idea is:

- a **structure or relationship**: dependencies, a system with parts and arrows, a pipeline, a sequence of exchanges, a state machine, a tree, a comparison, containment;
- **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Do NOT visualize when prose or a single equation already carries it. When in doubt, don't — a missing visual is cheaper than a false one.

## Choose the maker

- **`mermaid-maker`** (`learn:mermaid-maker`) — nodes-and-edges: dependency graphs, flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. The default.
- **`svg-maker`** (`learn:svg-maker`) — positions-and-shapes: exact coordinates, geometry, number lines, vectors, plots.

## Brief the maker: one idea, fewest elements

The most common failure is **cramming**. Before briefing, prune: for each element ask *"if I delete this, is the idea still clear?"* If yes, delete it.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows into 'reliable stream'. No title. Shows reliability is built FROM packets, not alongside them."

If your brief lists more than ~5–7 elements, cut it first.

## Invoke

Call the `Agent` tool with the maker as `subagent_type`. **Always include the render script's absolute path in the brief** — the maker needs it:

```
Render script: ${CLAUDE_SKILL_DIR}/scripts/viz.mjs
Brief: <your minimal, concrete brief>
```

(If `${CLAUDE_SKILL_DIR}` above was not expanded into a real path, find it with `find ~/.claude/plugins "$CLAUDE_PROJECT_DIR" -path '*visualize/scripts/viz.mjs' 2>/dev/null | head -1` and pass that.)

Several independent visuals? Launch the makers in parallel in one message.

The maker returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <project>/viz/viz-<slug>-<timestamp>.png
```

If it returns `RESULT: NONE`, simplify or rethink, or decide the visual isn't worth it. Never hand-author or fake a diagram yourself; correctness depends on the maker's render-and-inspect loop.

## Embed it in the lesson

Put an Obsidian embed with the returned **filename** directly in your reply:

```
![[viz-<slug>-<timestamp>.png|500]]
```

The `md-log` hook mirrors your reply into the linked `.md`, and Obsidian resolves embeds by filename anywhere in the vault (the maker publishes into the project's `viz/` folder). `|500` is a good default width. Introduce the visual in a sentence, then let it carry the idea.

In the terminal the embed is just text, so if no md-log is linked, also give the absolute `path` so the learner can open it.
