# QuoteForge — Statement of Work & Proposal

**Prepared for:** Turncircuit — Precision CNC Machining
**Prepared by:** Delivery Team
**Date:** 4 August 2026
**Version:** 2.0
**Engagement:** AI-assisted quoting tool for precision CNC machining (turning + turn-mill)
**Duration:** 2 weeks · **Rate:** GBP 22.00 / hour (ex. VAT)

> **Revision note (v2.0):** rescoped from sheet-metal fabrication to **precision CNC
> machining** following Turncircuit's feedback. Sheet-metal forming (laser/press-brake/
> unfolding) is well served by other software and is explicitly out of scope. The
> measurement engine carries over; the cost model and DFM are now machining-specific.

---

## 1. Problem Statement

Turncircuit produces intricate precision components on modern **sliding-head (Swiss)
turning and turn-mill** equipment, in **metals and plastics**, for demanding sectors —
aircraft interiors, musical instruments, flow-control, marine, sanitary brass, security
systems. Quoting these parts today is **manual, slow, and inconsistent**:

- An estimator opens each model or drawing, reads dimensions, decides bar or billet,
  judges how much material is cut away, guesses cycle time and setups, and keys numbers
  into a spreadsheet. A single quote takes 20–60 minutes.
- Different estimators price the same part differently, and there is no audit trail
  linking a price to the geometry it came from — quotes are hard to defend or review.
- Machinability varies enormously (free-cutting brass and aluminium vs stainless,
  titanium, PEEK), and it's easy to under-price a slow material or a low-yield part.
- Manufacturability problems — a slender turned part that will chatter, a micro-drilled
  hole, a part that's 95% chips — surface **on the machine**, as scrap and lost time,
  instead of at quote time.

Turncircuit needs a tool that **reads the part, sizes the stock, explains what it
measured, and produces a defensible machining quote in minutes — without fabricating any
number it cannot stand behind.**

---

## 2. Scope

The engagement delivers **QuoteForge**, a browser-based quoting application for CNC
machining, covering:

**CAD ingestion & measurement**
- Upload 3D solids (STEP / STP / IGES / BREP) and measure geometry directly from the
  B-Rep — bounding box, volume → weight, surface area — using OpenCascade.
- **Part-class detection**: classify each solid as **turned** (round-bar) or **milled**
  (billet) from its geometry, which drives the whole cost model.
- Upload 2D drawings (PDF / image) and extract dimensions via **AI vision (Google
  Gemini)** when a key is configured, clearly flagged "read from drawing — verify".
- Honest fallback to manual confirmation for anything that can't be measured or read —
  **no invented dimensions**.

**Machining cost model (subtractive)**
- **Stock sizing**: round bar (⌀ + allowance, length + facing) for turned parts;
  rectangular billet (grown faces) for milled parts.
- **Material removal (roughing)**: cost of turning `stock − part` volume into chips, at a
  removal rate **scaled by each material's machinability**.
- **Finishing, drilling/boring, setups, inspection and deburr** — each an itemised,
  traceable line tied to a measured driver.
- **Buy-to-fly (material yield)** — part volume ÷ stock volume — surfaced on every quote
  as a headline cost/waste indicator.
- **Material library for metals *and* plastics** (aluminium, brass, bronze, stainless,
  titanium, acetal, nylon, PEEK, PTFE …) with density and machinability.

**Machining DFM (advisory)**
- Buy-to-fly waste, **turned slenderness (L/D)**, **sliding-head bar-diameter limit**,
  machine-envelope fit, small/micro holes, thin walls, tight-tolerance and multi-setup
  cost flags — each derived from the measured geometry, with a manufacturability score.

**Quoting, data & UX**
- Shop-configurable machine rates, removal/finishing rates, setup times, margins and
  overhead; quantity, lead-time, rush handling; quote statuses; PDF export.
- Parts, materials (editable prices), customers, and quote history (local-first).
- Dashboard & analytics with real KPIs (win rate, margin, pipeline) and estimator
  accuracy (estimate vs recorded actual).
- Light/dark theming, responsive layout, top-level error boundary.

**Quality**
- Automated unit tests for the estimator, part-class detection, DFM and parsers; CI on
  push; production build.

---

## 3. Out of Scope

Explicitly **not** included in this 2-week engagement (available as future phases):

- **Sheet-metal fabrication** — laser/plasma cutting, press-brake bending, flat-pattern
  unfolding, welding. This is a different process with mature dedicated software; it is
  not Turncircuit's business and is out of scope.
- **True CNC/G-code generation** (turning/milling posts, tool libraries, work offsets) —
  safety-critical and out of domain. QuoteForge estimates cost/time; it does not program
  the machines.
- **Automatic feature recognition of pockets/threads/grooves** beyond holes/bores and the
  turned-vs-milled classification (cost model uses volume/area/holes/setups).
- **Nesting / bar-utilisation optimisation** across multiple parts per bar.
- **Server-side database, multi-user accounts, authentication and roles** — persistence is
  local-first (browser) for this phase.
- **ERP / MRP / accounting integrations** and automated RFQ email intake.
- **Bespoke AI model training** — the tool uses a hosted vision model (Gemini) via API.

---

## 4. Solution

QuoteForge is a single-page web application (React + TypeScript + Vite, Tailwind) with a
thin Node/Express API for AI extraction.

