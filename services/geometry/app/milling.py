"""
Milled / prismatic feature analysis from a STEP solid, using OpenCASCADE (OCP).

Companion to `extractor.py` (which handles turned parts). Where turning reads a
coaxial revolve, milling has to reason about a block of stock that material is
cut *away* from, reached by a tool from one or more directions. This module
implements the three high-leverage geometric rules that drive a milling quote:

  RULE 1 — Face-Normal Cluster → SETUP COUNT.
      A 3-axis mill cuts from one direction ("down the Z") per setup. Every
      feature that must be reached from a different direction forces a re-fixture
      (a "setup"), and setups are the single biggest cost lever on a milled part.
      We cluster the access directions of the real features (pocket floors, hole
      axes) into distinct unit directions; the count is the setup estimate.

  RULE 2 — "Cavity vs Boss" via EDGE CONCAVITY (the AAG idea).
      Along every edge shared by two faces we measure the dihedral: an inside
      corner (material on the reflex side) is CONCAVE and signals a pocket/cavity
      to be hogged out; an outside corner is CONVEX and signals a boss/island to
      be left standing. Concave-bordered floors → pockets (expensive: enclosed
      roughing). Convex islands → bosses.

  RULE 3 — Z-ACCESSIBLE DEPTH → deep-pocket penalty.
      For each pocket floor we measure how far the tool must reach (floor → open
      top, along the access normal) versus the pocket's width. A high depth/width
      ratio means a long, thin tool run slow to avoid chatter — a real cost hit —
      so those pockets are flagged.

Plus the stock/removal basics every milled quote needs: the billet is the
bounding box; removed volume = billet − part; the removal ratio tells you how
much is hogged to air (roughing time) vs. how close-to-net the blank is.

Everything is measured off the B-Rep — nothing invented. Heuristics are honest
first-order estimates and are reported with a confidence, not as ground truth.
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np

from OCP.TopExp import TopExp_Explorer, TopExp
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN
from OCP.gp import gp_Pnt


def _np(p) -> np.ndarray:
    return np.array([p.X(), p.Y(), p.Z()], dtype=float)


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _planar_normal(face) -> Optional[np.ndarray]:
    """Outward unit normal of a planar face (respecting orientation), else None."""
    ad = BRepAdaptor_Surface(face)
    if ad.GetType() != GeomAbs_Plane:
        return None
    n = _unit(_np(ad.Plane().Axis().Direction()))
    if face.Orientation() == TopAbs_REVERSED:
        n = -n
    return n


def _face_centroid(face) -> np.ndarray:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return _np(props.CentreOfMass())


def _face_area(face) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return float(props.Mass())


def _face_min_width(face, normal: np.ndarray) -> float:
    """Smallest in-plane extent of a face's bounding box (the tightest tool
    width a pocket floor imposes). Narrow slots read as narrow, so a deep slot
    gets a high depth/width ratio even though its area is large."""
    fb = Bnd_Box()
    BRepBndLib.Add_s(face, fb)
    xmin, ymin, zmin, xmax, ymax, zmax = fb.Get()
    extents = [(np.array([1.0, 0, 0]), xmax - xmin),
               (np.array([0, 1.0, 0]), ymax - ymin),
               (np.array([0, 0, 1.0]), zmax - zmin)]
    inplane = [d for axis, d in extents if abs(float(np.dot(axis, normal))) < 0.9 and d > 1e-6]
    return min(inplane) if inplane else max((e for _, e in extents), default=0.0)


def _edge_midpoint(edge) -> Optional[np.ndarray]:
    try:
        c = BRepAdaptor_Curve(edge)
        u = 0.5 * (c.FirstParameter() + c.LastParameter())
        return _np(c.Value(u))
    except Exception:
        return None


def _cluster_direction(dirs: List[np.ndarray], d: np.ndarray, tol: float = 0.98) -> int:
    """Index of an existing near-parallel direction (same sense), else -1."""
    for i, e in enumerate(dirs):
        if float(np.dot(e, d)) > tol:
            return i
    return -1


def analyze_milling(shape) -> dict:
    """Return the milled-part feature/cost signals for a STEP solid."""
    # --- Stock (billet) and removal ----------------------------------------
    vol_props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, vol_props)
    part_vol_mm3 = vol_props.Mass()

    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    bx, by, bz = xmax - xmin, ymax - ymin, zmax - zmin
    stock_vol_mm3 = max(bx * by * bz, 1e-9)
    removed_mm3 = max(stock_vol_mm3 - part_vol_mm3, 0.0)
    removal_ratio = removed_mm3 / stock_vol_mm3

    diag = max((bx, by, bz))
    tol_len = max(0.2, 0.01 * diag)

    # --- Face index map (stable identity across loops) & edge→faces --------
    face_map = TopTools_IndexedMapOfShape()
    planar_faces: List = []
    n_faces = 0
    n_planar = 0
    n_cyl = 0
    cyl_axes: List[np.ndarray] = []
    fexp = TopExp_Explorer(shape, TopAbs_FACE)
    while fexp.More():
        face = TopoDS.Face_s(fexp.Current())
        face_map.Add(face)
        n_faces += 1
        ad = BRepAdaptor_Surface(face)
        st = ad.GetType()
        if st == GeomAbs_Plane:
            n_planar += 1
            planar_faces.append(face)
        elif st == GeomAbs_Cylinder:
            n_cyl += 1
            cyl_axes.append(_unit(_np(ad.Cylinder().Axis().Direction())))
        fexp.Next()

    def _fid(f) -> int:
        return face_map.FindIndex(f)  # OCC IsSame-based identity (stable)

    edge_faces = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape, TopAbs_EDGE, TopAbs_FACE, edge_faces)

    # Concavity per edge (only where both faces are planar → reliable).
    concave_edges = 0
    convex_edges = 0
    # Per-face count of concave / convex boundary edges → pocket vs boss signal.
    concave_by_face: dict = {}
    convex_by_face: dict = {}

    for i in range(1, edge_faces.Extent() + 1):
        edge = TopoDS.Edge_s(edge_faces.FindKey(i))
        faces = edge_faces.FindFromIndex(i)
        if faces.Extent() != 2:
            continue
        f1 = TopoDS.Face_s(faces.First())
        f2 = TopoDS.Face_s(faces.Last())
        n1 = _planar_normal(f1)
        n2 = _planar_normal(f2)
        if n1 is None or n2 is None:
            continue
        if abs(float(np.dot(n1, n2))) > 0.999:
            continue  # coplanar/parallel — no real dihedral
        p = _edge_midpoint(edge)
        if p is None:
            continue
        c1 = _face_centroid(f1)
        c2 = _face_centroid(f2)
        id1, id2 = _fid(f1), _fid(f2)
        # Orientation-free dihedral test: a neighbour whose centroid sits on the
        # OUTWARD (+normal) side of a face's plane is an inside corner → concave.
        s = 0.5 * (float(np.dot(_unit(c2 - p), n1)) + float(np.dot(_unit(c1 - p), n2)))
        if s > 0.02:
            concave_edges += 1
            concave_by_face[id1] = concave_by_face.get(id1, 0) + 1
            concave_by_face[id2] = concave_by_face.get(id2, 0) + 1
        elif s < -0.02:
            convex_edges += 1
            convex_by_face[id1] = convex_by_face.get(id1, 0) + 1
            convex_by_face[id2] = convex_by_face.get(id2, 0) + 1

    # --- Pockets / bosses + access directions (Rules 1 & 3) ----------------
    all_axial = [np.array([x, y, z], float)
                 for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]

    def _is_stock_face(centroid, normal) -> bool:
        """A face lying on the billet envelope (its plane is the outer extreme
        along its own outward normal) — the raw block surface, not a feature."""
        proj = float(np.dot(centroid, normal))
        top = max(float(np.dot(c, normal)) for c in all_axial)
        return abs(proj - top) <= tol_len

    classifier = BRepClass3d_SolidClassifier(shape)

    def _faces_opening(centroid, normal) -> bool:
        """True if a tool could reach this face straight down its own normal — a
        ray from the face outward along +normal exits the billet without passing
        back through solid. This is what tells a pocket FLOOR (clear line to the
        open mouth) from a pocket WALL (a ray sideways hits the opposite wall)."""
        top = max(float(np.dot(c, normal)) for c in all_axial)
        span = top - float(np.dot(centroid, normal))
        if span <= tol_len:
            return False  # already at the surface — a stock face, not a recess
        for frac in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9):
            p = centroid + normal * (span * frac)
            classifier.Perform(gp_Pnt(float(p[0]), float(p[1]), float(p[2])), 1e-6)
            if classifier.State() == TopAbs_IN:
                return False  # blocked by material → not straight-line accessible
        return True

    pockets: List[dict] = []
    boss_count = 0
    access_dirs: List[np.ndarray] = []
    deep_pockets = 0
    max_depth_ratio = 0.0

    for face in planar_faces:
        fid = _fid(face)
        n_concave = concave_by_face.get(fid, 0)
        n_convex = convex_by_face.get(fid, 0)
        normal = _planar_normal(face)
        if normal is None:
            continue
        centroid = _face_centroid(face)

        # A pocket FLOOR is a concave-ringed planar face that is also reachable
        # straight down its own normal (a clear line to the open mouth). The
        # concavity says "enclosed recess"; the access ray separates the floor
        # from its walls (a sideways ray off a wall hits the opposite wall). A
        # BOSS/island top is convex-ringed yet sits below the raw block surface.
        if n_concave >= 3 and n_convex == 0 and _faces_opening(centroid, normal):
            # Rule 3: reach = floor → highest stock point along the access normal.
            floor_z = float(np.dot(centroid, normal))
            top_z = max(float(np.dot(c, normal)) for c in all_axial)
            depth = max(top_z - floor_z, 0.0)
            width = _face_min_width(face, normal)
            ratio = depth / width if width > 1e-6 else 0.0
            if ratio > 3.0 and depth > 2 * tol_len:
                deep_pockets += 1
            max_depth_ratio = max(max_depth_ratio, ratio)
            pockets.append({
                "depthMm": round(depth, 3),
                "widthMm": round(width, 3),
                "depthRatio": round(ratio, 2),
                "accessDir": [round(x, 4) for x in normal.tolist()],
            })
            if _cluster_direction(access_dirs, normal) < 0:
                access_dirs.append(normal)
        elif n_convex >= 3 and n_concave == 0 and not _is_stock_face(centroid, normal):
            boss_count += 1
            if _cluster_direction(access_dirs, normal) < 0:
                access_dirs.append(normal)

    # Hole access directions (both senses count toward re-fixturing).
    for ax in cyl_axes:
        if _cluster_direction(access_dirs, ax) < 0 and _cluster_direction(access_dirs, -ax) < 0:
            access_dirs.append(ax)

    # Rule 1: setups = distinct access directions, at least 1 (top facing).
    setup_count = max(1, len(access_dirs))
    setup_count = min(setup_count, 6)  # a 3-axis part rarely needs more than 6

    pocket_count = len(pockets)

    # --- Confidence & reason ------------------------------------------------
    # Higher when the topology is clean (all planar/cylindrical) and we found
    # coherent features; lower on free-form faces we can't reason about.
    known = n_planar + n_cyl
    clean_ratio = (known / n_faces) if n_faces else 0.0
    confidence = round(max(0.0, min(1.0, 0.4 + 0.4 * clean_ratio +
                                    (0.2 if (pocket_count or boss_count or n_cyl) else 0.0))), 2)

    reason = (f"Prismatic estimate: {setup_count} setup(s), "
              f"{pocket_count} pocket(s), {boss_count} boss(es), {n_cyl} hole/round face(s); "
              f"stock {bx:.0f}×{by:.0f}×{bz:.0f} mm, {int(removal_ratio*100)}% removed"
              + (f", {deep_pockets} deep pocket(s)" if deep_pockets else "")
              + ".")

    return {
        "setupCount": setup_count,
        "accessDirections": [[round(x, 4) for x in d.tolist()] for d in access_dirs],
        "pocketCount": pocket_count,
        "bossCount": boss_count,
        "deepPocketCount": deep_pockets,
        "maxDepthRatio": round(max_depth_ratio, 2),
        "holeCount": n_cyl,
        "concaveEdges": concave_edges,
        "convexEdges": convex_edges,
        "stockMm": {"x": round(bx, 3), "y": round(by, 3), "z": round(bz, 3)},
        "stockVolumeCm3": round(stock_vol_mm3 / 1000.0, 3),
        "partVolumeCm3": round(part_vol_mm3 / 1000.0, 3),
        "removedVolumeCm3": round(removed_mm3 / 1000.0, 3),
        "removalRatio": round(removal_ratio, 3),
        "pockets": pockets,
        "confidence": confidence,
        "reason": reason,
        "counts": {"faces": n_faces, "planar": n_planar, "cylindrical": n_cyl},
    }
