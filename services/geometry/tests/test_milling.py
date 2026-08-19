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
