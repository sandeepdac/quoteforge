/**
 * Client for the server-side Gemini vision endpoint (`POST /api/analyze-cad`).
 *
 * Used for 2D inputs — PDF drawings and images — where dimensions can't be measured
 * geometrically and must be read from the drawing's annotations/title block. Returns
 * null on any failure (no API key configured, network error, unparseable response) so
 * the caller can fall back to a manual-entry flow rather than fabricating dimensions.
 */

/** Turned-part fields the vision model reads off a rotationally-symmetric drawing. */
export interface AiTurnedData {
  odMm?: number;
  lengthMm?: number;
  boreDiaMm?: number;
  boreDepthMm?: number;
  grooveCount?: number;
  threadCount?: number;
  faceCount?: number;
}

/** Milled/prismatic fields read off a plate/housing drawing. */
export interface AiMilledData {
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  holeCount?: number;
  holeDetails?: Array<{ diameterMm: number; count: number }>;
  pocketCount?: number;
  bossCount?: number;
  setupCount?: number;
}

export interface AiDrawingData {
  partName?: string;
  materialName?: string;
  /** Machining route the model inferred from the drawing. */
  partClass?: 'turned' | 'milled' | 'unknown';
  turned?: AiTurnedData | null;
  milled?: AiMilledData | null;
  toleranceCallout?: string;
  finishCallout?: string;
  quantity?: number;
  weightKg?: number;
  aiNotes?: string[];
  confidenceScore?: number;

  // --- legacy sheet-metal fields (kept so older responses still parse) ---
  thicknessMm?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  perimeterMm?: number;
  pierceCount?: number;
  bendCount?: number;
  isSimpleBending?: boolean;
  holeCount?: number;
  holeDetails?: Array<{ diameterMm: number; count: number }>;
  weldLengthMm?: number;
  weldCount?: number;
  surfaceAreaM2?: number;
  tolerances?: string;
}

export async function analyzeDrawingWithAI(input: {
  fileName: string;
  fileBase64?: string;
  mimeType?: string;
  /** Raw STEP text — set for the 3D fallback when the geometry service is down. */
  stepText?: string;
}): Promise<AiDrawingData | null> {
  try {
    const res = await fetch('/api/analyze-cad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      if (res.status === 404) {
        console.warn('[ai] /api/analyze-cad returned 404 — the API server is not running. Start the app with `npm run dev` (tsx server.ts), not the bare Vite dev server.');
      } else {
        console.warn(`[ai] /api/analyze-cad HTTP ${res.status} — falling back to manual entry.`);
      }
      return null;
    }
    const json = await res.json();
    if (!json?.success || !json.data) {
      console.warn('[ai] extraction did not succeed, falling back to manual entry:', json?.message || json?.error || 'unknown reason');
      return null;
    }
    return json.data as AiDrawingData;
  } catch (err) {
    console.warn('[ai] drawing extraction failed, falling back to manual entry', err);
    return null;
  }
}
