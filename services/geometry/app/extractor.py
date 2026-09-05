"""
Turned-profile extraction from a STEP solid, using OpenCASCADE (OCP).

Two jobs, matching QuoteForge options 1 & 2:

  (2) Rotational-symmetry detection — is this a body of revolution (a turned
      part) or not? Uses the inertia tensor's principal properties (a revolved
      solid has two equal principal moments → a symmetry axis) AND a face-type
      check (every face a plane/cylinder/cone/torus/sphere, rotational faces
      coaxial with that axis). Inertia symmetry alone is necessary but not
      sufficient — a square prism also has two equal moments — so both must agree.

  (1) Profile extraction — from the B-Rep faces (not a mesh), read the real
      turned features: outer-diameter steps, the central bore, grooves, and
      off-axis "cross" holes (which need a second op / live tooling). This is
      what the WASM build in the browser cannot do, and it feeds the
      cycle-time estimator directly.

Everything is measured — nothing invented. If the part isn't rotational, we say
so and return the measurements without a turned profile.
"""
from __future__ import annotations

import math
from typing import List, Optional

import numpy as np

from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_VERTEX, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import (
    GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus, GeomAbs_Sphere,
)
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from .milling import analyze_milling
from .threads import find_thread_callouts, match_threads_to_holes

ROT_TYPES = {GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus, GeomAbs_Sphere}
KNOWN_TYPES = ROT_TYPES | {GeomAbs_Plane}


def _np(p) -> np.ndarray:
    return np.array([p.X(), p.Y(), p.Z()], dtype=float)


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _dist_point_to_line(p: np.ndarray, origin: np.ndarray, direction: np.ndarray) -> float:
    w = p - origin
    return float(np.linalg.norm(w - np.dot(w, direction) * direction))


def read_step(path: str):
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        raise ValueError("Could not read STEP file")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError("STEP file contained no shape")
    return shape


def _symmetry_axis(shape):
    """Return (origin, direction, has_symmetry, volume_mm3) from the inertia tensor."""
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    volume = props.Mass()  # density 1 → volume in mm³
    com = _np(props.CentreOfMass())
    pp = props.PrincipalProperties()
    moments = list(pp.Moments())  # (I1, I2, I3)
    axes = [_np(pp.FirstAxisOfInertia()), _np(pp.SecondAxisOfInertia()), _np(pp.ThirdAxisOfInertia())]

    # A body of revolution has two equal principal moments; the odd one out is
    # the symmetry axis. Find the most-equal pair, the leftover index is the axis.
    pairs = [(0, 1, 2), (1, 2, 0), (0, 2, 1)]  # (i, j, leftover)
    best = min(pairs, key=lambda t: abs(moments[t[0]] - moments[t[1]]) / (abs(moments[t[0]]) + abs(moments[t[1]]) + 1e-9))
    i, j, k = best
    rel_diff = abs(moments[i] - moments[j]) / (abs(moments[i]) + abs(moments[j]) + 1e-9)
    has_symmetry = rel_diff < 0.02  # two moments within 2% → inertial symmetry axis
    axis_dir = _unit(axes[k])
    return com, axis_dir, has_symmetry, volume


def _face_vertices_axial(face, origin, axis_dir):
    """(min, max) axial coordinate of a face's vertices along the axis."""
    zs = []
    vexp = TopExp_Explorer(face, TopAbs_VERTEX)
    seen = set()
    while vexp.More():
        v = TopoDS.Vertex_s(vexp.Current())
        p = _np(BRep_Tool.Pnt_s(v))
        key = (round(p[0], 4), round(p[1], 4), round(p[2], 4))
        if key not in seen:
            seen.add(key)
            zs.append(float(np.dot(p - origin, axis_dir)))
        vexp.Next()
    if not zs:
        return None
    return min(zs), max(zs)


