# QuoteForge — Statement of Work & Proposal

**Prepared for:** Turncircuit — Precision CNC Machining
**Prepared by:** Delivery Team
**Date:** 4 August 2026
**Version:** 3.0
**Engagement:** AI-assisted quoting tool for precision CNC **turning**
**Duration:** 2 weeks · **Rate:** GBP 22.00 / hour (ex. VAT)

> **Revision note (v3.0):** narrowed and sharpened to **turned parts only**, driven by a
> **cycle-time** cost model with **batch-quantity** pricing and a **shop efficiency
> calibration factor**. The tool **estimates cycle time; it does not generate toolpaths —
> your CAM (SolidCAM) stays in place.** Milled/prismatic parts, sheet-metal fabrication and
> G-code generation are explicitly out of scope. (v1 quoted sheet-metal fabrication; v2
> broadened to machining generally; this v3 reflects the agreed turning PoC scope.)

---

## 1. Problem Statement

Turncircuit produces intricate precision components on modern **sliding-head (Swiss)
turning and turn-mill** equipment, in **metals and plastics**, for demanding sectors —
aircraft interiors, musical instruments, flow-control, marine, sanitary brass, security
systems. Quoting these parts is **manual, slow, and inconsistent**:

- An estimator opens each model, reads dimensions, picks a bar, judges cycle time and
  setups, and keys numbers into a spreadsheet. A single quote takes 20–60 minutes.
- Most shops receive **more RFQs than they can properly estimate**, and cherry-pick badly.
- For a machinist, **price is dominated by how long the part occupies the machine** — and
  **batch quantity changes the answer completely**: a 5-off is mostly setup and
  programming; a 500-off is almost entirely cycle time. Same drawing, same customer.
- Machinability varies ~5× across materials (brass/aluminium vs stainless, titanium,
  PEEK), so it's easy to under-price a slow material.

The tool's job is **triage and consistency**, not replacing the estimator: produce a fast,
defensible rough number on **every** RFQ so the estimator can choose which deserve real
attention. The tool proposes; the estimator confirms or overrides; every override is a
data point.

---

## 2. Scope — turned parts

**IN SCOPE: rotationally-symmetric (turned) parts** — shafts, bushes, spacers, flanges,
pins, adaptors — where a 2D profile revolved about an axis makes cycle time close to
deterministic.

**CAD ingestion & measurement**
- Upload 3D solids (STEP / STP / IGES / BREP); measure geometry from the B-Rep (bounding
  box, volume → weight, surface area) with OpenCascade.
- **Rotational-symmetry detection** — classify the solid as turned or not; **if it is not
  a turned part, say so clearly and do not produce a number.**
- 2D drawings (PDF/image): AI vision reads **tolerances, surface finish (Ra), thread specs,
  material, heat-treat/plating notes** — flagged "verify". Manual confirmation otherwise.

**Cycle-time cost model** (the core)
- **Stock**: next standard bar over OD + allowance; cutoff/facing/parting loss; removal
  volume; buy-to-fly material yield.
- **Cycle time** built op-by-op: facing, roughing (MRR), finishing (rpm/feed per segment),
  drilling (peck penalty on deep holes), boring, grooving, threading, part-off, plus
  **non-cutting time** (tool changes, rapids, bar load).
- **Material tables** (cutting speed, feed, depth of cut, density, machinability) for
  free-cutting/medium-carbon/alloy steel, SS 303/316, Al 6082/7075, brass, and plastics.
- **Setup time amortised over batch quantity**, shown as a **price-per-part curve**
  (qty 1/5/25/100/500).
- **Shop efficiency factor** (`actual = theoretical ÷ factor`) as the prominent, live
  calibration control — designed for consistency, corrected with one slider.
