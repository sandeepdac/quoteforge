import { describe, it, expect } from 'vitest';
import { measureMesh, solidFormatFor, TessellatedMesh } from './occtLoader';

describe('solidFormatFor', () => {
  it('maps 3D solid extensions to OCCT formats', () => {
    expect(solidFormatFor('part.step')).toBe('step');
    expect(solidFormatFor('part.STP')).toBe('step');
    expect(solidFormatFor('part.iges')).toBe('iges');
    expect(solidFormatFor('part.IGS')).toBe('iges');
    expect(solidFormatFor('part.brep')).toBe('brep');
  });

  it('returns null for non-solid inputs', () => {
    expect(solidFormatFor('drawing.pdf')).toBeNull();
    expect(solidFormatFor('photo.png')).toBeNull();
    expect(solidFormatFor('layout.dxf')).toBeNull();
  });
});

/** Builds a solid axis-aligned cube of the given size at the origin, outward-wound. */
function cubeMesh(size: number): TessellatedMesh {
  const s = size;
  const positions = new Float32Array([
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, // z = 0
    0, 0, s, s, 0, s, s, s, s, 0, s, s, // z = s
  ]);
  // Outward-facing triangles (CCW seen from outside) for all six faces.
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (z=0), normal -z
    4, 5, 6, 4, 6, 7, // top (z=s), normal +z
    0, 1, 5, 0, 5, 4, // front (y=0), normal -y
    2, 3, 7, 2, 7, 6, // back (y=s), normal +y
    1, 2, 6, 1, 6, 5, // right (x=s), normal +x
    0, 4, 7, 0, 7, 3, // left (x=0), normal -x
  ]);
  return { positions, normals: new Float32Array(positions.length), indices, hasNormals: false, meshCount: 1 };
}

describe('measureMesh', () => {
  it('computes exact volume and surface area of a 10 mm cube', () => {
    const m = measureMesh(cubeMesh(10));
    // 10mm cube: 1000 mm³ = 1 cm³, 600 mm² = 6 cm².
    expect(m.volumeCm3).toBeCloseTo(1, 5);
    expect(m.surfaceAreaCm2).toBeCloseTo(6, 5);
  });

  it('reports the bounding box extents', () => {
    const m = measureMesh(cubeMesh(25));
    expect(m.lengthMm).toBe(25);
    expect(m.widthMm).toBe(25);
    expect(m.heightMm).toBe(25);
    expect(m.boundingBoxMm).toEqual({ x: 25, y: 25, z: 25 });
  });

  it('sorts bounding-box extents descending into length ≥ width ≥ height', () => {
    const mesh = cubeMesh(10);
    // Stretch X to 30 and Y to 20 so extents are distinct.
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i] > 0) mesh.positions[i] = 30;
      if (mesh.positions[i + 1] > 0) mesh.positions[i + 1] = 20;
    }
    const m = measureMesh(mesh);
    expect([m.lengthMm, m.widthMm, m.heightMm]).toEqual([30, 20, 10]);
  });
});
