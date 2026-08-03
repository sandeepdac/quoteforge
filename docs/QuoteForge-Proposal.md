# QuoteForge — Statement of Work & Proposal

**Prepared for:** Client / Sponsor
**Prepared by:** Delivery Team
**Date:** 3 August 2026
**Version:** 1.0
**Engagement:** AI-driven CAD quoting tool for sheet-metal & structural fabrication
**Duration:** 2 weeks · **Rate:** GBP 22.00 / hour (ex. VAT)

---

## 1. Problem Statement

Fabrication shops quote from customer CAD (3D STEP solids) and 2D engineering drawings (PDF). Today that process is **manual, slow, and inconsistent**:

- An estimator opens each file, eyeballs dimensions, counts holes and bends, guesses material and weight, and keys numbers into a spreadsheet. A single quote takes 20–60 minutes.
- Different estimators price the same part differently. There is no audit trail linking a price to the geometry it came from, so quotes are hard to defend to the customer or review internally.
- Manufacturability problems (a hole too close to a bend, a radius too tight for the gauge) are caught **on the shop floor** — as scrap and rework — instead of at quote time.
- There is no single view of win rate, margin, pipeline, or estimate-vs-actual accuracy, so pricing never improves from experience.

The business needs a tool that **reads the part, explains what it measured, and produces a defensible quote in minutes — without fabricating any numbers it cannot stand behind.**

---

## 2. Scope

The engagement delivers **QuoteForge**, a browser-based quoting application, covering:

**CAD ingestion & measurement**
- Upload 3D solids (STEP / STP / IGES / BREP) and measure geometry directly from the B-Rep — bounding box, volume→weight, surface area, and **material thickness measured from the solid** (not assumed).
- Upload 2D drawings (PDF / PNG / JPG) and extract dimensions via **AI vision (Google Gemini)** when an API key is configured, with a clear "read from drawing — verify" status.
- Honest fallback to manual confirmation for any file that cannot be measured or read — **no invented dimensions**.

**Feature detection & manufacturing intelligence**
- Geometric detection of **holes** (count, diameters, positions) and **bends** from the solid faces.
- **Design-for-Manufacturing (DFM)** advisory checks — min hole size vs thickness, min bend radius, hole-to-bend clearance, thin-part aspect ratio, standard-sheet fit — each tied to the measured geometry, with a manufacturability score.
- **Formed-part detection** with an honest lower-bound flag where a folded solid's cut length cannot be fully recovered.

**Quoting engine**
- Transparent, itemised cost breakdown: material, laser cutting, press-brake bending, welding, handling/assembly, finishing — **each line traceable to the measured driver** (e.g. "281 mm cut path · 5 pierces") — rolled up through overhead, margin, rush premium to the unit and total price.
- Shop-configurable rates, speeds, margins and overhead.
- Quantity, lead-time, delivery and rush-order handling; quote statuses (draft / sent / won / lost); PDF quote export.

**Data, analytics & UX**
- Parts library, materials catalogue (editable prices), customers, and quote history with local-first persistence.
- Dashboard and analytics with **real** KPIs (win rate, margin, pipeline) and estimator accuracy (estimate vs recorded actual cost).
- Light/dark theming, responsive layout, and a top-level error boundary.

**Quality**
- Automated unit tests for the estimator, parsers, feature detection and DFM; CI on push; production build.

---

## 3. Out of Scope

The following are explicitly **not** included in this 2-week engagement (available as future phases):

- **Flat-pattern unfolding / CAM** — recovering the true flat-blank cut length from a *folded* sheet-metal solid (requires a dedicated unfolding engine). Formed parts are flagged as a lower bound instead.
- **True CNC/G-code generation** (3-axis milling posts, tool libraries, work offsets) — safety-critical and out of domain.
- **Nesting & material-utilisation optimisation** across sheets.
- **DXF / cut-file export** to shop CAM systems.
- **Server-side database, multi-user accounts, authentication, roles, and audit history** — current persistence is local-first (browser).
- **ERP / MRP / accounting integrations** (e.g. pushing accepted quotes to production or invoicing).
- **Automated email/RFQ intake** and customer portal.
- **Bespoke AI model training** — the tool uses a hosted vision model (Gemini) via API.
- **Regulatory/qualification tolerancing** (GD&T interpretation beyond basic callouts).

---

## 4. Solution

QuoteForge is a single-page web application (React + TypeScript + Vite, Tailwind) with a thin Node/Express API for AI extraction.

**A tiered, honest measurement pipeline** — the core design principle is *never present a number the tool cannot justify*:

