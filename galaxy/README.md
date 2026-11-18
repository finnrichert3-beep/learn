# Galaxy

School topics and the Baseline app, drawn as a glowing 3D galaxy that grows over time.
Static site: Vite + TypeScript + Three.js. No backend, no tracking, no network calls after the page loads.

| Desktop | Phone |
| --- | --- |
| ![Galaxy on a desktop screen](docs/desktop.jpg) | ![Galaxy on a phone](docs/phone.jpg) |

## Run it

Needs Node 20 or newer.

```bash
cd galaxy
```

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server with live reload |
| `npm test` | Unit tests (vitest) |
| `npm run build` | Type-check in strict mode, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

## Using it

- **Drag** to orbit, **scroll or pinch** to zoom, **right-drag or two-finger drag** to pan.
- It rotates slowly when left alone and stops the moment you touch it. It starts again after 5 seconds.
- **Hover** (or **tap**) a node to see its label, cluster and date. Tap empty space to clear it.
- **Click a cluster** in the legend to fly to it. Click it again, or "Show whole galaxy", to fly back. On a phone the legend is behind the **Clusters** button.
- **Timeline** at the bottom: play/pause (or the space bar), drag the scrubber, and watch nodes appear by date.

Add `?debug` to the address for an FPS readout (frame rate, frame time, particles drawn, quality level).
Add `?lockquality` to stop the automatic quality drop, for benchmarking.

## Edit the data

Everything on screen comes from one file: [`public/galaxy.json`](public/galaxy.json). Edit it, save, reload.

```json
{
  "clusters": [
    { "id": "calc", "name": "Calculus", "color": "#4d8dff", "group": "School" }
  ],
  "nodes": [
    { "id": "calc-limits", "label": "Limits", "cluster": "calc", "date": "2026-08-19" },
    { "id": "calc-derivatives", "label": "Derivatives", "cluster": "calc", "date": "2026-09-02", "size": 4 }
  ],
  "links": [
    ["calc-limits", "calc-derivatives"]
  ]
}
```

**Clusters**

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Short unique name that nodes refer to |
| `name` | yes | What the legend shows |
| `color` | yes | Hex color, `#rgb` or `#rrggbb` |
| `group` | no | Which super-cluster it belongs to (`"School"`, `"Baseline"`). Clusters with the same group sit together. Groups appear in the order they are first used. |

**Nodes**

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique name that links refer to |
| `label` | yes | Shown on hover or tap |
| `cluster` | yes | The `id` of one of the clusters |
| `date` | yes | `YYYY-MM-DD`. The node appears when the timeline reaches this date. |
| `size` | no | 1 to 5. Leave it out and the size comes from the link count: 1, plus 0.5 per link, up to 5. |

**Links** are pairs of node ids. Order does not matter, and the same pair written twice counts once.
A link shows up once both of its nodes are on screen.

The timeline runs from the earliest node date to the latest.
Each cluster gets 1,000 to 4,000 particles, a few more for clusters with more nodes.

### If you break the file

The page checks the file on load and shows an error card instead of the galaxy. It tells you where to look:

- JSON mistakes (missing or trailing comma, unclosed bracket, single quotes, comments) give a **line and column**.
- Data mistakes give the **line and the field**, for example `Line 90 · nodes[63].cluster · Unknown cluster "sleeep". Did you mean "sleep"?`

Things it checks: required fields, duplicate ids, nodes pointing at a cluster that doesn't exist, links pointing at a
node that doesn't exist, dates that aren't real calendar dates, sizes outside 1 to 5, colors that aren't hex, and
misspelled field names.

## Deploy to Vercel

The site is plain static files, so there is nothing to configure beyond telling Vercel where it lives.

**From the dashboard**

1. Import the repository at vercel.com/new.
2. Set **Root Directory** to `galaxy`.
3. Deploy. `vercel.json` already sets the build command (`npm run build`) and the output folder (`dist`).

**From the terminal**

```bash
cd galaxy
```

```bash
npx vercel --prod
```

Any other static host works too: run `npm run build` and upload the `dist/` folder. All paths are relative, so it can
sit at a domain root or in a sub-folder.

To update the live galaxy, edit `public/galaxy.json`, commit, and push. Vercel rebuilds on its own.

## How it works

| Part | File | Notes |
| --- | --- | --- |
| Load and validate | `src/data/` | Small JSON parser that tracks line numbers, then field checks. Never throws. |
| Sizes and timeline | `src/data/sizing.ts`, `src/data/timeline.ts` | Pure functions, unit tested |
| Layout | `src/layout/layout.ts` | d3-force-3d, seeded and run to rest before the first frame, so nothing moves on load |
| Rendering | `src/render/` | Three.js with `UnrealBloomPass`. Nodes, links, particles and stars are four draw calls. |
| Particles | `src/render/particles.ts` | One `THREE.Points` with a custom vertex shader. The swirl runs on the GPU; JavaScript only advances a clock. |
| Fading by date | `src/render/fade.ts` | One small texture holds each node's visibility. Nodes, links and particles all read it, so they always agree. |
| UI | `src/ui/` | Legend, timeline bar, tooltip, error card, FPS readout |

**Performance and motion**

- Frame rate is measured in one-second windows. Two slow windows in a row (under 30 FPS) step quality down: fewer
  particles first, then a lower pixel ratio. There are five levels and it never steps back up, so it can't flicker.
- Pixel ratio is capped at 2 and at about 7 million pixels per frame.
- Rendering stops completely while the tab is hidden.
- With "reduce motion" switched on in the system settings there is no auto-rotate, no swirl, no drift and no
  autoplay; bloom is constant; camera moves cut instead of flying; and frames are only drawn when something changes.

## Tests

```bash
npm test
```

- `tests/validate.test.ts`: JSON validation, line numbers, the seed file itself
- `tests/sizing.test.ts`: link-count sizing
- `tests/timeline.test.ts`: filtering nodes by date, month labels, the node count
- `tests/layout.test.ts`: the layout is deterministic and keeps the two super-clusters apart
- `tests/boot.test.ts`: a broken, missing or empty `galaxy.json` shows the error card instead of crashing
