/**
 * Camera framing for the 3D CAD viewer.
 *
 * The viewer shows parts spanning three orders of magnitude — a 10 mm insert to a
 * 2 m weldment — so every distance it uses must be derived from the model, never
 * fixed in millimetres. Hard-coded values silently clip large parts: with a 2000 mm
 * far plane, an 800 mm plate (camera ~2360 mm out) rendered as a sliver and a
 * 1800 mm frame vanished completely, while the reported dimensions still looked
 * correct — so the bug read as "the file didn't load".
 */

/** Camera placement offsets as multiples of the model span (an isometric-ish 3/4 view). */
export const CAMERA_OFFSET = { x: 1.5, y: 1.2, z: 1.8 } as const;

export interface CameraBracket {
  near: number;
  far: number;
  /** Distance from origin to the camera at the default framing. */
  distance: number;
}

/**
 * Near/far planes and the resulting camera distance for a model of `spanMm`
 * (its largest bounding-box dimension).
 *
 * @param frame extra framing multiplier (>1 pulls back to fit annotations)
 */
export function cameraBracketFor(spanMm: number, frame = 1): CameraBracket {
  const span = spanMm > 0 ? spanMm : 300;
  const { x, y, z } = CAMERA_OFFSET;
  const distance = span * frame * Math.hypot(x, y, z);
  return {
    near: Math.max(0.1, span / 1000),
    // Clears the camera distance plus the part itself, with room to zoom out.
    far: span * 20,
    distance,
  };
}

/** Wheel-zoom limits, also scaled so the wheel feels the same at any part size. */
export function zoomLimitsFor(spanMm: number): { min: number; max: number; step: number } {
  const span = spanMm > 0 ? spanMm : 300;
  return { min: span * 0.25, max: span * 6, step: span * 0.0012 };
}

/** True when the model's bounding sphere fits inside the near/far bracket. */
export function isModelWithinBracket(spanMm: number, b: CameraBracket): boolean {
  const halfDiagonal = (spanMm * Math.sqrt(3)) / 2; // worst case: span on every axis
  return b.distance + halfDiagonal <= b.far && b.distance - halfDiagonal >= b.near;
}
