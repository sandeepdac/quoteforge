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
