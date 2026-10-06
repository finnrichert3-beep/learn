#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RENDER_TIMEOUT_MS = 120_000;

export function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "diagram";
}

export function commandsFor(sourcePath, outputPath) {
	const extension = extname(sourcePath).toLowerCase();
	if (extension === ".mmd") {
		return [{
			command: "mmdc",
			args: ["-i", sourcePath, "-o", outputPath, "-s", "2", "-b", "white"],
		}];
	}
	if (extension === ".svg") {
		return [
			{ command: "rsvg-convert", args: ["-z", "2", sourcePath, "-o", outputPath] },
			{ command: "magick", args: ["-density", "192", "-background", "white", sourcePath, outputPath] },
		];
	}
	throw new Error("Source file must end in .mmd or .svg.");
}

function runProcess(command, args, timeoutMs = RENDER_TIMEOUT_MS) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs });
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.error?.message || result.stderr || "",
	};
}

function uniqueOutputPath(outputDir, slug, timestamp) {
	const base = `viz-${slugify(slug)}-${timestamp}`;
	let suffix = 1;
	let filename = `${base}.png`;
	while (existsSync(join(outputDir, filename))) {
		suffix += 1;
		filename = `${base}-${suffix}.png`;
	}
	return { filename, path: join(outputDir, filename) };
}

export async function renderDiagram({
	sourcePath,
	outputDir = join(process.cwd(), "viz"),
	slug,
	now = () => Date.now(),
	run = runProcess,
}) {
	if (!sourcePath) throw new Error("Provide a source file path.");
	const source = resolve(sourcePath);
	if (!existsSync(source) || !statSync(source).isFile()) {
		throw new Error(`Source file does not exist: ${source}`);
	}

	const stageDir = mkdtempSync(join(tmpdir(), "learn-diagram-"));
	const stagedPng = join(stageDir, "render.png");
	const errors = [];
	let rendered = false;
	try {
		const commands = commandsFor(source, stagedPng);
		for (const { command, args } of commands) {
			const result = await run(command, args, RENDER_TIMEOUT_MS);
			if (result.status === 0 && existsSync(stagedPng)) {
				rendered = true;
				break;
			}
			errors.push(`${command}: ${result.stderr || result.stdout || `exit status ${result.status}`}`);
		}
		if (!rendered) {
			const hint = extname(source).toLowerCase() === ".mmd"
				? "Install Mermaid CLI so the mmdc command is available."
				: "Install rsvg-convert or ImageMagick so rsvg-convert or magick is available.";
			throw new Error(`Could not render ${source}. ${hint}\n${errors.join("\n")}`);
		}

		const destinationDirectory = resolve(outputDir);
		mkdirSync(destinationDirectory, { recursive: true });
		const output = uniqueOutputPath(destinationDirectory, slug || basename(source, extname(source)), now());
		copyFileSync(stagedPng, output.path);
		return output;
	} finally {
		rmSync(stageDir, { recursive: true, force: true });
	}
}

function printUsage() {
	console.log("Usage: node render-diagram.mjs <source.mmd|source.svg> [--slug name] [--output-dir directory]");
	console.log("Renders to <output-dir>/viz-<slug>-<timestamp>.png (default output-dir: ./viz).");
}

async function main(argv) {
	if (argv.includes("--help") || argv.includes("-h")) {
		printUsage();
		return;
	}
	const sourcePath = argv[0];
	let slug;
	let outputDir = join(process.cwd(), "viz");
	for (let index = 1; index < argv.length; index += 1) {
		const option = argv[index];
		if (option === "--slug" || option === "--output-dir") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
			if (option === "--slug") slug = value;
			else outputDir = value;
			index += 1;
		} else {
			throw new Error(`Unknown option: ${option}`);
		}
	}
	const output = await renderDiagram({ sourcePath, outputDir, slug });
	console.log(`Published ${output.path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		printUsage();
		process.exitCode = 1;
	});
}
