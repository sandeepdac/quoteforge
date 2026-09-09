import type { ShopTool, TurningOp, TurningToolAssembly } from '../types';

export type EstimatedTurningOp = TurningOp | 'groove' | 'thread' | 'tap' | 'cross';
export const TURNING_SEQUENCE: EstimatedTurningOp[] = [
  'face', 'rough', 'drill', 'bore', 'finish', 'groove', 'thread', 'partoff', 'tap', 'cross',
];

export interface ToolAssignment {
  op: EstimatedTurningOp;
  identity: string;
  label: string;
  station: string;
  description: string;
  noseRadiusMm?: number;
  warning?: string;
}

const stationKey = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

/** No silent substitution when an explicit assignment is missing or broken. */
export function resolveTurningTool(
  op: EstimatedTurningOp, tools: ShopTool[], assemblies?: TurningToolAssembly[],
): ToolAssignment {
  const row = tools.find(t => t.op === op);
  const assembly = row?.assemblyId ? assemblies?.find(a => a.id === row.assemblyId) : undefined;
  const record = row?.assemblyId ? assembly : row;
  const station = stationKey(record?.station ?? '');
  const description = record?.description.trim() ?? '';
  if (!record || !station || !description) {
    return { op, identity: `unassigned:${op}`, label: `Unassigned ${op} tool`, station: '', description: '',
      warning: `${op}: assign a tool assembly with a station and description; one provisional selection is allowed.` };
  }
  // Old rows with conflicting descriptions at the same station must not be
  // silently collapsed into one physical tool.
  const conflict = !row?.assemblyId && tools.some(t => !t.assemblyId && t.op !== op
    && stationKey(t.station) === station && t.description.trim() !== description);
  return {
    op, identity: row?.assemblyId ? `assembly:${row.assemblyId}` : `station:${station}${conflict ? `:${op}` : ''}`,
    label: `${station} — ${description}`, station, description, noseRadiusMm: record.noseRadiusMm,
    warning: conflict ? `${station}: conflicting legacy tool descriptions; resolve the assembly assignments.`
      : !assembly?.inventoryConfirmed ? `${station}: inventory not confirmed; sample/legacy tooling is an assumption.` : undefined,
  };
}

/** Initial selection is included; adjacent uses share a tool, returning to it costs another selection. */
export function countToolSelections(assignments: ToolAssignment[]) {
  return {
    distinctTools: new Set(assignments.map(a => a.identity)).size,
    selections: assignments.filter((a, i) => i === 0 || a.identity !== assignments[i - 1].identity).length,
  };
}

/** Explicit editor migration only; opening Settings never writes or overwrites saved inventory. */
export function seedTurningInventory(tools: ShopTool[], existing?: TurningToolAssembly[]) {
  if (existing !== undefined) return { assemblies: existing, assignments: tools };
  const assemblies: TurningToolAssembly[] = [];
  const assignments = tools.map(t => {
    if (t.assemblyId || !t.station.trim() || !t.description.trim()) return t;
    let a = assemblies.find(a => a.station === stationKey(t.station) && a.description === t.description.trim());
    if (!a) {
      a = { id: `legacy-${assemblies.length + 1}`, station: stationKey(t.station), description: t.description.trim(),
        noseRadiusMm: t.noseRadiusMm, inventoryConfirmed: false, source: 'Existing operation mapping — confirm against shop inventory' };
      assemblies.push(a);
    }
    return { ...t, assemblyId: a.id };
  });
  return { assemblies, assignments };
}
