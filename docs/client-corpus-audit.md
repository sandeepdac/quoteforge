# Client corpus audit

Run the read-only inventory against the supplied evidence folder:

```powershell
npm run audit:client -- "C:\Sriven\Turncircuit"
npm run audit:client -- "C:\Sriven\Turncircuit" --json > client-corpus-report.json
npm run audit:client -- "C:\Sriven\Turncircuit" --manifest C:\path\to\local-manifest.json --json > client-corpus-report.json
```

The command does not copy, modify, or commit any client file. The repository contains no client manifest. Pass a local JSON manifest when you want STEP matching; each row needs at least `stepMatch`, and may contain private drawing, material, quantity, route, setup, and cycle fields. Keep that manifest outside Git.

Before using the report for calibration, confirm router time units and whether cycle times are per part or per batch. OLY014-01921 is especially important: its machining operations must be allocated to NTX1000 and MINI MILL separately, while programming and inspection are not spindle runtime.

To compare QuoteForge output, create a local prediction file with rows shaped like `{ "drawing": "...", "setupMin": 123, "cycleMinPerPart": 4.2, "machines": ["..."] }`, then run:

```powershell
npm run calibrate:client -- client-corpus.local.json predictions.local.json
npm run calibrate:client -- client-corpus.local.json predictions.local.json --json > client-calibration-report.json
```

The report uses signed error `(prediction - client) / client`, mean absolute errors, machine accuracy, and explicit missing-prediction rows. It never changes estimator coefficients.
