import React, { useMemo, useState } from 'react';
import { Boxes, AlertTriangle, Crosshair } from 'lucide-react';
import {
  milledFeatureLayout,
  milledOpsFor,
  MilledCounts,
  MilledOp,
} from '../../utils/opRegions';

interface Props {
  stockMm: { x: number; y: number; z: number };
  counts: MilledCounts;
  removedVolumeCm3?: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * "Where this op acts" for a MILLED part. We know the feature counts from the
 * geometry service but not their positions, so this is an explicitly schematic
 * plan + elevation of the billet: pick an operation and it shades what that op
 * touches (top face, perimeter/pocket volume, walls, or holes).
 */
export default function MilledOperationStrategy({ stockMm, counts, removedVolumeCm3 }: Props) {
  const ops = useMemo(() => milledOpsFor(counts), [counts]);
  const layout = useMemo(() => milledFeatureLayout(counts), [counts]);
  const [focus, setFocus] = useState<MilledOp | null>(null);
  const active = focus ? ops.find((o) => o.op === focus) ?? null : null;
  const t = active?.touches ?? {};

  // --- View geometry (schematic; consistent x-scale across both views) ------
  const VIEW_W = 300;
  const PADX = 10;
  const innerW = VIEW_W - 2 * PADX;
  const pxPerMm = innerW / Math.max(1, stockMm.x);
  const planH = Math.min(200, Math.max(70, stockMm.y * pxPerMm));
  const elevH = Math.min(140, Math.max(44, stockMm.z * pxPerMm));

  const primary = 'hsl(var(--primary))';
  const border = 'hsl(var(--border))';
  const muted = 'hsl(var(--muted-foreground))';
  const stockFill = 'hsl(var(--muted-foreground) / 0.12)';
  const cavityFill = 'hsl(var(--card))';

  // Emphasis helpers keyed off the focused op's `touches`.
  const on = (k: keyof typeof t) => !!t[k];
  const dim = (lit: boolean) => (focus ? (lit ? 1 : 0.28) : 0.85);
  const hi = (lit: boolean) => (lit ? primary : muted);

  const px = (nx: number) => PADX + nx * innerW;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
        <Boxes size={15} className="text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Milling Strategy</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          Schematic
        </span>
      </div>

      {/* Focus caption */}
      <div className="px-4 py-2 border-b border-border bg-primary/5 flex items-start gap-2 min-h-[2.4rem]">
        <Crosshair size={13} className="text-primary shrink-0 mt-0.5" />
        {active ? (
          <p className="text-[11px] text-foreground leading-snug">
            <span className="font-semibold">{active.label}:</span>{' '}
            <span className="text-muted-foreground">{active.description(counts, removedVolumeCm3)}</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Select an operation below to highlight <strong className="text-foreground">where it acts</strong> on the billet.
          </p>
        )}
      </div>

      {/* Plan + elevation schematic */}
      <div className="p-3 bg-muted/10 flex flex-wrap gap-4 justify-center">
        {/* Plan (top-down) */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1 text-center">TOP (plan)</p>
          <svg width={VIEW_W} height={planH + 22} role="img" aria-label="Milled part plan view">
            {/* Stock footprint */}
            <rect x={PADX} y={4} width={innerW} height={planH} fill={stockFill} stroke={border} strokeWidth={1.2} />
            {/* Roughing perimeter ring */}
            {(on('perimeter') || !focus) && (
              <rect
                x={px(0.05)} y={4 + planH * 0.06} width={innerW * 0.9} height={planH * 0.88}
                fill="none" stroke={hi(on('perimeter'))} strokeWidth={on('perimeter') ? 2 : 1}
                strokeDasharray="5 3" opacity={dim(on('perimeter'))}
              />
            )}
            {/* Pockets */}
            {layout.pockets.map((p, i) => {
              const lit = on('pockets') || on('walls');
              return (
                <rect
                  key={`pk${i}`}
                  x={px(p.x)} y={4 + p.y * planH} width={p.w * innerW} height={p.h * planH} rx={3}
                  fill={on('pockets') ? 'hsl(var(--primary) / 0.18)' : cavityFill}
                  stroke={p.deep ? '#e11d48' : hi(lit)} strokeWidth={lit ? 1.8 : 1}
                  opacity={dim(lit)}
                />
              );
            })}
            {/* Bosses (islands) */}
            {layout.bosses.map((b, i) => {
              const lit = on('bosses');
              return (
                <rect
                  key={`bs${i}`}
                  x={px(b.x)} y={4 + b.y * planH} width={b.w * innerW} height={Math.max(4, b.h * planH)} rx={2}
                  fill={lit ? 'hsl(var(--primary) / 0.25)' : stockFill}
                  stroke={hi(lit)} strokeWidth={lit ? 1.5 : 0.8} opacity={dim(lit)}
                />
              );
            })}
            {/* Holes */}
            {layout.holes.map((h, i) => {
              const lit = on('holes');
              return (
                <circle
                  key={`h${i}`}
                  cx={px(h.x)} cy={4 + h.y * planH} r={Math.max(2.5, h.r * innerW)}
                  fill={lit ? 'hsl(var(--primary) / 0.35)' : cavityFill}
                  stroke={hi(lit)} strokeWidth={lit ? 1.4 : 0.9} opacity={dim(lit)}
                />
              );
            })}
            {layout.hiddenHoles > 0 && (
              <text x={VIEW_W - PADX} y={planH + 16} fontSize={9} fill={muted} textAnchor="end">
                +{layout.hiddenHoles} more holes
              </text>
            )}
            <text x={PADX} y={planH + 16} fontSize={9} fill={muted}>
              {r1(stockMm.x)} × {r1(stockMm.y)} mm
            </text>
          </svg>
        </div>

        {/* Elevation (front) */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1 text-center">FRONT (elevation)</p>
          <svg width={VIEW_W} height={elevH + 22} role="img" aria-label="Milled part elevation view">
            {/* Stock */}
            <rect x={PADX} y={16} width={innerW} height={elevH} fill={stockFill} stroke={border} strokeWidth={1.2} />
            {/* Facing: top face band */}
            <rect
              x={PADX} y={16} width={innerW} height={Math.max(4, elevH * 0.08)}
              fill={on('face') ? 'hsl(var(--primary) / 0.3)' : 'transparent'}
              stroke={hi(on('face'))} strokeWidth={on('face') ? 2 : 0.8}
              opacity={on('face') ? 1 : focus ? 0.2 : 0.4}
            />
            {/* Pocket notches from the top */}
            {layout.pockets.map((p, i) => {
              const lit = on('pockets') || on('walls');
              const w = p.w * innerW;
              const d = Math.max(6, p.depth * elevH);
              return (
                <rect
                  key={`pe${i}`}
                  x={px(p.x)} y={16} width={w} height={d}
                  fill={on('pockets') ? 'hsl(var(--primary) / 0.18)' : cavityFill}
                  stroke={p.deep ? '#e11d48' : hi(lit)} strokeWidth={lit ? 1.6 : 1} opacity={dim(lit)}
                />
              );
            })}
            {/* Holes: dashed through-lines */}
            {layout.holes.map((h, i) => {
              const lit = on('holes');
              return (
                <line
                  key={`he${i}`}
                  x1={px(h.x)} y1={16} x2={px(h.x)} y2={16 + elevH}
                  stroke={hi(lit)} strokeWidth={lit ? 1.6 : 0.7} strokeDasharray="3 2" opacity={dim(lit)}
                />
              );
            })}
            <text x={PADX} y={elevH + 32} fontSize={9} fill={muted}>
              thickness {r1(stockMm.z)} mm
            </text>
          </svg>
        </div>
      </div>

      {/* Op selector */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5 border-t border-border">
        {ops.map((o) => {
          const isFocused = focus === o.op;
          return (
            <button
              key={o.op}
              onClick={() => setFocus((cur) => (cur === o.op ? null : o.op))}
              className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                isFocused
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/40 text-foreground'
                  : focus
                  ? 'border-border/50 opacity-60 hover:opacity-100 text-foreground'
                  : 'border-border bg-accent/30 hover:bg-accent/50 text-foreground'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-3 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          A <strong className="text-foreground">schematic</strong>: the feature <em>counts</em> are measured from your model, but their
          <strong className="text-foreground"> positions here are illustrative</strong> — the real layout comes from your CAM (SolidWorks/SolidCAM).
          It shows which faces and features each operation works, not an exact toolpath.
        </p>
      </div>
    </div>
  );
}
