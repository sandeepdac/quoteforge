# QuoteForge Geometry Service

A small local **FastAPI + OpenCASCADE (OCP)** service that reads the *real* turned
profile off a STEP solid — outer-diameter steps, central bore, grooves, and off-axis
"cross" features — and decides whether the part is a **body of revolution** (turnable).

It exists because the browser's WASM CAD build only exposes a tessellated **mesh**, not the
**B-Rep topology** needed for accurate profile/feature extraction. This service fills that
gap and returns a `TurningProfile` that plugs straight into QuoteForge's cycle-time
estimator.

> It **estimates geometry for quoting**; it does **not** generate toolpaths. Runs locally —
> client CAD never leaves the machine.

## What it does

- **Rotational-symmetry detection** (option 2): principal moments of inertia + a
  face-type/coaxiality check. A part is "turned" when its main form is a coaxial revolve of
  known surface types; off-axis holes are *flagged*, not disqualifying.
- **Profile extraction** (option 1): from the B-Rep faces — OD steps, central bore
  (diameter + depth), grooves, and cross features — plus exact volume & surface area.
- **Milled / prismatic analysis** (`milled` block, always computed) — the three
  high-leverage geometric rules that drive a milling quote:
  1. **Setup count** — cluster the tool-access directions of the real features
     (pocket-floor normals + hole axes) into distinct unit directions. Setups are
     the single biggest cost lever.
  2. **Cavity vs. boss** — classify every shared edge as concave (inside corner →
     pocket) or convex (outside corner → boss) via an orientation-free dihedral
     test; a pocket floor is a concave-ringed face reachable straight down its own
     normal (a solid-classifier ray separates floors from walls).
  3. **Z-accessible depth** — pocket depth ÷ min width; a high ratio flags a deep
     pocket (long, slow tool). Plus billet stock (bounding box) and removed volume.

## Setup

```bash
cd services/geometry
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`cadquery-ocp` ships prebuilt OpenCASCADE wheels, so no system CAD install is needed.

## Run

```bash
./run.sh                    # http://127.0.0.1:8000  (GEOMETRY_PORT to change)
```

Point the Node server at it with `GEOMETRY_URL` (defaults to `http://127.0.0.1:8000`).
The web app calls `POST /api/extract-profile-b64` on the Node server, which forwards here.
If this service isn't running, the app **falls back** to its built-in mesh approximation —
nothing breaks, quotes are just less precise.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{status:"ok"}` |
| POST | `/extract-profile` | multipart `file` | profile JSON |
| POST | `/extract-profile-b64` | `{fileName?, fileBase64}` | profile JSON |

Response shape:

```jsonc
{
  "ok": true,
  "is_turned": true,
  "confidence": 1.0,
  "reason": "Body of revolution: ⌀20.0 × 100.0 mm, 2 OD step(s), ⌀8.0 bore …",
  "axis": { "origin": [x,y,z], "dir": [x,y,z] },
  "profile": { "odMm", "lengthMm", "boreDiaMm", "boreDepthMm",
               "grooveCount", "threadCount", "faceCount", "crossFeatures" },
  "measured": { "volumeCm3", "surfaceAreaCm2", "boundingBoxMm": {x,y,z} },
  "counts": { "faces", "odSteps", "bores", "crossFeatures", "grooves" },
  "segments": [ { "type": "od|bore|cross", "radiusMm", "zStartMm", "zEndMm" } ]
}
```

## Tests

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests -q
```

Tests generate sample solids (stepped bored shaft, box, cross-drilled shaft) with OCP and
assert the verdict and profile.
