"""
THREADS — the one manufacturing operation with no geometric signature.

Everything else this service reports is measured off the B-Rep: a bore is a
cylinder, a countersink is a cone, a setup is a cluster of face normals. A
THREAD is not. CAD systems almost never model the helix; a tapped hole is stored
as a plain cylinder at the TAP-DRILL diameter, and the fact that it gets tapped
lives in a name, a note, or the drawing.

So no amount of face classification will ever find it. The face-coverage ledger
looks at a ⌀2.5 cylinder, correctly calls it a hole, and honestly reports the
part fully accounted for — while two M3 taps go unquoted. That is the ledger
claiming operation coverage when it only ever measured FACE coverage, and it is
the most dangerous failure mode the overlay has, because it is green.

What we can do is read the name. Both real parts that needed tapping carried the
callout in the solid's own name — 'M3 Tapped Hole1', 'M2x0.4 Tapped Hole2' —
written there by SolidWorks because that was the last feature in the tree. That
is a strong HINT and a weak INVENTORY: it proves at least one thread exists and
tells us its size, but the tree name only records the last feature, so a part
with three different threads may name only one. Everything here is therefore
reported as a candidate to confirm, never as a settled count.
"""
from __future__ import annotations

import re
from typing import List, Optional

# Metric coarse tap drills (ISO 261 / 262). Diameter → what you drill before
# tapping, which is the ⌀ the CAD model actually contains.
METRIC_TAP_DRILL_MM = {
    1.6: 1.25, 2.0: 1.6, 2.5: 2.05, 3.0: 2.5, 4.0: 3.3, 5.0: 4.2,
    6.0: 5.0, 8.0: 6.8, 10.0: 8.5, 12.0: 10.2, 16.0: 14.0, 20.0: 17.5,
}

# THE FULL TABLE THE DRAWINGS ASKED FOR.
#
# Reading eleven Turncircuit drawings against our own extraction turned up a
# thread on every single part, and none of them costed. The coarse metric table
# above could not have found two of them: Lance's VOC housing is tapped G1/4
# (a parallel pipe thread) and his hollow arm bulkhead M0.9 x 0.225 — a tap
# under a millimetre, which is smaller than anything ISO coarse covers.
#
# Each entry is `callout -> tap drill ⌀`, because the tap drill is the only
# thing the solid actually contains. Pitch is carried because TAPPING TIME is
# set by it: the feed is not a choice, it is one pitch per revolution.
TAP_TABLE_MM = {
    # metric coarse
    'M1.6': (1.25, 0.35), 'M2': (1.6, 0.4), 'M2.5': (2.05, 0.45), 'M3': (2.5, 0.5),
    'M4': (3.3, 0.7), 'M5': (4.2, 0.8), 'M6': (5.0, 1.0), 'M8': (6.8, 1.25),
    'M10': (8.5, 1.5), 'M12': (10.2, 1.75), 'M16': (14.0, 2.0), 'M20': (17.5, 2.5),
    # metric fine and sub-miniature — the small end is where the money is,
    # because a tap this size breaks if it is hurried and takes the part with it.
    'M0.9x0.225': (0.675, 0.225), 'M1x0.25': (0.75, 0.25), 'M1.2x0.25': (0.95, 0.25),
    'M1.4x0.3': (1.1, 0.3), 'M1.6x0.35': (1.25, 0.35), 'M2x0.4': (1.6, 0.4),
    'M3x0.5': (2.5, 0.5), 'M5x0.35': (4.65, 0.35), 'M6x0.75': (5.25, 0.75),
    'M8x1': (7.0, 1.0), 'M10x1': (9.0, 1.0),
    # BSP parallel (G) and taper (Rc) — pipe threads, common on anything that
    # seals. Lance's VOC housing and condenser flange both use them.
    'G1/8': (8.8, 0.907), 'G1/4': (11.8, 1.337), 'G3/8': (15.25, 1.337),
    'G1/2': (19.0, 1.814),
    'Rc1/8': (8.4, 0.907), 'Rc1/4': (11.2, 1.337), 'Rc3/8': (14.75, 1.337),
    'Rc1/2': (18.25, 1.814),
}

