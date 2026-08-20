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
  // --- turned vs milled: the first question on a mill-turn ------------------
  /** The axis the part's circular features share, if any — the turning axis. */
  turningAxis?: number[] | null;
  /** Circular features coaxial with it: the spindle can TURN these. */
  turnedFeatures?: Array<{ kind: 'bore' | 'spigot'; diameterMm: number; lengthMm: number; offAxisMm: number }>;
  turnedFeatureCount?: number;
  /** Circular features off that axis — driven tools / milling. */
  milledFeatures?: Array<{ kind: 'bore' | 'spigot'; diameterMm: number; lengthMm: number; offAxisMm: number }>;
  /** Planar faces square to the turning axis — facing cuts on a lathe. */
  facingCandidates?: number;
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

// ---------------------------------------------------------------------------
// Face-classification mesh — the outside-in check on the geometry service
// ---------------------------------------------------------------------------
//
// Every geometry defect found in this project so far has been a SILENT
// OMISSION: a feature present in the solid that produced no output at all. None
// were caught by our own tests, and they could not have been — a test written
// from the analyser's output can only ask about features the analyser already
// reports. What found them was someone looking at the part.
//
// This makes that check available in the product. Each triangle carries the
// B-Rep face it came from, and each face carries how the analyser classified
// it, so the viewer can paint the part by what the engine UNDERSTOOD rather
// than by what it drew markers for. A face the engine never accounted for gets
// a loud colour instead of blending into the model.

export interface LabelledMesh {
  ok: boolean;
  positions: number[];
  normals: number[];
  indices: number[];
  /** One B-Rep face index per TRIANGLE (indices.length / 3 entries). */
  triangleFace: number[];
  /** Face index (as string) → classification label. */
  faceLabel: Record<string, string>;
  vertexCount: number;
  triangleCount: number;
  faceLedger?: Array<{ label: string; faces: number; areaMm2: number; areaShare: number; detail: Record<string, number> }>;
  /** Faces the analyser did not account for, by count and by share of area. */
  unaccountedFaces?: number;
  unaccountedAreaShare?: number;
}

/** How each classification reads, and what it means. Shared by the 3D overlay
 *  and the legend so a colour always means the same thing. */
export const FACE_CLASS_INFO: Record<string, { color: string; title: string; blurb: string }> = {
  bore: { color: '#3b82f6', title: 'Bore / hole', blurb: 'Internal cylinder — drilled, bored or interpolated.' },
  boss: { color: '#14b8a6', title: 'Boss / spigot', blurb: 'External cylinder the cutter profiles around.' },
  planar: { color: '#94a3b8', title: 'Flat face', blurb: 'Inspected: drives setups, pockets and facing.' },
  ignored: { color: '#f59e0b', title: 'Seen, then discarded', blurb: 'Inspected and then judged a corner blend or an outside-profile radius rather than a feature. A judgement, not a fact — and the one most worth arguing with.' },
  unexamined: { color: '#ef4444', title: 'NOT EXAMINED', blurb: 'A surface type this analyser never inspects. Every countersink, chamfer and taper lives here.' },
  unexplained: { color: '#dc2626', title: 'UNEXPLAINED', blurb: 'Inspected but attributed to no feature — an omission, not a decision.' },
};

export function faceClassOf(label: string): string {
  return (label || 'unexplained').split(':')[0];
}

/** Fetch the classification mesh. Null on any failure — the viewer falls back to
 *  the plain in-browser tessellation, so this never costs a quote. */
export async function fetchLabelledMesh(fileBase64: string, fileName?: string): Promise<LabelledMesh | null> {
  if (!fileBase64) return null;
  try {
    const res = await fetch('/api/labelled-mesh-b64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64, fileName }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.ok === true ? (json as LabelledMesh) : null;
  } catch {
    return null;
  }
}