- Every cost line shows its driver **with time** (e.g. "Roughing — 34.2 cm³ @ 62 cm³/min —
  33 s — £14.20").

**Turning DFM (advisory)**
- Buy-to-fly waste, **slenderness (L/D)**, bar-diameter/envelope limits, deep bores,
  small/micro holes, thin walls, **tight tolerance/fine finish → grinding flag**, and
  **off-axis features → second-op / live-tooling flag** (detected, not costed).

**Kept from the existing build:** STEP ingestion & measurement, 3D viewer, quote lifecycle
(draft/sent/won/lost), PDF export, parts/materials/customers, shop-configurable rates &
margins, **local-first persistence** (client data never leaves their machine), analytics.

---

## 3. Out of Scope

Explicitly **not** included in this turning PoC:

- **Milled / prismatic parts** (arbitrary 3D geometry; setup planning is a hard problem).
  Detected and flagged, not costed.
- **5-axis** anything.
- **Live tooling / driven-tool features** (cross-drilling, flats, keyways) — **detected and
  flagged as second-op / live-tooling, not costed.**
- **G-code / toolpath generation** — the tool **estimates cycle time; it does not generate
  toolpaths. SolidCAM stays in place.** This is stated in the UI and generated docs.
- **Sheet-metal fabrication**, flat patterns, nesting, DXF export.
- **Server-side database, multi-user accounts, authentication** — persistence is
  local-first (browser) this phase.
- **ERP / MRP / accounting integrations** and automated RFQ intake.
- **Bespoke AI model training** — a hosted vision model (Gemini) is used via API.

---

## 4. Solution

A single-page web application (React + TypeScript + Vite, Tailwind) with a thin
Node/Express API for AI extraction.

**Honest, measured-first pipeline** — never present a number the tool cannot justify:

| Input | Path | Result |
|---|---|---|
| **STEP / IGES / BREP (turned solid)** | Tessellate → measure → confirm rotational → profile → **cycle-time cost** | Authoritative, calibratable. **Preferred.** |
| **STEP solid, not rotational** | Detected & **flagged out of scope** | No number — quote manually / in CAM. |
| **PDF / image (drawing)** | Gemini vision reads tolerance/finish/thread/material | Indicative; flagged "verify". |
| **Unreadable** | Manual confirmation | User-entered; no fabrication. |

**The demo tells the story in four beats:** (1) measurement panel — stock, removal, feature
list the machinist verifies by eye; (2) operation breakdown with time and cost per line;
(3) the **batch-quantity curve** — the moment they recognise their own business; (4) the
**efficiency slider** — calibrate against one part they know cold until it matches, and
every quote on screen recalibrates. That turns "your number is wrong" into "your model just
needs my rate."

---

## 5. Timeline (2 weeks) — build order

| Phase | Work | Deliverable |
|---|---|---|
| 1 | Strip sheet-metal | Remove sheet-metal cost/DFM/bend; keep ingestion, measurement, viewer, lifecycle |
| 2 | Geometry | Rotational-symmetry detection + profile extraction from the B-Rep |
| 3 | Profile → ops | Segment the profile into turning operations (OD steps, faces, grooves, bores) |
| 4 | Cycle-time engine | Op-by-op time + material cutting tables |
| 5 | Cost & batch | Stock, setup model, cost roll-up, **batch-quantity curve** |
| 6 | Calibration & trust | **Efficiency slider**, assumptions panel, confidence indicators |
| 7 | Turning DFM | Deep bores, thin walls, small holes, tolerance→grinding, cross-features→2nd op |
| 8 | Validation | Compare against Fusion 360 cycle times on 8–10 parts; report mean **and spread** |

**Highest-risk work is phases 2–3** (profile extraction and operation inference). OCCT
handles the sectioning; the inference rules need real iteration — budgeted accordingly.

---

## 6. Commercials

| Item | Detail |
|---|---|
| **Rate** | **GBP 22.00 / hour** (ex. VAT) |
| **Assumed effort** | 2 weeks · 10 working days · ~8 hours/day |
| **Estimated hours** | 70–80 hours |
| **Estimated total** | **GBP 1,540 – 1,760** (ex. VAT) |

**Notes**
- Billed on **actual hours worked** against the timeline; the range reflects final scope
  and the phase 2–3 iteration.
- Excludes VAT and third-party costs — notably **Google Gemini API usage** (drawing path),
  billed to the client at cost.
- **Payment terms:** to be agreed — suggested 50% on commencement, 50% on handover, net 14.
- Scope changes via a short written change note at the same hourly rate.

---

## 7. Validation & acceptance

No client data required — ground truth is built in-house:

1. Take 8–10 representative turned parts (GrabCAD / McMaster / modelled).
2. Program each in **Fusion 360** (free tier) with realistic tooling for a CAM cycle time.
3. Run QuoteForge on the same STEP files.
4. Report **mean error and the standard deviation of error** — the spread matters more
   than the mean.

**Acceptance target:** after fitting the efficiency factor on 3 parts, **≥ 70% of the
remaining parts within ±25%**, with consistent direction of error (a uniform bias is one
slider adjustment; random spread is not). Reported honestly in the demo — a stated error
bar earns more trust than an unsupported accuracy claim.

---

## 8. Assumptions & Risks

**Assumptions**
- **Turned parts are the target.** Non-rotational parts are flagged, not costed.
- The tool **estimates cycle time, not toolpaths** — it complements SolidCAM, not replaces
  it, and does not replace the estimator (triage + consistency).
- Turncircuit provides **machine rates, setup times, margins and material prices**; the
  tool ships with public-catalogue cutting-data defaults, calibrated via the efficiency
  factor during UAT.
- The client provides a **Gemini API key** for the drawing path (billed to the client).
- Persistence is **local-first (browser)** this phase.
- One primary stakeholder is available for daily review/UAT, and can supply one known part
  with its actual cycle time for calibration.

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| **Profile extraction / operation inference** (phases 2–3) is the hard part | Wrong op list → wrong time | Budgeted iteration; confidence indicator; estimator can override any value |
| **Cycle time is a model, not a CAM simulation** | Over/under on complex parts | Efficiency factor calibrates the bias uniformly; validated against Fusion 360 |
| **Rotational-symmetry edge cases** | Mis-classification | Confidence score; non-rotational parts flagged out of scope, never silently costed |
| **Cutting-data defaults** are generic per family | Cost drift on specific alloys/tempers | Shop-tunable; calibrated on real jobs |
| **Off-axis / live-tooling features** | Under-quoting | Detected and flagged as 2nd-op / live-tooling; not silently costed |
| **Tight tolerance / fine finish** | Missing a grinding op | DFM flags it for a secondary operation and inspection |
| **Gemini API** availability/cost | Drawing path degraded | Graceful fallback to manual; STEP path unaffected |
| **Scope creep** into milling/CAM/5-axis/ERP | Timeline slip | Explicit Out-of-Scope list; change-note process |

---

*Design principle throughout: measure what we can, state confidence, flag what we can't,
and never fabricate a number we cannot justify. The efficiency factor makes the model
**consistent** — being 25% low on every part is one slider; being randomly ±25% is
unfixable.*
