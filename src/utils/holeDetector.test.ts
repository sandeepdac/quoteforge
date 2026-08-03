import { describe, it, expect } from 'vitest';
import { detectFeaturesFromOcctMeshes } from './holeDetector';
import type { OcctMesh } from 'occt-import-js';

/** A cylindrical wall arc from 0..arcDeg. `inward` normals = concave (bore/inner). */
function arcWall(radius: number, height: number, arcDeg: number, segments: number, inward: boolean): OcctMesh {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  const arc = (arcDeg * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * arc;
    const cx = Math.cos(a), cy = Math.sin(a);
    const nx = inward ? -cx : cx, ny = inward ? -cy : cy;
    position.push(radius * cx, radius * cy, 0); normal.push(nx, ny, 0);
    position.push(radius * cx, radius * cy, height); normal.push(nx, ny, 0);
  }
  for (let i = 0; i < segments; i++) {
    const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
    index.push(b0, b1, t0, t0, b1, t1);
  }
  return {
    attributes: { position: { array: position }, normal: { array: normal } },
    index: { array: index },
    brep_faces: [{ first: 0, last: index.length / 3 - 1, color: null }],
  };
}

describe('detectFeaturesFromOcctMeshes — holes', () => {
  it('detects a concave full cylinder as one hole with the right diameter', () => {
    const r = detectFeaturesFromOcctMeshes([arcWall(4, 10, 360, 48, true)]);
    expect(r.holeCount).toBe(1);
    expect(r.holeDetails[0].diameterMm).toBe(8);
  });

  it('ignores a convex cylinder (outer boss)', () => {
    const r = detectFeaturesFromOcctMeshes([arcWall(4, 10, 360, 48, false)]);
    expect(r.holeCount).toBe(0);
    expect(r.bendCount).toBe(0);
  });

  it('counts a very large opening as a bore, not a hole', () => {
    const r = detectFeaturesFromOcctMeshes([arcWall(40, 20, 360, 64, true)]);
    expect(r.holeCount).toBe(0);
    expect(r.boreCount).toBe(1);
  });

  it('counts two collinear holes at different axial positions as two holes', () => {
    // Same axis line (Z through origin), same radius, but axially separated — two
    // distinct bores through stacked flanges, not one merged hole.
    const shiftZ = (m: OcctMesh, dz: number): OcctMesh => {
      const p = m.attributes.position.array.slice() as number[];
      for (let i = 2; i < p.length; i += 3) p[i] += dz;
      return { ...m, attributes: { ...m.attributes, position: { array: p } } };
    };
    const holeA = arcWall(4, 3, 360, 48, true);           // z ∈ [0, 3]
    const holeB = shiftZ(arcWall(4, 3, 360, 48, true), 20); // z ∈ [20, 23]
    const r = detectFeaturesFromOcctMeshes([holeA, holeB]);
    expect(r.holeCount).toBe(2);
  });
});

describe('detectFeaturesFromOcctMeshes — bends', () => {
  it('detects a coaxial concave+convex arc pair (a fold) as one bend', () => {
    // Inner wall r=3 (concave) + outer wall r=6 (convex): 3 mm sheet, 90° fold.
    const r = detectFeaturesFromOcctMeshes([
      arcWall(3, 40, 90, 24, true),
      arcWall(6, 40, 90, 24, false),
    ]);
    expect(r.bendCount).toBe(1);
    expect(r.holeCount).toBe(0);
  });

  it('does not treat a lone fillet arc (no matching inner/outer wall) as a bend', () => {
    const r = detectFeaturesFromOcctMeshes([arcWall(2, 40, 90, 24, false)]);
    expect(r.bendCount).toBe(0);
  });
});
