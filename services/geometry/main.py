"""
QuoteForge geometry service (FastAPI).

Endpoints:
  GET  /health            → liveness
  POST /extract-profile   → STEP in, turned-profile JSON out

Input (either form works):
  • multipart file upload  (field name: "file")
  • JSON { "fileName": "...", "fileBase64": "<base64 STEP>" }

The response is consumed by the Node/Express server, which forwards it to the
browser. Runs locally — client CAD never leaves the shop's machine.
"""
from __future__ import annotations

import base64
import os
import tempfile
from typing import Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.extractor import extract
from app.labelled_mesh import labelled_mesh
from app.milling import analyze_milling
from app.threads import find_thread_callouts, match_threads_to_holes

app = FastAPI(title="QuoteForge Geometry Service", version="1.0.0")


class Base64Payload(BaseModel):
    fileName: Optional[str] = None
    fileBase64: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "geometry", "version": app.version}


def _run(step_bytes: bytes) -> JSONResponse:
    if not step_bytes:
        return JSONResponse(status_code=400, content={"ok": False, "error": "empty file"})
    tmp = tempfile.NamedTemporaryFile(suffix=".step", delete=False)
    try:
        tmp.write(step_bytes)
        tmp.close()
        result = extract(tmp.name)
        return JSONResponse(content=result)
    except Exception as exc:  # noqa: BLE001 — surface any extraction failure honestly
        return JSONResponse(status_code=422, content={"ok": False, "error": str(exc)})
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@app.post("/extract-profile")
async def extract_profile_multipart(file: UploadFile = File(...)):
    return _run(await file.read())


@app.post("/extract-profile-b64")
def extract_profile_b64(payload: Base64Payload):
    try:
        data = base64.b64decode(payload.fileBase64)
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid base64"})
    return _run(data)


@app.post("/labelled-mesh-b64")
def labelled_mesh_b64(payload: Base64Payload):
    """
    A tessellation of the solid in which every triangle knows which B-Rep face it
    came from, and every face carries the analyser's classification of it.

    Served separately from the analysis on purpose. It is an order of magnitude
    larger (a 637-face part meshes to ~48k triangles), it is diagnostic rather
    than load-bearing, and the analysis it accompanies is persisted with the
    quote — a mesh this size has no business in that record.
    """
    try:
        data = base64.b64decode(payload.fileBase64)
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid base64"})
    if not data:
        return JSONResponse(status_code=400, content={"ok": False, "error": "empty file"})
    tmp = tempfile.NamedTemporaryFile(suffix=".step", delete=False)
    try:
        tmp.write(data)
        tmp.close()
        from app.extractor import read_step
        shape = read_step(tmp.name)
        milled = analyze_milling(shape)
        # Threads come from the file's NAMES, not its faces, so this endpoint has
        # to read them too — it builds its own analysis and would otherwise show a
        # green "fully accounted" badge over a part with untapped M3 holes.
        callouts = match_threads_to_holes(
            find_thread_callouts(tmp.name), milled.get("holeDiametersMm") or []
        )
        if callouts:
            labels = ", ".join(c["callout"] for c in callouts)
            n = sum(c["matchedHoleCount"] for c in callouts)
            milled["openQuestions"] = [{
                "kind": "threads",
                "summary": f"{labels} thread callout in the model"
                           + (f" — {n} hole(s) at the tap-drill ⌀" if n else " — no hole found at its tap-drill ⌀"),
                "detail": "Threads have no geometric signature: CAD stores a tapped hole as a plain "
                          "cylinder at the tap-drill diameter, so face analysis cannot see it and no "
                          "tapping time is in this quote. Confirm against the drawing and add it.",
            }]
        mesh = labelled_mesh(shape, milled.get("faceLabels"))
        mesh["ok"] = True
        mesh["faceLedger"] = milled.get("faceLedger")
        mesh["unaccountedFaces"] = milled.get("unaccountedFaces")
        mesh["unaccountedAreaShare"] = milled.get("unaccountedAreaShare")
        # Questions the FACES cannot answer — threads, principally. Carried with
        # the mesh so the overlay can never show a green badge while an operation
        # with no geometric signature is missing from the quote.
        mesh["openQuestions"] = milled.get("openQuestions") or []
        return JSONResponse(content=mesh)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={"ok": False, "error": str(exc)})
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
