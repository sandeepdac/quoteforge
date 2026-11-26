# Calibration notes: what is derived, what is Lance's data, what is a guess

QuoteForge's CNC cycle-time and price models were checked against Turncircuit's
(Lance's) real cycle sheets, CAM reports and quotes. This note says, for every
number that matters, **where it comes from**, so nobody mistakes a guess for a
measurement. Read it before changing a constant.

## The rules the work followed

1. A value comes from one of four places: **physics or a handbook**, a **machine
   specification**, a **tool specification**, or a **shop setting** taken from the shop's
   own data. It is never tuned to make one part match.
2. Every change was measured on its own through the app's real pipeline
   (`analyzeCadFile` then `resolveQuoteCosts`) before it was claimed to help.
3. Negative results are kept (see the end).

## What we hold

| Source | What it gives | How far to trust it |
|---|---|---|
| Cycle sheets: 031169-A, OLY014_01921-A (head 1) | Cutting and idle seconds per operation | Estimates, not timings: round numbers; the housing's "rough turn" cell is a formula copying the HSS drill row; the arm has two identical 150 s rows and a 360 s row (6 x 60 s) |
| CAM write-ups: OLY014_02062-A (316), S17604_00415-A (aluminium) | Programmed rpm, feed, depth and machining time per tool | **Best evidence we have**: path length / feed. Cutting time only, no idle. Which part each belongs to is inferred from the material |
| Routers and quotes: 7 parts | Machines, booked minutes, rates, prices | Booked allowances, **not measured**: the housing's router books 45 min against a measured 8.3 |

Eight parts have STEP files. Four have cutting times to compare (two sheets, two CAM
write-ups); only two have idle times. That is a thin base, which is why the thresholds
below are listed as guesses.

## A. Derived (physics, handbook, specification)

| Constant | Where | Basis |
|---|---|---|
| Drill speed 0.4 x turning speed | `drilling.ts` | Published free-machining brass data; chip evacuation |
| Drill speed by tool material (HSS 0.4, cobalt 0.55, carbide 1) | `drilling.ts` | Hot hardness; published speeds |
| Thread passes = ceil(3 + 4 p) + 1 spring | `turning.ts` | Insert makers' infeed tables |
| Screwcut speed 0.35 x finish speed | `turning.ts` (`THREAD_VC_FRACTION`) | Thread-turning data run well below turning data |
| Thread run-out 1.5 pitches; axis lag n L / 1800 (end), 3.605 x that (start) | `turning.ts` | ISO 4755 / DIN 76; Fanuc threading-cycle manual |
| Finish feed from Ra = sqrt(32 r Ra) x 0.86 | `turning.ts` | Theoretical roughness, derated for real cuts |
| Pecking depth by hole depth/diameter | `drilling.ts` | Flute chip clearance |
| Tool change and rapid per machine | `machineSelection.ts` | Manufacturer specifications where published |
| Hex/polygon bar section and corners | `turning.ts` | Geometry |
| Proving rounds = 1 + halvings below +/-0.1 mm | `setupModel.ts` | Each correction roughly halves the error; effect is small (see negatives) |
| Counting a bore at each end | geometry service | Geometry: a run counts only if it touches an end face |

## B. Taken from Lance's data (shop settings, editable)

| Setting | Value | Evidence | Where to change it |
|---|---|---|---|
| Bar stop / bar handling | 30 s | Same 30 s "bar stop process" row on **both** sheets | Settings |
| Operation idle floor | 15 s | Average idle per operation over 25 rows on his two sheets; the least is 10 s | Settings (0 switches off) |
| Milling roughing depth | 0.2 x cutter diameter | His CAM programs: 0.17 (3 mm in 316) to 0.25 (8 mm in aluminium) | `millAxialFactor` |
| Realisation stack on milled work | off | His depth already carries those conditions; on top of it the stack double-counts (x2.65 and x4.37 of his CAM totals) | `realisationOnMilling` |
| Drill feed in hard materials | sqrt of machinability below 1 | One CAM row: a 3.2 mm carbide drill in 316 at 0.033 mm/rev | `drillFeedPerRev` |
| Setup rate per machine | 40 or 50 per hour | The setup-rate column of his routers | `MachineSpec.setupRatePerHr` |
| Programming rate | 40 per hour | His only router with a PROG line | `setupModel.ts` |
| Setup "character" minutes per machine | e.g. NL 210, NTX 900 | Observed on his routers (1 to 3 jobs each) | `machineSelection.ts` |

## C. Hypotheses: thresholds chosen with one to three parts in hand

Each of these is flagged in the code. The next quote that disagrees disproves it.

| Threshold | Evidence | What would disprove it |
|---|---|---|
| **Small prismatic section (16 mm or less) is bar-fed and cut off, with a second operation on a mill** | One part (the hollow arm) | Any small prismatic quote made from sawn billet |
| **Sub-1.5 mm feature goes to the NTX** | Cold stage block 1.0, arm 0.65. Counter-example: 029068 (1.1 mm) runs on a sliding head, so bar work on a sliding head is exempt | A fine-feature part Lance runs on a mini mill or VMC |
| **Wall finish swept at 2 diameters of flute; flat floor at 0.7 D** | His aluminium block; conventional practice | A part where his finishing passes are much shallower |
| **Idle floor charged on every machine** | Evidence is a Mori NL2000Y and an NTX 1000 only | A sliding head or VMC sheet showing less overhead |
| **Realisation stack still applied to turned parts** | No programmed turning data yet. It was introduced to close a gap and its factors are named, not fitted | Turning speeds and feeds for the housing (the stack is then replaced as it was for milling) |
| Tap-drill match +/-0.04 mm | Measured cliff on the seven parts: +/-0.06 invents threads | A thread that sits outside it |
| Milled finishing area 60 percent machined; sculpt and complexity multipliers | Earlier calibration, simple parts at 1.0 | Contoured parts with real finishing times |

## D. What we tried that did not work

- **Travel and spindle ramp as the cause of idle:** measured, they explain almost none of it.
- **Catalogue cutting data for his tools:** the ranges are too wide (30 to 440 m/min) to say where he runs.
- **Tolerance as the cause of the setup gap:** it is the right mechanism and a small effect. The arm moves from x0.41 to x0.42 of his setup at +/-0.05 mm.
- **A sliding-head fine-feature rule (below 0.8 mm):** removed. The pipeline's "smallest feature" is the smallest hole (1.0 mm on the hinge), so it never fired.
- **Matching the sheet's drill rows:** his 36 s for a 40 mm carbide drill and for a 70 mm HSS drill cannot be reproduced from any derivable speed. His CAM drilling (a 3.2 mm drill, 4 s) matches our model within 14 percent.
- **Machine hourly rates from his routers:** would lower prices that are already over and the arm's which is under; not done.

## E. Known gaps

- **Housing hole work** (drills, boring, threading, deburr): about 59 s of cutting short of his sheet. Needs his programmed speeds.
- **Setup model:** over-reads simple parts (C clamp x2.1, housing x1.7, guide rod x1.6 of his booked minutes) and under-reads precision parts (arm and drive dog x0.4). It does not know why Lance books 5 hours for one and 32 hours for another.
- **Machine routing:** the housing goes to the SR-32 (he uses the Mori), the hinge to the Hanwha (he uses the NTX).
- **Prices:** C clamp about x1.9, hollow arm about x0.43 of his.
- **Not modelled:** transfer between operations, counterbores milled (they are drilled), the slitting-saw cut-off (3 s modelled; physics says about 4 s; his sheet says 55 s).

## F. Where it stands (last full run)

| Part | Cutting x Lance | Idle x Lance | Price x Lance |
|---|---|---|---|
| 031169-A housing, op 1 | 0.81 | 0.96 | 1.22 |
| OLY014_01921-A arm | 0.66 | 1.02 | 0.43 |
| OLY014_02062-A hinge (CAM) | 0.83 | | |
| S17604_00415-A block (CAM) | 1.10 | | |
| 032736-01 | | | 0.95 |
| OLY014_01297-A | | | 0.83 |
| 035838-A | | | 1.87 |
| NAUT_01695-C | | | 0.81 |

Re-run it with the all-parts comparison test (header of
`src/utils/calibration/allParts.test.ts` says how; it needs the geometry service; all eight STEP files are in
`test-fixtures/corpus/`).
