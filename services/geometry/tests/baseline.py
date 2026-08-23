"""
GOLDEN BASELINE — a brake, not a feature.

Every change to the analyser this project has shipped was verified by running the
sample corpus before and after and diffing the output by hand. That worked, and
it is why the ⌀24 fix could be shown to touch exactly one part while eight NIST
benchmarks stayed byte-identical. But it only happened because someone
remembered to do it, which is not a control.

This pins the numbers. `python -m tests.baseline --update` rewrites
`baseline.json`; the test compares against it and prints a per-part diff. A
change that moves a price is then a visible, reviewable line in a commit rather
than something a reader has to take on trust.

The corpus itself is not in the repo (customer parts, ~40 MB), so the harness
reads it from QF_CORPUS_DIR and skips cleanly when it is absent. The BASELINE is
committed, so the numbers stay reviewable in git either way.
"""
from __future__ import annotations

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE_PATH = os.path.join(HERE, "baseline.json")
DEFAULT_CORPUS = "/root/.claude/uploads/7cf6da52-9462-5706-9569-ec9852d252bd"

# The fields that decide a price. Deliberately narrow: adding a diagnostic field
# should not churn the baseline, but anything here moving is a real change to
# what a customer is quoted.
TRACKED = [
    "setupCount", "axisAlignedSetups", "angledSetups",
    "holeCount", "pocketCount", "bossCount", "deepPocketCount",
    "roundBossCount", "countersinkCount", "chamferCount", "taperCount",
    "drillPointCount", "steppedHoleCount",
    "turnedFeatureCount", "facingCandidates",
    "unaccountedFaces", "threadCalloutCount",
    "partVolumeCm3", "stockVolumeCm3", "removedVolumeCm3",
]


def corpus_dir() -> str:
    return os.environ.get("QF_CORPUS_DIR", DEFAULT_CORPUS)


def corpus_files() -> list:
    d = corpus_dir()
    if not os.path.isdir(d):
        return []
    return sorted(glob.glob(os.path.join(d, "*.[Ss][Tt][EePp]*")))


def _key(path: str) -> str:
    """Stable name for a part: the filename minus any upload-id prefix."""
    base = os.path.basename(path)
    return base[9:] if len(base) > 9 and base[8] == "-" else base


def measure_one(path: str) -> dict:
    from app.extractor import read_step
    from app.milling import analyze_milling
    from app.threads import find_thread_callouts

    m = analyze_milling(read_step(path))
    # Threads are read from the file's NAMES, not its faces, so they are not part
    # of the milling analysis — but a change in thread detection changes what a
    # customer is quoted, so it belongs under the same brake.
    m["threadCalloutCount"] = len(find_thread_callouts(path))
    out = {}
    for k in TRACKED:
        v = m.get(k)
        out[k] = round(v, 3) if isinstance(v, float) else v
    return out


def measure_all() -> dict:
    rows = {}
    for f in corpus_files():
        try:
            rows[_key(f)] = measure_one(f)
        except Exception as exc:  # noqa: BLE001 — a part that fails to read is itself a finding
            rows[_key(f)] = {"error": str(exc)[:120]}
    return rows


def load_baseline() -> dict:
    if not os.path.exists(BASELINE_PATH):
        return {}
    with open(BASELINE_PATH) as fh:
        return json.load(fh)


def diff(current: dict, baseline: dict) -> list:
    """Human-readable list of what moved, part by part."""
    lines = []
    for part in sorted(set(current) | set(baseline)):
        cur, base = current.get(part), baseline.get(part)
        if base is None:
            lines.append(f"+ {part}: NEW (not in baseline)")
            continue
        if cur is None:
            lines.append(f"- {part}: MISSING from this run")
            continue
        for k in sorted(set(cur) | set(base)):
            a, b = base.get(k), cur.get(k)
            if a != b:
                lines.append(f"~ {part}: {k}  {a} -> {b}")
    return lines


def main() -> int:
    files = corpus_files()
    if not files:
        print(f"No corpus at {corpus_dir()} — set QF_CORPUS_DIR.")
        return 2
    current = measure_all()
    if "--update" in sys.argv:
        with open(BASELINE_PATH, "w") as fh:
            json.dump(current, fh, indent=2, sort_keys=True)
            fh.write("\n")
        print(f"Baseline written: {len(current)} parts -> {BASELINE_PATH}")
        return 0
    changes = diff(current, load_baseline())
    if not changes:
        print(f"No change across {len(current)} parts.")
        return 0
    print(f"{len(changes)} change(s) against the baseline:")
    for line in changes:
        print("   ", line)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
