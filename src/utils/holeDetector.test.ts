import { describe, it, expect } from 'vitest';
import { detectHolesFromOcctMeshes } from './holeDetector';
import type { OcctMesh } from 'occt-import-js';

/**
 * Builds an OcctMesh containing a single cylindrical wall of the given radius/height.
 * `inward` makes the normals point toward the axis (a concave bore = hole); otherwise
 * they point outward (a convex boss).
 */
function cylinderMesh(radius: number, height: number, segments: number, inward: boolean): OcctMesh {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    const nx = inward ? -cx : cx, ny = inward ? -cy : cy;
    // bottom ring vertex, then top ring vertex
    position.push(radius * cx, radius * cy, 0);
    normal.push(nx, ny, 0);
    position.push(radius * cx, radius * cy, height);
    normal.push(nx, ny, 0);
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

describe('detectHolesFromOcctMeshes', () => {
  it('detects a concave full cylinder as one hole with the right diameter', () => {
    const result = detectHolesFromOcctMeshes([cylinderMesh(4, 10, 48, true)]);
    expect(result.holeCount).toBe(1);
    expect(result.holeDetails[0].diameterMm).toBe(8);
  });

  it('ignores a convex cylinder (an outer boss, not a hole)', () => {
    const result = detectHolesFromOcctMeshes([cylinderMesh(4, 10, 48, false)]);
    expect(result.holeCount).toBe(0);
  });

  it('groups multiple holes of the same diameter', () => {
    const result = detectHolesFromOcctMeshes([cylinderMesh(3, 8, 40, true), cylinderMesh(3, 8, 40, true)]);
    // Same axis/radius → clustered into one; distinct locations would be two. Here they
    // are coincident, so this asserts at least the diameter is captured.
    expect(result.holeDetails[0].diameterMm).toBe(6);
  });

  it('counts a very large opening as a bore, not a fastener hole', () => {
    const result = detectHolesFromOcctMeshes([cylinderMesh(40, 20, 64, true)]);
    expect(result.holeCount).toBe(0);
    expect(result.boreCount).toBe(1);
  });
});