**A tiered, honest measurement pipeline** — the core principle is *never present a number
the tool cannot justify*:

| Input | Path | Accuracy | Notes |
|---|---|---|---|
| **STEP / IGES / BREP (3D solid)** | Tessellate (OpenCascade) → measure geometry → classify turned/milled → cost | **Authoritative** | No AI; exact measurement. **Preferred input.** |
| **PDF / image (2D drawing)** | Google Gemini vision → structured extraction → **verify** | Indicative | Requires API key; values flagged for human confirmation. |
| **Unreadable / unknown** | Manual confirmation | User-entered | Zeroed, honest — no fabrication. |

**From geometry to a defensible price:** the solid is classified as turned or milled;
stock is sized (bar or billet); the volume removed, surface area, holes and setups feed a
transparent subtractive estimator using Turncircuit's own rates and each material's
machinability. Every quote line shows the driver it was priced from, buy-to-fly shows how
much of the bar becomes chips, and DFM findings surface cost/risk drivers *before* the job
reaches the machine.

**Recommended intake policy:** **prefer STEP solids** (exact, no-AI measurement); accept
PDF via AI + verification; use manual confirmation as the honest fallback.

---

## 5. Timeline (2 weeks)

Ten working days, delivered in short increments with a reviewable build at each phase.

| Day | Phase | Deliverable |
|---|---|---|
| 1 | Foundation & CAD intake | Scaffolding, upload flow, STEP tessellation & exact measurement |
| 2 | Measurement & classification | Volume→weight, surface area, turned-vs-milled detection, 3D viewer |
| 3 | Stock & material model | Bar/billet stock sizing, material library (metals + plastics), machinability, buy-to-fly |
| 4 | Machining cost engine | Removal/roughing, finishing, drilling, setups, inspection, deburr — itemised & traceable |
| 5 | Machining DFM | Slenderness, bar/envelope limits, small holes, thin walls, tolerance/setups + score |
| 6 | AI drawing path | Gemini PDF/image extraction, verify state, manual fallback |
| 7 | Quote lifecycle | Draft/sent/won/lost, quote PDF export, quantity & logistics |
| 8 | Data & analytics | Parts/materials/customers, dashboard & analytics, estimator accuracy |
| 9 | Hardening | Theming, error boundary, validation, tests + CI, cross-page polish |
| 10 | UAT & handover | Bug-fix from review, documentation, deployment notes, walkthrough |

**Milestones:** end of Week 1 — CAD measured, classified, costed with DFM; end of Week 2 —
full quoting flow, analytics, tested and handed over.

---

## 6. Commercials

| Item | Detail |
|---|---|
| **Rate** | **GBP 22.00 / hour** (ex. VAT) |
| **Assumed effort** | 2 weeks · 10 working days · ~8 hours/day |
| **Estimated hours** | 70–80 hours |
| **Estimated total** | **GBP 1,540 – 1,760** (ex. VAT) |

**Notes**
- Billed on **actual hours worked**, reported against the timeline above; the range
  reflects final scope and review effort.
- Estimate excludes VAT and any third-party costs — notably **Google Gemini API usage**
  (PDF path), billed to the client at cost.
- **Payment terms:** to be agreed — suggested 50% on commencement, 50% on handover, net 14 days.
- Scope changes are handled via a short written change note at the same hourly rate.

---

## 7. Assumptions & Risks

**Assumptions**
- **STEP is the primary quoting input.** 3D solids give exact, no-AI measurement; PDFs are
  a secondary, verified path. (See §4.)
- Turncircuit provides **machine rates, removal/finishing rates, setup times, margins and
  material prices** — the tool ships with sensible defaults, tuned during UAT to
  Turncircuit's machines (sliding-head, turn-mill) and materials.
- The client provides a **Google Gemini API key** for the PDF/image path; usage is billed
  to the client. Without it, drawings route to manual entry.
- Representative **sample parts** are provided across the mix Turncircuit actually quotes
  (turned brass, plastics, small milled components).
- Persistence is **local-first (browser)** for this phase; no server database or
  multi-user accounts required yet.
- One primary stakeholder is available for **daily review/UAT** decisions.

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| **Cycle-time estimation** is volume/area-based, not a true CAM simulation | Over/under-quoting complex parts | Rates tuned to real jobs in UAT; estimate-vs-actual analytics improve it over time |
| **Part-class edge cases** (a milled part that looks round, or vice-versa) | Wrong stock model | Confidence score + user can override turned/milled and stock in the review step |
| **Machinability defaults** are generic per material family | Cost drift on specific alloys/tempers | Shop-tunable factors; refined against Turncircuit's own timings |
| **PDF extraction accuracy** — AI misreads a drawing | Wrong dimensions | Values flagged "verify"; mandatory human confirmation; prefer STEP |
| **Very slender / thin-wall / low-yield parts** | Machining risk & cost | Flagged by DFM (L/D, thin wall, buy-to-fly) at quote time, not on the machine |
| **Gemini API** availability, latency, cost or key limits | PDF path degraded | Graceful fallback to manual; STEP path unaffected |
| **Scope creep** into CAM/nesting/ERP/sheet-metal within 2 weeks | Timeline slip | Explicit Out-of-Scope list; change-note process |

---

*This document reflects the honest, measured-first design principle applied throughout
QuoteForge: the tool measures what it can, clearly states confidence, and never fabricates
a number it cannot justify.*
