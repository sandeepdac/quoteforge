# QuoteForge

AI-assisted quoting and estimating for job shops that make parts by **sheet-metal
fabrication** and by **CNC machining** (turning, milling and mill-turn).
Upload a CAD file (3D STEP or 2D PDF drawing), QuoteForge extracts the manufacturing
features, works out how the part would be made, and prices the job using your shop's
labour and machine rates, overhead, margin and rush rules. Every line of the price says
what drives it.

## Features

**Quoting**
- **CAD-driven quoting wizard** — Upload → Extract → Quantity → Review.
- **Native STEP (ISO-10303-21) parser** — bounding box, hole schedule, bend/feature
  detection, material callout and header metadata read directly from the B-Rep.
- **Transparent cost engine** — per-operation breakdown (material, each operation, setup,
  CAM programming, tooling, overhead, margin, rush premium) that sums to the price, a
  quantity price curve, and a win-probability estimate.
- **Inline drawing preview** — real PDF drawings render in-app; a bundled
  *P5 Round Top Flag* sample (STEP + PDF) drives the demo end-to-end.
- **Dashboard, quotes, jobs, invoices, parts, customers, materials, analytics and a
  fixture estimator**, with PDF quotes, invoices and job travellers.
- **Local persistence** — all data survives reloads (see below).

**CNC machining engine**
- **Geometry service** (Python + OpenCASCADE, `services/geometry/`) reads the real
  B-Rep: turned diameters, bores (stepped, and at each end), recesses, hex/square bar,
  threads, counterbores, cross holes, pockets and tool-access directions.
- **Turned parts** — per-operation cycle time for facing, roughing, finishing, drilling,
  boring, grooving and recesses, screwcutting (passes, run-out, deburr), part-off and
  driven tools; the drawing's surface finish feeds the finishing feeds.
- **Milled parts** — roughing, rest roughing, wall/floor finishing, drilling, tapping,
  deburring and part-off, using a tool library for chip load and the shop's own depth of cut.
- **Cutting and idle kept apart** per operation, the way a cycle sheet reads, with
  per-machine tool change and rapid, a per-operation idle floor, and bar handling.
- **Machine selection** — a cost-based comparison across the machines on the floor, with
  its reasoning shown; small prismatic parts are costed as bar.
- **Derived setup time** — dial-in, tooling, work-holding, programming and proving per
  machine, at per-machine setup rates, with an optional tightest-tolerance input.
- **Editable realisation allowances** (tool life, rigidity, one-off program, material
  condition, interrupted cut) and shop settings for rates, tool changes, idle floor and
  milling depth.

## Tech stack

React 19 · React Router 6 · TypeScript · Vite 6 · Tailwind CSS 4 · Three.js (3D viewer) ·
Recharts (analytics) · Express (server + Gemini endpoint) · Vitest (tests) ·
Python · FastAPI · OpenCASCADE (`cadquery-ocp`) for the geometry service.

## Getting started

```bash
npm install        # installs deps (an .npmrc pins legacy-peer-deps for React 19)
npm run dev        # start the app + API on http://localhost:3000
```

**Geometry service (optional, recommended for machined parts).** `npm run dev` starts it
for you if its virtualenv exists; without it the app falls back to a mesh approximation
and quotes are less precise. One-time setup:

```bash
cd services/geometry
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Set `GEOMETRY_AUTOSTART=false` to manage it yourself (`./run.sh`, port 8000). See
`services/geometry/README.md`.

### Scripts

| Script            | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | Express server with Vite middleware (hot reload).    |
| `npm run build`   | Production client build + bundled server (`dist/`).  |
| `npm run start`   | Run the production server from `dist/`.              |
| `npm run lint`    | Type-check the whole project (`tsc --noEmit`).       |
| `npm run test`    | Run the Vitest unit suite once.                      |
| `npm run test:watch` | Run tests in watch mode.                          |

### Environment

Copy `.env.example` to `.env`. `GEMINI_API_KEY` is **optional** — when it is absent the
CAD analysis falls back to the native STEP/PDF parsers, so the app is fully usable
without it. Never commit a real key.

## Architecture

- **`src/context/`** — React contexts hold app state: `QuoteContext` (quotes, parts,
  customers, materials), `SettingsContext` (shop rates/speeds/margins), `ThemeContext`.
- **`src/utils/estimator.ts`** — the sheet-metal pricing engine (pure functions).
- **`src/utils/turning.ts`, `cncEstimator.ts`** — turned-part cycle time (per operation,
  cutting and idle) and its cost roll-up; **`milling.ts`, `milledEstimator.ts`,
  `milledPlanner.ts`** — the milled equivalents and the operation plan.
- **`src/utils/machineSelection.ts`, `setupModel.ts`** — which machine and route a part
  takes, and the derived setup time.
- **`src/utils/quoteCosts.ts`** — one entry point (`resolveQuoteCosts`) the wizard prices through.
- **`services/geometry/`** — the Python/OpenCASCADE service that reads the real B-Rep.
- **`src/utils/stepParser.ts`** — the STEP B-Rep parser.
- **`src/utils/cadAnalyzer.ts`** — dispatches an uploaded file to the STEP parser,
  PDF metadata, or a fallback, returning a normalized feature set.
- **`server.ts`** — Express app; serves the SPA and the `/api/analyze-cad` Gemini route.

### Persistence

App data is persisted to `localStorage` through a small typed layer
(`src/utils/storage.ts`) under a versioned `quoteforge:vN:*` namespace. Access is
guarded, so private-mode browsers, full storage or a missing key all degrade to the
seed (demo) data rather than throwing. The API is intentionally backend-shaped
(`loadState` / `saveState` by logical name) so a real backend can replace it without
touching call sites. **Settings → Preferences → Reset Demo Data** clears saved state.

## Testing

Unit tests live next to the code they cover (`src/**/*.test.ts`) and run in Node via
Vitest — no browser required. Coverage focuses on the domain logic: the pricing and cycle-time
estimators, the STEP parser, the CAD dispatcher, machine selection, setup and the storage
layer. The geometry service has its own pytest suite (`services/geometry/tests`).

```bash
npm run test
```

**All-parts comparison against the shop's real numbers.** `src/utils/calibration/allParts.test.ts`
runs every STEP file we hold through the app's pipeline and prints cutting, idle, cycle and
price against the shop's cycle sheets, CAM reports and quotes. It is skipped by default (it needs
the geometry service and the STEP files); the file header says how to run it. See
`docs/calibration-notes.md` for where every constant comes from and which are guesses.

## Continuous integration

`.github/workflows/ci.yml` runs type-check, tests and a production build on every push
to `main` and on pull requests.
