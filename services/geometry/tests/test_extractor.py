"""Tests for the turned-profile extractor, using OCP-generated sample solids."""
import os
import tempfile

import pytest

from app.extractor import extract
from tests.generate_samples import build

SAMPLES = build(os.path.join(tempfile.gettempdir(), "qf_samples"))


def test_stepped_shaft_is_turned_with_bore():
    r = extract(SAMPLES["shaft"])
    assert r["is_turned"] is True
    assert r["confidence"] > 0.6
    # OD ⌀20, length 100, central bore ⌀8.
    assert r["profile"]["odMm"] == pytest.approx(20, abs=0.5)
    assert r["profile"]["lengthMm"] == pytest.approx(100, abs=1.0)
    assert r["profile"]["boreDiaMm"] == pytest.approx(8, abs=0.5)
    assert r["profile"]["crossFeatures"] is False


def test_box_is_not_turned():
    r = extract(SAMPLES["box"])
    assert r["is_turned"] is False
    assert "Not a turned part" in r["reason"]


def test_shaft_with_cross_hole_flags_cross_features():
    r = extract(SAMPLES["cross"])
    assert r["is_turned"] is True
    assert r["profile"]["crossFeatures"] is True
    assert r["counts"]["crossFeatures"] >= 1


def test_measured_volume_is_reported():
    r = extract(SAMPLES["shaft"])
    assert r["measured"]["volumeCm3"] > 0
    assert r["measured"]["surfaceAreaCm2"] > 0


# --- Threads: proposed from the tap drill, checked against the DRAWINGS ------
#
# Reading eleven Turncircuit drawings found a thread on every part and not one
# of them priced. The name route these files were supposed to use finds nothing
# — none of them carries a single feature name — so the tap-drill diameter is
# the only signal left. These cases are the drawings' own callouts.

def test_tap_drill_detection_matches_the_drawings():
    from app.threads import find_thread_candidates

    # (part, measured hole ⌀s, depths, the thread the DRAWING calls out)
    cases = [
        ("031169 VOC housing", [11.8, 10.0], [14.0, 40.918], "G1/4"),
        ("029068 collet block", [5.0, 1.7], [5.0, 1.0], "M6"),
        ("OLY014_01921 hollow arm", [1.3, 1.0, 0.65], [1.35, 0.675, 1.5], "M0.9x0.225"),
        ("032736 cold stage", [3.4, 1.6, 1.6, 1.0], [1.84, 8.0, 8.0, 7.176], "M2"),
    ]
    for name, dias, depths, expected in cases:
        found = {c["callout"] for c in find_thread_candidates(dias, depths)}
        assert expected in found, f"{name}: expected {expected}, got {found or 'nothing'}"


def test_parts_with_no_thread_get_no_candidate():
    from app.threads import find_thread_candidates

    # The C clamp and the drive dog have no thread on their drawings. Proposing
    # one would be worse than proposing none — it puts money on the quote that
    # the shop never spends.
    assert find_thread_candidates([30.0, 24.0, 5.5, 5.5], [6.5, 1.9, 3.8, 3.8]) == []
    assert find_thread_candidates([], []) == []


def test_clearance_holes_are_not_mistaken_for_tapped_ones():
    from app.threads import find_thread_candidates

    # MEASURED: at +/-0.06 these six ⌀1.3 clearance holes on the hollow arm read
    # as M1.6, and ⌀1.0 as M1.2 — eight threads that do not exist. The tolerance
    # is set inside that cliff, and this test is what holds it there.
    assert find_thread_candidates([1.3] * 6, [0.8] * 6) == []
    assert find_thread_candidates([1.0], [4.0]) == []
    assert find_thread_candidates([3.4, 3.4], [1.84, 1.84]) == []


def test_the_pitch_comes_with_the_callout():
    from app.threads import find_thread_candidates

    # Tapping time is set by the pitch — the tap advances exactly one pitch per
    # revolution — so a candidate without one could not be costed.
    for c in find_thread_candidates([5.0, 1.6], [10.0, 8.0]):
        assert c["pitchMm"] > 0, c


# --- Every coaxial hole, and ONLY coaxial holes ------------------------------

def _solid(*cuts):
    """⌀30 x 60 bar with the given cylinders subtracted, written to a STEP."""
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    s = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 15, 60).Shape()
    for (px, py, pz), (dx, dy, dz), r, h in cuts:
        tool = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), r, h).Shape()
        s = BRepAlgoAPI_Cut(s, tool).Shape()
    fd, path = tempfile.mkstemp(suffix=".step")
    os.close(fd)
    w = STEPControl_Writer()
    w.Transfer(s, STEPControl_AsIs)
    w.Write(path)
    return path


def test_a_narrower_coaxial_hole_behind_the_main_bore_is_reported():
    # The VOC housing's shape: a ⌀12 mouth 14 deep and a ⌀8 hole running on
    # behind it. The extractor used to keep only the widest and drop the rest,
    # so the second drilling operation never reached the cost model.
    r = extract(_solid(
        ((0, 0, 46), (0, 0, 1), 6, 14),     # ⌀12 x 14 at the top end
        ((0, 0, 20), (0, 0, 1), 4, 26.5),   # ⌀8 continuing 26 mm behind it
    ))
    p = r["profile"]
    assert p["boreDiaMm"] == pytest.approx(12, abs=0.1)
    assert len(p["additionalBores"]) == 1
    assert p["additionalBores"][0]["diameterMm"] == pytest.approx(8, abs=0.1)
    assert p["additionalBores"][0]["depthMm"] == pytest.approx(26, abs=1)


def test_a_cross_hole_is_not_reported_as_a_coaxial_hole():
    # THE DOUBLE-COUNT THIS FIELD EXISTS TO PREVENT. The milled hole list holds
    # every hole in every direction; built from it, a cross hole on a turned part
    # became an on-axis hole too, and was drilled down the spindle as well as
    # cut with the driven tool. It belongs in crossFeatureList only.
    r = extract(_solid(
        ((0, 0, 40), (0, 0, 1), 5, 20),     # ⌀10 axial bore
        ((-20, 0, 20), (1, 0, 0), 2, 40),   # ⌀4 straight through the side
    ))
    p = r["profile"]
    assert p["boreDiaMm"] == pytest.approx(10, abs=0.1)
    assert any(abs(c["diameterMm"] - 4) < 0.1 for c in p["crossFeatureList"])
    assert p["additionalBores"] == []
    # The milled list DOES contain it, which is why it cannot be the source.
    assert any(abs(d - 4) < 0.1 for d in r["milled"]["holeDiametersMm"])


def test_a_blind_hole_in_each_end_is_two_holes_not_one():
    # Two ⌀6 holes, 10 deep, one from each end, solid between them.
    r = extract(_solid(
        ((0, 0, 50), (0, 0, 1), 7, 10),     # ⌀14 main bore at the top
        ((0, 0, 0), (0, 0, 1), 3, 10),      # ⌀6 blind from the bottom
        ((0, 0, 40), (0, 0, 1), 3, 10),     # ⌀6 continuing below the top bore
    ))
    sixes = [b for b in r["profile"]["additionalBores"] if abs(b["diameterMm"] - 6) < 0.1]
    assert len(sixes) == 2
    for b in sixes:
        assert b["depthMm"] == pytest.approx(10, abs=0.5)
