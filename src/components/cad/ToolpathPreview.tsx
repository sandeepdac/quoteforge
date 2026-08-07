import React, { useMemo, useState } from 'react';
import { Download, Route, AlertTriangle } from 'lucide-react';
import { Toolpath, toGcode } from '../../utils/toolpath';

interface ToolpathPreviewProps {
  toolpath: Toolpath;
  partName?: string;
  materialName?: string;
}

const PAD = 30;
const DIM_BAND = 40; // room under the part for the length dimension
const SVG_W = 560;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A full longitudinal (Z–X) section of the estimated turning passes. Reference only. */
export default function ToolpathPreview({ toolpath: tp, partName, materialName }: ToolpathPreviewProps) {
  const [off, setOff] = useState<Record<string, boolean>>({});
  const isOn = (op: string) => !off[op];
  const toggle = (op: string) => setOff((s) => ({ ...s, [op]: !s[op] }));

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
          {/* Centreline (dash-dot) */}
          <line x1={PAD - 8} y1={midY} x2={SVG_W - PAD + 8} y2={midY} stroke={muted} strokeDasharray="8 3 2 3" strokeWidth={0.8} opacity={0.6} />

          {/* Passes — drawn on the operating (top) side for clarity */}
          {tp.passes.filter((p) => isOn(p.op)).map((pass, pi) => {
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
                  opacity={rapid ? 0.45 : 1}
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

      {/* Op legend / toggles with assumed cutter */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-border">
        {tp.passes.map((pass) => (
          <button
            key={pass.op}
            onClick={() => toggle(pass.op)}
            className={`flex items-start gap-2 text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
              isOn(pass.op) ? 'border-border bg-accent/30' : 'border-border/50 opacity-45'
            }`}
            title="Toggle this operation"
          >
            <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: pass.color }} />
            <span className="min-w-0">
              <span className="text-[11px] font-semibold text-foreground">
                {pass.label} <span className="text-muted-foreground font-normal">· T{String(pass.toolNo).padStart(2, '0')} · S{pass.rpm} · F{pass.feed}</span>
              </span>
              <span className="block text-[10px] text-muted-foreground truncate">{pass.tool}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="px-4 pb-3 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          A <strong className="text-foreground">reference</strong> path expanded from the estimate. The tooling above is a <strong className="text-foreground">generic assumption</strong>
          {' '}(standard OD insert, carbide drill, parting blade) with <strong className="text-foreground">no offsets, nose radius or holder</strong> defined — it is <strong className="text-foreground">not
          post-processed</strong> for any control and is <strong className="text-foreground">not a substitute for your CAM</strong> (SolidCAM). Verify everything before running; grooves and
          threads are quoted but not in this reference path.
        </p>
      </div>
    </div>
  );
}
