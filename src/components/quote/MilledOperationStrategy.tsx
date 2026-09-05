import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, AlertTriangle, Crosshair, Play, Pause, ChevronLeft, ChevronRight, RotateCcw, Check } from 'lucide-react';
import {
  milledFeatureLayout,
  milledOpsFor,
  MilledCounts,
} from '../../utils/opRegions';

interface Props {
  stockMm: { x: number; y: number; z: number };
  counts: MilledCounts;
  removedVolumeCm3?: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const STEP_MS = 1500;

/**
 * "Where this op acts" for a MILLED part, as an interactive process walkthrough.
 * We know the feature counts from the geometry service but not their positions,
 * so this is an explicitly schematic plan + elevation of the billet. Step through
 * the operations (play / prev / next, or click a chip) and the view shades what
 * the current op touches, dims what's still to come, and marks what's already
 * machined — so you can read the process order, not an exact toolpath.
 */
export default function MilledOperationStrategy({ stockMm, counts, removedVolumeCm3 }: Props) {
  const ops = useMemo(() => milledOpsFor(counts), [counts]);
  const layout = useMemo(() => milledFeatureLayout(counts), [counts]);

  // curIdx: pinned step in the sequence (-1 = none). hoverIdx: transient preview.
  const [curIdx, setCurIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // Auto-advance while playing; stop at the last op.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCurIdx((i) => {
        const next = i + 1;
        if (next >= ops.length) {
          setPlaying(false);
          return ops.length - 1;
        }
        return next;
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, ops.length]);

  const displayIdx = hoverIdx !== null ? hoverIdx : curIdx;
  const active = displayIdx >= 0 ? ops[displayIdx] ?? null : null;
  const t = active?.touches ?? {};

