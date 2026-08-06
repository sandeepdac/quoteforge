import React, { useMemo, useState } from 'react';
import { Download, Play, Pause, Route, AlertTriangle } from 'lucide-react';
import { Toolpath, toGcode, TPMove } from '../../utils/toolpath';

interface ToolpathPreviewProps {
  toolpath: Toolpath;
  partName?: string;
  materialName?: string;
}

const PAD = 34;
const SVG_W = 560;

/** A longitudinal (Z–X) section of the estimated turning passes. Reference only. */
export default function ToolpathPreview({ toolpath: tp, partName, materialName }: ToolpathPreviewProps) {
  const [activeOps, setActiveOps] = useState<Record<string, boolean>>({});

  const { scale, X, Y, svgH, stockR } = useMemo(() => {
    const totalZ = tp.stockLengthMm; // clearance + length
    const stockRadius = tp.stockDiaMm / 2;
    const s = (SVG_W - 2 * PAD) / Math.max(1, totalZ);
    const h = PAD * 2 + stockRadius * s + 20;
    const baseY = h - PAD;
    return {
      scale: s,
      stockR: stockRadius,
      svgH: h,
      X: (z: number) => PAD + (z + tp.lengthMm) * s,
      Y: (r: number) => baseY - Math.max(0, r) * s,
    };
  }, [tp]);

  const isOn = (op: string) => activeOps[op] !== false; // default all on
  const toggle = (op: string) => setActiveOps((s) => ({ ...s, [op]: !isOn(op) }));

  const moveLine = (moves: TPMove[]) =>
    moves.map((mv) => `${X(mv.z)},${Y(mv.x / 2)}`).join(' ');

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

      {/* Longitudinal section */}
      <div className="p-3 overflow-x-auto bg-slate-950/40">
        <svg width={SVG_W} height={svgH} className="max-w-full" role="img" aria-label="Turning toolpath section">
          {/* Stock envelope (dashed) */}
          <rect
            x={X(0)} y={Y(stockR)} width={Math.max(1, X(0) - X(-tp.lengthMm))} height={stockR * scale}
            fill="none" stroke="#64748b" strokeDasharray="4 3" strokeWidth={1}
          />
          {/* Finished part body */}
          <rect
            x={X(-tp.lengthMm)} y={Y(tp.partOdMm / 2)} width={Math.max(1, X(0) - X(-tp.lengthMm))} height={(tp.partOdMm / 2) * scale}
            fill="#1e293b" stroke="#334155" strokeWidth={1}
          />
          {/* Bore (air) */}
          {tp.boreDiaMm > 0 && (
            <rect
              x={X(-tp.boreDepthMm)} y={Y(tp.boreDiaMm / 2)} width={Math.max(1, X(0) - X(-tp.boreDepthMm))} height={(tp.boreDiaMm / 2) * scale}
              fill="#0b1220" stroke="#8b5cf6" strokeDasharray="2 2" strokeWidth={0.8}
            />
          )}
          {/* Centreline */}
          <line x1={PAD} y1={Y(0)} x2={SVG_W - PAD} y2={Y(0)} stroke="#334155" strokeDasharray="6 4" strokeWidth={0.8} />

          {/* Passes */}
          {tp.passes.filter((p) => isOn(p.op)).map((pass, pi) => (
            <g key={pi}>
              {/* feed moves solid; rapids faint dashed */}
              {(() => {
                // Split into feed vs rapid segments for styling.
                const segs: React.ReactElement[] = [];
                for (let i = 1; i < pass.moves.length; i++) {
                  const a = pass.moves[i - 1], b = pass.moves[i];
                  segs.push(
                    <line
                      key={i}
                      x1={X(a.z)} y1={Y(a.x / 2)} x2={X(b.z)} y2={Y(b.x / 2)}
                      stroke={b.rapid ? '#475569' : pass.color}
                      strokeWidth={b.rapid ? 0.8 : 1.6}
                      strokeDasharray={b.rapid ? '3 3' : undefined}
                      opacity={b.rapid ? 0.7 : 1}
                    />
                  );
                }
                return segs;
              })()}
            </g>
          ))}

          {/* Axis hint */}
          <text x={SVG_W - PAD} y={Y(0) + 14} fontSize={9} fill="#64748b" textAnchor="end">Z →</text>
          <text x={PAD - 6} y={Y(stockR) - 4} fontSize={9} fill="#64748b">⌀</text>
        </svg>
      </div>

      {/* Op legend / toggles */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-t border-border">
        {tp.passes.map((pass) => (
          <button
            key={pass.op}
            onClick={() => toggle(pass.op)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              isOn(pass.op) ? 'border-border bg-accent/40 text-foreground' : 'border-border/60 text-muted-foreground/50 line-through'
            }`}
            title="Toggle this operation"
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pass.color }} />
            {pass.label} <span className="text-muted-foreground">· S{pass.rpm} · F{pass.feed}</span>
          </button>
        ))}
      </div>

      <div className="px-4 pb-3 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          A <strong className="text-foreground">reference</strong> path expanded from the estimate — facing, roughing, drilling, finishing and part-off with
          real diameters, feeds and speeds. It is <strong className="text-foreground">not post-processed</strong> for any control and is <strong className="text-foreground">not a
          substitute for your CAM</strong> (SolidCAM). Verify everything before running; grooves/threads are quoted but not in this reference path.
        </p>
      </div>
    </div>
  );
}
