import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { analyzeCadFile } from '../cadAnalyzer';
import { resolveQuoteCosts } from '../quoteCosts';
import { DEFAULT_SHOP_SETTINGS } from '../../constants';
import { QUOTED_PARTS } from './quotes';
import { CYCLE_SHEETS, sheetCuttingSec, sheetIdleSec } from './cycleSheets';
import { PROGRAMMED_PARTS, programmedTotalSec } from './programmedCuts';

/**
 * EVERY PART, THROUGH THE APP'S OWN PIPELINE, AGAINST LANCE.
 *
 * analyzeCadFile -> resolveQuoteCosts, exactly as the wizard runs them, on each
 * STEP file we hold, scored against whatever Lance has told us about it: a cycle
 * sheet (cutting + idle), a CAM write-up (cutting), his router (machine, price).
 * It prints one table so a change to the model shows up as a row moving, and it
 * asserts only BANDS, never a pinned second: nothing here is fitted.
 *
 * OFF BY DEFAULT. It needs the geometry service and the STEP files, so an
 * ordinary `npm test` skips it. To run it:
 *
 *   (cd services/geometry && .venv/bin/uvicorn main:app --port 8000) &
 *   git archive origin/main -- '*.STEP' '*.step' | tar -x -C /tmp/qf-steps
 *   QF_ALL_PARTS=1 QF_STEP_DIR=/tmp/qf-steps npx vitest run src/utils/calibration/allParts.test.ts
 *
 * QF_EXTRA_STEP_DIR names a second folder (the two CAM-timed parts, which are
 * not in the repo); QF_GEOMETRY_URL overrides http://127.0.0.1:8000.
 */
const RUN = process.env.QF_ALL_PARTS === '1';
const STEP_DIR = process.env.QF_STEP_DIR ?? process.cwd();
const EXTRA_DIR = process.env.QF_EXTRA_STEP_DIR;
const GEOMETRY_URL = process.env.QF_GEOMETRY_URL ?? 'http://127.0.0.1:8000';

interface Case {
  name: string; match: string; material: string; pricePerKg: number; qty: number;
  /** Lance's machine for the first operation, as our MachineId, where we know it. */
  lanceMachine?: string;
  /** Finishes the drawing calls out that the lathe has to leave (Ra, um). */
  finish?: { general: number; sealing: number };
  /** Which of Lance's cutting figures applies, and from where. */
  cutting?: { sec: number; source: 'sheet' | 'CAM'; scope: 'op1' | 'whole' };
  idleSec?: number;
}

const sheet = (d: string) => CYCLE_SHEETS.find((s) => s.drawing === d)!;
const cam = (p: string) => programmedTotalSec(PROGRAMMED_PARTS.find((x) => x.part.startsWith(p))!);
const quote = (d: string) => QUOTED_PARTS.find((q) => q.drawing === d)!;

const CASES: Case[] = [
  { name: '031169-A', match: '031169', material: 'Brass CZ121', pricePerKg: 12, qty: 1, lanceMachine: 'nl-2000',
    finish: { general: 0.8, sealing: 0.4 },
    cutting: { sec: sheetCuttingSec(sheet('031169-A')), source: 'sheet', scope: 'op1' }, idleSec: sheetIdleSec(sheet('031169-A')) },
  { name: 'OLY014_01921-A', match: 'OLY014_01921', material: 'Stainless 316', pricePerKg: 8.5, qty: 15, lanceMachine: 'ntx-1000',
    cutting: { sec: sheetCuttingSec(sheet('OLY014_01921-A')), source: 'sheet', scope: 'whole' }, idleSec: sheetIdleSec(sheet('OLY014_01921-A')) },
  { name: 'OLY014_02062-A', match: 'OLY014_02062', material: 'Stainless 316', pricePerKg: 8.5, qty: 1, lanceMachine: 'ntx-1000',
    cutting: { sec: cam('OLY014_02062'), source: 'CAM', scope: 'whole' } },
  { name: 'S17604_00415-A', match: 'S17604', material: 'Aluminium 6082', pricePerKg: 6.5, qty: 1, lanceMachine: 'haas-vf2',
    cutting: { sec: cam('S17604_00415'), source: 'CAM', scope: 'whole' } },
  { name: '032736-01', match: '032736', material: 'Copper', pricePerKg: 14, qty: 10, lanceMachine: 'ntx-1000' },
  { name: 'OLY014_01297-A', match: 'OLY014_01297', material: 'Acetal (POM)', pricePerKg: 6, qty: 68, lanceMachine: 'star-sr32' },
  { name: '035838-A', match: '035838', material: 'Aluminium 6082', pricePerKg: 6.5, qty: 15, lanceMachine: 'nl-2000' },
  { name: 'NAUT_01695-C', match: 'NAUT_01695', material: 'Stainless 303', pricePerKg: 6.5, qty: 100, lanceMachine: 'hanwha' },
];

