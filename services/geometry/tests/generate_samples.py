"""Generate sample STEP solids with OCP for validating the extractor.

Writes a stepped shaft (turned, bored), a box (not turned), and a shaft with a
cross hole (turned + cross feature) into the given output directory.
"""
import math
import os
import sys

from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone
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

    # Block 60×60×30 with ONE pocket cut from the top and ONE ⌀6 hole drilled on a
    # 30° COMPOUND ANGLE. The angled hole can only be produced along its own axis,
    # so it needs its own fixturing/rotation — a setup the axis-aligned count
    # cannot see. Regression guard for the bug where every non-axis direction was
    # silently discarded (a real part's two 30° holes contributed nothing).
    ang = BRepPrimAPI_MakeBox(60, 60, 30).Shape()
    ang = BRepAlgoAPI_Cut(ang, BRepPrimAPI_MakeBox(gp_Pnt(15, 15, 22), 30, 30, 20).Shape()).Shape()
    s30, c30 = math.sin(math.radians(30.0)), math.cos(math.radians(30.0))
    ang = BRepAlgoAPI_Cut(ang, cyl(3, 120, x=5, y=30, z=-5, dx=s30, dy=0.0, dz=c30)).Shape()
    paths["angled"] = write(ang, os.path.join(outdir, "angled.step"))

    # Same block, same pocket, but the hole is drilled straight down Z. Pairs with
    # "angled" to prove the extra setup comes from the ANGLE, not the hole.
    strt = BRepPrimAPI_MakeBox(60, 60, 30).Shape()
    strt = BRepAlgoAPI_Cut(strt, BRepPrimAPI_MakeBox(gp_Pnt(15, 15, 22), 30, 30, 20).Shape()).Shape()
    strt = BRepAlgoAPI_Cut(strt, cyl(3, 120, x=8, y=30, z=-5, dx=0, dy=0, dz=1)).Shape()
    paths["straight"] = write(strt, os.path.join(outdir, "straight.step"))

    # Block 60x60x20 with a COUNTERBORED hole: ⌀5 through, opened to ⌀10 for 6 mm
    # from the top. Two coaxial diameters = two operations (drill + counterbore).
    cb = BRepPrimAPI_MakeBox(60, 60, 20).Shape()
    cb = BRepAlgoAPI_Cut(cb, cyl(2.5, 60, x=30, y=30, z=-5)).Shape()
    cb = BRepAlgoAPI_Cut(cb, cyl(5.0, 6, x=30, y=30, z=14)).Shape()
    paths["counterbore"] = write(cb, os.path.join(outdir, "counterbore.step"))

    # Block 60x60x20 with a ⌀30 x 8 mm round SPIGOT standing proud of the top.
    # External cylinder: material inside it, so not a hole — but still machined
    # around.
    sp = BRepAlgoAPI_Fuse(BRepPrimAPI_MakeBox(60, 60, 20).Shape(),
                          cyl(15, 8, x=30, y=30, z=20)).Shape()
    paths["spigot"] = write(sp, os.path.join(outdir, "spigot.step"))

    # Block 60x60x30 with a blind pocket on TOP and a blind pocket on the BOTTOM.
    # Opposite faces → the part must be flipped → 2 setups.
    ts = BRepPrimAPI_MakeBox(60, 60, 30).Shape()
    ts = BRepAlgoAPI_Cut(ts, BRepPrimAPI_MakeBox(gp_Pnt(10, 10, 22), 25, 25, 20).Shape()).Shape()
    ts = BRepAlgoAPI_Cut(ts, BRepPrimAPI_MakeBox(gp_Pnt(30, 30, -12), 20, 20, 20).Shape()).Shape()
    paths["twosided"] = write(ts, os.path.join(outdir, "twosided.step"))

    # Block 60x60x20 with a single ⌀6 THROUGH hole — drillable from either end,
    # so it must not invent a second setup.
    th = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(60, 60, 20).Shape(),
                         cyl(3, 60, x=30, y=30, z=-10)).Shape()
    paths["throughonly"] = write(th, os.path.join(outdir, "throughonly.step"))

    # A bore that is LARGE relative to the part: ⌀24 through a 26.5 x 25 x 14.25
    # block, i.e. nearly as wide as the stock. Two size gates disagreed about
    # where a cylinder stopped being a bore and started being a boss (0.4 vs 0.5
    # of the longest edge), so a face in between matched neither test and was
    # dropped from the analysis entirely — no hole, no boss, nothing, its volume
    # visible only inside the roughing total. This is part 032736's ⌀24.
    bigbore = BRepAlgoAPI_Cut(
        BRepPrimAPI_MakeBox(26.5, 25.0, 14.25).Shape(),
        cyl(12.0, 40, x=13.25, y=12.5, z=-10)).Shape()
    paths["bigbore"] = write(bigbore, os.path.join(outdir, "bigbore.step"))

    # A ⌀6 through hole with a 90° COUNTERSINK on top, in a 40x40x12 block.
    # Conical faces were never inspected, so this cost nothing at all.
    cs = BRepPrimAPI_MakeBox(40, 40, 12).Shape()
    cs = BRepAlgoAPI_Cut(cs, cyl(3, 40, x=20, y=20, z=-10)).Shape()
    cone = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(20, 20, 12), gp_Dir(0, 0, -1)), 6.0, 3.0, 3.0).Shape()
    cs = BRepAlgoAPI_Cut(cs, cone).Shape()
    paths["countersink"] = write(cs, os.path.join(outdir, "countersink_cone.step"))
    return paths


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "samples"
    for name, p in build(out).items():
        print(f"{name}: {p}")
