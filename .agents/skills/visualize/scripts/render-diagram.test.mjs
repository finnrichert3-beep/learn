import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandsFor, renderDiagram, slugify } from "./render-diagram.mjs";

function temporaryDirectory() {
	return mkdtempSync(join(tmpdir(), "learn-render-test-"));
}

test("slugify creates a safe non-empty filename component", () => {
	assert.equal(slugify("  Vectors & Lines!  "), "vectors-lines");
	assert.equal(slugify("!!!"), "diagram");
});

test("commandsFor selects Mermaid and SVG renderers by extension", () => {
	assert.deepEqual(commandsFor("lesson.mmd", "/tmp/out.png"), [
		{ command: "mmdc", args: ["-i", "lesson.mmd", "-o", "/tmp/out.png", "-s", "2", "-b", "white"] },
	]);
	assert.deepEqual(commandsFor("lesson.svg", "/tmp/out.png"), [
		{ command: "rsvg-convert", args: ["-z", "2", "lesson.svg", "-o", "/tmp/out.png"] },
		{ command: "magick", args: ["-density", "192", "-background", "white", "lesson.svg", "/tmp/out.png"] },
	]);
	assert.throws(() => commandsFor("lesson.txt", "/tmp/out.png"), /\.mmd or \.svg/);
});

test("renderDiagram publishes the rendered image and preserves an existing filename", async (t) => {
	const root = temporaryDirectory();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "vectors.mmd");
	const output = join(root, "viz");
	writeFileSync(source, "graph TD; A-->B");
	const run = (_command, args) => {
		writeFileSync(args[args.indexOf("-o") + 1], "png data");
		return { status: 0, stdout: "", stderr: "" };
	};

	const first = await renderDiagram({ sourcePath: source, outputDir: output, slug: "Vectors & Lines", now: () => 1234, run });
	assert.equal(first.filename, "viz-vectors-lines-1234.png");
	assert.equal(readFileSync(first.path, "utf8"), "png data");

	const second = await renderDiagram({ sourcePath: source, outputDir: output, slug: "Vectors & Lines", now: () => 1234, run });
	assert.equal(second.filename, "viz-vectors-lines-1234-2.png");
});

test("renderDiagram tries ImageMagick when rsvg-convert fails", async (t) => {
	const root = temporaryDirectory();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "shape.svg");
	writeFileSync(source, "<svg></svg>");
	const calls = [];
	const run = (command, args) => {
		calls.push(command);
		if (command === "magick") writeFileSync(args.at(-1), "png data");
		return { status: command === "magick" ? 0 : 1, stdout: "", stderr: "not installed" };
	};

	const result = await renderDiagram({ sourcePath: source, outputDir: join(root, "viz"), now: () => 5678, run });
	assert.deepEqual(calls, ["rsvg-convert", "magick"]);
	assert.equal(result.filename, "viz-shape-5678.png");
});

test("renderDiagram rejects partial files when every SVG renderer fails", async (t) => {
	const root = temporaryDirectory();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "shape.svg");
	const output = join(root, "viz");
	writeFileSync(source, "<svg></svg>");
	const run = (_command, args) => {
		writeFileSync(args.at(-1), "partial data");
		return { status: 1, stdout: "", stderr: "conversion failed" };
	};

	await assert.rejects(
		renderDiagram({ sourcePath: source, outputDir: output, run }),
		/Could not render/,
	);
	assert.equal(existsSync(output), false);
});
