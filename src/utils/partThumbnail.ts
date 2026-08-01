/**
 * Generates a self-contained SVG data-URI thumbnail for a part, so quotes created
 * from an upload have a real image without depending on external hosts. The color is
 * derived from the part name so each part gets a stable, distinct swatch.
 */
export function generatePartThumbnail(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'PT';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 42%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 40) % 360} 55% 28%)"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <g fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="6">
    <path d="M120 250 L200 210 L280 250 L200 290 Z"/>
    <path d="M120 250 L120 170 L200 130 L280 170 L280 250"/>
    <path d="M200 210 L200 130"/>
  </g>
  <text x="200" y="345" font-family="ui-monospace, monospace" font-size="52" font-weight="700"
    fill="rgba(255,255,255,0.92)" text-anchor="middle">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
