/**
 * Format a stock / bounding-box triple as "L × W × H mm" with the LARGEST
 * dimension first. Stock is a block, so the axis order is cosmetic — but showing
 * it largest-first lines it up with the part's sorted L/W/H, so a billet never
 * looks "shorter than the part" just because its axes are in a different order.
 */
export function dimsDesc(d: { x: number; y: number; z: number }, dp = 1): string {
  const p = 10 ** dp;
  return [d.x, d.y, d.z]
    .sort((a, b) => b - a)
    .map((v) => Math.round(v * p) / p)
    .join(' × ');
}
