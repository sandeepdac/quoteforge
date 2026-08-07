/**
 * Material properties for CNC TURNING estimates — metals and plastics.
 *
 * Each family carries the cutting data a turning cycle-time model needs:
 *   • cuttingSpeedRough / cuttingSpeedFinish (Vc, m/min)
 *   • feedRough / feedFinish (fn, mm/rev)
 *   • depthOfCutRough (ap, mm)
 * plus density (g/cm³) and a relative machinability (mild/medium-carbon steel = 1.0).
 *
 * Values are representative carbide-turning figures from public cutting-data
 * catalogues (Sandvik / Kennametal / Iscar) and Machinery's Handbook — starting
 * points, not shop gospel. A shop tunes them, and the global efficiency factor
 * (see turning.ts) corrects the book-vs-reality gap uniformly. The families span
 * roughly a 5× range in cutting speed (SS316 ≈ 100 vs aluminium ≈ 400 m/min), so
 * the material choice visibly moves the number.
 *
 * Metric MRR (cm³/min) for turning = Vc(m/min) × fn(mm/rev) × ap(mm).
 */

export type MaterialFamily =
  | 'free-steel'
  | 'mild-steel'
  | 'alloy-steel'
  | 'stainless-303'
  | 'stainless-316'
  | 'aluminium'
  | 'aluminium-7075'
  | 'brass'
  | 'bronze'
  | 'copper'
  | 'titanium'
  | 'acetal'
  | 'nylon'
  | 'peek'
  | 'ptfe'
  | 'plastic';

export interface MaterialProps {
  family: MaterialFamily;
  label: string;
  densityGCm3: number;
  /** Relative removal rate, medium-carbon steel = 1.0 (informational). */
  machinability: number;
  isPlastic: boolean;
  // --- turning cutting data ---
  cuttingSpeedRough: number; // Vc, m/min
  cuttingSpeedFinish: number; // Vc, m/min
  feedRough: number;         // fn, mm/rev
  feedFinish: number;        // fn, mm/rev
  depthOfCutRough: number;   // ap, mm
  // --- milling cutting data ---
  /** Feed per tooth (fz, mm/tooth) for a ~10 mm carbide end mill — drives milling MRR. */
  feedPerToothMm: number;
}

type Row = Omit<MaterialProps, 'family'>;

