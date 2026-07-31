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
