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
