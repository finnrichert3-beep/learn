#!/usr/bin/env node
/**
 * viz — render-and-publish helper for the mermaid-maker / svg-maker subagents.
 *
 *   node viz.mjs new <mermaid|svg> <slug>   create a work dir, print the source path to Write
 *   node viz.mjs render <source>            render to a preview PNG next to the source, print its path
 *   node viz.mjs publish <source> <slug>    render and copy into <project>/viz/viz-<slug>-<ts>.png
 *
 * The subagent Reads the printed PNG path to LOOK at the result before publishing.
 * Work dirs live under the OS temp dir, so only published PNGs land in the vault.
 *
 * Mermaid: `mmdc` on PATH, else `npx @mermaid-js/mermaid-cli` (cached after first run).
 * SVG: headless Chrome screenshot, else rsvg-convert, else ImageMagick.
 * Node builtins only — nothing to install.
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
const ENV = { ...process.env, PATH: [...EXTRA_PATH, process.env.PATH ?? ""].join(":") }
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]
const TIMEOUT_MS = 180_000

const chrome = () => CHROME_CANDIDATES.find((c) => existsSync(c))
const has = (bin) => spawnSync("which", [bin], { env: ENV }).status === 0
const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "viz"

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function run(cmd, args, env = ENV) {
  const res = spawnSync(cmd, args, { env, encoding: "utf8", timeout: TIMEOUT_MS })
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}${res.error ? String(res.error) : ""}`
  return { ok: res.status === 0, out: out.split("\n").slice(-30).join("\n") }
}

function renderMermaid(src, out) {
  const dir = dirname(src)
  const browser = chrome()
  const cfg = join(dir, "puppeteer.json")
  writeFileSync(cfg, JSON.stringify(browser ? { executablePath: browser, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }))
  const env = browser ? { ...ENV, PUPPETEER_SKIP_DOWNLOAD: "1" } : ENV
  const args = ["-i", src, "-o", out, "-p", cfg, "-s", "2", "-b", "white"]
  return has("mmdc")
    ? run("mmdc", args, env)
    : run("npx", ["-y", "-p", "@mermaid-js/mermaid-cli@11", "mmdc", ...args], env)
}

function svgSize(svg) {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ""
  const num = (name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(tag)
    return m ? Number(m[1]) : undefined
  }
  const vb = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number)
  const w = num("width") ?? vb?.[2] ?? 800
  const h = num("height") ?? vb?.[3] ?? 600
  return { w: Math.ceil(w), h: Math.ceil(h) }
}

function renderSvg(src, out) {
  const svg = readFileSync(src, "utf8")
  const { w, h } = svgSize(svg)
  const browser = chrome()
  const errors = []
  if (browser) {
    const html = join(dirname(src), "page.html")
    writeFileSync(
      html,
      `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`,
    )
    const res = run(browser, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      `file://${html}`,
    ])
    if (res.ok && existsSync(out)) return res
    errors.push(`chrome: ${res.out}`)
  }
  if (has("rsvg-convert")) {
    const res = run("rsvg-convert", ["-z", "2", "-b", "white", "-o", out, src])
    if (res.ok && existsSync(out)) return res
    errors.push(`rsvg-convert: ${res.out}`)
  }
  if (has("magick")) {
    const res = run("magick", ["-density", "192", "-background", "white", src, out])
    if (res.ok && existsSync(out)) return res
    errors.push(`magick: ${res.out}`)
  }
  return { ok: false, out: errors.join("\n\n") || "No SVG renderer found (install Google Chrome, librsvg, or ImageMagick)." }
}

function render(src) {
  if (!existsSync(src)) die(`Source not found: ${src}`)
  const dir = dirname(src)
  const n = readdirSync(dir).filter((f) => f.startsWith("preview-")).length + 1
  const out = join(dir, `preview-${n}.png`)
  const ext = extname(src).toLowerCase()
  const res = ext === ".svg" ? renderSvg(src, out) : renderMermaid(src, out)
  if (!res.ok || !existsSync(out)) die(`RENDER FAILED — no image produced. Fix the source and render again.\n\n${res.out}`)
  return out
}

const [cmd, a, b] = process.argv.slice(2)

if (cmd === "new") {
  if (a !== "mermaid" && a !== "svg") die("usage: viz.mjs new <mermaid|svg> <slug>")
  const dir = join(tmpdir(), "learn-viz", `${a}-${slugify(b)}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  console.log(join(dir, a === "svg" ? "picture.svg" : "diagram.mmd"))
} else if (cmd === "render") {
  if (!a) die("usage: viz.mjs render <source>")
  const out = render(resolve(a))
  console.log(`preview: ${out}\nRead this PNG and LOOK at it before publishing.`)
} else if (cmd === "publish") {
  if (!a || !b) die("usage: viz.mjs publish <source> <slug>")
  const out = render(resolve(a))
  const vizDir = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), "viz")
  mkdirSync(vizDir, { recursive: true })
  const filename = `viz-${slugify(b)}-${Date.now()}.png`
  const dest = join(vizDir, filename)
  copyFileSync(out, dest)
  console.log(`filename: ${filename}\npath: ${dest}`)
} else {
  die(`usage:\n  ${basename(process.argv[1])} new <mermaid|svg> <slug>\n  ${basename(process.argv[1])} render <source>\n  ${basename(process.argv[1])} publish <source> <slug>`)
}
