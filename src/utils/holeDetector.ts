/**
 * Geometric feature detection from a tessellated B-Rep (holes + sheet-metal bends).
 *
 * OpenCascade gives us, per mesh, the triangles grouped by their originating B-Rep
 * face (`brep_faces`) plus per-vertex normals. We fit each face to a cylinder and
 * classify:
 *   - HOLE: concave, near-complete cylinder (a bore wall). Coaxial half-cylinders are
 *     merged so one physical hole counts once; openings over ⌀60 mm are "bores".
 *   - BEND: a coaxial concave(inner) + convex(outer) cylinder pair separated by the
 *     sheet thickness — the signature of a press-brake fold. Machining fillets and
 *     edge rounds lack the matching inner/outer wall, so they're excluded.
 * This is far more reliable than counting CIRCLE / PLANE entities in the STEP text,
 * which also picks up annotation arcs, convex rounds and PMI geometry.
 */
import type { OcctMesh } from 'occt-import-js';

export interface DetectedFeatures {
  holeCount: number;
  holeDetails: Array<{ diameterMm: number; count: number }>;
  boreCount: number;
  bendCount: number;
}

type Vec3 = [number, number, number];

interface CylFace {
  axis: Vec3;
  radius: number;
  centerPerp: Vec3; // foot of perpendicular from origin to the axis line
  concave: boolean;
  coverageDeg: number; // angular wrap of this face
  axMin: number; // extent along the axis
  axMax: number;
  worldPts: Vec3[];
}

// ---- small linear-algebra helpers -----------------------------------------