const TABLE: Record<MaterialFamily, Row> = {
  'free-steel':     { label: 'Free-cutting Steel (12L14/EN1A)', densityGCm3: 7.85, machinability: 1.6, isPlastic: false, cuttingSpeedRough: 200, cuttingSpeedFinish: 250, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.060 },
  'mild-steel':     { label: 'Medium-carbon Steel (EN8/1045)',  densityGCm3: 7.85, machinability: 1.0, isPlastic: false, cuttingSpeedRough: 150, cuttingSpeedFinish: 190, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 2.5, feedPerToothMm: 0.050 },
  'alloy-steel':    { label: 'Alloy Steel (EN24/4140)',         densityGCm3: 7.85, machinability: 0.75, isPlastic: false, cuttingSpeedRough: 120, cuttingSpeedFinish: 160, feedRough: 0.28, feedFinish: 0.10, depthOfCutRough: 2.0, feedPerToothMm: 0.045 },
  'stainless-303':  { label: 'Stainless 303',                   densityGCm3: 8.00, machinability: 0.70, isPlastic: false, cuttingSpeedRough: 130, cuttingSpeedFinish: 170, feedRough: 0.28, feedFinish: 0.10, depthOfCutRough: 2.0, feedPerToothMm: 0.045 },
  'stainless-316':  { label: 'Stainless 316',                   densityGCm3: 8.00, machinability: 0.45, isPlastic: false, cuttingSpeedRough: 100, cuttingSpeedFinish: 140, feedRough: 0.24, feedFinish: 0.08, depthOfCutRough: 1.8, feedPerToothMm: 0.035 },
  aluminium:        { label: 'Aluminium 6082',                  densityGCm3: 2.70, machinability: 3.0, isPlastic: false, cuttingSpeedRough: 400, cuttingSpeedFinish: 600, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.090 },
  'aluminium-7075': { label: 'Aluminium 7075',                  densityGCm3: 2.81, machinability: 2.6, isPlastic: false, cuttingSpeedRough: 350, cuttingSpeedFinish: 520, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.090 },
  brass:            { label: 'Brass (CZ121)',                   densityGCm3: 8.50, machinability: 3.5, isPlastic: false, cuttingSpeedRough: 300, cuttingSpeedFinish: 400, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.080 },
  bronze:           { label: 'Bronze',                          densityGCm3: 8.80, machinability: 1.8, isPlastic: false, cuttingSpeedRough: 150, cuttingSpeedFinish: 200, feedRough: 0.25, feedFinish: 0.10, depthOfCutRough: 2.0, feedPerToothMm: 0.050 },
  copper:           { label: 'Copper',                          densityGCm3: 8.96, machinability: 1.5, isPlastic: false, cuttingSpeedRough: 200, cuttingSpeedFinish: 280, feedRough: 0.25, feedFinish: 0.10, depthOfCutRough: 2.0, feedPerToothMm: 0.060 },
  titanium:         { label: 'Titanium',                        densityGCm3: 4.43, machinability: 0.25, isPlastic: false, cuttingSpeedRough: 50,  cuttingSpeedFinish: 70,  feedRough: 0.20, feedFinish: 0.08, depthOfCutRough: 1.0, feedPerToothMm: 0.030 },
  acetal:           { label: 'Acetal (POM)',                    densityGCm3: 1.41, machinability: 4.0, isPlastic: true,  cuttingSpeedRough: 300, cuttingSpeedFinish: 450, feedRough: 0.25, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.100 },
  nylon:            { label: 'Nylon',                           densityGCm3: 1.14, machinability: 3.5, isPlastic: true,  cuttingSpeedRough: 250, cuttingSpeedFinish: 400, feedRough: 0.25, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.100 },
  peek:             { label: 'PEEK',                            densityGCm3: 1.32, machinability: 2.5, isPlastic: true,  cuttingSpeedRough: 200, cuttingSpeedFinish: 350, feedRough: 0.20, feedFinish: 0.10, depthOfCutRough: 2.5, feedPerToothMm: 0.080 },
  ptfe:             { label: 'PTFE',                            densityGCm3: 2.20, machinability: 3.0, isPlastic: true,  cuttingSpeedRough: 250, cuttingSpeedFinish: 400, feedRough: 0.30, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.100 },
  plastic:          { label: 'Plastic',                         densityGCm3: 1.20, machinability: 4.0, isPlastic: true,  cuttingSpeedRough: 300, cuttingSpeedFinish: 450, feedRough: 0.25, feedFinish: 0.10, depthOfCutRough: 3.0, feedPerToothMm: 0.100 },
};

/** Classify a free-text material name into a known family (defaults to medium-carbon steel). */
export function materialFamilyFor(name: string): MaterialFamily {
  const s = (name || '').toLowerCase();
  if (/acetal|\bpom\b|delrin/.test(s)) return 'acetal';
  if (/peek/.test(s)) return 'peek';
  if (/ptfe|teflon/.test(s)) return 'ptfe';
  if (/nylon|\bpa6\b|\bpa66\b|polyamide/.test(s)) return 'nylon';
  if (/plastic|polymer|abs|acrylic|polycarb|\bpc\b|hdpe|\buhmw\b/.test(s)) return 'plastic';
  if (/titanium|\bti\b|ti-?6al/.test(s)) return 'titanium';
  if (/\b316\b|316l/.test(s)) return 'stainless-316';
  if (/\b303\b|\b304\b|\b17-4\b|stainless|inox/.test(s)) return 'stainless-303';
  if (/\b7075\b|\b2024\b/.test(s)) return 'aluminium-7075';
  if (/alumini?um|\b6061\b|\b6082\b|\b5052\b/.test(s)) return 'aluminium';
  if (/brass|\bcz\b|c360|free.?cutting brass/.test(s)) return 'brass';
  if (/bronze|phosphor.?bronze|gunmetal/.test(s)) return 'bronze';
  if (/copper|\bcu\b|c101|c110/.test(s)) return 'copper';
  if (/alloy steel|\b4140\b|\b4340\b|en19|en24|tool steel/.test(s)) return 'alloy-steel';
  if (/12l14|en1a|free.?cutting|leaded|resulph/.test(s)) return 'free-steel';
  if (/\b1045\b|\ben8\b|medium.?carbon|\b080m40\b/.test(s)) return 'mild-steel';
  return 'mild-steel';
}

