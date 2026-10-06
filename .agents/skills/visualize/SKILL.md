---
name: visualize
description: Add a correct, minimal diagram or geometric picture to a lesson when shape, structure, direction, or spatial relationships are clearer in a picture.
---

# Visualize

A picture earns its place when it shows shape, structure, direction, relationships, or geometry more clearly than prose. Add one visual only when it helps the learner understand the idea.

## When to visualize

Use a diagram for structures and relationships such as dependencies, systems, flows, sequences, state machines, trees, comparisons, or containment. Use a geometric picture for coordinate geometry, number lines, vectors, function shapes, plots, or exact physical arrangements.

Do not visualize when prose or one equation already carries the idea. Decorative diagrams add noise and can introduce errors. When in doubt, leave it out.

## Choose a format

- Use Mermaid for node-and-edge relationships, flowcharts, sequences, state diagrams, trees, and timelines.
- Use SVG for exact positions, geometry, number lines, vectors, plots, and shapes Mermaid cannot place precisely.

Keep each picture focused on one idea. Before adding an element, ask whether removing it would make the idea unclear. If the diagram is growing beyond five to seven elements, simplify it.

## Create and check the visual

1. Decide the exact idea the picture must communicate.
2. Write the smallest useful Mermaid or SVG source. Use short labels and do not add facts the learner has not established.
3. If the conversation can display Mermaid, include a fenced Mermaid block in the reply. Otherwise, create a `.mmd` source file and render it with the bundled script:

   ```sh
   node .agents/skills/visualize/scripts/render-diagram.mjs diagram.mmd --slug short-topic
   ```

   For SVG, use the same command with an `.svg` source file. If this skill was installed outside the project, use the path to its `scripts/render-diagram.mjs` file instead. Rendering Mermaid requires the `mmdc` command. Rendering SVG requires `rsvg-convert` or ImageMagick's `magick` command. These are optional; the teaching workflow still works without them.
4. Inspect the rendered image when image viewing is available. Check that every arrow, label, coordinate, angle, and proportion is correct, and that nothing is clipped or hard to read. If the image cannot be inspected, say so and provide the source for review instead of claiming it is verified.
5. Put the image in the response using its returned path. If writing an Obsidian lesson note, embed the filename with `![[filename.png|500]]`.

The renderer saves PNGs under `viz/` in the current directory unless `--output-dir` is provided. Use a learner-selected directory when one is specified.

## Keep it accurate

- Build dependency graphs with foundations above the facts that depend on them.
- Omit relationships you cannot verify.
- Prefer fewer elements over cramped labels.
- Introduce the picture with one sentence. Let it carry its point without repeating every label in prose.
