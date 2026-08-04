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
