/**
 * Client for the optional Python geometry service (turned-profile extraction).
 *
 * The browser posts the STEP bytes to the Node server (`/api/extract-profile-b64`),
 * which forwards to the FastAPI + OpenCASCADE service. That service reads the real
 * B-Rep — OD steps, bore, grooves, cross features — which the in-browser WASM build
 * cannot. Returns null on any failure (service not running, network, bad reply) so
 * the analyzer falls back to its built-in mesh approximation. Nothing breaks when
 * the service is absent; quotes are just less precise.
 */

export interface GeometryProfile {
  odMm: number;
  lengthMm: number;
  boreDiaMm: number;
  boreDepthMm: number;
  grooveCount: number;
  threadCount: number;
  faceCount: number;
  crossFeatures: boolean;
}

/** Milled/prismatic analysis (the 3 AAG rules) — present alongside the turned verdict. */
export interface GeometryMilled {
  setupCount: number;
  accessDirections: number[][];
  /** Setups reachable from a stock face (the 3-axis, axis-aligned ones). */
  axisAlignedSetups?: number;
  /** Extra setups forced by holes/bores drilled on a COMPOUND ANGLE. */
  angledSetups?: number;
  /** Each angled hole/bore axis, with how far off a stock axis it sits. */
  angledToolAxes?: Array<{ dir: number[]; offAxisDeg: number }>;
  /** Slanted FACES assumed reachable from an existing axis (advisory). */
  absorbedFaceDirections?: Array<{ dir: number[]; offAxisDeg: number }>;
  /** Open/partial circular features — milled by interpolation, never drilled. */
  partialBoreDiametersMm?: number[];
  /** Holes carrying a counterbore/step — drill PLUS counterbore, two tools. */
  steppedHoleCount?: number;
  /** Round bosses / spigots (external cylinders) the cutter profiles around. */
  roundBossCount?: number;
  roundBossDiametersMm?: number[];
  pocketCount: number;
  bossCount: number;
  deepPocketCount: number;
  maxDepthRatio: number;
  holeCount: number;
  /** Measured hole diameters (mm) — for per-size drilling operations. */
  holeDiametersMm?: number[];
  /** Total cylindrical faces (incl. fillets/rounds) — a superset of holeCount. */
  roundFaceCount?: number;
  /** Part fills a small fraction of its bbox → a solid billet is the wrong stock. */
  sparseBillet?: boolean;
  concaveEdges: number;
  convexEdges: number;
  stockMm: { x: number; y: number; z: number };
  stockVolumeCm3: number;
  partVolumeCm3: number;
  removedVolumeCm3: number;
  removalRatio: number;
  pockets: Array<{ depthMm: number; widthMm: number; depthRatio: number; accessDir: number[] }>;
  confidence: number;
  reason: string;
  counts?: Record<string, number>;
}

export interface GeometryResult {
  ok: boolean;
  is_turned: boolean;
  /** 'turned' | 'milled' — the service's headline route recommendation. */
  part_class?: 'turned' | 'milled';
  confidence: number;
  reason: string;
  axis?: { origin: number[]; dir: number[] };
  profile: GeometryProfile;
  measured: { volumeCm3: number; surfaceAreaCm2: number; boundingBoxMm: { x: number; y: number; z: number } };
  counts?: Record<string, number>;
  segments?: Array<{ type: string; radiusMm: number; zStartMm: number; zEndMm: number }>;
  /** Milled analysis, always computed by the service. */
  milled?: GeometryMilled;
}

/** Base64-encode an ArrayBuffer in the browser without blowing the call stack. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

export async function extractTurnedProfile(fileBase64: string, fileName?: string): Promise<GeometryResult | null> {
  if (!fileBase64) return null;
  try {
    const res = await fetch('/api/extract-profile-b64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64, fileName }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.ok !== true) return null;
    return json as GeometryResult;
  } catch {
    // Service not running / unreachable → caller falls back to the mesh path.
    return null;
  }
}
