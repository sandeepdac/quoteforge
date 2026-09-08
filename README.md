# QuoteForge

AI-assisted quoting and estimating for sheet-metal and structural fabrication shops.
Upload a CAD file (3D STEP or 2D PDF drawing), QuoteForge extracts the manufacturing
features (bounding box, holes, bends, welds, weight), and prices the job using your
shop's labour rates, overhead, margin and rush rules.

## Features

- **CAD-driven quoting wizard** — Upload → AI Extraction → Quantity → Review.
- **Native STEP (ISO-10303-21) parser** — bounding box, hole schedule, bend/feature
  detection, material callout and header metadata read directly from the B-Rep.
- **Inline drawing preview** — real PDF drawings render in-app; a bundled
  *P5 Round Top Flag* sample (STEP + PDF) drives the demo end-to-end.
- **Transparent cost engine** — per-operation breakdown (laser, brake, weld, assembly,
  finish) plus overhead, margin and rush premium, with a win-probability estimate.
- **Dashboard, quotes, parts, customers, materials, analytics and a fixture estimator.**
- **Local persistence** — all data survives reloads (see below).

## Tech stack

React 19 · React Router 6 · TypeScript · Vite 6 · Tailwind CSS 4 · Three.js (3D viewer) ·
Recharts (analytics) · Express (server + Gemini endpoint) · Vitest (tests).

## Getting started

```bash
npm install        # installs deps (an .npmrc pins legacy-peer-deps for React 19)
npm run dev        # start the app + API on http://localhost:3000
```

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
without it.

## Architecture

- **`src/context/`** — React contexts hold app state: `QuoteContext` (quotes, parts,
  customers, materials), `SettingsContext` (shop rates/speeds/margins), `ThemeContext`.
- **`src/utils/estimator.ts`** — the pricing engine (pure functions).
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
Vitest — no browser required. Coverage focuses on the domain logic: the pricing
estimator, the STEP parser (including regression guards for material false-positives
and header parsing), the CAD dispatcher, and the storage layer.

```bash
npm run test
```

## Continuous integration

`.github/workflows/ci.yml` runs type-check, tests and a production build on every push
to `main` and on pull requests.
