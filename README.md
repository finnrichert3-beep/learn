# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

A personal learning system built around two teaching principles: start from truths the learner accepts, and make each new idea feel discoverable. The source video is [here](https://www.youtube.com/watch?v=kzcI5F4tGiU).

## What's included

- `.agents/skills/teach/` — the teaching method and session flow
- `.agents/skills/visualize/` — guidance for creating a useful diagram or geometric picture
- `.agents/skills/visualize/scripts/render-diagram.mjs` — optional Mermaid and SVG to PNG renderer
- `.codex/agents/researcher.toml` — an optional read-only research specialist

## Use

Open this repository as the working project to use the skills here. To use them in another project, copy or symlink the skill directories into that project's `.agents/skills/` directory:

```sh
git clone https://github.com/amosblomqvist/learn /path/to/learn
mkdir -p /path/to/learning-project/.agents/skills
ln -s /path/to/learn/.agents/skills/teach /path/to/learning-project/.agents/skills/teach
ln -s /path/to/learn/.agents/skills/visualize /path/to/learning-project/.agents/skills/visualize
```

Select or mention `teach` when starting a lesson. Use `visualize` when a picture will make an idea clearer.

You can also install them for personal use by linking them into `~/.agents/skills/`:

```sh
mkdir -p ~/.agents/skills
ln -s /path/to/learn/.agents/skills/teach ~/.agents/skills/teach
ln -s /path/to/learn/.agents/skills/visualize ~/.agents/skills/visualize
```

The core teaching workflow needs no `pi`, packages, or extensions. Ask questions and grade answers in the conversation. Lesson notes are written only when requested; give a destination path or choose one when asked.

## Optional diagram rendering

Mermaid rendering requires Node.js 22.13 or later and the `mmdc` command. Install Mermaid CLI with `npm install --global @mermaid-js/mermaid-cli`. SVG rendering uses `rsvg-convert` when available, with ImageMagick's `magick` as a fallback. You can still use Mermaid source directly when these tools are unavailable.

From a learning project, render a source diagram with:

```sh
node /path/to/learn/.agents/skills/visualize/scripts/render-diagram.mjs diagram.mmd --slug short-topic
```

The renderer saves the PNG in `./viz/` by default. Set `--output-dir` to choose another directory.

Run the renderer checks with `node --test .agents/skills/visualize/scripts/render-diagram.test.mjs`.

## Background

This system is personal and written for one learner. Edit the teaching skill to fit how you learn best.
