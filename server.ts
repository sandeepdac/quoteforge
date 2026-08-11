import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Optionally launch the Python geometry service (turned-profile extraction) as a
 * managed child process, so `npm run dev` runs everything with one command. It's
 * a separate process (Python/OpenCASCADE can't run inside Node), but the app owns
 * its lifecycle and shuts it down on exit. Skipped when the venv isn't installed,
 * when something is already serving the port, or when GEOMETRY_AUTOSTART=false —
 * in all those cases the app still works via the mesh-approximation fallback.
 */
async function startGeometryService(geometryUrl: string): Promise<ChildProcess | null> {
  if (process.env.GEOMETRY_AUTOSTART === 'false') return null;

  // Already up? (e.g. started manually) — don't double-launch.
  try {
    const ping = await fetch(`${geometryUrl}/health`);
    if (ping.ok) {
      console.log(`Geometry service: already running at ${geometryUrl} ✓`);
      return null;
    }
  } catch {
    /* not running yet — we'll start it */
  }

  const dir = path.join(process.cwd(), 'services', 'geometry');
  // venv layout differs by OS: Scripts\python.exe on Windows, bin/python on POSIX.
  const isWin = process.platform === 'win32';
  const venvBin = path.join(dir, '.venv', isWin ? 'Scripts' : 'bin');
  const python = path.join(venvBin, isWin ? 'python.exe' : 'python');
  if (!fs.existsSync(python)) {
    console.log('Geometry service: venv not found — skipping auto-start (app uses mesh fallback).');
    console.log(`  Looked for: ${python}`);
    console.log(isWin
      ? '  To enable exact B-Rep profiles: cd services\\geometry && python -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt'
      : '  To enable exact B-Rep profiles: cd services/geometry && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt');
    return null;
  }

  const port = (() => { try { return new URL(geometryUrl).port || '8000'; } catch { return '8000'; } })();
  // Run uvicorn via the venv's python (-m uvicorn) so it works whether or not the
  // uvicorn launcher script/.exe is on PATH, and identically on Windows and POSIX.
  const child = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', port], {
    cwd: dir,
    env: { ...process.env, PYTHONPATH: dir },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[geometry] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`[geometry] ${d}`));
  child.on('exit', (code) => console.log(`[geometry] service exited (code ${code})`));

  // Tear the child down with the parent so we don't leak a process.
  const stop = () => { try { child.kill(); } catch { /* ignore */ } };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });

  console.log(`Geometry service: launching on port ${port} …`);
  return child;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Healthcheck endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // CAD Analysis Endpoint with Gemini API
  app.post('/api/analyze-cad', async (req, res) => {
    try {
      const { fileName, fileBase64, mimeType, stepText } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      // A STEP text payload is the 3D fallback used only when the exact geometry
      // service (OCP) is unavailable; PDFs/images go through vision as before.
      const isStep = typeof stepText === 'string' && stepText.trim().length > 0;
      const inputDesc = isStep
        ? `${Math.round(stepText.length / 1024)}KB STEP text`
        : fileBase64 ? Math.round(fileBase64.length / 1024) + 'KB base64' : 'no data';
      console.log(`[analyze-cad] ${fileName} (${isStep ? 'STEP-text' : mimeType}, ${inputDesc}) — key ${apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? 'present' : 'MISSING'}`);

      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return res.json({
          success: false,
          message: 'GEMINI_API_KEY not provided. Fallback to native STEP/PDF parser.'
        });
      }

      const ai = new GoogleGenAI({ apiKey });

      const source = isStep
        ? `the raw text of a STEP (ISO 10303) B-Rep CAD file (${fileName}). Infer the overall size from the CARTESIAN_POINT coordinate ranges (X/Y/Z extents in the file's units — assume millimetres unless a CONVERSION_BASED_UNIT says inches, then convert), the part class from whether the geometry is rotationally symmetric (a dominant axis with CYLINDRICAL_SURFACE faces sharing it → turned; prismatic planar faces in many directions → milled), holes from coaxial cylindrical faces, and the part name from the PRODUCT / FILE_NAME entities`
        : `a 2D engineering drawing (${fileName}). Read the drawing's dimensions and callouts`;

      const prompt = `You are an expert CNC machining estimator reading ${source}.
This shop makes CNC MACHINED parts — turned (lathe / sliding-head) and milled (prismatic) — from solid bar or billet.
Return ONLY valid JSON in this exact shape:
{
  "partName": "string — from the title block",
  "materialName": "string — e.g. Aluminium 6082, Brass CZ121, Stainless 316, Mild Steel EN8, Titanium",
  "partClass": "turned | milled | unknown",
  "turned": {
    "odMm": number,        // largest outside diameter
    "lengthMm": number,    // overall turned length along the axis
    "boreDiaMm": number,   // central bore/through-hole diameter, 0 if solid
    "boreDepthMm": number, // bore depth, 0 if none
    "grooveCount": number, // turned recesses / undercuts
    "threadCount": number, // threaded features
    "faceCount": number    // faces to finish (1 or 2)
  },
  "milled": {
    "lengthMm": number, "widthMm": number, "heightMm": number,  // overall bounding box
    "holeCount": number,
    "holeDetails": [{"diameterMm": number, "count": number}],
    "pocketCount": number,
    "bossCount": number,
    "setupCount": number   // distinct faces that must be machined (fixturings), 1-6
  },
  "weightKg": number,          // finished part weight if determinable, else 0
  "toleranceCallout": "string",// tightest tolerance / fit / GD&T seen, else ""
  "finishCallout": "string",   // surface finish / coating callout, else ""
  "quantity": number,          // batch qty if stated, else 0
  "confidenceScore": number,   // 0-100 — how confident you are in the numbers you read
  "aiNotes": ["string"]        // caveats: unreadable dims, assumptions, risk features
}
Rules:
- Choose partClass = "turned" for rotationally-symmetric parts (shafts, pins, bushings, fittings, spacers) shown with diameter (⌀) callouts and a turned side view. Choose "milled" for prismatic/plate parts (brackets, housings, manifolds). Use "unknown" only if you truly cannot tell.
- Populate the matching object ("turned" or "milled"); the other may be null.
- Report dimensions in millimetres. If the drawing is in inches, convert to mm.
- If a value cannot be read, use 0 and add a note — never invent numbers.
Return ONLY the JSON object.`;

      // Ask the model for strict JSON so the reply is machine-parseable.
      const generationConfig = { responseMimeType: 'application/json' };

      let responseText = '';

      if (isStep) {
        // STEP files can be large; cap the text so we stay within request limits.
        // The header + a broad sample of geometry entities is enough to size and
        // classify the part — this is a fallback, not the exact measurement.
        const MAX_STEP_CHARS = 180_000;
        const clipped = stepText.length > MAX_STEP_CHARS
          ? stepText.slice(0, MAX_STEP_CHARS) + '\n...[truncated]'
          : stepText;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt + '\n\n=== STEP FILE ===\n' + clipped }] }],
          config: generationConfig
        });
        responseText = response.text || '';
      } else if (fileBase64 && mimeType) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType === 'application/pdf' ? 'application/pdf' : 'image/png',
                    data: fileBase64
                  }
                },
                { text: prompt }
              ]
            }
          ],
          config: generationConfig
        });
        responseText = response.text || '';
      } else {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: generationConfig
        });
        responseText = response.text || '';
      }

      // Empty reply → let the client fall back to manual entry rather than error out.
      if (!responseText.trim()) {
        return res.json({ success: false, message: 'Empty response from vision model.' });
      }

      // Strip any stray code fences (belt-and-suspenders alongside responseMimeType).
      const cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(cleanJson);
      } catch {
        console.error('Gemini CAD API: could not parse JSON reply');
        return res.json({ success: false, message: 'Could not parse the model response as JSON.' });
      }
      if (!parsedData || typeof parsedData !== 'object') {
        return res.json({ success: false, message: 'Model response was not a JSON object.' });
      }

      console.log(`[analyze-cad] OK — extracted ${Object.keys(parsedData as object).length} fields`);
      return res.json({ success: true, data: parsedData });
    } catch (err: any) {
      console.error('[analyze-cad] Gemini error:', err?.message || err);
      return res.json({ success: false, error: err?.message || String(err) });
    }
  });

  // Turned-profile extraction — forward to the Python geometry service (OCP).
  // Optional: if the service isn't running, return ok:false and the web app
  // falls back to its built-in mesh approximation.
  const GEOMETRY_URL = process.env.GEOMETRY_URL || 'http://127.0.0.1:8000';
  app.post('/api/extract-profile-b64', async (req, res) => {
    try {
      const { fileBase64, fileName } = req.body;
      if (!fileBase64) return res.json({ ok: false, error: 'no data' });
      const upstream = await fetch(`${GEOMETRY_URL}/extract-profile-b64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, fileName }),
      });
      const json = await upstream.json();
      return res.json(json);
    } catch (err: any) {
      // Service down / unreachable — honest fallback signal for the client.
      return res.json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const keyOk = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`AI vision (Gemini): GEMINI_API_KEY ${keyOk ? 'configured ✓' : 'NOT configured ✗ (PDF/image will fall back to manual)'}`);
    console.log('Note: open the app on THIS port (the Express server) so /api/analyze-cad is available — not the bare Vite port.');
    // Bring up the turned-profile geometry service alongside the app.
    void startGeometryService(GEOMETRY_URL);
  });
}

startServer();