# How close a measured hole has to sit to a tap drill before we call it a
# candidate. MEASURED, not chosen: against the seven parts we hold geometry for,
# +/-0.05 catches all five real threads with no false alarms, and +/-0.06 lets in
# eight — six ⌀1.3 clearance holes reading as M1.6, and two ⌀1.0 as M1.2. Sitting
# on the edge of that cliff would be reckless, so this is comfortably inside it.
TAP_DRILL_TOL_MM = 0.04

# 'M3', 'M2x0.4', 'M6 × 1.0', 'M8-1.25'. The pitch is optional and ignored for
# matching — the tap drill is set by the major diameter for coarse threads.
_M_THREAD = re.compile(r"\bM(\d+(?:\.\d+)?)\s*(?:[x×\-]\s*(\d+(?:\.\d+)?))?\b", re.IGNORECASE)
# Only trust a match when the surrounding text actually says it is a thread —
# 'M3' alone could be a part number, a material code, or a revision.
_THREAD_WORD = re.compile(r"tap|thread", re.IGNORECASE)

# Names STEP writers emit for the whole body when nothing was named. A callout
# has to beat these to be worth reading.
_NAME_ENTITIES = (
    "MANIFOLD_SOLID_BREP",
    "ADVANCED_BREP_SHAPE_REPRESENTATION",
    "PRODUCT",
    "SHAPE_DEFINITION_REPRESENTATION",
    "NEXT_ASSEMBLY_USAGE_OCCURRENCE",
)


def _names_in_step(path: str, max_bytes: int = 8_000_000) -> List[str]:
    """Every quoted name on a naming entity. Read as text, not through OCC: the
    STEP reader discards solid names, and this costs a single pass."""
    try:
        with open(path, "r", errors="ignore") as fh:
            text = fh.read(max_bytes)
    except OSError:
        return []
    out: List[str] = []
    for ent in _NAME_ENTITIES:
        for m in re.finditer(ent + r"\s*\(\s*'([^']*)'", text):
            name = m.group(1).strip()
            if name:
                out.append(name)
    return out


def tap_drill_for(major_mm: float) -> Optional[float]:
    """Tap-drill ⌀ for a metric coarse thread, or None if it is not a size we know."""
    for major, drill in METRIC_TAP_DRILL_MM.items():
        if abs(major - major_mm) < 0.01:
            return drill
    return None


def find_thread_callouts(path: str) -> List[dict]:
    """
    Thread callouts named anywhere in the STEP's naming entities.

    Returns one entry per distinct callout: the text it came from, the major
    diameter, and the tap-drill ⌀ to look for among the measured holes.
    """
    seen: dict = {}
    for name in _names_in_step(path):
        if not _THREAD_WORD.search(name):
            continue
        for m in _M_THREAD.finditer(name):
            major = float(m.group(1))
            drill = tap_drill_for(major)
            if drill is None:
                continue
            label = f"M{m.group(1)}" + (f"x{m.group(2)}" if m.group(2) else "")
            seen.setdefault(label, {
                "callout": label,
                "majorDiaMm": major,
                "tapDrillMm": drill,
                "source": name,
            })
    return list(seen.values())


def match_threads_to_holes(callouts: List[dict], hole_diameters: List[float]) -> List[dict]:
    """
    Pair each callout with the measured holes at its tap-drill diameter.

    Tolerance is deliberately loose (±0.15 mm): shops drill M2 with 1.5 or 1.6
    depending on material and preference, and the model records whichever the
    designer used. A callout that matches nothing is still reported — that is
    itself worth seeing, because it means the thread is somewhere we did not
    find a hole for.
    """
    out: List[dict] = []
    for c in callouts:
        matches = [d for d in (hole_diameters or []) if abs(d - c["tapDrillMm"]) <= 0.15]
        out.append({
            **c,
            "matchedHoleDiaMm": round(matches[0], 3) if matches else None,
            "matchedHoleCount": len(matches),
        })
    return out