export function materialPropsFor(name: string): MaterialProps {
  const family = materialFamilyFor(name);
  return { family, ...TABLE[family] };
}

/** Density in g/cm³ for a material name. */
export function densityFor(name: string): number {
  return materialPropsFor(name).densityGCm3;
}

/**
 * Standard round bar diameters (mm). Turned parts are quoted from the next size
 * up over the part OD + radial allowance. Configurable per shop; this is a
 * common metric range for bar-fed work.
 */
export const STANDARD_BAR_DIAMETERS_MM = [
  3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 32, 36, 40, 45, 50, 60, 63, 75, 80, 100, 125,
];

/** Smallest standard bar diameter that is ≥ the required diameter. */
export function nextStandardBar(requiredDiaMm: number): number {
  for (const d of STANDARD_BAR_DIAMETERS_MM) {
    if (d >= requiredDiaMm) return d;
  }
  // Larger than the biggest standard bar — round up to the next 25 mm.
  return Math.ceil(requiredDiaMm / 25) * 25;
}

/**
 * Standard plate / flat-bar thicknesses (mm), the imperial-derived sizes most
 * stock is actually sold in (1/8" … 4"). A milled part is quoted from a billet
 * cut to the next size up, never from its exact bounding box: a 27.9 mm-thick
 * part is machined from 31.75 mm (1¼") plate because 27.9 mm plate isn't a thing.
 */
export const STANDARD_PLATE_THICKNESS_MM = [
  3.175, 4.763, 6.35, 7.938, 9.525, 12.7, 15.875, 19.05, 22.225, 25.4,
  31.75, 38.1, 44.45, 50.8, 63.5, 76.2, 88.9, 101.6,
];

/** Smallest standard plate thickness ≥ the required size (else round up to 25 mm steps). */
export function nextStandardPlate(requiredMm: number): number {
  for (const t of STANDARD_PLATE_THICKNESS_MM) {
    if (t >= requiredMm - 1e-6) return t;
  }
  return Math.ceil(requiredMm / 25.4) * 25.4;
}

/**
 * Billet size for a milled part: add a machining allowance on every face, then
 * round the two smaller dimensions up to purchasable plate thicknesses. The
 * longest dimension is a saw cut, so it only takes the allowance.
 */
export function milledBilletMm(
  bboxMm: { x: number; y: number; z: number },
  // Per face. Kept modest deliberately: this only decides WHICH plate to buy, and
  // the chosen plate usually supplies more clean-up than this anyway. Too large an
  // allowance tips a part over a size boundary for the sake of a fraction of a
  // millimetre — a 150 mm part wants 6" plate (1.2 mm/face of skim), not 7".
  allowanceMm = 1.0
): { x: number; y: number; z: number } {
  const dims: Array<['x' | 'y' | 'z', number]> = [
    ['x', bboxMm.x], ['y', bboxMm.y], ['z', bboxMm.z],
  ];
  // Longest dimension = sawn to length; the other two come off standard plate.
  const longest = dims.reduce((a, b) => (b[1] > a[1] ? b : a));
  const out = { x: 0, y: 0, z: 0 };
  for (const [k, v] of dims) {
    const withAllowance = v + 2 * allowanceMm;
    out[k] = k === longest[0] ? withAllowance : nextStandardPlate(withAllowance);
  }
  return out;
}
