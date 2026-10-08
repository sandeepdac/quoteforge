"""Tests for the turned-profile extractor, using OCP-generated sample solids."""
import math
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


# --- The bar it is cut from, and what is turned out of it ---------------------

def _hex_housing():
    """25.4 A/F hex bar, 70 long, with a ⌀21 boss at each end and a ⌀21
    recess between two hex collars — the shape of the VOC housing."""
    import math
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeCylinder
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    from OCP.gp import gp_Pnt, gp_Vec, gp_Ax2, gp_Dir
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    R = 25.4 / math.sqrt(3)                       # hex circumradius
    poly = BRepBuilderAPI_MakePolygon()
    for k in range(6):
        a = math.pi / 6 + k * math.pi / 3
        poly.Add(gp_Pnt(R * math.cos(a), R * math.sin(a), -35))
    poly.Close()
    bar = BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(poly.Wire()).Face(), gp_Vec(0, 0, 70)).Shape()

    def ring(z0, length):   # turn a band down to ⌀21: hex band minus a ⌀21 core
        band = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1)), 20, length).Shape()
        core = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z0), gp_Dir(0, 0, 1)), 10.5, length).Shape()
        return BRepAlgoAPI_Cut(band, core).Shape()
    for z0, length in ((-35, 5), (-22, 44), (30, 5)):
        bar = BRepAlgoAPI_Cut(bar, ring(z0, length)).Shape()
    fd, path = tempfile.mkstemp(suffix=".step")
    os.close(fd)
    w = STEPControl_Writer()
    w.Transfer(bar, STEPControl_AsIs)
    w.Write(path)
    return path


def test_a_hex_bar_is_recognised_and_its_corners_are_not_turned():
    p = extract(_hex_housing())["profile"]
    # The "OD" the extractor measures is the hex's across-corners...
    assert p["odMm"] == pytest.approx(25.4 / math.cos(math.pi / 6), abs=0.1)
    # ...and the bar is reported as the hex it is.
    assert p["stock"] == {"shape": "polygon", "flats": 6, "acrossFlatsMm": pytest.approx(25.4, abs=0.05)}


def test_turned_regions_are_bosses_at_the_ends_and_a_recess_between_collars():
    regions = extract(_hex_housing())["profile"]["odRegions"]
    assert [r["kind"] for r in regions] == ["boss", "recess", "boss"]
    for r in regions:
        assert r["diameterMm"] == pytest.approx(21, abs=0.05)
    assert regions[1]["lengthMm"] == pytest.approx(44, abs=0.5)


def test_a_plain_round_shaft_is_round_bar_with_no_recess():
    p = extract(SAMPLES["shaft"])["profile"]
    assert p["stock"] == {"shape": "round"}
    assert all(r["kind"] == "boss" for r in p["odRegions"])


# --- A stepped bore is drilled through at its narrow diameter -----------------

def test_a_mouth_over_a_narrower_through_hole_reports_the_through_hole_as_pilot():
    # ⌀12 x 10 mouth over a ⌀10 hole the rest of the way: the shop drills ⌀10
    # the full 60 mm and bores the mouth up from it.
    p = extract(_solid(
        ((0, 0, 50), (0, 0, 1), 6, 10),     # ⌀12 x 10 at the top
        ((0, 0, -1), (0, 0, 1), 5, 52),     # ⌀10 the rest of the way through
    ))["profile"]
    assert p["boreDiaMm"] == pytest.approx(12, abs=0.1)
    assert p["pilotHole"]["diameterMm"] == pytest.approx(10, abs=0.1)
    assert p["pilotHole"]["depthMm"] == pytest.approx(60, abs=1)
    # ...and the ⌀10 is not ALSO reported as a separate hole to drill.
    assert p["additionalBores"] == []


def test_no_pilot_when_a_boring_bar_could_not_open_the_step():
    # ⌀12 over ⌀4: nobody bores 8 mm on diameter up from a ⌀4 hole; it is drilled
    # ⌀12-ish and then ⌀4, as two holes.
    p = extract(_solid(
        ((0, 0, 50), (0, 0, 1), 6, 10),
        ((0, 0, 30), (0, 0, 1), 2, 21),
    ))["profile"]
    assert p["pilotHole"] is None
    assert any(abs(b["diameterMm"] - 4) < 0.1 for b in p["additionalBores"])


# --- A bore at each end is two bores ------------------------------------------

def test_a_blind_bore_in_each_end_counts_both_ends():
    # ⌀12 x 10 blind at each end of a ⌀30 x 60 shaft, a ⌀6 hole through between.
    p = extract(_solid(
        ((0, 0, 50), (0, 0, 1), 6, 11),
        ((0, 0, -1), (0, 0, 1), 6, 11),
        ((0, 0, -1), (0, 0, 1), 3, 62),
    ))["profile"]
    assert p["boreDiaMm"] == pytest.approx(12, abs=0.1)
    assert p["boreEndCount"] == 2


def test_one_bore_is_one_end():
    p = extract(_solid(((0, 0, 50), (0, 0, 1), 6, 11)))["profile"]
    assert p["boreEndCount"] == 1


def test_a_bore_interrupted_by_a_cross_hole_is_still_one_bore():
    # A single ⌀12 bore down the middle of the part, no cross hole needed: it
    # touches neither end, so it can never be read as a bore at each end.
    p = extract(_solid(((0, 0, 20), (0, 0, 1), 6, 20)))["profile"]
    assert p["boreEndCount"] == 1


def test_a_through_bore_is_one_bore_at_both_ends():
    p = extract(_solid(((0, 0, -1), (0, 0, 1), 6, 62)))["profile"]
    assert p["boreEndCount"] == 1
