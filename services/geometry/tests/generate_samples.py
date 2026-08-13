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

    # --- Milled samples ----------------------------------------------------
    # Block 60×40×20 with a single open pocket 30×20 × 10 deep, cut from the top.
    block = BRepPrimAPI_MakeBox(60, 40, 20).Shape()
    pocket_tool = BRepPrimAPI_MakeBox(gp_Pnt(15, 10, 10), 30, 20, 20).Shape()
    pocketed = BRepAlgoAPI_Cut(block, pocket_tool).Shape()
    paths["pocket"] = write(pocketed, os.path.join(outdir, "pocket.step"))

    # Block 40×40×60 with a narrow deep slot 8 wide × 40 deep (high depth ratio).
    tall = BRepPrimAPI_MakeBox(40, 40, 60).Shape()
    deep_tool = BRepPrimAPI_MakeBox(gp_Pnt(16, 5, 20), 8, 30, 60).Shape()
    deep = BRepAlgoAPI_Cut(tall, deep_tool).Shape()
    paths["deep"] = write(deep, os.path.join(outdir, "deep.step"))

    # L-step block 60×40×20 with a 30×40×8 corner removed from the top. The step
    # creates sub-surface, convex-ringed faces but NO recess (a prismatic profile,
    # ~no concavity) — these must not be mistaken for bosses/islands.
    step = BRepAlgoAPI_Cut(
        BRepPrimAPI_MakeBox(60, 40, 20).Shape(),
        BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 12), 30, 40, 8).Shape(),
    ).Shape()
    paths["step"] = write(step, os.path.join(outdir, "step.step"))

    # Block 60×60×20 with a pocket on top AND two holes drilled from a side
    # face → two access directions → 2+ setups.
    multi = BRepPrimAPI_MakeBox(60, 60, 20).Shape()
    multi = BRepAlgoAPI_Cut(multi, BRepPrimAPI_MakeBox(gp_Pnt(15, 15, 12), 30, 30, 20).Shape()).Shape()
    multi = BRepAlgoAPI_Cut(multi, cyl(3, 60, x=-1, y=20, z=10, dx=1, dy=0, dz=0)).Shape()
    multi = BRepAlgoAPI_Cut(multi, cyl(3, 60, x=-1, y=40, z=10, dx=1, dy=0, dz=0)).Shape()
    paths["multi"] = write(multi, os.path.join(outdir, "multi.step"))
    return paths


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "samples"
    for name, p in build(out).items():
        print(f"{name}: {p}")
