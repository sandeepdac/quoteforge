/**
 * Generates a self-contained SVG data-URI thumbnail for a part — a small
 * blueprint-style schematic drawn from the part's *measured* footprint, so every
 * part shows a representative diagram (real length × width aspect ratio, hole
 * count, dimension callouts) instead of an external stock photo. No network
 * dependency; the accent hue is derived from the name so parts stay distinct.
 */
export interface ThumbnailGeometry {
  lengthMm?: number;
  widthMm?: number;
  holeCount?: number;
  bendCount?: number;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'PT'
  );
}

export function generatePartThumbnail(name: string, geo?: ThumbnailGeometry): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const initials = initialsOf(name);

  const W = 400;
  const H = 300;
  const L = geo?.lengthMm && geo.lengthMm > 0 ? geo.lengthMm : 1;
  const Wd = geo?.widthMm && geo.widthMm > 0 ? geo.widthMm : 1;

  // Fit the real L×W footprint into the drawing area, preserving aspect ratio.
  const boxMaxW = 236;
  const boxMaxH = 150;
  const scale = Math.min(boxMaxW / L, boxMaxH / Wd);
  const rectW = Math.max(40, L * scale);
  const rectH = Math.max(28, Wd * scale);
  const rx = (W - rectW) / 2;
  const ry = (H - rectH) / 2 - 6;

  // A small, clearly-schematic hole pattern (count is a real measurement; exact
  // positions aren't known, so we lay a neat centered grid as a visual cue).
  const holeCount = Math.max(0, Math.round(geo?.holeCount ?? 0));
  const holesToDraw = Math.min(holeCount, 6);
  let holes = '';
  if (holesToDraw > 0) {
    const cols = Math.min(holesToDraw, 3);
    const rows = Math.ceil(holesToDraw / cols);
    const padX = rectW / (cols + 1);
    const padY = rectH / (rows + 1);
    let drawn = 0;
    for (let r = 0; r < rows && drawn < holesToDraw; r++) {
      for (let c = 0; c < cols && drawn < holesToDraw; c++) {
        const cx = rx + padX * (c + 1);
        const cy = ry + padY * (r + 1);
        holes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="none" stroke="hsl(${hue} 80% 70%)" stroke-width="2.5"/>`;
        drawn++;
      }
    }
  }

  const dimL = geo?.lengthMm ? `${Math.round(geo.lengthMm)} mm` : '';
  const dimW = geo?.widthMm ? `${Math.round(geo.widthMm)} mm` : '';
  const bendBadge = geo?.bendCount && geo.bendCount > 0
    ? `<text x="${W - 16}" y="30" font-family="ui-monospace, monospace" font-size="15" fill="hsl(${hue} 80% 75%)" text-anchor="end">${geo.bendCount} bend${geo.bendCount > 1 ? 's' : ''}</text>`
    : '';
  const holeBadge = holeCount > 0
    ? `<text x="16" y="30" font-family="ui-monospace, monospace" font-size="15" fill="hsl(${hue} 80% 75%)">${holeCount} hole${holeCount > 1 ? 's' : ''}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1a2e"/>
      <stop offset="1" stop-color="#0a1322"/>
    </linearGradient>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0 L0 0 0 24" fill="none" stroke="rgba(120,160,220,0.10)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rectW.toFixed(1)}" height="${rectH.toFixed(1)}" rx="6"
    fill="hsl(${hue} 60% 55% / 0.12)" stroke="hsl(${hue} 80% 65%)" stroke-width="2.5"/>
  ${holes}
  <g stroke="rgba(150,190,240,0.55)" stroke-width="1" fill="rgba(150,190,240,0.9)" font-family="ui-monospace, monospace" font-size="13">
    ${dimL ? `<line x1="${rx.toFixed(1)}" y1="${(ry + rectH + 16).toFixed(1)}" x2="${(rx + rectW).toFixed(1)}" y2="${(ry + rectH + 16).toFixed(1)}"/>
    <text x="${(W / 2).toFixed(1)}" y="${(ry + rectH + 32).toFixed(1)}" text-anchor="middle" stroke="none">${dimL}</text>` : ''}
    ${dimW ? `<line x1="${(rx - 16).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(rx - 16).toFixed(1)}" y2="${(ry + rectH).toFixed(1)}"/>
    <text x="${(rx - 22).toFixed(1)}" y="${(ry + rectH / 2 + 4).toFixed(1)}" text-anchor="end" stroke="none">${dimW}</text>` : ''}
  </g>
  ${holeBadge}
  ${bendBadge}
  <text x="16" y="${H - 16}" font-family="ui-monospace, monospace" font-size="20" font-weight="700"
    fill="rgba(220,235,255,0.95)">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
