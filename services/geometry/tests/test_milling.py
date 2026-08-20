"""Tests for the milled/prismatic analysis (the 3 AAG rules), on OCP samples."""
import os
import tempfile

import pytest

from app.extractor import extract
from app.milling import analyze_milling
from app.extractor import read_step
from tests.generate_samples import build

SAMPLES = build(os.path.join(tempfile.gettempdir(), "qf_samples"))


def _milled(name: str) -> dict:
    return analyze_milling(read_step(SAMPLES[name]))


def test_plain_box_is_one_setup_no_pockets():
    m = _milled("box")
    assert m["setupCount"] == 1
    assert m["pocketCount"] == 0
    # Nothing removed from a solid block → near-zero removal.
    assert m["removalRatio"] < 0.05


def test_open_pocket_is_detected_as_cavity():
    m = _milled("pocket")
    # A single top pocket → one pocket floor, one access direction.
    assert m["pocketCount"] >= 1
    assert m["concaveEdges"] >= 3  # a rectangular pocket has concave floor edges
    assert m["setupCount"] == 1
    assert 0.0 < m["removalRatio"] < 1.0


def test_deep_slot_is_flagged_deep():
    m = _milled("deep")
    assert m["pocketCount"] >= 1
    assert m["deepPocketCount"] >= 1
    assert m["maxDepthRatio"] > 3.0


def test_profiled_step_block_has_no_bosses():
    # A stepped/profiled block has convex-ringed sub-surface faces but no recess
    # (almost no concavity), so it must report ZERO bosses — the convex faces are
    # external profile walls, not islands to rough around. (Regression: a profiled
    # part previously reported many phantom bosses, inflating the complexity derate.)
    m = _milled("step")
    assert m["bossCount"] == 0
    assert m["concaveEdges"] < 3  # a true recess would ring 3+ concave edges


def test_multi_direction_needs_more_than_one_setup():
    m = _milled("multi")
    # Top pocket + side-drilled holes → at least two access directions.
    assert m["setupCount"] >= 2
    assert m["holeCount"] >= 1


def test_box_classified_milled_by_extract():
    r = extract(SAMPLES["box"])
    assert r["is_turned"] is False
    assert r["part_class"] == "milled"
    assert "milled" in r and r["milled"]["setupCount"] >= 1


def test_removed_volume_consistent():
    m = _milled("pocket")
    assert m["stockVolumeCm3"] >= m["partVolumeCm3"] > 0
    assert m["removedVolumeCm3"] == pytest.approx(
        m["stockVolumeCm3"] - m["partVolumeCm3"], abs=0.5)


# --- Compound-angle setups (the "angled features are invisible" regression) ---
#
# A hole can only be produced along its own axis, so a hole drilled on a compound
# angle needs its own tilted fixture or an indexed rotation. The engine used to
# discard every direction more than ~26° off a stock axis, which silently deleted
# those setups — and setups dominate the price at low quantity.


def test_angled_hole_adds_a_setup_over_the_same_part_drilled_straight():
    angled = _milled("angled")
    straight = _milled("straight")
    # Identical block + pocket; only the hole's ANGLE differs. The angled part
    # must need strictly more setups, and must attribute one of them to the
    # angle. (It can also pick up an extra axis-aligned direction, because a
    # slanted through-hole breaks out of a different face than a vertical one —
    # that is real geometry, not the rule misfiring.)
    assert angled["setupCount"] > straight["setupCount"]
    assert angled["angledSetups"] == 1
    assert straight["angledSetups"] == 0


def test_angled_tool_axis_is_reported_with_its_angle():
    m = _milled("angled")
    axes = m["angledToolAxes"]
    assert len(axes) == 1
    # The sample drills at 30° off Z.
    assert 28.0 <= axes[0]["offAxisDeg"] <= 32.0


def test_setup_count_splits_into_axis_aligned_plus_angled():
    m = _milled("angled")
    assert m["setupCount"] == min(m["axisAlignedSetups"], 6) + m["angledSetups"]


def test_angled_work_collapses_confidence_and_says_why():
    angled = _milled("angled")
    straight = _milled("straight")
    # The dangerous old behaviour was near-certainty while dropping real setups.
    assert angled["confidence"] <= 0.6
    assert angled["confidence"] < straight["confidence"]
    assert "angled" in angled["reason"].lower()


def test_axis_aligned_part_is_unaffected_by_the_angled_rule():
    # The straight-drilled twin must keep its original behaviour exactly.
    m = _milled("straight")
    assert m["angledSetups"] == 0
    assert m["angledToolAxes"] == []
    assert m["setupCount"] == m["axisAlignedSetups"]


def test_slanted_faces_are_still_absorbed_not_counted_as_setups():
    # A plain box has no angled tool axes and no absorbed face directions; the
    # rule must not invent either on simple prismatic stock.
    m = _milled("box")
    assert m["angledSetups"] == 0
    assert m["setupCount"] == 1


# --- Stepped holes, round spigots, and which face a blind feature opens on ---
#
# Reported against part 031167-A: a counterbored flange quoted as if the
# counterbores were the only holes, with the ⌀21 spigot and the flip to the back
# face both invisible.


def test_counterbored_hole_reports_both_diameters():
    # The "multi" sample has plain through-holes; build the stepped case here so
    # the assertion is about the step, not about that sample's other features.
    m = _milled("counterbore")
    # A ⌀10 counterbore over a ⌀5 through-hole is TWO operations, two tools.
    assert 2 in [len(g) for g in [m["holeDiametersMm"]]] or m["holeCount"] >= 2
    assert m["steppedHoleCount"] >= 1
    dias = m["holeDiametersMm"]
    assert any(abs(d - 10.0) < 0.6 for d in dias), dias
    assert any(abs(d - 5.0) < 0.6 for d in dias), dias


