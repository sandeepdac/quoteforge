/**
 * Material properties for CNC machining estimates — metals AND plastics.
 *
 * `machinability` is a relative cutting-rate multiplier with **mild steel = 1.0**.
 * A higher number means the material removes faster (so less machine time for the
 * same volume of chips). The values are widely-cited shop approximations — a real
 * shop should tune them to its own tooling, but they capture the right ordering
 * (free-cutting brass and aluminium are fast; stainless and titanium are slow;
 * engineering plastics cut very fast). Densities are in g/cm³.
 *
 * This is used both to turn measured volume into weight and to scale the
 * material-removal (roughing) time in the CNC cost model.
 */

export type MaterialFamily =
  | 'aluminium'
  | 'brass'
  | 'bronze'
  | 'copper'
  | 'mild-steel'
  | 'alloy-steel'
  | 'stainless'
  | 'titanium'
  | 'acetal'
  | 'nylon'
  | 'peek'
  | 'ptfe'
  | 'plastic';

export interface MaterialProps {
  family: MaterialFamily;
  /** Human label for notes/UI. */
  label: string;
  /** Density in g/cm³ (for volume → weight). */
  densityGCm3: number;
  /** Relative material-removal rate, mild steel = 1.0 (higher = machines faster). */
  machinability: number;
  /** True for polymers — different stock forms and DFM (no coolant/chip issues, but deflection). */
  isPlastic: boolean;
}

const TABLE: Record<MaterialFamily, Omit<MaterialProps, 'family'>> = {
  aluminium:     { label: 'Aluminium',      densityGCm3: 2.70, machinability: 3.0, isPlastic: false },
  brass:         { label: 'Brass',          densityGCm3: 8.50, machinability: 3.5, isPlastic: false },
  bronze:        { label: 'Bronze',         densityGCm3: 8.80, machinability: 1.8, isPlastic: false },
  copper:        { label: 'Copper',         densityGCm3: 8.96, machinability: 1.5, isPlastic: false },
  'mild-steel':  { label: 'Mild Steel',     densityGCm3: 7.85, machinability: 1.0, isPlastic: false },
  'alloy-steel': { label: 'Alloy Steel',    densityGCm3: 7.85, machinability: 0.7, isPlastic: false },
  stainless:     { label: 'Stainless Steel', densityGCm3: 8.00, machinability: 0.45, isPlastic: false },
  titanium:      { label: 'Titanium',       densityGCm3: 4.43, machinability: 0.25, isPlastic: false },
  acetal:        { label: 'Acetal (POM)',   densityGCm3: 1.41, machinability: 4.0, isPlastic: true },
  nylon:         { label: 'Nylon',          densityGCm3: 1.14, machinability: 3.5, isPlastic: true },
  peek:          { label: 'PEEK',           densityGCm3: 1.32, machinability: 2.5, isPlastic: true },
  ptfe:          { label: 'PTFE',           densityGCm3: 2.20, machinability: 3.0, isPlastic: true },
  plastic:       { label: 'Plastic',        densityGCm3: 1.20, machinability: 4.0, isPlastic: true },
};

/** Classify a free-text material name into a known family (defaults to mild steel). */
export function materialFamilyFor(name: string): MaterialFamily {
  const s = (name || '').toLowerCase();
  if (/acetal|\bpom\b|delrin/.test(s)) return 'acetal';
  if (/peek/.test(s)) return 'peek';
  if (/ptfe|teflon/.test(s)) return 'ptfe';
  if (/nylon|\bpa6\b|\bpa66\b|polyamide/.test(s)) return 'nylon';
  if (/plastic|polymer|abs|acrylic|delrin|polycarb|\bpc\b|hdpe|\buhmw\b/.test(s)) return 'plastic';
  if (/titanium|\bti\b|ti-?6al/.test(s)) return 'titanium';
  if (/stainless|inox|\b304\b|\b316\b|\b303\b|\b17-4\b/.test(s)) return 'stainless';
  if (/brass|\bcz\b|c360|free.?cutting brass/.test(s)) return 'brass';
  if (/bronze|phosphor.?bronze|\bpb\b|gunmetal/.test(s)) return 'bronze';
  if (/copper|\bcu\b|c101|c110/.test(s)) return 'copper';
  if (/alloy steel|\b4140\b|\b4340\b|en19|en24|tool steel/.test(s)) return 'alloy-steel';
  if (/alumini?um|\b6061\b|\b6082\b|\b5052\b|\b7075\b|\b2024\b/.test(s)) return 'aluminium';
  return 'mild-steel';
}

export function materialPropsFor(name: string): MaterialProps {
  const family = materialFamilyFor(name);
  return { family, ...TABLE[family] };
}

/** Density in g/cm³ for a material name (kept for callers that only need weight). */
export function densityFor(name: string): number {
  return materialPropsFor(name).densityGCm3;
}
