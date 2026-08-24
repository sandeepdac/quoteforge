/**
 * Back-test in the REAL app. Uploads each STEP Lance labelled and reads the
 * machine QuoteForge recommends off the extraction screen.
 *
 * Two traps this harness had to survive, both of which produced a confident
 * wrong number first time round:
 *   1. Matching a machine name anywhere in the page text hits the BAKE-OFF
 *      TABLE, which lists every candidate — so every part "chose" whichever
 *      name was checked first.
 *   2. The machine panel renders only after the face-coverage mesh resolves.
 *      A fixed wait read the page before it existed and scored 0/8.
 * So: wait for the panel, then read the recommendation element itself.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const D = '/root/.claude/uploads/7cf6da52-9462-5706-9569-ec9852d252bd';

const NAMES = [
  ['DMG Mori NTX 1000', 'ntx-1000'],
  ['Mori NL 2000', 'nl-2000'],
  ['Star SR-20', 'star-sr20'],
  ['Star SR-32', 'star-sr32'],
  ['Hanwha', 'hanwha'],
  ['Hi Turner', 'hi-turner'],
  ['Haas VF-2', 'haas-vf2'],
  ['Sabre', 'sabre'],
  ['H Mini Mill 300', 'h-mini-mill-300'],
];

// Mirrors src/utils/machineGroundTruth.ts. Duplicated rather than imported
// because this runs as plain CommonJS against the built app, with no TS step.
// Keep the two in step: machineGroundTruth.ts is the record, this is the runner.
const GT = [
  ['035838', ['ntx-1000', 'nl-2000'], '035838', 'Bulkhead C Clamp'],
  ['032736', ['haas-vf2'], '032736', 'Cold Stage Block'],
  ['031581', ['ntx-1000'], '031581', 'Stage Spacer Block'],
  ['031167', ['nl-2000'], '031167', 'VOC Condenser Side Flange'],
  ['029068', ['star-sr20'], '029068', 'Removable Collet Holding Block'],
  ['Kepler_00884', ['haas-vf2'], 'Kepler_00884', 'Fixture B'],
  ['OLY014_01921', ['ntx-1000'], 'OLY014_01921', 'Hollow arm bulkhead'],
  ['OLY014_01297', ['star-sr32'], 'OLY014_01297', 'Drive Dog'],
];

(async () => {
  const files = fs.readdirSync(D).filter((f) => /\.ste?p$/i.test(f));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let hit = 0, total = 0;
  const misses = [];

  console.log('drawing'.padEnd(15) + 'Lance'.padEnd(20) + 'QuoteForge'.padEnd(20) + 'verdict');
  console.log('-'.repeat(66));

  for (const [drawing, want, match, title] of GT) {
    const f = files.find((x) => x.includes(match));
    if (!f) { console.log(drawing.padEnd(15) + '(no STEP)'); continue; }
    const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
    let got = '?', reason = '';
    try {
      await p.goto('http://localhost:3000/quotes/new', { waitUntil: 'networkidle', timeout: 60000 });
      await p.locator('input[type="file"]').first().setInputFiles(`${D}/${f}`);
      const ins = p.getByRole('button', { name: /Inspect Extracted CAD Features/i });
      await ins.waitFor({ state: 'visible', timeout: 240000 });
      await p.waitForTimeout(1000);
      await ins.click();
      // Wait for the panel itself, not a guess at how long analysis takes.
      await p.waitForFunction(
        () => [...document.querySelectorAll('h3')].some((h) => /Recommended Machine/.test(h.textContent || '')),
        { timeout: 180000 },
      );
      const info = await p.evaluate(() => {
        const h = [...document.querySelectorAll('h3')].find((x) => /Recommended Machine/.test(x.textContent || ''));
        if (!h) return null;
        const panel = h.nextElementSibling;
        const name = panel?.querySelector('p')?.textContent?.trim() ?? '';
        const why = [...(panel?.querySelectorAll('li') ?? [])].map((li) => li.textContent.trim());
        return { name, why: why.slice(0, 2) };
      });
      if (info) {
        for (const [name, id] of NAMES) if (info.name.includes(name)) { got = id; break; }
        if (got === '?') got = 'RAW:' + info.name.slice(0, 26);
        reason = (info.why || []).join(' | ');
      }
    } catch (e) { got = 'ERR:' + String(e.message).slice(0, 26); }
    await p.close();

    const ok = want.includes(got);
    total++; if (ok) hit++;
    else misses.push(`  ${drawing} (${title})\n     Lance: ${want.join(' or ')}   QuoteForge: ${got}\n     why: ${reason.slice(0, 190)}`);
    console.log(drawing.padEnd(15) + want.join('/').padEnd(20) + String(got).padEnd(20) + (ok ? 'HIT' : 'MISS'));
  }
  await b.close();
  console.log('-'.repeat(66));
  console.log(`${hit}/${total} correct (${total ? (hit / total * 100).toFixed(0) : 0}%)`);
  if (misses.length) { console.log('\nMISSES\n'); misses.forEach((m) => console.log(m + '\n')); }
})();
