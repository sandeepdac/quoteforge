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

import math

import numpy as np

from OCP.TopExp import TopExp_Explorer, TopExp
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
from OCP.BRepTools import BRepTools
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
    hole_axes: List[np.ndarray] = []
    # Internal cylinders as (axis, point-on-axis, radius). A single physical hole
    # is often several coaxial faces (counterbore + through + tap ⌀), so these are
    # grouped into distinct hole FEATURES below rather than counted face-by-face.
    hole_cyls: List[tuple] = []
    # External cylinders as (axis, point-on-axis, radius, wrap): round bosses.
    boss_cyls: List[tuple] = []

    # External cylindrical features — round bosses / spigots / pads standing
    # proud of the stock. These are NOT holes (material lies inside them, not
    # outside), so hole detection rightly ignores them — but nothing else looked
    # at them either, because the boss test only ever examined PLANAR faces. A
    # ⌀21 x 9 mm spigot therefore cost nothing at all on part 031167-A, even
    # though the cutter has to profile all the way around it.
    #
    # Decided geometrically rather than from the face's orientation flag: step a
    # little way RADIALLY OUTWARD from the surface and ask the solid whether that
    # point is inside it. Material outside → hole; material inside → boss.
    boss_test_classifier = BRepClass3d_SolidClassifier(shape)

    def _cylinder_has_material_outside(face, ad, axis: np.ndarray, radius: float) -> bool:
        try:
            u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
            surf_pt = _np(ad.Value(0.5 * (u0 + u1), 0.5 * (v0 + v1)))
            loc = _np(ad.Cylinder().Axis().Location())
            radial = surf_pt - loc
            radial = radial - float(np.dot(radial, axis)) * axis  # drop the axial part
            n = float(np.linalg.norm(radial))
            if n < 1e-9:
                return False
            radial = radial / n
            # Far enough out to clear surface tolerance, small enough to stay in
            # the wall rather than punching through a thin one.
            eps = max(0.05, min(0.25, 0.05 * radius))
            probe = surf_pt + radial * eps
            boss_test_classifier.Perform(gp_Pnt(float(probe[0]), float(probe[1]), float(probe[2])), 1e-7)
            return boss_test_classifier.State() == TopAbs_IN
        except Exception:
            # Fall back to the old convention rather than losing the face entirely.
            return face.Orientation() == TopAbs_REVERSED

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
            ax = _unit(_np(ad.Cylinder().Axis().Direction()))
            cyl_axes.append(ax)
            # A hole/bore is an INTERNAL cylinder (material outside → the face is
            # REVERSED) of modest radius. Convex external rounds/fillets — which
            # inflate a naive cylinder count — are FORWARD and are excluded.
            # (Verified against a geometric inside/outside probe: the orientation
            # flag and the probe agree, so the cheap flag is kept.)
            r = ad.Cylinder().Radius()
            if face.Orientation() == TopAbs_REVERSED and r <= 0.4 * max(diag, 1.0):
                loc = ad.Cylinder().Axis().Location()
                # How far around the axis this face wraps. A drilled/bored hole
                # closes the full 360° (often as two 180° halves); a filleted
                # pocket CORNER is the same kind of internal cylindrical face but
                # only wraps ~90°. Without this, every rounded corner reads as a
                # hole — the NIST CTC-01 benchmark reported 36 holes instead of 10.
                u0, u1, _v0, _v1 = BRepTools.UVBounds_s(face)
                hole_axes.append(ax)
                # For a cylinder the V parameter runs ALONG the axis, so this is
                # the face's axial extent — which tells us whether the feature
                # breaks out of the part (through) or stops inside it (blind).
                base_ax = float(np.dot(np.array([loc.X(), loc.Y(), loc.Z()]), ax))
                hole_cyls.append((ax, np.array([loc.X(), loc.Y(), loc.Z()]), r, abs(u1 - u0),
                                  base_ax + min(_v0, _v1), base_ax + max(_v0, _v1)))
            elif r <= 0.5 * max(diag, 1.0) and not _cylinder_has_material_outside(face, ad, ax, r):
                # Material INSIDE the cylinder → a round boss / spigot standing
                # proud, which the cutter still has to profile around.
                loc2 = ad.Cylinder().Axis().Location()
                u0, u1, _v0, _v1 = BRepTools.UVBounds_s(face)
                boss_cyls.append((ax, np.array([loc2.X(), loc2.Y(), loc2.Z()]), r, abs(u1 - u0)))
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
    boss_faces: List = []
    # Access directions are kept in two buckets because they mean different
    # things for workholding (see Rule 1 below): a slanted FACE can be cut from
    # an existing axis, a slanted TOOL AXIS cannot.
    face_access_dirs: List[np.ndarray] = []   # pocket floors / boss tops
    tool_access_dirs: List[np.ndarray] = []   # drilled / bored hole axes
    deep_pockets = 0
    max_depth_ratio = 0.0

    # A boss/island the tool roughs AROUND is a real chunk of material, not a
    # sliver or a thin profile wall: require a minimum footprint (width the size
    # of a roughing pass, area a few tool-widths square). Scaled to the part so
    # the same rule works on a 30 mm block and a 300 mm plate.
    min_boss_width = max(3.0, 0.06 * diag)
    min_boss_area = 2.0 * min_boss_width * min_boss_width

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
            if _cluster_direction(face_access_dirs, normal) < 0:
                face_access_dirs.append(normal)
        # The boss test keys off the ABSENCE of concave edges, which is only
        # meaningful if concavity was measurable at all. On a heavily filleted
        # part every wall meets its floor through a cylindrical blend, so the
        # planar-planar dihedral test finds nothing and "no concave edges" becomes
        # vacuously true for every face — which turned the NIST CTC-01 plate into
        # 37 bosses claiming all six setups. Require positive evidence instead.
        elif (concave_edges > 0 and n_convex >= 3 and n_concave == 0
              and not _is_stock_face(centroid, normal)):
            # A convex-ringed sub-surface face still implies a re-fixture
            # direction, so it contributes to the setup count exactly as before.
            if _cluster_direction(face_access_dirs, normal) < 0:
                face_access_dirs.append(normal)
            # But it is only a machinable ISLAND (which drives the small-tool
            # complexity derate) if it is a real chunk — not a sliver or a thin
            # profile wall. The final islands-need-a-recess check is applied once
            # all pockets are known (below).
            if (_face_area(face) >= min_boss_area
                    and _face_min_width(face, normal) >= min_boss_width):
                boss_faces.append(face)

    # An island rises from a machined recess, which shows up as concavity (a
    # pocket floor rings 4+ concave edges). A part with almost no concave edges
    # is a prismatic PROFILE — its convex-ringed faces are external walls, lands
    # and chamfer facets, not bosses to rough around. Part 12630 (a profiled
    # block, 1 concave edge) reported 10 such faces as bosses, inflating the
    # complexity derate; the real island count is 0. Gate on the raw concave-edge
    # count (more robust than the pocket detector). Setup count is unaffected —
    # the access directions above are collected regardless of this gate.
    boss_count = len(boss_faces) if concave_edges >= 3 else 0

    # --- Distinct hole features ---------------------------------------------
    # Group coaxial internal cylinders into ONE hole. A counterbored hole shows up
    # as 3+ concentric cylinders (counterbore ⌀, body ⌀, tapping ⌀); counting the
    # faces would triple-count it and massively over-state drilling time. Two
    # cylinders belong to the same hole when their axes are parallel AND lie on the
    # same line (perpendicular offset ≈ 0).
    # Coaxial faces are grouped twice over, and the distinction matters:
    #
    #   • Same axis line AND same ⌀  → the same cylindrical surface split into
    #     halves by the modeller. One operation.
    #   • Same axis line, DIFFERENT ⌀ → a STEPPED hole: a drill with a
    #     counterbore/spotface over it, or a bore opening out a pilot. That is
    #     TWO operations with two tools, not one.
    #
    # Collapsing the second case to the largest ⌀ (what this used to do) threw
    # away the smaller drill entirely: part 031167-A's four ⌀8 counterbores each
    # sat over a ⌀4.5 through-hole, and only the ⌀8 was ever costed.
    hole_groups: List[dict] = []
    for ax, pt, r, span, a_lo, a_hi in hole_cyls:
        placed = False
        for g in hole_groups:
            if abs(float(np.dot(ax, g["axis"]))) > 0.98:
                d = pt - g["point"]
                perp = d - float(np.dot(d, g["axis"])) * g["axis"]
                if float(np.linalg.norm(perp)) < 0.25:  # mm — same axis line
                    # Same ⌀ (within a hair) → the same surface; otherwise a step.
                    step = next((st for st in g["steps"] if abs(st["radius"] - r) < 0.05), None)
                    if step is None:
                        g["steps"].append({"radius": r, "span": span, "faces": 1})
                    else:
                        step["span"] += span
                        step["faces"] += 1
                    g["maxRadius"] = max(g["maxRadius"], r)
                    g["minRadius"] = min(g["minRadius"], r)
                    g["span"] += span
                    g["faces"] += 1
                    g["axLo"] = min(g["axLo"], a_lo)
                    g["axHi"] = max(g["axHi"], a_hi)
                    placed = True
                    break
        if not placed:
            hole_groups.append({"axis": ax, "point": pt, "maxRadius": r,
                                "minRadius": r, "span": span, "faces": 1,
                                "axLo": a_lo, "axHi": a_hi,
                                "steps": [{"radius": r, "span": span, "faces": 1}]})

    # Which circular features are real machining operations?
    #
    # A CLOSED bore wraps (nearly) all the way round — corner fillets sum to
    # ~90–120° and are excluded, two 180° halves sum to 360° and count.
    #
    # But a PARTIAL arc can be a real feature too: an open-sided bore, a circular
    # relief, a radiused slot end. Wrap angle alone cannot separate those from a
    # corner fillet — both can be 90° — because the true difference is SIZE. A
    # corner fillet is left by the roughing cutter (a few mm radius); a 46 mm
    # circular pocket wall is deliberately interpolated. Judging on wrap alone
    # dropped this part's ⌀46.35, ⌀22.2 and two 45.9 mm-deep ⌀19.05 features
    # while keeping ⌀3.5 fillet-sized holes.
    #
    # So: keep a partial arc when it is far too big to be a cutter-corner radius.
    FULL_TURN = 2.0 * math.pi
    PARTIAL_MIN_WRAP = math.radians(60.0)  # below this it is a chamfer/blend sliver
    # Biggest plausible corner radius: a cutter bigger than this is not roughing
    # internal corners on a part of this size. Scaled to the part, floored at a
    # size no sane corner fillet exceeds.
    corner_dia_max = max(12.0, 0.12 * max(diag, 1.0))

    def _is_real_circular_feature(g: dict) -> bool:
        if g["span"] >= 0.85 * FULL_TURN:
            return True
        return g["span"] >= PARTIAL_MIN_WRAP and 2.0 * g["maxRadius"] > corner_dia_max

    partial_bores = [g for g in hole_groups
                     if _is_real_circular_feature(g) and g["span"] < 0.85 * FULL_TURN]
    hole_groups = [g for g in hole_groups if _is_real_circular_feature(g)]

    # One machining operation per distinct coaxial ⌀ — a stepped hole is a drill
    # PLUS a counterbore, each with its own tool and its own cycle time. A step
    # only counts if it is a real surface in its own right (same wrap test), so a
    # chamfer ring or a blend does not become a phantom operation.
    def _real_steps(g: dict) -> List[dict]:
        return [st for st in g.get("steps", [])
                if st["span"] >= 0.85 * FULL_TURN
                or (st["span"] >= PARTIAL_MIN_WRAP and 2.0 * st["radius"] > corner_dia_max)]

    hole_diameters: List[float] = []
    stepped_holes = 0
    for g in hole_groups:
        steps = _real_steps(g) or [{"radius": g["maxRadius"]}]
        if len(steps) > 1:
            stepped_holes += 1
        for st in steps:
            hole_diameters.append(round(2.0 * st["radius"], 3))
    hole_diameters.sort(reverse=True)
    # Distinct circular operations, counterbores included.
    n_holes = len(hole_diameters)
    # Open / partial circular features: milled by interpolation, never drilled.
    partial_bore_diameters = sorted((round(2.0 * g["maxRadius"], 3) for g in partial_bores),
                                    reverse=True)
    # Only genuine holes should drive re-fixturing decisions (one axis per hole,
    # not one per step — a counterbore shares its drill's axis).
    hole_axes = [g["axis"] for g in hole_groups]

    # --- Round bosses / spigots (external cylinders) ------------------------
    # Grouped the same way, so a spigot split into halves counts once.
    boss_groups: List[dict] = []
    for ax, pt, r, span in boss_cyls:
        placed = False
        for g in boss_groups:
            if abs(float(np.dot(ax, g["axis"]))) > 0.98:
                d = pt - g["point"]
                perp = d - float(np.dot(d, g["axis"])) * g["axis"]
                if float(np.linalg.norm(perp)) < 0.25 and abs(g["radius"] - r) < 0.05:
                    g["span"] += span
                    placed = True
                    break
        if not placed:
            boss_groups.append({"axis": ax, "point": pt, "radius": r, "span": span})
    # A real spigot wraps most of the way round and is big enough to profile
    # around; small external radii are just corner rounds on the outside profile.
    round_bosses = [g for g in boss_groups
                    if g["span"] >= 0.85 * FULL_TURN and 2.0 * g["radius"] > corner_dia_max]
    round_boss_diameters = sorted((round(2.0 * g["radius"], 3) for g in round_bosses), reverse=True)

    # --- TURNED vs MILLED features ------------------------------------------
    #
    # On a mill-turn this is the first question about every feature, and nothing
    # here used to ask it: every cut was costed as a milling toolpath, so a bore
    # that a spindle could open in seconds was priced as helical interpolation
    # with an end mill (~4x slower) at the turn-mill's premium rate.
    #
    # The test is coaxiality. A lathe spins the part about ONE axis, so:
    #   • features whose axis is the part's main axis are TURNED — bores,
    #     spigots, faces, grooves. The tool is stationary, the part spins.
    #   • everything off that axis is MILLED with driven tools.
    #
    # The main axis is the one the most circular features share, weighted by
    # size (a ⌀46 bore says more about how the part is held than a ⌀3 hole), and
    # it must pass through the part's centre — an off-centre bolt circle is not
    # a turning axis no matter how many holes share its direction.
    ON_AXIS_TOL_MM = 0.5  # how close two features must run to share an axis

    circular_features = (
        [{"axis": g["axis"], "point": g["point"], "radius": g["maxRadius"], "kind": "bore"}
         for g in hole_groups]
        + [{"axis": g["axis"], "point": g["point"], "radius": g["radius"], "kind": "spigot"}
           for g in round_bosses]
    )

    def _line_gap(a: dict, b: dict) -> float:
        """Perpendicular distance between two parallel feature axes."""
        v = b["point"] - a["point"]
        return float(np.linalg.norm(v - float(np.dot(v, a["axis"])) * a["axis"]))

    def _coaxial(a: dict, b: dict) -> bool:
        return abs(float(np.dot(a["axis"], b["axis"]))) > 0.98 and _line_gap(a, b) <= ON_AXIS_TOL_MM

    # Cluster features onto shared axis LINES. Anchoring to the bounding-box
    # centre instead was wrong: on an asymmetric part the box centre is not on
    # the turning axis at all, and it pushed the P5 flag's two coaxial spigots
    # (1.25 mm off that centre) into the milled bucket. The turning axis is
    # wherever the round features actually line up.
    axis_groups: List[List[dict]] = []
    for f in circular_features:
        for g in axis_groups:
            if _coaxial(g[0], f):
                g.append(f)
                break
        else:
            axis_groups.append([f])

    # The turning axis is the line carrying the most circular content (weighted
    # by radius — a ⌀46 bore says more about how the part is held than a ⌀3 hole).
    # It needs at least TWO coaxial features: one lone bore in a block is a
    # drilled hole, not evidence that the part belongs on a lathe.
    best_group = max(
        (g for g in axis_groups if len(g) >= 2),
        key=lambda g: sum(f["radius"] for f in g),
        default=None,
    )
    best_axis = best_group[0]["axis"] if best_group else None
    turned_ids = {id(f) for f in (best_group or [])}

    turned_features: List[dict] = []
    milled_features: List[dict] = []
    for f in circular_features:
        entry = {"kind": f["kind"], "diameterMm": round(2.0 * f["radius"], 3),
                 "offAxisMm": round(_line_gap(best_group[0], f) if best_group else 0.0, 3)}
        (turned_features if id(f) in turned_ids else milled_features).append(entry)

    # Planar faces square to the turning axis are FACING cuts on a lathe.
    facing_candidates = 0
    if best_axis is not None:
        for face in planar_faces:
            n = _planar_normal(face)
            if n is not None and abs(float(np.dot(n, best_axis))) > 0.98:
                facing_candidates += 1

    turned_features.sort(key=lambda f: -f["diameterMm"])
    milled_features.sort(key=lambda f: -f["diameterMm"])
    # A round spigot is an island to profile around exactly like a planar boss,
    # so it joins the boss count that drives the small-tool complexity derate.
    boss_count += len(round_bosses)

    # Hole access directions. These are TOOL AXES: a hole is only producible
    # along its own axis, so an angled one is a genuine extra setup rather than
    # something an existing axis can reach.
    #
    # Which SENSE matters depends on whether the hole breaks through:
    #   • A THROUGH hole can be drilled from either end, so it does not by itself
    #     force a particular orientation — one direction, either sense.
    #   • A BLIND hole or counterbore only opens on ONE face. Two blind features
    #     opening on OPPOSITE faces mean the part must be turned over: two
    #     setups. Treating both senses as one direction (what this used to do)
    #     hid that flip — part 031167-A has a blind ⌀10.7 bore on top and four
    #     ⌀8 counterbores underneath, and reported a single setup.
    corners = [np.array([x, y, z]) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]

    def _opening_senses(g: dict) -> List[np.ndarray]:
        ax = g["axis"]
        proj = [float(np.dot(c, ax)) for c in corners]
        part_lo, part_hi = min(proj), max(proj)
        breaks_hi = (part_hi - g["axHi"]) <= tol_len   # reaches the +axis face
        breaks_lo = (g["axLo"] - part_lo) <= tol_len   # reaches the -axis face
        if breaks_hi and breaks_lo:
            return [ax]              # through — either end will do
        if breaks_hi:
            return [ax]              # opens on the +axis face
        if breaks_lo:
            return [-ax]             # opens on the -axis face
        return [ax]                  # fully internal (rare) — don't force a flip

    for g in hole_groups:
        for d in _opening_senses(g):
            if _cluster_direction(tool_access_dirs, d) < 0:
                tool_access_dirs.append(d)

    # Rule 1: setups = distinct access directions, at least 1 (top facing).
    #
    # Two KINDS of direction reach this point, and they must not be treated alike:
    #
    #   FACE NORMALS (pocket floors, boss tops) — a slanted FACE is still cut from
    #     above with the side or the nose of the cutter. The hex boss on NIST
    #     CTC-01 has ten slanted walls and needs one setup, not eleven. So a face
    #     normal only earns a setup when it is roughly a stock axis; otherwise it
    #     is absorbed into the axis that can already reach it.
    #
    #   TOOL AXES (drilled / bored holes) — a hole can ONLY be produced along its
    #     own axis. You cannot drill a 30° hole from Z. An angled hole therefore
    #     demands its own workholding: a tilted fixture or an indexed rotation on
    #     a 4th/5th axis. Snapping these to the nearest stock axis (which is what
    #     the code used to do to every direction indiscriminately) silently
    #     deleted real setups: this part's two ⌀12.7 holes are drilled at 30° and
    #     contributed nothing at all to the setup count.
    #
    # Absorbing a slanted wall is sound engineering; absorbing a slanted hole axis
    # is a costing error, and setups are the dominant cost at low quantity.
    AXIS_ALIGNED = 0.90  # cos(~26°) — "roughly a stock axis"

    def _axis_key(d: np.ndarray):
        """(axis index, sense) when the direction is near a stock axis, else None."""
        i = int(np.argmax(np.abs(d)))
        return (i, 1 if d[i] >= 0 else -1) if abs(float(d[i])) >= AXIS_ALIGNED else None

    def _off_axis_deg(d: np.ndarray) -> float:
        i = int(np.argmax(np.abs(d)))
        return math.degrees(math.acos(min(1.0, abs(float(d[i])))))

    axis_dirs = set()
    absorbed_face_dirs: List[np.ndarray] = []  # slanted walls, legitimately cut from an existing axis
    for d in face_access_dirs:
        key = _axis_key(d)
        if key is not None:
            axis_dirs.add(key)
        else:
            absorbed_face_dirs.append(d)

    # Angled tool axes: cluster so two holes on the same slanted axis share one
    # setup, and a direction and its reverse are the same fixturing.
    angled_tool_axes: List[np.ndarray] = []
    for d in tool_access_dirs:
        key = _axis_key(d)
        if key is not None:
            axis_dirs.add(key)
            continue
        if (_cluster_direction(angled_tool_axes, d) < 0
                and _cluster_direction(angled_tool_axes, -d) < 0):
            angled_tool_axes.append(d)

    axis_aligned_setups = len(axis_dirs)
    angled_setups = len(angled_tool_axes)
    # A 3-axis part cannot need more than 6 stock-face setups, but each angled
    # tool axis is an ADDITIONAL fixturing/rotation on top of those.
    setup_count = max(1, min(axis_aligned_setups, 6) + angled_setups)

    pocket_count = len(pockets)

    # --- Confidence & reason ------------------------------------------------
    # Higher when the topology is clean (all planar/cylindrical) and we found
    # coherent features; lower on free-form faces we can't reason about.
    known = n_planar + n_cyl
    clean_ratio = (known / n_faces) if n_faces else 0.0
    confidence = round(max(0.0, min(1.0, 0.4 + 0.4 * clean_ratio +
                                    (0.2 if (pocket_count or boss_count or n_cyl) else 0.0))), 2)
    # If no concave edge was measurable on a part with real topology, our
    # pocket/boss reasoning ran blind (typically a heavily filleted model, where
    # every wall meets its floor through a cylindrical blend). The stock and hole
    # figures still hold, but the SETUP count — the biggest cost lever — is a
    # weaker inference, so say so rather than reporting near-certainty.
    if concave_edges == 0 and n_faces > 12:
        confidence = min(confidence, 0.55)

    # Compound-angle work is where this analysis is weakest, and it used to be
    # invisible: the old code discarded every non-axis direction and still
    # reported ~0.97 confidence. Whenever the part has angled features, say so in
    # the number as well as the text — an angled setup may be a tilted fixture, an
    # indexed rotation, or (on a 5-axis) nearly free, and we cannot tell which.
    if angled_setups:
        confidence = min(confidence, 0.6)
    # Slanted faces were folded into an existing axis. That is usually right (a
    # chamfer, a boss wall) but a deep angled floor may really want its own
    # setup, so it caps certainty rather than moving the estimate.
    if absorbed_face_dirs:
        confidence = min(confidence, 0.75)

    # A part that fills only a small fraction of its bounding box is almost
    # certainly NOT machined from a solid billet — it comes from plate, a
    # weldment, an extrusion, or a near-net casting/forging. Flag it so the
    # solid-billet cost (which would be enormous) is treated as an upper bound.
    sparse_billet = removal_ratio > 0.85

    angled_note = ""
    if angled_setups:
        degs = ", ".join(f"{_off_axis_deg(d):.0f}°" for d in angled_tool_axes)
        angled_note = (f". {angled_setups} angled hole/bore axis/axes ({degs} off a stock axis) "
                       f"need their own fixturing or a 4th/5th-axis rotation — counted as "
                       f"{angled_setups} extra setup(s) on top of {min(axis_aligned_setups, 6)} "
                       f"axis-aligned one(s); CONFIRM how these are held")
    absorbed_note = ""
    if absorbed_face_dirs:
        absorbed_note = (f". {len(absorbed_face_dirs)} slanted face direction(s) were assumed "
                         f"reachable from an existing axis (cut with the side/nose of the cutter)")

    reason = (f"Prismatic estimate: {setup_count} setup(s), "
              f"{pocket_count} pocket(s), {boss_count} boss(es), {n_holes} hole(s); "
              f"stock {bx:.0f}×{by:.0f}×{bz:.0f} mm, {int(removal_ratio*100)}% removed"
              + (f", {deep_pockets} deep pocket(s)" if deep_pockets else "")
              + angled_note
              + absorbed_note
              + (". NOTE: part fills only "
                 f"{int((1 - removal_ratio) * 100)}% of its bounding box — a solid billet is "
                 "likely the wrong stock (plate / weldment / near-net); estimate is an upper bound"
                 if sparse_billet else "")
              + ".")

    return {
        "setupCount": setup_count,
        "accessDirections": [[round(x, 4) for x in d.tolist()]
                             for d in (face_access_dirs + tool_access_dirs)],
        # Setups split by origin, so the estimator and the UI can explain the number.
        "axisAlignedSetups": axis_aligned_setups,
        "angledSetups": angled_setups,
        # Angled hole/bore axes that each need their own fixturing or rotation.
        "angledToolAxes": [{"dir": [round(x, 4) for x in d.tolist()],
                            "offAxisDeg": round(_off_axis_deg(d), 1)}
                           for d in angled_tool_axes],
        # Slanted FACES folded into an existing axis (normal, but worth surfacing:
        # a deep angled floor may really want its own setup).
        "absorbedFaceDirections": [{"dir": [round(x, 4) for x in d.tolist()],
                                    "offAxisDeg": round(_off_axis_deg(d), 1)}
                                   for d in absorbed_face_dirs],
        "pocketCount": pocket_count,
        "bossCount": boss_count,
        "deepPocketCount": deep_pockets,
        "maxDepthRatio": round(max_depth_ratio, 2),
        "holeCount": n_holes,
        "holeDiametersMm": hole_diameters,
        # Open/partial circular features (milled by interpolation, not drilled).
        "partialBoreDiametersMm": partial_bore_diameters,
        # Holes that carry a counterbore/step (drill + counterbore = 2 tools).
        "steppedHoleCount": stepped_holes,
        # Round bosses / spigots the cutter must profile around.
        "roundBossCount": len(round_bosses),
        "roundBossDiametersMm": round_boss_diameters,
        # --- turned vs milled (the first question on a mill-turn) -----------
        "turningAxis": [round(float(x), 4) for x in best_axis.tolist()] if best_axis is not None else None,
        # Circular features the SPINDLE can cut (coaxial with the turning axis).
        "turnedFeatures": turned_features,
        "turnedFeatureCount": len(turned_features),
        # Circular features off that axis — driven tools / milling.
        "milledFeatures": milled_features,
        # Planar faces square to the axis: facing cuts on a lathe.
        "facingCandidates": facing_candidates,
        "roundFaceCount": n_cyl,
        "sparseBillet": sparse_billet,
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
        "counts": {"faces": n_faces, "planar": n_planar, "cylindrical": n_cyl, "holes": n_holes},
    }