| Input | Path | Accuracy | Notes |
|---|---|---|---|
| **STEP / IGES / BREP (3D solid)** | Tessellate with OpenCascade (occt-import-js) → measure geometry + detect features | **Authoritative** | No AI; exact measurement. Preferred input. |
| **PDF / image (2D drawing)** | Google Gemini vision → structured extraction → **verify** | Indicative | Requires API key; values flagged for human confirmation. |
| **Unreadable / unknown** | Manual confirmation | User-entered | Zeroed, honest — no fabrication. |

**From geometry to a defensible price:** measured drivers (weight, cut perimeter, pierces, bends, holes, surface area) feed a transparent estimator using the shop's own rates and speeds. Every quote line shows the geometry it was priced from, and DFM findings surface cost- and risk-drivers *before* the job hits the floor.

**Recommended intake policy:** prefer STEP; accept PDF via AI + verification; request a flat-pattern DXF for formed sheet-metal to price cut length accurately.

---

## 5. Timeline (2 weeks)

Ten working days, delivered in short increments with a reviewable build at each phase.

| Day | Phase | Deliverable |
|---|---|---|
| 1 | Foundation & CAD intake | Project scaffolding, upload flow, STEP tessellation & exact measurement |
| 2 | Measurement & thickness | Volume→weight, surface area, measured material thickness, 3D viewer with dimensions |
| 3 | Feature detection | Geometric hole & bend detection from B-Rep faces |
| 4 | DFM engine | Manufacturability checks + score, formed-part detection & honest flagging |
| 5 | AI drawing path | Gemini PDF/image extraction, verify state, manual fallback |
| 6 | Quoting engine | Itemised, geometry-linked cost breakdown; rates/margins/overhead/rush |
| 7 | Quote lifecycle | Draft/sent/won/lost, quote PDF export, quantity & logistics |
| 8 | Data & analytics | Parts/materials/customers, dashboard & analytics with real KPIs, estimator accuracy |
| 9 | Hardening | Theming, error boundary, validation, tests + CI, cross-page polish |
| 10 | UAT & handover | Bug-fix from review, documentation, deployment notes, walkthrough |

**Milestones:** end of Week 1 — CAD measured, features + DFM working; end of Week 2 — full quoting flow, analytics, tested and handed over.

---

## 6. Commercials

| Item | Detail |
|---|---|
| **Rate** | **GBP 22.00 / hour** (ex. VAT) |
| **Assumed effort** | 2 weeks · 10 working days · ~8 hours/day |
| **Estimated hours** | 70–80 hours |
| **Estimated total** | **GBP 1,540 – 1,760** (ex. VAT) |

**Notes**
- Billed on **actual hours worked**, reported against the timeline above; the range reflects final scope and review effort.
- Estimate excludes VAT and any third-party costs (see Assumptions) — notably **Google Gemini API usage**, billed by the client at cost.
- **Payment terms:** to be agreed — suggested 50% on commencement, 50% on handover, net 14 days.
- Changes to scope are handled via a short written change note and billed at the same hourly rate.

---

## 7. Assumptions & Risks

**Assumptions**
- **STEP is the primary quoting input.** 3D solids give exact, no-AI measurement; PDFs are a secondary path. (See the intake recommendation in §4.)
- The client provides a **Google Gemini API key** for the PDF/image AI path; without it, drawings route to manual entry. API usage is billed to the client.
- Shop **rates, speeds, margins and material prices** are provided/confirmed by the client and are tuned to their machines — the tool ships with sensible defaults, not shop-specific gospel.
- Representative **sample CAD files** are provided for testing across the part types the shop actually quotes.
- Persistence is **local-first (browser)** for this phase; no server database or multi-user accounts are required yet.
- One primary stakeholder is available for **daily review/UAT** decisions.

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| **Formed sheet-metal cut length** — a folded STEP under-states the flat-blank laser path | Under-quoting formed parts | Detect & **flag as a lower bound**; request flat-pattern DXF; unfolding is a scoped future phase |
| **PDF extraction accuracy** — AI misreads a drawing | Wrong dimensions | Values flagged "verify"; mandatory human confirmation; prefer STEP |
| **Small/ambiguous features** (tiny bends, coaxial holes) may under/over-count on some solids | DFM/quote drift | Conservative detection + review step; user can correct any value |
| **DFM thresholds** are generic sheet-metal defaults | False warnings | Advisory only; make thresholds shop-configurable (future) |
| **Gemini API** availability, latency, cost or key limits | PDF path degraded | Graceful fallback to manual; STEP path unaffected |
| **Non-sheet / chunky parts** don't fit sheet-metal assumptions (thickness, bends) | Misleading metrics | Thickness measured from geometry; flag when assumptions don't hold |
| **Scope creep** into CAM/nesting/ERP within 2 weeks | Timeline slip | Explicit Out-of-Scope list; change-note process |

---

*This document reflects the honest, measured-first design principle applied throughout QuoteForge: the tool measures what it can, clearly states confidence, and never fabricates a number it cannot justify.*
