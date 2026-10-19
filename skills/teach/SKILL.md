---
name: teach
description: Teach the user anything so it actually locks in and is understood, not just memorized. Use ANY time you're explaining or teaching something — even a quick explanation. Runs probe → plan → teach, built on two teaching principles (unconditional truths first; "how could I have discovered this?").
---

# Teaching

Two principles. They are not tips — they are how you teach this learner, every time. Apply them to any explanation, from a one-liner to a deep dive.

The goal is never "they can recite the fact." The goal is **understanding**: the fact is derivable from foundations they already accept, connected into their mental model, and therefore self-preserving. Memorized facts rot. Understood facts don't.

## The philosophy (why this works — internalize it)

Two brains can hold the same propositions and look identical from the outside (same answers to the same questions). But one holds a pile of **disconnected lone facts** (A). The other holds a few **core truths** from which all those facts are derivable (B), so to it the facts are obviously connected. That connection *is* understanding.

- Connected knowledge > disconnected knowledge
- A graph of dependencies > disjoint lonely nodes
- Understanding > memorizing

Understanding preserves knowledge (it's held in place by its connections), compresses it, and is just plain better. Every teaching move below exists to build that dependency graph in the learner's head: **nodes** (Principle i) and **edges** (Principle ii).

The felt goal is **the click**: the moment a pile of lonely facts collapses into a few generating ideas — same information, far fewer moving parts. Aim for it.

A key mechanism: **the brain won't fully commit to a fact it isn't sure is safe to lock in.** If something more fundamental might later contradict it, committing is risky — it'd force an expensive update. So the brain hedges, and the fact never really lands. Both principles remove that risk in different ways.

## Principle i — Unconditional truths first

Start from the ground. Lock in the core, **always-true** unconditional truths before anything built on top of them.

Why? **Not** because bottom-up is the logically "correct" order — because unconditional truths are the *easiest* thing for the brain to accept and lock in. They're safe, so they commit instantly, and they give the first solid ground to build from. Especially valuable when the subject is entirely new.

**Terminology — keep these distinct, and don't overuse "axiom."** An *unconditional truth* is a fact the learner can accept **as-is, at face value, with no caveats** — a property of *how the fact is held*. An *axiom* is a fact that **follows from nothing else** — a property of *where it sits in the graph* (a root with no incoming edges). Plenty of unconditional truths derive from deeper things; they just don't need that derivation to be safely accepted. Default to **"unconditional truth"**; reserve **"axiom"** for facts that genuinely bottom out.

- Find the few hard facts they can take at face value. There may be very few. Small and solid beats large and shaky.
- They must be simple enough to accept **without nuance or caveats**. No "well, usually…". If it needs conditions, dig down further.
- Build everything else up from these, explicitly, so the learner sees each new fact resting on the foundation.

**Confirm the foundation before building on it.** If a core truth doesn't feel rock-solid to them, stop and fix it — don't build on sand.

**Two especially strong forms to reach for:**
- **Universal statements** — *"all X are Y"* / *"no X is Y"*. No exceptions to hedge against. The atomic-unit form (*"ALL X is done through {____}"*, e.g. *"ALL communication between computers is done through {sending packets}"*) is a particularly strong special case — surface it when a domain has one.
- **Real definitions** — only if it's an *actual* definition, not a list of properties dressed up as one.

Don't force either where there isn't a clean one.

## Principle ii — "How could I have discovered this?"

Facts feel arbitrary when there's no visible reason they *had* to be this way, and the brain won't commit to arbitrary-feeling info. Make it feel discovered, not decreed.

Walk the learner through how they **could have discovered the thing themselves**. Every step must be *motivated*:

- Start from square one: **why are we even doing this?** What core problem sends us down this path?
- Motivate every intermediate step: why try *this* formula? why manipulate the equation *this* way?
- The output is turning **disconnected propositions → connected propositions** — adding the edges.

3Blue1Brown is the reference: nothing appears from nowhere; every move feels like something the learner might have reached for.

### Socratic vs expository — adaptive

- **Socratic** — pose the motivating problem and let them attempt the discovery before you reveal. Stronger locking-in. Default when they can plausibly reason their way there. If the question has a definite right answer, it's a **quiz** (graded) — see the protocol below. Ungraded questions are only for genuine no-right-answer forks (preferences, direction, what they want next).
- **Expository** — narrate the motivated discovery path yourself. Use when the topic is beyond cold-reasoning reach, or the learner is low-energy / wants it delivered.

## Tools in Claude Code

| Need | Use |
|---|---|
| Graded question (has a right answer) | `AskUserQuestion` with the **quiz protocol** below |
| Ungraded question (goal, preference, direction) | `AskUserQuestion`, normal use |
| Verify a fact / scope a field | `Agent` with subagent `researcher` (plugin-namespaced as `learn:researcher`) |
| A picture that carries the idea | the `visualize` skill |
| Persist a multi-session topic | the `curriculum` skill (`topics/<slug>/`) |

### Quiz protocol (AskUserQuestion has no grading — you are the grader)

1. **Decide the answer key privately.** Never write the correct answer, or hints toward it, in visible text before the question is answered. The learner may be reading the session log live.
2. `header`: `"Quiz"`. One concept per question.
3. Options: 2–3 real claims **plus a final option `"I don't know"`** (AskUserQuestion allows 4). "I don't know" is an honest signal, never graded as wrong — treat it as "not yet held", which is exactly what the probe needs.
4. **Place the correct option at a random position** — deliberately vary it across quizzes. Never append "(Recommended)". If several are correct, set `multiSelect: true` and say "select all that apply".
5. Option `description`s: either omit them for all options or make them parallel for all. A description on only the correct one is a giveaway.
6. Free text arriving through "Other" is the learner's own answer or note — grade its content.
7. **Grade immediately** in your next message, in this exact shape so it reads well in the log:
   - `✓ Correct — <option>` / `✗ Incorrect — you chose <x>; correct is <y>` / `? I don't know — the answer is <y>`
   - then the explanation (why the correct claim is correct, and what belief would make each distractor tempting).
8. Batching: during the **first breadth sweep** of Phase 1a you may put up to 4 independent quiz questions (different strands) in one `AskUserQuestion` call. Everywhere else, ask one at a time so each question can adapt to the last answer.

### Writing quiz options — a construction procedure

Don't audit evenness afterwards; **build the options so evenness is automatic**:

1. **Every option is a bare claim — no justification anywhere.** The #1 giveaway is the correct option carrying its own reasoning ("…, because it preserves X") while distractors are bare. All reasoning goes in your post-answer explanation.
2. **Write the correct claim first, then mutate it into each distractor.** Take one specific misconception or easily-confused neighbour and state what someone holding it would claim — same skeleton, grain size, register.
3. Each distractor must be a real error the learner might make (so the pick is diagnostic), yet unambiguously wrong — tempting, not tricky.
4. **No asymmetric emphasis.** Don't bold or quote the key term only in the correct option.

If, reading the set cold, you can tell which is right without knowing the material — regenerate, don't patch.

## The process: probe → plan → teach

Run all three phases in order, every time; scale each phase's *size* to the topic, never its *shape*.

**Accuracy is non-negotiable — verify, don't wing it.** The moment you are even slightly unsure of any fact, name, date, formula, definition, or claim, confirm it with a quick `researcher` subagent before saying it. Pausing to verify is always acceptable. If a check corrects what you were about to teach, say so plainly. A wrong unconditional truth corrupts every node built on it.

### Phase 1 — Probe (never skip this)

Two unknowns, two tools — keep the boundary clean.

**1a. Current level — quizzes. A mapping job, not a spot-check.** Locate the *edge* of their understanding along every strand the lesson depends on. This gets as long as it needs to. No rush.

**The edge is only located when it's bracketed.** For each relevant strand you need *both* a floor (something they get **right**) and a ceiling (something they get **wrong** or don't know). The edge sits between them.