def test_plain_through_hole_is_not_reported_as_stepped():
    m = _milled("multi")
    assert m["steppedHoleCount"] == 0


def test_round_spigot_is_detected_as_a_boss():
    # An external cylinder has material INSIDE it, so it is not a hole — but the
    # cutter still has to profile around it. It used to be invisible entirely.
    m = _milled("spigot")
    assert m["roundBossCount"] >= 1
    assert any(abs(d - 30.0) < 1.0 for d in m["roundBossDiametersMm"]), m["roundBossDiametersMm"]
    assert m["holeCount"] == 0  # and it must NOT be mistaken for a bore


def test_blind_features_on_opposite_faces_force_a_flip():
    # Blind pockets/holes opening on opposite faces cannot share a setup: the
    # part has to be turned over. Merging both senses of one axis hid that.
    m = _milled("twosided")
    assert m["setupCount"] >= 2


def test_a_through_hole_alone_does_not_force_a_flip():
    # A through hole can be drilled from either end, so it must not manufacture
    # a second setup on an otherwise one-sided part.
    m = _milled("throughonly")
    assert m["setupCount"] == 1


def test_a_bore_nearly_as_wide_as_the_part_is_still_a_bore():
    # The bore branch capped radius at 0.4 x the longest edge and the boss branch
    # at 0.5, so a cylinder between the two matched NEITHER and disappeared. A
    # ⌀24 bore in a 26.5 mm-wide part is ordinary, not absurd; what makes a face
    # a bore is material lying outside it, not its size.
    m = _milled("bigbore")
    assert any(abs(d - 24.0) < 0.5 for d in m["holeDiametersMm"]), m["holeDiametersMm"]
    assert m["roundBossCount"] == 0  # and it is NOT the part's outside profile


def test_every_cylindrical_face_is_classified_as_bore_or_boss():
    # The failure mode was silent: a real feature belonging to neither list. Any
    # cylinder inside the size bound must land somewhere, or it is invisible to
    # both the cost model and the traveller.
    for name in ("bigbore", "counterbore", "spigot", "multi"):
        m = _milled(name)
        assert m["holeCount"] + m["roundBossCount"] > 0, name


# --- The face ledger: the check that can see what we MISSED ----------------
# Every geometry defect in this project has been a silent omission, and none
# were caught by tests, because a test written from the analyser's output can
# only assert about features the analyser already reports. These tests assert
# the opposite property: that nothing in the solid goes unaccounted for without
# being counted and named.

def test_every_face_is_labelled():
    m = _milled("multi")
    assert len(m["faceLabels"]) == m["counts"]["faces"]


def test_the_ledger_accounts_for_every_face():
    m = _milled("counterbore")
    assert sum(row["faces"] for row in m["faceLedger"]) == m["counts"]["faces"]
    assert 0.99 <= sum(row["areaShare"] for row in m["faceLedger"]) <= 1.01


def test_surface_types_we_never_inspect_are_reported_not_dropped():
    # This analyser only reads planes and cylinders. Cones, tori, spheres and
    # NURBS are up to a third of the faces on a real part — every countersink and
    # chamfer lives there — and used to vanish without trace. They must surface as
    # `unexamined`, so the gap is a number on the quote rather than a silence.
    m = _milled("bigbore")
    labels = set(m["faceLabels"].values())
    assert all(":" not in l or l.split(":")[0] in
               ("unexamined", "ignored") for l in labels), labels
    # And the headline figure exists and is consistent with the ledger.
    unexamined = sum(r["faces"] for r in m["faceLedger"]
                     if r["label"] in ("unexamined", "unexplained"))
    assert m["unaccountedFaces"] == unexamined


def test_labelled_mesh_pairs_every_triangle_with_a_classified_face():
    from app.labelled_mesh import labelled_mesh
    shape = read_step(SAMPLES["counterbore"])
    m = _milled("counterbore")
    mesh = labelled_mesh(shape, m["faceLabels"])
    assert mesh["triangleCount"] > 0
    assert len(mesh["triangleFace"]) == mesh["triangleCount"]
    assert len(mesh["indices"]) == mesh["triangleCount"] * 3
    # Every triangle resolves to a face that carries a label — an unlabelled
    # triangle would paint as "unexplained", which must mean something real.
    for fidx in set(mesh["triangleFace"]):
        assert str(fidx) in mesh["faceLabel"]


def test_the_ledger_never_claims_coverage_the_output_does_not_have():
    # The ledger labelled a face `boss` at the moment it was classified, but a
    # boss group that fails the wrap/size test produces no boss feature. Part
    # 035838 had 17 such faces — 23% of its surface — counted as understood while
    # nothing in the quote named them. A ledger that overstates its own coverage
    # is the exact failure it exists to expose, so labels must survive the
    # downstream filters, not just the initial classification.
    for name in ("spigot", "counterbore", "multi", "bigbore", "pocket"):
        m = _milled(name)
        bosses_claimed = sum(r["faces"] for r in m["faceLedger"] if r["label"] == "boss")
        if bosses_claimed:
            assert m["roundBossCount"] > 0, (
                f"{name}: ledger labels {bosses_claimed} faces `boss` but the "
                f"analysis reports no boss feature"
            )
        holes_claimed = sum(r["faces"] for r in m["faceLedger"] if r["label"] == "bore")
        if holes_claimed:
            assert m["holeCount"] > 0, (
                f"{name}: ledger labels {holes_claimed} faces `bore` but the "
                f"analysis reports no hole"
            )
