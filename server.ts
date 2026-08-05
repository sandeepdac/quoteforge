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
  const uvicorn = path.join(dir, '.venv', 'bin', 'uvicorn');
  if (!fs.existsSync(uvicorn)) {
    console.log('Geometry service: venv not found — skipping auto-start (app uses mesh fallback).');
    console.log('  To enable exact B-Rep profiles: cd services/geometry && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt');
    return null;
  }

  const port = (() => { try { return new URL(geometryUrl).port || '8000'; } catch { return '8000'; } })();
  const child = spawn(uvicorn, ['main:app', '--host', '127.0.0.1', '--port', port], {
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
      const { fileName, fileBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      console.log(`[analyze-cad] ${fileName} (${mimeType}, ${fileBase64 ? Math.round(fileBase64.length / 1024) + 'KB base64' : 'no data'}) — key ${apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? 'present' : 'MISSING'}`);

      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return res.json({
          success: false,
          message: 'GEMINI_API_KEY not provided. Fallback to native STEP/PDF parser.'
        });
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are an expert manufacturing engineer and CAD CAD/CAM estimator.
Analyze this CAD engineering drawing or document (${fileName}).
Extract structured JSON with the following fields:
{
  "partName": "string",
  "materialName": "string (e.g. Mild Steel 3.0mm, Stainless 304, Aluminum 6061)",
  "thicknessMm": number,
  "lengthMm": number,
  "widthMm": number,
  "heightMm": number,
  "perimeterMm": number,
  "pierceCount": number,
  "bendCount": number,
  "isSimpleBending": boolean,
  "holeCount": number,
  "holeDetails": [{"diameterMm": number, "count": number}],
  "weldLengthMm": number,
  "weldCount": number,
  "weightKg": number,
  "surfaceAreaM2": number,
  "finishCallout": "string",
  "tolerances": "string",
  "aiNotes": ["string"],
  "confidenceScore": number (0-100)
}
Return ONLY valid JSON.`;

      // Ask the model for strict JSON so the reply is machine-parseable.
      const generationConfig = { responseMimeType: 'application/json' };

      let responseText = '';

      if (fileBase64 && mimeType) {
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