def extract(path: str) -> dict:
    shape = read_step(path)
    origin, axis_dir, has_symmetry, volume_mm3 = _symmetry_axis(shape)

    # Surface area.
    area_props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, area_props)
    area_mm2 = area_props.Mass()

    # Bounding box (raw dims) + axial length along the symmetry axis.
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    bbox = {"x": round(xmax - xmin, 3), "y": round(ymax - ymin, 3), "z": round(zmax - zmin, 3)}
    corners = [np.array([x, y, z], float)
               for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]
    axial = [float(np.dot(c - origin, axis_dir)) for c in corners]
    axis_length = round(max(axial) - min(axial), 3)

    outer_cyls: List[dict] = []
    bore_cyls: List[dict] = []
    cross_cyls: List[dict] = []
    max_vertex_radius = 0.0
    n_faces = 0
    n_known = 0
    n_rot = 0
    n_rot_coaxial = 0
    tol = max(0.2, 0.01 * max(bbox.values()))

    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        n_faces += 1
        ad = BRepAdaptor_Surface(face)
        stype = ad.GetType()
        if stype in KNOWN_TYPES:
            n_known += 1

        # Track the largest radial extent of any vertex (robust OD fallback).
        ext = _face_vertices_axial(face, origin, axis_dir)  # also visits vertices
        vexp = TopExp_Explorer(face, TopAbs_VERTEX)
        while vexp.More():
            p = _np(BRep_Tool.Pnt_s(TopoDS.Vertex_s(vexp.Current())))
            max_vertex_radius = max(max_vertex_radius, _dist_point_to_line(p, origin, axis_dir))
            vexp.Next()

        if stype == GeomAbs_Cylinder:
            n_rot += 1
            cyl = ad.Cylinder()
            r = cyl.Radius()
            cdir = _unit(_np(cyl.Axis().Direction()))
            cloc = _np(cyl.Axis().Location())
            parallel = abs(float(np.dot(cdir, axis_dir))) > 0.98
            coaxial = parallel and _dist_point_to_line(cloc, origin, axis_dir) < tol
            zspan = ext if ext else (0.0, 0.0)
            entry = {"radiusMm": round(r, 3), "zStartMm": round(zspan[0], 3), "zEndMm": round(zspan[1], 3)}
            if coaxial:
                n_rot_coaxial += 1
                is_bore = face.Orientation() == TopAbs_REVERSED
                (bore_cyls if is_bore else outer_cyls).append(entry)
            else:
                # Keep the cylinder's own axis and seat so these FACES can be
                # grouped into FEATURES below. A single cross hole is normally
                # split into two half-cylinders, and a counterbored one into
                # more, so a raw face count runs to several times the number of
                # operations a machinist actually performs.
                # Extent along the CYLINDER'S OWN axis — the distance a tool has
                # to travel to make this feature, which is not the same as its
                # extent along the part's turning axis.
                own = _face_vertices_axial(face, cloc, cdir)
                entry["_axis"] = cdir
                entry["_loc"] = cloc
                entry["_isBore"] = face.Orientation() == TopAbs_REVERSED
                entry["_lo"], entry["_hi"] = own if own else (0.0, 0.0)
                cross_cyls.append(entry)
        elif stype in ROT_TYPES:
            n_rot += 1
            # Cone/torus/sphere — treat as coaxial rotational if their axis lines up.
            n_rot_coaxial += 1

        exp.Next()

    # --- Derive the turned profile ------------------------------------------
    outer_radius = max([c["radiusMm"] for c in outer_cyls] + [max_vertex_radius], default=0.0)
    od = round(2 * outer_radius, 3)

    # The main bore, measured across ALL the faces that make it.
    #
    # This used to take the single widest FACE and report its extent as the bore
    # depth. A bore is normally modelled as two half-cylinders, and either half
    # may be split again where a groove or a step interrupts it, so the depth
    # came out as whatever the largest fragment happened to be. On Lance's VOC
    # housing that read 14 mm for a hole that runs the full 70 mm of the part —
    # a fifth of the real drilling, on the part whose two deep holes ARE the job.
    main_bore = max(bore_cyls, key=lambda c: c["radiusMm"], default=None)
    bore_dia = round(2 * main_bore["radiusMm"], 3) if main_bore else 0.0
    if main_bore:
        r_main = main_bore["radiusMm"]
        same = [c for c in bore_cyls if abs(c["radiusMm"] - r_main) <= max(0.05, 0.02 * r_main)]
        # Every zStart/zEnd here is already projected on the part's own turning
        # axis from a common origin, so these are directly comparable.
        bore_depth = round(max(c["zEndMm"] for c in same) - min(c["zStartMm"] for c in same), 3)
    else:
        bore_depth = 0.0

    # Grooves: narrow outer reductions well below the OD.
    groove_count = 0
    for c in outer_cyls:
        width = abs(c["zEndMm"] - c["zStartMm"])
        if outer_radius > 0 and c["radiusMm"] < 0.85 * outer_radius and 0 < width < 0.25 * max(axis_length, 1):
            groove_count += 1

    cross_features = len(cross_cyls) > 0

    # --- Off-axis (cross) features, grouped into real operations -------------
    #
    # Each of these is a driven-tool operation on a turn-mill, or a second op on
    # a lathe: index the spindle, bring in a live tool, cut, retract. Until now
    # the extractor reported only the BOOLEAN `crossFeatures`, and the cost
    # models never read even that — so a cross-drilled part was costed as though
    # the cross work did not exist. Lance's Drive Dog is the clean example: it is
    # a plastic part with no holes and almost nothing to remove, it takes him ten
    # times as long as a stainless rod of the same size, and the only difference
    # between the two parts is that this one has cross features.
    #
    # Faces are grouped into features by shared axis LINE and radius, because one
    # hole normally arrives as two half-cylinders. Length is the axial extent
    # along the feature's own axis, which is the depth a tool has to travel.
    cross_groups: List[dict] = []
    for c in cross_cyls:
        ax = c["_axis"]
        loc = c["_loc"]
        r = c["radiusMm"]
        placed = False
        for g in cross_groups:
            if abs(float(np.dot(ax, g["axis"]))) <= 0.98:
                continue
            if abs(r - g["radiusMm"]) > max(0.05, 0.02 * r):
                continue
            # Same axis LINE, not merely the same direction.
            if _dist_point_to_line(loc, g["point"], g["axis"]) > max(0.2, 0.02 * r):
                continue
            g["faces"] += 1
            g["lo"] = min(g["lo"], c["_lo"])
            g["hi"] = max(g["hi"], c["_hi"])
            placed = True
            break
        if not placed:
            cross_groups.append({"axis": ax, "point": loc, "radiusMm": r,
                                 "faces": 1, "isBore": c.get("_isBore", True),
                                 "lo": c["_lo"], "hi": c["_hi"]})

    cross_feature_list = [
        {"diameterMm": round(2.0 * g["radiusMm"], 3),
         "lengthMm": round(max(0.0, g["hi"] - g["lo"]), 3),
         "isBore": bool(g["isBore"])}
        for g in sorted(cross_groups, key=lambda g: -g["radiusMm"])
    ]

    # Strip the grouping helpers so the response stays JSON-serialisable.
    for c in cross_cyls:
        c.pop("_axis", None)
        c.pop("_loc", None)
        c.pop("_isBore", None)
        c.pop("_lo", None)
        c.pop("_hi", None)

    # --- Rotational-symmetry verdict ----------------------------------------
    # A part is TURNED when its main form is a body of revolution — a coaxial
    # outer profile made of known surface types. Off-axis (cross) features do NOT
    # disqualify it (a cross-drilled shaft is still turned on a turn-mill); they
    # are flagged separately as needing live tooling / a second op. Inertia
    # symmetry is a positive signal but not required, since a cross hole breaks it.
    consistent = n_faces > 0 and n_known == n_faces
    coaxial_ratio = (n_rot_coaxial / n_rot) if n_rot else 0.0
    has_outer = len(outer_cyls) >= 1
    cross_ok = len(cross_cyls) <= max(1, len(outer_cyls))  # a few cross holes are fine
    is_turned = bool(consistent and has_outer and od > 0 and coaxial_ratio >= 0.5 and cross_ok)

    if is_turned:
        confidence = 0.6 + 0.4 * coaxial_ratio * (1.0 if has_symmetry else 0.8)
    else:
        confidence = 0.3 * (1.0 if has_symmetry else 0.0) + 0.3 * coaxial_ratio
    confidence = round(max(0.0, min(1.0, confidence)), 2)

    if is_turned:
        reason = (f"Body of revolution: ⌀{od:.1f} × {axis_length:.1f} mm, "
                  f"{len(outer_cyls)} OD step(s)"
                  + (f", ⌀{bore_dia:.1f} bore" if bore_dia else "")
                  + (f", {groove_count} groove(s)" if groove_count else "")
                  + (f", {len(cross_cyls)} cross-feature(s)" if cross_features else "")
                  + f". Inertia symmetric={has_symmetry}, {int(coaxial_ratio*100)}% of turned faces coaxial.")
    else:
        why = []
        if not consistent:
            why.append("has non-revolved (free-form) faces")
        if not has_outer:
            why.append("no coaxial outer cylindrical form")
        if coaxial_ratio < 0.5:
            why.append("cylindrical faces are not coaxial")
        if not cross_ok:
            why.append("off-axis features dominate (prismatic/milled)")
        reason = "Not a turned part — " + ("; ".join(why) or "geometry is not a body of revolution") + "."

    segments = (
        [{"type": "od", **c} for c in sorted(outer_cyls, key=lambda c: c["zStartMm"])]
        + [{"type": "bore", **c} for c in sorted(bore_cyls, key=lambda c: c["zStartMm"])]
        + [{"type": "cross", **c} for c in cross_cyls]
    )

    # Milled/prismatic analysis (the 3 AAG rules) — always computed so the app
    # has a full picture and can choose the cheaper machining route / machine.
    milled = analyze_milling(shape)

    # THREADS. Not measurable from faces — a tapped hole is modelled as a plain
    # cylinder at the tap-drill ⌀ — so the only signal in the file is the name the
    # CAD system wrote. Both real parts needing taps carried it: 'M3 Tapped
    # Hole1', 'M2x0.4 Tapped Hole2'. Reported as candidates to confirm, because a
    # tree name records the LAST feature, not an inventory of every thread.
    thread_callouts = match_threads_to_holes(
        find_thread_callouts(path), milled.get("holeDiametersMm") or []
    )
    milled["threadCallouts"] = thread_callouts
    # A question the FACES cannot answer, kept separate from face coverage so a
    # green ledger can never stand in for "every operation is costed".
    open_questions = []
    if thread_callouts:
        labels = ", ".join(c["callout"] for c in thread_callouts)
        n = sum(c["matchedHoleCount"] for c in thread_callouts)
        open_questions.append({
            "kind": "threads",
            "summary": f"{labels} thread callout in the model"
                       + (f" — {n} hole(s) at the tap-drill ⌀" if n else " — no hole found at its tap-drill ⌀"),
            "detail": "Threads have no geometric signature: CAD stores a tapped hole as a plain "
                      "cylinder at the tap-drill diameter, so face analysis cannot see it and no "
                      "tapping time is in this quote. Confirm against the drawing and add it.",
        })
    milled["openQuestions"] = open_questions

    return {
        "ok": True,
        "is_turned": is_turned,
        "part_class": "turned" if is_turned else "milled",
        "confidence": confidence,
        "reason": reason,
        "milled": milled,
        "axis": {"origin": [round(x, 3) for x in origin.tolist()],
                 "dir": [round(x, 4) for x in axis_dir.tolist()]},
        "profile": {
            "odMm": od,
            "lengthMm": axis_length,
            "boreDiaMm": bore_dia,
            "boreDepthMm": bore_depth,
            "grooveCount": groove_count,
            "threadCount": 0,  # threads come from the drawing callout, not geometry
            "faceCount": 2,
            "crossFeatures": cross_features,
            # The off-axis features themselves, grouped into operations. Each is
            # a live-tool cut on a turn-mill or a second op on a plain lathe.
            "crossFeatureList": cross_feature_list,
        },
        "measured": {
            "volumeCm3": round(volume_mm3 / 1000.0, 3),
            "surfaceAreaCm2": round(area_mm2 / 100.0, 3),
            "boundingBoxMm": bbox,
        },
        "counts": {
            "faces": n_faces, "odSteps": len(outer_cyls),
            "bores": len(bore_cyls), "crossFeatures": len(cross_cyls),
            "grooves": groove_count,
        },
        "segments": segments,
    }
