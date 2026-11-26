# Sample corpus for the geometry baseline and the all-parts comparison

STEP files dropped in this folder are picked up automatically by:

- `services/geometry/tests/baseline.py`: measures each part and compares it with
  `baseline.json` (`.venv/bin/python -m tests.baseline`; add `--update` to accept a
  change on purpose). It also looks in the repo root, where the first customer parts
  were uploaded.
- `src/utils/calibration/allParts.test.ts`: runs each part through the app's pipeline
  against Lance's data (`QF_ALL_PARTS=1`, with the geometry service running).

The two parts the comparison scores against Lance's CAM reports are here:
`OLY014_02062-A.step` (316 stainless hinge) and `SOLIDWORKS-MID_LIMIT-S17604-00415.STEP`
(aluminium base block). Add new parts the same way, then run
`python -m tests.baseline --update` and commit the updated `baseline.json`.

These are customer parts: confirm you may commit a file before adding it.
