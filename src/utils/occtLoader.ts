/**
 * Lazy OpenCascade (occt-import-js) loader that tessellates a STEP B-Rep solid into
 * a renderable triangle mesh. The ~7.6 MB WASM module is fetched only the first time
 * a STEP file is actually rendered, then cached for the session.
 *
 * All failures resolve to `null` so the 3D viewer can gracefully fall back to its
 * schematic representation instead of breaking the quoting flow.
 */
// Vite emits the WASM as a hashed asset and hands back its URL (a tiny string).
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

export interface TessellatedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  hasNormals: boolean;
  meshCount: number;
}

export interface MeshMeasurements {
  /** Bounding-box extents sorted descending, in mm. */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Raw axis-aligned bounding box extents (unsorted), in mm. */
  boundingBoxMm: { x: number; y: number; z: number };
  /** Enclosed solid volume, in cm³ (exact for a closed manifold mesh). */
  volumeCm3: number;
  /** Total wetted surface area, in cm². */
  surfaceAreaCm2: number;
}

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/**
 * Computes exact bounding box, enclosed volume and surface area directly from the
 * tessellated triangles — the "measured from the solid" numbers that then drive the
 * weight and finishing cost. Volume uses the signed-tetrahedron sum (origin- and
 * winding-independent in magnitude for a closed surface); area sums triangle areas.
 */
export function measureMesh(mesh: TessellatedMesh): MeshMeasurements {
  const p = mesh.positions;
  const idx = mesh.indices;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  let sixVolume = 0;
  let twiceArea = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];

    // 6 * signed volume of the tetrahedron (origin, a, b, c)
    sixVolume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);

    // 2 * triangle area = |(b - a) × (c - a)|
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    twiceArea += Math.hypot(nx, ny, nz);
  }

  const volumeMm3 = Math.abs(sixVolume) / 6;
  const areaMm2 = twiceArea / 2;
  const dims = [maxX - minX, maxY - minY, maxZ - minZ].sort((x, y) => y - x);

  return {
    lengthMm: round(dims[0], 1),
    widthMm: round(dims[1], 1),
    heightMm: round(dims[2], 1),
    boundingBoxMm: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    volumeCm3: round(volumeMm3 / 1000, 2),
    surfaceAreaCm2: round(areaMm2 / 100, 1),
  };
}

let occtPromise: Promise<import('occt-import-js').OcctModule> | null = null;

function loadOcct() {
  if (!occtPromise) {
    // Dynamic import keeps the ~90 KB emscripten glue out of the main bundle; it
    // (and the WASM) only load the first time a STEP file is rendered.
    occtPromise = import('occt-import-js').then((mod) =>
      mod.default({ locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) })
    );
  }
  return occtPromise;
}

/**
 * Reads a STEP file (as raw bytes) and returns a single merged, indexed mesh.
 * Returns null if OCCT is unavailable or the file yields no geometry.
 */
export async function tessellateStep(buffer: ArrayBuffer): Promise<TessellatedMesh | null> {
  try {
    const occt = await loadOcct();
    const result = occt.ReadStepFile(new Uint8Array(buffer), null);
    if (!result?.success || !result.meshes?.length) return null;

    // Pre-count so we can allocate typed arrays once and merge all sub-meshes.
    let vertexCount = 0;
    let indexCount = 0;
    let hasNormals = true;
    for (const mesh of result.meshes) {
      vertexCount += mesh.attributes.position.array.length / 3;
      indexCount += mesh.index.array.length;
      if (!mesh.attributes.normal) hasNormals = false;
    }
    if (vertexCount === 0 || indexCount === 0) return null;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    let posOffset = 0;
    let idxOffset = 0;
    let vertexBase = 0;
    for (const mesh of result.meshes) {
      const pos = mesh.attributes.position.array;
      positions.set(pos, posOffset);
      if (mesh.attributes.normal) normals.set(mesh.attributes.normal.array, posOffset);

      const idx = mesh.index.array;
      for (let k = 0; k < idx.length; k++) indices[idxOffset + k] = idx[k] + vertexBase;

      vertexBase += pos.length / 3;
      posOffset += pos.length;
      idxOffset += idx.length;
    }

    return { positions, normals, indices, hasNormals, meshCount: result.meshes.length };
  } catch (err) {
    console.warn('[occt] STEP tessellation failed, falling back to schematic view', err);
    return null;
  }
}
