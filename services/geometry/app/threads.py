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
