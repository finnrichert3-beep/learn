#!/usr/bin/env python3
"""
Render a Mermaid or SVG source file to PNG for the visual maker subagents.

    python3 .claude/scripts/render.py mermaid <source.mmd>
    python3 .claude/scripts/render.py svg     <source.svg>
    python3 .claude/scripts/render.py svg     <source.svg> --publish <slug>

Without --publish: writes a preview PNG next to the source and prints its path,
so the maker can Read (look at) it.

With --publish: also copies the PNG into <repo>/viz/ as
viz-<slug>-<timestamp>.png and prints the filename + path (the only file that
lands in the notes vault).

Renderers:
  mermaid -> mmdc (if installed) or `npx -y @mermaid-js/mermaid-cli`, using a
             locally installed Chrome/Chromium when one is found
  svg     -> rsvg-convert, then ImageMagick (magick / convert), then headless
             Chrome as a last resort
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VIZ_DIR = REPO_ROOT / "viz"
MERMAID_CLI = "@mermaid-js/mermaid-cli@11.4.2"
TIMEOUT_S = 180


def find_chrome():
    env = os.environ.get("CHROME_PATH") or os.environ.get("PUPPETEER_EXECUTABLE_PATH")
    if env and Path(env).exists():
        return env
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    patterns = [
        "/opt/pw-browsers/chromium-*/chrome-linux*/chrome",
        str(Path.home() / ".cache/ms-playwright/chromium-*/chrome-linux*/chrome"),
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    return None


def run(cmd, cwd):
    try:
        res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=TIMEOUT_S)
    except FileNotFoundError as e:
        return False, str(e)
    except subprocess.TimeoutExpired:
        return False, f"timed out after {TIMEOUT_S}s: {cmd[0]}"
    return res.returncode == 0, (res.stderr or res.stdout).strip()


def render_mermaid(src: Path, out: Path):
    if shutil.which("mmdc"):
        base = [shutil.which("mmdc")]
    elif shutil.which("npx"):
        base = [shutil.which("npx"), "-y", MERMAID_CLI]
    else:
        return False, "Mermaid needs Node.js (npx) or mmdc on PATH. Install Node.js from https://nodejs.org"

    cmd = base + ["-i", str(src), "-o", str(out), "-b", "white", "-s", "2"]
    chrome = find_chrome()
    if chrome:
        cfg = src.parent / "puppeteer.json"
        cfg.write_text(json.dumps({"executablePath": chrome, "args": ["--no-sandbox"]}))
        cmd += ["-p", str(cfg)]
    ok, msg = run(cmd, cwd=src.parent)
    return ok and out.exists(), msg


def svg_size(src: Path):
    text = src.read_text(errors="ignore")
    tag = re.search(r"<svg\b[^>]*>", text, re.S)
    tag = tag.group(0) if tag else ""
    w = re.search(r'\bwidth="([\d.]+)', tag)
    h = re.search(r'\bheight="([\d.]+)', tag)
    if w and h:
        return int(float(w.group(1))), int(float(h.group(1)))
    vb = re.search(r'viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)', tag)
    if vb:
        return int(float(vb.group(1))), int(float(vb.group(2)))
    return 800, 600


def render_svg(src: Path, out: Path):
    errors = []
    if shutil.which("rsvg-convert"):
        ok, msg = run(["rsvg-convert", "-z", "2", "-b", "white", str(src), "-o", str(out)], cwd=src.parent)
        if ok and out.exists():
            return True, msg
        errors.append(f"rsvg-convert: {msg}")
    for im in ("magick", "convert"):
        exe = shutil.which(im)
        # Windows ships an unrelated convert.exe; only trust it if it's ImageMagick.
        if exe and not (im == "convert" and os.name == "nt"):
            ok, msg = run([exe, "-density", "192", "-background", "white", str(src), str(out)], cwd=src.parent)
            if ok and out.exists():
                return True, msg
            errors.append(f"{im}: {msg}")
    chrome = find_chrome()
    if chrome:
        w, h = svg_size(src)
        ok, msg = run(
            [
                chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                "--force-device-scale-factor=2", f"--window-size={w},{h}",
                f"--screenshot={out}", src.resolve().as_uri(),
            ],
            cwd=src.parent,
        )
        if ok and out.exists():
            return True, msg
        errors.append(f"chrome: {msg}")
    if not errors:
        errors.append("no SVG renderer found: install librsvg (rsvg-convert), ImageMagick, or Google Chrome")
    return False, "\n".join(errors)


def publish(png: Path, slug: str):
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")[:48] or "diagram"
    VIZ_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = VIZ_DIR / f"viz-{slug}-{stamp}.png"
    n = 2
    while dest.exists():
        dest = VIZ_DIR / f"viz-{slug}-{stamp}-{n}.png"
        n += 1
    shutil.copyfile(png, dest)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["mermaid", "svg"])
    ap.add_argument("source")
    ap.add_argument("--publish", metavar="SLUG", help="also save into viz/ under this short kebab-case name")
    args = ap.parse_args()

    src = Path(args.source).resolve()
    if not src.exists():
        print(f"ERROR: source not found: {src}")
        return 1
    out = src.with_suffix(".png")
    if out.exists():
        out.unlink()

    ok, msg = (render_mermaid if args.kind == "mermaid" else render_svg)(src, out)
    if not ok:
        print("ERROR: render failed\n" + msg)
        return 1

    print(f"preview: {out}")
    if not args.publish:
        print("Now Read that PNG and LOOK at it before publishing.")
    else:
        dest = publish(out, args.publish)
        print("RESULT:")
        print(f"filename: {dest.name}")
        print(f"path: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
