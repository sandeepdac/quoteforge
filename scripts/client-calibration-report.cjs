#!/usr/bin/env node
/* Compare local client evidence with local QuoteForge predictions. No data is committed. */
const fs = require('fs');

function usage() {
  console.error('Usage: node scripts/client-calibration-report.cjs <evidence.json> <predictions.json> [--json]');
  process.exitCode = 2;
}
const evidencePath = process.argv[2];
const predictionsPath = process.argv[3];
if (!evidencePath || !predictionsPath || !fs.existsSync(evidencePath) || !fs.existsSync(predictionsPath)) usage();
else {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));
  const byDrawing = new Map(predictions.map((row) => [row.drawing, row]));
  const rows = evidence.map((actual) => {
    const predicted = byDrawing.get(actual.drawing);
    if (!predicted) return { drawing: actual.drawing, status: 'prediction-missing' };
    const setupError = actual.setupMin > 0 && Number.isFinite(predicted.setupMin) ? (predicted.setupMin - actual.setupMin) / actual.setupMin : null;
    const cycleError = actual.cycleMinPerPart > 0 && Number.isFinite(predicted.cycleMinPerPart) ? (predicted.cycleMinPerPart - actual.cycleMinPerPart) / actual.cycleMinPerPart : null;
    const actualMachines = new Set(actual.machines ?? []);
    const predictedMachines = new Set(predicted.machines ?? (predicted.machine ? [predicted.machine] : []));
    const machineMatch = actualMachines.size > 0 && [...actualMachines].every((machine) => predictedMachines.has(machine));
    return { drawing: actual.drawing, status: 'compared', actualMachines: [...actualMachines], predictedMachines: [...predictedMachines], setupError, cycleError, machineMatch };
  });
  const compared = rows.filter((row) => row.status === 'compared');
  const finite = (key) => compared.filter((row) => Number.isFinite(row[key]));
  const summary = {
    evidenceRows: evidence.length,
    comparedRows: compared.length,
    missingPredictions: rows.filter((row) => row.status === 'prediction-missing').length,
    machineAccuracy: compared.length ? compared.filter((row) => row.machineMatch).length / compared.length : null,
    meanAbsSetupError: finite('setupError').length ? finite('setupError').reduce((sum, row) => sum + Math.abs(row.setupError), 0) / finite('setupError').length : null,
    meanAbsCycleError: finite('cycleError').length ? finite('cycleError').reduce((sum, row) => sum + Math.abs(row.cycleError), 0) / finite('cycleError').length : null,
  };
  const report = { summary, rows };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Compared ${summary.comparedRows}/${summary.evidenceRows} evidence rows`);
    console.log(`Machine accuracy: ${summary.machineAccuracy == null ? 'n/a' : `${(summary.machineAccuracy * 100).toFixed(1)}%`}`);
    console.log(`Mean absolute setup error: ${summary.meanAbsSetupError == null ? 'n/a' : `${(summary.meanAbsSetupError * 100).toFixed(1)}%`}`);
    console.log(`Mean absolute cycle error: ${summary.meanAbsCycleError == null ? 'n/a' : `${(summary.meanAbsCycleError * 100).toFixed(1)}%`}`);
    for (const row of rows) console.log(row.status === 'compared' ? `${row.drawing}: setup ${row.setupError == null ? 'n/a' : `${(row.setupError * 100).toFixed(1)}%`}, cycle ${row.cycleError == null ? 'n/a' : `${(row.cycleError * 100).toFixed(1)}%`}, machine ${row.machineMatch ? 'match' : 'mismatch'}` : `${row.drawing}: prediction missing`);
  }
}
