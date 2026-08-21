import React, { useMemo, useState } from 'react';
import { Download, Route, AlertTriangle, Crosshair } from 'lucide-react';
import { Toolpath, toGcode } from '../../utils/toolpath';
import { turningOpRegions, SectionRegion } from '../../utils/opRegions';
import type { TurningOp } from '../../types';

interface ToolpathPreviewProps {
  toolpath: Toolpath;
  partName?: string;
  materialName?: string;
  /**
   * Off-axis feature ⌀s the turned path CANNOT contain — a cross-drilled hole,
   * a flat, a drill breaking through the OD. They are cut with live tooling in a
   * second operation. Naming them here stops the path looking as though the
   * engine failed to see them: on part 029068 a ⌀1 drill through the OD was
   * detected and flagged, but the path showed five turning passes and no hint
   * that anything had been left out.
   */
  crossFeatureDiametersMm?: number[];
}

const PAD = 30;
const DIM_BAND = 40; // room under the part for the length dimension
const SVG_W = 560;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A full longitudinal (Z–X) section of the estimated turning passes. Reference only. */
export default function ToolpathPreview({ toolpath: tp, partName, materialName, crossFeatureDiametersMm }: ToolpathPreviewProps) {
  // Single-select "focus": which op's region we highlight. null = show every pass.
  const [focus, setFocus] = useState<TurningOp | null>(null);
  const opInfo = useMemo(() => turningOpRegions(tp), [tp]);
  const focused = focus ? opInfo.find((o) => o.op === focus) : null;

  const { scale, X, Y, midY, svgH, stockR } = useMemo(() => {
    const totalZ = tp.stockLengthMm;
    const stockRadius = tp.stockDiaMm / 2;
    const s = (SVG_W - 2 * PAD) / Math.max(1, totalZ);
    const partH = tp.stockDiaMm * s;
    const h = PAD + partH + DIM_BAND + PAD;
    const my = PAD + partH / 2;
    return {
      scale: s,
      stockR: stockRadius,
      svgH: h,
      midY: my,
      X: (z: number) => PAD + (z + tp.lengthMm) * s,
      Y: (r: number, sign = 1) => my - sign * r * s,
    };
  }, [tp]);

  const download = () => {
    const gcode = toGcode(tp, { partName, materialName });
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(partName || 'turned-part').replace(/\s+/g, '_')}_REFERENCE.nc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const partX = X(-tp.lengthMm);
  const partW = Math.max(1, X(0) - partX);
  const border = 'hsl(var(--border))';
  const muted = 'hsl(var(--muted-foreground))';

  // Render one region (in mm section space) as shaded SVG rect(s).
  const drawRegion = (region: SectionRegion, color: string, key: string) => {
    const x = X(region.zA);
    const w = Math.max(1, X(region.zB) - X(region.zA));
    const common = { fill: color, fillOpacity: 0.22, stroke: color, strokeWidth: 1.2, strokeDasharray: '4 2' } as const;
    if (region.shape === 'band' || region.shape === 'core') {
      const rTop = Y(region.rOuter);
      const h = region.rOuter * 2 * scale;
      return <rect key={key} x={x} y={rTop} width={w} height={h} {...common} />;
    }
    // annulus → mirrored pair (top + bottom)
    const hAnn = Math.max(1, (region.rOuter - region.rInner) * scale);
    return (
      <g key={key}>
        <rect x={x} y={Y(region.rOuter)} width={w} height={hAnn} {...common} />
        <rect x={x} y={Y(-region.rInner)} width={w} height={hAnn} {...common} />
      </g>
    );
  };

  const activeColor = (op: TurningOp) => tp.passes.find((p) => p.op === op)?.color ?? muted;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Route size={15} className="text-primary" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Turning Toolpath</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            Reference
          </span>
        </div>
        <button
          onClick={download}
          className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Download size={13} /> Download G-code (.nc)
        </button>
      </div>

      {/* Focus caption — what the selected op acts on */}
      <div className="px-4 py-2 border-b border-border bg-primary/5 flex items-start gap-2 min-h-[2.4rem]">
        <Crosshair size={13} className="text-primary shrink-0 mt-0.5" />
        {focused ? (
          <p className="text-[11px] text-foreground leading-snug">
            <span className="font-semibold">{focused.label}:</span>{' '}
            <span className="text-muted-foreground">{focused.description}</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Select an operation below to highlight <strong className="text-foreground">where it acts</strong> on the section.
          </p>
        )}
      </div>

      {/* Full longitudinal section */}
      <div className="p-3 overflow-x-auto bg-muted/10">
        <svg width={SVG_W} height={svgH} className="max-w-full" role="img" aria-label="Turning toolpath section">
          {/* Stock envelope */}
          <rect
            x={partX} y={Y(stockR)} width={partW} height={tp.stockDiaMm * scale}
            fill="none" stroke={muted} strokeDasharray="5 4" strokeWidth={1} opacity={0.55}
          />
          {/* Finished part body (mirrored) */}
          <rect
            x={partX} y={Y(tp.partOdMm / 2)} width={partW} height={tp.partOdMm * scale}
            style={{ fill: 'hsl(var(--muted-foreground) / 0.18)' }} stroke={border} strokeWidth={1.2}
          />
          {/* Bore (cut back to card colour = air) */}
          {tp.boreDiaMm > 0 && (
            <rect
              x={X(-tp.boreDepthMm)} y={Y(tp.boreDiaMm / 2)} width={Math.max(1, X(0) - X(-tp.boreDepthMm))} height={tp.boreDiaMm * scale}
              style={{ fill: 'hsl(var(--card))' }} stroke="#8b5cf6" strokeDasharray="3 2" strokeWidth={0.9} opacity={0.9}
            />
          )}

          {/* Op-focus region overlay (behind the pass polylines) */}
          {focused && focused.regions.map((rg, i) => drawRegion(rg, activeColor(focused.op), `rg${i}`))}

          {/* Centreline (dash-dot) */}
          <line x1={PAD - 8} y1={midY} x2={SVG_W - PAD + 8} y2={midY} stroke={muted} strokeDasharray="8 3 2 3" strokeWidth={0.8} opacity={0.6} />

          {/* Passes — dimmed when another op is focused, so the highlighted op reads clearly */}
          {tp.passes.map((pass, pi) => {
            const dim = focus ? (pass.op === focus ? 1 : 0.12) : 1;
            const segs: React.ReactElement[] = [];
            for (let i = 1; i < pass.moves.length; i++) {
              const a = pass.moves[i - 1], b = pass.moves[i];
              const rapid = b.rapid;
              segs.push(
                <line
                  key={i} x1={X(a.z)} y1={Y(a.x / 2)} x2={X(b.z)} y2={Y(b.x / 2)}
                  stroke={rapid ? muted : pass.color}
                  strokeWidth={rapid ? 0.8 : 1.8}
                  strokeDasharray={rapid ? '3 3' : undefined}
                  opacity={(rapid ? 0.45 : 1) * dim}
                  strokeLinecap="round"
                />
              );
            }
            return <g key={pi}>{segs}</g>;
          })}

          {/* Length dimension */}
          {(() => {
            const dy = midY + stockR * scale + 20;
            return (
              <g stroke={muted} fill={muted} opacity={0.8}>
                <line x1={partX} y1={dy} x2={X(0)} y2={dy} strokeWidth={0.8} />
                <line x1={partX} y1={dy - 4} x2={partX} y2={dy + 4} strokeWidth={0.8} />
                <line x1={X(0)} y1={dy - 4} x2={X(0)} y2={dy + 4} strokeWidth={0.8} />
                <text x={(partX + X(0)) / 2} y={dy + 15} fontSize={10} textAnchor="middle" stroke="none">
                  L {r1(tp.lengthMm)} mm
                </text>
              </g>
            );
          })()}

          {/* OD + bore callouts */}
          <text x={partX + 4} y={Y(tp.partOdMm / 2) - 4} fontSize={10} fill={muted}>⌀{r1(tp.partOdMm)}</text>
          {tp.boreDiaMm > 0 && (
            <text x={X(0) - 4} y={midY - 3} fontSize={9} fill="#8b5cf6" textAnchor="end">⌀{r1(tp.boreDiaMm)} bore</text>
          )}
          <text x={SVG_W - PAD} y={midY + stockR * scale + 20} fontSize={9} fill={muted} textAnchor="end">Z →</text>
        </svg>
      </div>

      {/* Op selector — click to focus a region, click again to show all */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-border">
        {tp.passes.map((pass) => {
          const isFocused = focus === pass.op;
          const hasRegion = opInfo.some((o) => o.op === pass.op);
          return (
            <button
              key={pass.op}
              onClick={() => setFocus((cur) => (cur === pass.op ? null : pass.op))}
              className={`flex items-start gap-2 text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                isFocused
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                  : focus
                  ? 'border-border/50 opacity-55 hover:opacity-100'
                  : 'border-border bg-accent/30 hover:bg-accent/50'
              }`}
              title={hasRegion ? 'Highlight where this operation acts' : 'Operation'}
            >
              <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: pass.color }} />
              <span className="min-w-0">
                <span className="text-[11px] font-semibold text-foreground">
                  {pass.label} <span className="text-muted-foreground font-normal">· {pass.station} · S{pass.rpm} · F{pass.feed}</span>
                </span>
                <span className="block text-[10px] text-muted-foreground truncate">{pass.tool}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-3 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          A <strong className="text-foreground">reference</strong> path expanded from the estimate, using your <strong className="text-foreground">shop tool library</strong> (edit in
          {' '}Settings → Tooling). Stations and inserts are yours, but <strong className="text-foreground">offsets and wear comp are not set here</strong> — it is <strong className="text-foreground">not
          post-processed</strong> for any control and is <strong className="text-foreground">not a substitute for your CAM</strong> (SolidCAM). Verify everything before running; grooves and
          threads are quoted but not in this reference path.
        </p>
      </div>

      {(crossFeatureDiametersMm?.length ?? 0) > 0 && (
        <div className="px-4 pb-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <strong className="text-amber-700 dark:text-amber-300">
              Not in this path: {crossFeatureDiametersMm!.map((d) => `⌀${r1(d)}`).join(', ')}
            </strong>{' '}
            — {crossFeatureDiametersMm!.length === 1 ? 'this feature is' : 'these features are'} OFF-AXIS
            (cross-drilled, a flat, or a drill breaking through the OD), so a turning path cannot produce
            {crossFeatureDiametersMm!.length === 1 ? ' it' : ' them'}. The quote carries a second-op setup for
            {crossFeatureDiametersMm!.length === 1 ? ' it' : ' them'} but <strong className="text-foreground">no
            cutting time</strong> — add the live-tooling time separately.
          </p>
        </div>
      )}
    </div>
  );
}
