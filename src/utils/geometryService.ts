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

export interface GeometryResult {
  ok: boolean;
  is_turned: boolean;
  confidence: number;
  reason: string;
  axis?: { origin: number[]; dir: number[] };
  profile: GeometryProfile;
  measured: { volumeCm3: number; surfaceAreaCm2: number; boundingBoxMm: { x: number; y: number; z: number } };
  counts?: Record<string, number>;
  segments?: Array<{ type: string; radiusMm: number; zStartMm: number; zEndMm: number }>;
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
