"""
Tessellate a STEP solid into a mesh that REMEMBERS WHICH FACE each triangle came
from, and pair every face with how the analyser classified it.

Why this exists
---------------
Every geometry bug found in this project so far has been a silent omission: a
feature present in the B-Rep that produced no output at all. None of them were
caught by our own checks, because a check written from the analyser's output can
only ask about features the analyser already reports. The reviewer who kept
finding them had one advantage — they LOOKED AT THE PART.

The existing viewer cannot serve that purpose. It draws schematic markers at
detected hole positions, so it is a picture of what we found: a missed bore draws
nothing, and an unmarked region is indistinguishable from a plain face. To make
the picture diagnostic it has to be coloured by CLASSIFICATION, including a loud
colour for "this analyser did not account for this face at all".

That needs per-face identity in the mesh, which the browser's WASM importer
destroys when it merges shells into one buffer. OpenCASCADE keeps a separate
triangulation per face, so tessellating here preserves the mapping for free.
"""
from __future__ import annotations

from typing import Dict, List

from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedMapOfShape

# Deflection is a compromise: fine enough that a small bore still reads as round
# in the viewer, coarse enough that a 600-face part stays a sane payload.
LINEAR_DEFLECTION = 0.1
ANGULAR_DEFLECTION = 0.35


def labelled_mesh(shape, face_labels: Dict[str, str] | None = None) -> dict:
    """
    Mesh the solid, tagging every triangle with its source face index and label.

    `face_labels` maps a face index (as a string, matching `analyze_milling`'s
    `faceLabels`) to a classification. Faces missing from that map are reported as
    `unexplained` rather than defaulted to something benign — an unclassified face
    is exactly the condition worth seeing.
    """
    labels = face_labels or {}
    BRepMesh_IncrementalMesh(shape, LINEAR_DEFLECTION, False, ANGULAR_DEFLECTION, True)

    # Same indexing as the analyser's face map, so labels line up by index.
    face_map = TopTools_IndexedMapOfShape()
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face_map.Add(TopoDS.Face_s(exp.Current()))
        exp.Next()

    positions: List[float] = []
    normals: List[float] = []
    indices: List[int] = []
    tri_face: List[int] = []          # one face index per TRIANGLE
    face_of: Dict[int, str] = {}

    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        fidx = face_map.FindIndex(face)
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            exp.Next()
            continue
        trsf = loc.Transformation()
        base = len(positions) // 3
        reversed_face = face.Orientation() == TopAbs_REVERSED

        has_normals = False
        try:
            has_normals = tri.HasNormals()
        except Exception:  # noqa: BLE001 — older triangulations carry no normals
            has_normals = False

        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(trsf)
            positions.extend((p.X(), p.Y(), p.Z()))
            if has_normals:
                n = tri.Normal(i).Transformed(trsf)
                nx, ny, nz = n.X(), n.Y(), n.Z()
                if reversed_face:
                    nx, ny, nz = -nx, -ny, -nz
                normals.extend((nx, ny, nz))

        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            # Keep the winding consistent with the outward normal so the viewer
            # can cull backfaces without holes appearing in the solid.
            if reversed_face:
                a, c = c, a
            indices.extend((base + a - 1, base + b - 1, base + c - 1))
            tri_face.append(fidx)

        face_of[fidx] = labels.get(str(fidx), "unexplained")
        exp.Next()

    # 3 dp is an order of magnitude finer than the tessellation deflection, so
    # rounding costs nothing visible and roughly halves the payload — this mesh
    # is far larger than the analysis it accompanies (a 637-face part meshes to
    # ~48k triangles), which is why it is served on demand rather than riding
    # along with every quote.
    return {
        "positions": [round(v, 3) for v in positions],
        "normals": [round(v, 4) for v in normals] if len(normals) == len(positions) else [],
        "indices": indices,
        "triangleFace": tri_face,
        "faceLabel": {str(k): v for k, v in sorted(face_of.items())},
        "vertexCount": len(positions) // 3,
        "triangleCount": len(indices) // 3,
    }