  // Everything the ops *before* the displayed one already machined → "done".
  const doneKeys = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i < displayIdx; i++) {
      const tt = ops[i]?.touches ?? {};
      (Object.keys(tt) as (keyof typeof tt)[]).forEach((k) => tt[k] && s.add(k as string));
    }
    return s;
  }, [displayIdx, ops]);

  // --- View geometry (schematic; consistent x-scale across both views) ------
  const VIEW_W = 300;
  const PADX = 10;
  const innerW = VIEW_W - 2 * PADX;
  const pxPerMm = innerW / Math.max(1, stockMm.x);
  const planH = Math.min(200, Math.max(70, stockMm.y * pxPerMm));
  const elevH = Math.min(140, Math.max(44, stockMm.z * pxPerMm));

  // Concrete colours (not CSS vars): var() does not resolve in SVG presentation
  // attributes like fill=, so it silently falls back to solid black.
  const primary = '#2563eb';
  const doneCol = '#10b981';
  const border = 'rgba(100,116,139,0.75)';
  const muted = '#94a3b8';
  const stockFill = 'rgba(148,163,184,0.20)';
  const cavityFill = 'rgba(148,163,184,0.38)';
  const doneFill = 'rgba(16,185,129,0.16)';
  const HL = { pocket: 'rgba(37,99,235,0.22)', boss: 'rgba(37,99,235,0.32)', hole: 'rgba(37,99,235,0.5)', face: 'rgba(37,99,235,0.3)' };

  // State of a region keyed off the displayed op's `touches` + machined history.
  const on = (k: keyof typeof t) => !!t[k];
  const done = (k: keyof typeof t) => doneKeys.has(k as string) && !on(k);
  const opac = (k: keyof typeof t) => (!active ? 0.85 : on(k) ? 1 : done(k) ? 0.6 : 0.25);
  const stroke = (k: keyof typeof t) => (on(k) ? primary : done(k) ? doneCol : muted);
  const px = (nx: number) => PADX + nx * innerW;

  const atStart = curIdx <= 0;
  const atEnd = curIdx >= ops.length - 1;
  const go = (i: number) => {
    setPlaying(false);
    setCurIdx(Math.max(0, Math.min(ops.length - 1, i)));
  };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (curIdx >= ops.length - 1) setCurIdx(0); // restart from the top
    setPlaying(true);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
        <Boxes size={15} className="text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Milling Strategy</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          Schematic
        </span>
        {curIdx >= 0 && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">
            Step {curIdx + 1}/{ops.length}
          </span>
        )}
      </div>

      {/* Playback controls */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <button
          onClick={togglePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 transition-colors shrink-0"
          title={playing ? 'Pause' : 'Play the operation sequence'}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? 'Pause' : atEnd && curIdx >= 0 ? 'Replay' : 'Play sequence'}
        </button>
        <button
          onClick={() => go(curIdx < 0 ? 0 : curIdx - 1)}
          disabled={atStart}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Previous op"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={() => go(curIdx + 1)}
          disabled={atEnd}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Next op"
        >
          <ChevronRight size={15} />
        </button>
        {curIdx >= 0 && (
          <button
            onClick={() => { setPlaying(false); setCurIdx(-1); }}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors"
            title="Reset"
          >
            <RotateCcw size={14} />
          </button>
        )}
        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden ml-1">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${curIdx < 0 ? 0 : ((curIdx + 1) / ops.length) * 100}%` }}
          />
        </div>
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
            Press <strong className="text-foreground">Play</strong> to walk the operations in machining order, or hover a chip to preview
            {' '}<strong className="text-foreground">where it acts</strong> on the billet.
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
            {(on('perimeter') || done('perimeter') || !active) && (
              <rect
                x={px(0.05)} y={4 + planH * 0.06} width={innerW * 0.9} height={planH * 0.88}
                fill="none" stroke={stroke('perimeter')} strokeWidth={on('perimeter') ? 2 : 1}
                strokeDasharray="5 3" opacity={opac('perimeter')}
              />
            )}
            {/* Pockets */}
            {layout.pockets.map((p, i) => {
              const lit = on('pockets') || on('walls');
              const isDone = done('pockets') || done('walls');
              return (
                <rect
                  key={`pk${i}`}
                  x={px(p.x)} y={4 + p.y * planH} width={p.w * innerW} height={p.h * planH} rx={3}
                  fill={lit ? HL.pocket : isDone ? doneFill : cavityFill}
                  stroke={p.deep ? '#e11d48' : stroke('pockets')} strokeWidth={lit ? 1.8 : 1}
                  opacity={opac('pockets')}
                />
              );
            })}
            {/* Bosses (islands) */}
            {layout.bosses.map((b, i) => (
              <rect
                key={`bs${i}`}
                x={px(b.x)} y={4 + b.y * planH} width={b.w * innerW} height={Math.max(4, b.h * planH)} rx={2}
                fill={on('bosses') ? HL.boss : done('bosses') ? doneFill : stockFill}
                stroke={stroke('bosses')} strokeWidth={on('bosses') ? 1.5 : 0.8} opacity={opac('bosses')}
              />
            ))}
            {/* Holes */}
            {layout.holes.map((h, i) => (
              <circle
                key={`h${i}`}
                cx={px(h.x)} cy={4 + h.y * planH} r={Math.max(2.5, h.r * innerW)}
                fill={on('holes') ? HL.hole : done('holes') ? doneFill : cavityFill}
                stroke={stroke('holes')} strokeWidth={on('holes') ? 1.4 : 0.9} opacity={opac('holes')}
              />
            ))}
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
              fill={on('face') ? HL.face : done('face') ? doneFill : 'transparent'}
              stroke={stroke('face')} strokeWidth={on('face') ? 2 : 0.8}
              opacity={on('face') ? 1 : done('face') ? 0.7 : active ? 0.2 : 0.4}
            />
            {/* Pocket notches from the top */}
            {layout.pockets.map((p, i) => {
              const lit = on('pockets') || on('walls');
              const isDone = done('pockets') || done('walls');
              const w = p.w * innerW;
              const d = Math.max(6, p.depth * elevH);
              return (
                <rect
                  key={`pe${i}`}
                  x={px(p.x)} y={16} width={w} height={d}
                  fill={lit ? HL.pocket : isDone ? doneFill : cavityFill}
                  stroke={p.deep ? '#e11d48' : stroke('pockets')} strokeWidth={lit ? 1.6 : 1} opacity={opac('pockets')}
                />
              );
            })}
            {/* Holes: dashed through-lines */}
            {layout.holes.map((h, i) => (
              <line
                key={`he${i}`}
                x1={px(h.x)} y1={16} x2={px(h.x)} y2={16 + elevH}
                stroke={stroke('holes')} strokeWidth={on('holes') ? 1.6 : 0.7} strokeDasharray="3 2" opacity={opac('holes')}
              />
            ))}
            <text x={PADX} y={elevH + 32} fontSize={9} fill={muted}>
              thickness {r1(stockMm.z)} mm
            </text>
          </svg>
        </div>
      </div>

      {/* Op selector — click to jump, hover to preview */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5 border-t border-border">
        {ops.map((o, i) => {
          const isCurrent = curIdx === i;
          const isComplete = curIdx >= 0 && i < curIdx;
          return (
            <button
              key={o.op}
              onClick={() => go(isCurrent ? -1 : i)}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className={`flex items-center gap-1.5 text-left px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                isCurrent
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/40 text-foreground'
                  : isComplete
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-foreground'
                  : curIdx >= 0
                  ? 'border-border/50 opacity-60 hover:opacity-100 text-foreground'
                  : 'border-border bg-accent/30 hover:bg-accent/50 text-foreground'
              }`}
            >
              <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] shrink-0 ${
                isComplete ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {isComplete ? <Check size={10} /> : i + 1}
              </span>
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
          It shows the operation <strong className="text-foreground">order</strong> and which faces/features each one works, not an exact toolpath.
        </p>
      </div>
    </div>
  );
}