const find = (match: string): string | undefined => {
  for (const dir of [STEP_DIR, EXTRA_DIR].filter(Boolean) as string[]) {
    if (!fs.existsSync(dir)) continue;
    const f = fs.readdirSync(dir).find((x) => x.includes(match) && /\.ste?p$/i.test(x));
    if (f) return path.join(dir, f);
  }
  return undefined;
};

describe.skipIf(!RUN)('every part against Lance, through the app\'s pipeline', () => {
  const realFetch = globalThis.fetch;
  const rows: string[] = [];

  it('prints the table and stays inside the bands', async () => {
    globalThis.fetch = ((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/extract-profile-b64')) return realFetch(`${GEOMETRY_URL}/extract-profile-b64`, init);
      if (u.startsWith('/api/')) return Promise.resolve(new Response('{}', { status: 404 }));
      return realFetch(url as string, init);
    }) as typeof fetch;

    const missing: string[] = [];
    for (const c of CASES) {
      const file = find(c.match);
      if (!file) { missing.push(c.name); continue; }
      const buf = fs.readFileSync(file);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const a: any = await analyzeCadFile(
        { name: path.basename(file), buffer: ab, content: buf.toString('utf8'), base64: buf.toString('base64') },
        { quantity: c.qty });
      if (c.finish && a.turningProfile) {
        a.turningProfile.surfaceFinishRaUm = c.finish.general;
        a.turningProfile.sealingFaceRaUm = c.finish.sealing;
      }
      const r: any = resolveQuoteCosts({
        cadAnalysis: { ...a, materialName: c.material }, features: a.features ?? ({} as any),
        materialName: c.material, materialPricePerKg: c.pricePerKg, quantity: c.qty,
        isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS as any,
      });
      const mc = r.machiningCosts;
      const ops = (mc?.plan?.setups ?? []) as Array<{ operations: Array<{ cuttingSeconds?: number; idleSeconds?: number }> }>;
      const sum = (os: typeof ops, k: 'cuttingSeconds' | 'idleSeconds') =>
        os.flatMap((s) => s.operations).reduce((x, o) => x + (o[k] ?? 0), 0);
      const scoped = c.cutting?.scope === 'op1' ? ops.slice(0, 1) : ops;
      const cut = sum(scoped, 'cuttingSeconds');
      const idle = sum(scoped, 'idleSeconds') + (c.cutting?.scope === 'op1' ? DEFAULT_SHOP_SETTINGS.cnc!.barLoadSec : 0);
      const machine = a.machineRecommendation?.recommended as string;
      const lancePrice = (() => { try { return quote(c.name).pricing[0].quotedPrice; } catch { return undefined; } })();
      const price: number = r.unitPrice;

      rows.push([
        c.name.padEnd(16), `${machine}${c.lanceMachine ? (machine === c.lanceMachine ? ' =' : ` != ${c.lanceMachine}`) : ''}`.padEnd(24),
        `cut ${cut.toFixed(0).padStart(5)}${c.cutting ? ` / ${c.cutting.sec} (${c.cutting.source}) x${(cut / c.cutting.sec).toFixed(2)}` : ''}`.padEnd(40),
        `idle ${idle.toFixed(0).padStart(4)}${c.idleSec ? ` / ${c.idleSec} x${(idle / c.idleSec).toFixed(2)}` : ''}`.padEnd(26),
        `price ${price.toFixed(2)}${lancePrice ? ` / ${lancePrice} x${(price / lancePrice).toFixed(2)}` : ''}`,
      ].join('  '));

      // BANDS, not pins: a change that moves a part out of these is worth reading.
      if (c.cutting) expect(cut / c.cutting.sec, `${c.name} cutting`).toBeGreaterThan(0.5);
      if (c.cutting) expect(cut / c.cutting.sec, `${c.name} cutting`).toBeLessThan(1.5);
      if (c.idleSec) expect(idle / c.idleSec, `${c.name} idle`).toBeGreaterThan(0.5);
      if (c.idleSec) expect(idle / c.idleSec, `${c.name} idle`).toBeLessThan(1.5);
      if (lancePrice) expect(price / lancePrice, `${c.name} price`).toBeGreaterThan(0.25);
      if (lancePrice) expect(price / lancePrice, `${c.name} price`).toBeLessThan(2.5);
      expect(Number.isFinite(price) && price > 0, `${c.name} price is a number`).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.log(`\n${rows.join('\n')}${missing.length ? `\n(no STEP file found for: ${missing.join(', ')})` : ''}\n`);
    expect(rows.length, 'at least one part was found').toBeGreaterThan(0);
    globalThis.fetch = realFetch;
  }, 600000);
});