def find_thread_candidates(hole_diameters, hole_depths=None) -> List[dict]:
    """
    Threads PROPOSED from the holes themselves, when nothing named one.

    A tapped hole is modelled at its tap-drill ⌀, so the diameter is a real
    fingerprint — the only one a thread leaves. On the parts we hold drawings
    for this finds Lance's G1/4, M6, M2 and M0.9 exactly, and proposes nothing
    that is not there.

    It is deliberately narrow. A clearance hole and a tap drill can be the same
    size, so widening the tolerance turns this from a useful prompt into noise
    (measured: +/-0.06 invents eight threads on parts that have none). Where two
    callouts share a tap drill — M2 and M2x0.4 both want 1.6 — the coarse one is
    proposed, because coarse is what a shop reaches for unless told otherwise.

    These are CANDIDATES. The drawing decides, and a quoter has the drawing.
    """
    dias = list(hole_diameters or [])
    depths = list(hole_depths or [])
    out: List[dict] = []
    for i, d in enumerate(dias):
        best = None
        for callout, (drill, pitch) in TAP_TABLE_MM.items():
            gap = abs(d - drill)
            if gap > TAP_DRILL_TOL_MM:
                continue
            # Prefer the closest; tie-break to the shorter callout, which is the
            # coarse thread ('M2' over 'M2x0.4').
            key = (round(gap, 4), len(callout))
            if best is None or key < best[0]:
                best = (key, callout, drill, pitch)
        if best is None:
            continue
        _, callout, drill, pitch = best
        depth = depths[i] if i < len(depths) and depths[i] > 0 else None
        out.append({
            "callout": callout,
            "tapDrillMm": drill,
            "pitchMm": pitch,
            "holeDiaMm": round(d, 3),
            "depthMm": round(depth, 3) if depth else None,
            "source": "tap-drill-diameter",
        })
    return out


def thread_open_questions(callouts: List[dict], candidates: List[dict]) -> List[dict]:
    """
    The thread question, in ONE definition.

    Both the extract endpoint and the face-coverage endpoint have to raise this,
    and they used to build it separately — so when candidates were added, only
    one of them learned about them and the face-coverage overlay went on showing
    a green badge over a part with untapped holes. That overlay exists precisely
    to stop a green badge standing in for "every operation is costed", so it is
    the last place that should be behind.

    A NAMED callout outranks a proposed one: the CAD system wrote it because a
    designer asked for it.
    """
    if callouts:
        labels = ", ".join(c["callout"] for c in callouts)
        n = sum(c.get("matchedHoleCount", 0) for c in callouts)
        return [{
            "kind": "threads",
            "summary": f"{labels} thread callout in the model"
                       + (f" — {n} hole(s) at the tap-drill ⌀" if n else " — no hole found at its tap-drill ⌀"),
            "detail": "Threads have no geometric signature: CAD stores a tapped hole as a plain "
                      "cylinder at the tap-drill diameter, so face analysis cannot see it. This "
                      "callout was NAMED in the file and its tapping time IS in the quote. "
                      "Confirm the count against the drawing — a tree name records the last "
                      "feature, not an inventory.",
        }]
    if candidates:
        labels = ", ".join(sorted({c["callout"] for c in candidates}))
        return [{
            "kind": "threads",
            "summary": f"{len(candidates)} hole(s) sit exactly on a tap-drill ⌀ — {labels}",
            "detail": "Nothing in this file NAMES a thread, so these are proposed from the only "
                      "fingerprint a thread leaves: a tapped hole is modelled at its tap-drill "
                      "diameter. Their tapping time IS in the quote. The drawing decides — "
                      "confirm each one, and add any thread whose tap drill we did not find.",
        }]
    return []