function eigenSym3(m: number[]): { values: number[]; vectors: Vec3[] } {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (let iter = 0; iter < 50; iter++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    for (const [i, j] of pairs) {
      if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
    }
    if (max < 1e-12) break;
    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 3; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
    for (let k = 0; k < 3; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
    for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors: Vec3[] = [
    [v[0][0], v[1][0], v[2][0]],
    [v[0][1], v[1][1], v[2][1]],
    [v[0][2], v[1][2], v[2][2]],
  ];
  const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  return { values: order.map((i) => values[i]), vectors: order.map((i) => vectors[i]) };
}

function planeBasis(axis: Vec3): [Vec3, Vec3] {
  const up: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u: Vec3 = [up[1] * axis[2] - up[2] * axis[1], up[2] * axis[0] - up[0] * axis[2], up[0] * axis[1] - up[1] * axis[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: Vec3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  return [u, v];
}

function fitCircle(pts: Array<[number, number]>): { uc: number; vc: number; r: number; res: number } | null {
  const n = pts.length;
  let mu = 0, mv = 0;
  for (const [u, v] of pts) { mu += u; mv += v; }
  mu /= n; mv /= n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const [pu, pv] of pts) {
    const u = pu - mu, v = pv - mv;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return null;
  const D = 0.5 * (Suuu + Suvv), E = 0.5 * (Svvv + Svuu);
  const uc = (D * Svv - Suv * E) / det + mu;
  const vc = (Suu * E - Suv * D) / det + mv;
  let r = 0;
  for (const [u, v] of pts) r += Math.hypot(u - uc, v - vc);
  r /= n;
  let res = 0;
  for (const [u, v] of pts) { const d = Math.hypot(u - uc, v - vc) - r; res += d * d; }
  return { uc, vc, r, res: Math.sqrt(res / n) };
}

function angularCoverageDeg(angles: number[]): number {
  const a = angles.slice().sort((x, y) => x - y);
  let maxGap = 2 * Math.PI - (a[a.length - 1] - a[0]);
  for (let i = 1; i < a.length; i++) maxGap = Math.max(maxGap, a[i] - a[i - 1]);
  return ((2 * Math.PI - maxGap) * 180) / Math.PI;
}

function sameAxisLine(a: { axis: Vec3; centerPerp: Vec3 }, b: { axis: Vec3; centerPerp: Vec3 }, perpTol = 0.6): boolean {
  const dot = Math.abs(a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2]);
  const dp = Math.hypot(
    a.centerPerp[0] - b.centerPerp[0],
    a.centerPerp[1] - b.centerPerp[1],
    a.centerPerp[2] - b.centerPerp[2]
  );
  return dot > 0.996 && dp < perpTol;
}

// ---- face extraction -------------------------------------------------------

function extractCylindricalFaces(meshes: OcctMesh[]): CylFace[] {
  const faces: CylFace[] = [];
  for (const mesh of meshes) {
    const P = mesh.attributes.position.array;
    const N = mesh.attributes.normal?.array;
    const idx = mesh.index.array;
    if (!N || !mesh.brep_faces) continue;

    for (const face of mesh.brep_faces) {
      const vids = new Set<number>();
      for (let t = face.first; t <= face.last; t++) {
        vids.add(idx[t * 3]); vids.add(idx[t * 3 + 1]); vids.add(idx[t * 3 + 2]);
      }
      if (vids.size < 10) continue;
      const ids = [...vids];

      const m = [0, 0, 0, 0, 0, 0];
      for (const i of ids) {
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        m[0] += nx * nx; m[1] += nx * ny; m[2] += nx * nz;
        m[3] += ny * ny; m[4] += ny * nz; m[5] += nz * nz;
      }
      const { values, vectors } = eigenSym3(m);
      const [e0, e1, e2] = values;
      if (e2 < 1e-9 || e0 / e2 > 0.08 || e1 / e2 < 0.15) continue;

      let axis = vectors[0];
      const abs = axis.map(Math.abs);
      const mi = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
      if (axis[mi] < 0) axis = [-axis[0], -axis[1], -axis[2]];

      const [u, v] = planeBasis(axis);
      const pts2d = ids.map((i): [number, number] => [
        P[i * 3] * u[0] + P[i * 3 + 1] * u[1] + P[i * 3 + 2] * u[2],
        P[i * 3] * v[0] + P[i * 3 + 1] * v[1] + P[i * 3 + 2] * v[2],
      ]);
      const cf = fitCircle(pts2d);
      if (!cf || cf.r < 0.2 || cf.r > 80 || cf.res / cf.r > 0.06) continue;

      let concaveVotes = 0;
      const axialVals: number[] = [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        const pu = pts2d[k][0] - cf.uc, pv = pts2d[k][1] - cf.vc;
        const rl = Math.hypot(pu, pv) || 1;
        const nu = N[i * 3] * u[0] + N[i * 3 + 1] * u[1] + N[i * 3 + 2] * u[2];
        const nv = N[i * 3] * v[0] + N[i * 3 + 1] * v[1] + N[i * 3 + 2] * v[2];
        if (nu * (pu / rl) + nv * (pv / rl) < 0) concaveVotes++;
        axialVals.push(P[i * 3] * axis[0] + P[i * 3 + 1] * axis[1] + P[i * 3 + 2] * axis[2]);
      }

      faces.push({
        axis,
        radius: cf.r,
        centerPerp: [cf.uc * u[0] + cf.vc * v[0], cf.uc * u[1] + cf.vc * v[1], cf.uc * u[2] + cf.vc * v[2]],
        concave: concaveVotes / ids.length > 0.5,
        coverageDeg: angularCoverageDeg(pts2d.map(([pu, pv]) => Math.atan2(pv - cf.vc, pu - cf.uc))),
        axMin: Math.min(...axialVals),
        axMax: Math.max(...axialVals),
        worldPts: ids.map((i): Vec3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]),
      });
    }
  }
  return faces;
}

// ---- classification --------------------------------------------------------

export function detectFeaturesFromOcctMeshes(meshes: OcctMesh[]): DetectedFeatures {
  const faces = extractCylindricalFaces(meshes);

  // HOLES: cluster concave faces by axis line + radius; a hole wraps (near) fully.
  const isHoleFace = new Array(faces.length).fill(false);
  const holeDiameters: number[] = [];
  let boreCount = 0;
  const claimed = new Array(faces.length).fill(false);

  for (let i = 0; i < faces.length; i++) {
    if (claimed[i] || !faces[i].concave) continue;
    const group = [i];
    for (let j = i + 1; j < faces.length; j++) {
      if (!claimed[j] && faces[j].concave && Math.abs(faces[j].radius - faces[i].radius) < 0.3 && sameAxisLine(faces[i], faces[j])) {
        group.push(j);
      }
    }
    // Union angular coverage across the cluster, in the first face's frame.
    const [u, v] = planeBasis(faces[i].axis);
    const cu = faces[i].centerPerp[0] * u[0] + faces[i].centerPerp[1] * u[1] + faces[i].centerPerp[2] * u[2];
    const cv = faces[i].centerPerp[0] * v[0] + faces[i].centerPerp[1] * v[1] + faces[i].centerPerp[2] * v[2];
    const angles: number[] = [];
    for (const g of group) {
      for (const p of faces[g].worldPts) {
        angles.push(Math.atan2(p[0] * v[0] + p[1] * v[1] + p[2] * v[2] - cv, p[0] * u[0] + p[1] * u[1] + p[2] * u[2] - cu));
      }
    }
    if (angularCoverageDeg(angles) > 270) {
      group.forEach((g) => { claimed[g] = true; isHoleFace[g] = true; });
      const diameterMm = Math.round(faces[i].radius * 2 * 10) / 10;
      if (diameterMm <= 60) holeDiameters.push(diameterMm);
      else boreCount++;
    }
  }

  // BENDS: a coaxial concave(inner r) + convex(outer r+t) partial-arc pair, with t in
  // the sheet-thickness range and overlapping along the axis (the two walls of a fold).
  const usedForBend = new Array(faces.length).fill(false);
  let bendCount = 0;
  for (let i = 0; i < faces.length; i++) {
    const inner = faces[i];
    if (usedForBend[i] || isHoleFace[i] || !inner.concave || inner.coverageDeg > 230) continue;
    for (let j = 0; j < faces.length; j++) {
      const outer = faces[j];
      if (usedForBend[j] || isHoleFace[j] || outer.concave || outer.coverageDeg > 230) continue;
      const thickness = outer.radius - inner.radius;
      if (thickness < 0.3 || thickness > 8) continue;
      if (!sameAxisLine(inner, outer, 1.0)) continue;
      const overlap = Math.min(inner.axMax, outer.axMax) - Math.max(inner.axMin, outer.axMin);
      const minLen = Math.min(inner.axMax - inner.axMin, outer.axMax - outer.axMin);
      if (overlap < minLen * 0.4) continue;
      usedForBend[i] = usedForBend[j] = true;
      bendCount++;
      break;
    }
  }

  const byDiameter = new Map<number, number>();
  holeDiameters.forEach((d) => byDiameter.set(d, (byDiameter.get(d) || 0) + 1));
  const holeDetails = [...byDiameter.entries()]
    .map(([diameterMm, count]) => ({ diameterMm, count }))
    .sort((a, b) => b.count - a.count);

  return { holeCount: holeDiameters.length, holeDetails, boreCount, bendCount };
}
