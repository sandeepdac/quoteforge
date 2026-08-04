"""Generate sample STEP solids with OCP for validating the extractor.

Writes a stepped shaft (turned, bored), a box (not turned), and a shaft with a
cross hole (turned + cross feature) into the given output directory.
"""
import os
import sys

from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeBox
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs


def cyl(r, h, x=0, y=0, z=0, dx=0, dy=0, dz=1):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(dx, dy, dz)), r, h).Shape()


def write(shape, path):
    w = STEPControl_Writer()
    w.Transfer(shape, STEPControl_AsIs)
    w.Write(path)
    return path


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    paths = {}

    # Stepped shaft ⌀20×60 + ⌀12×40, bored ⌀8 through.
    shaft = BRepAlgoAPI_Fuse(cyl(10, 60), cyl(6, 40, z=60)).Shape()
    shaft = BRepAlgoAPI_Cut(shaft, cyl(4, 120, z=-1)).Shape()
    paths["shaft"] = write(shaft, os.path.join(outdir, "shaft.step"))

    # Plain box 40×30×20 — not a turned part.
    paths["box"] = write(BRepPrimAPI_MakeBox(40, 30, 20).Shape(), os.path.join(outdir, "box.step"))

    # ⌀20×60 shaft with a ⌀5 cross hole through X.
    cross = BRepAlgoAPI_Cut(cyl(10, 60), cyl(2.5, 60, x=-30, z=30, dx=1, dy=0, dz=0)).Shape()
    paths["cross"] = write(cross, os.path.join(outdir, "cross.step"))
    return paths


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "samples"
    for name, p in build(out).items():
        print(f"{name}: {p}")
