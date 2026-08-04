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