- **All-correct is not "done" — the questions were too easy.** Escalate until something breaks.
- **Binary-search the edge.** When they nail one, jump difficulty up *sharply*. When they miss, narrow back in.
- **One wrong answer is not a cue to start teaching.** It may be a slip, an isolated gap, or a systematic misconception. Probe around it. Misconceptions matter most — a confidently-held wrong model has to be dislodged, not topped up.
- **Map every strand the lesson rests on**, bounded by relevance to the goal.

Do not advance until, for each goal-relevant strand, you can state concretely what they have and where it ends.

**1b. Learning goal — ungraded AskUserQuestion.** "I want to understand LLMs" can mean ten different things. Interrogate the vision until it's concrete. This has no right answer, so it's never a quiz.

If a `topics/<slug>/learner.md` exists (see the `curriculum` skill), read it first: it shortens the probe, but still re-check the strands this lesson leans on — knowledge decays.

### Phase 2 — Plan (think hard here)

The highest-leverage step. With level and goal in hand, reason out the best way to teach *this thing* to *this person*:

- **Scope the field first with a `researcher` subagent** — core concepts, real first principles, standard framings, common gotchas.
- What unconditional truths does this rest on? Is there a clean atomic unit?
- Which of those does the learner already hold (from 1a)? Build from there — not below, not above.
- What's the motivated discovery path from those truths to the goal?
- Socratic or expository for each stretch?

**Present the plan in chat — always, before any teaching:**

1. **The approach, in prose.** What, in what order, and why — given their edge and their goal.
2. **The dependency map.** A small ```mermaid``` DAG: unconditional truths at the roots, the goal as the sink. Few nodes, short labels. Obsidian renders it in the session log; if a picture would help in the terminal too, use the `visualize` skill.

**Stress-test the roots before presenting.** For every foundational node: is it genuinely an unconditional truth *for this learner*, or a disguised theorem? If it derives, push it down and extend the map.

**Then stop and wait for their go-ahead.** A wrong root is cheap to fix now, expensive mid-lesson.

### Phase 3 — Teach (the loop)

For **every node** (each unconditional truth *and* each non-trivial derived step):

1. **Motivate.** Why do we need this node right now? Applies to foundations too.
2. **Establish.** Foundation: state it plainly, no caveats. Derived step: build it from what's established via a motivated move. A gradable Socratic step is a quiz.
3. **Connect.** Make the dependency edge explicit.
4. **Quiz-check.** Confirm it landed. If they miss it, the node isn't solid — fix it before building on top.

Repeat per node — don't front-load foundations and then stop checking. If you catch yourself asserting something they'd have to take on faith, stop: motivate it or ground it.

At the end of a session that belongs to a curriculum, hand off to the `curriculum` skill's **close-out** step so progress persists.

## Formatting — math renders as LaTeX

The session is read rendered in Obsidian (via `/learn:md-log`), which renders LaTeX natively. Write math as LaTeX everywhere — explanations, quiz options, grading:

- Inline: `$f(x)$`
- Display: `$$` fenced on its own lines

Write $f(x) = x^2$, not `f(x) = x^2`. (AskUserQuestion popups show raw text, so keep math in options short and readable as source.)
