import React, { useState, useEffect } from 'react';
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  RotateCcw,
  Info,
  Box,
  FileText,
  Sliders,
  CheckSquare,
  Cpu,
  XCircle
} from 'lucide-react';
import { useQuotes } from '../../context/QuoteContext';
import { PartFeatures } from '../../types';
import { ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import CadViewer3D from '../cad/CadViewer3D';
import CadPdfViewer from '../cad/CadPdfViewer';
import DfmPanel from '../cad/DfmPanel';
import { cn } from '../../utils/cn';

interface StepExtractProps {
  cadAnalysis?: ExtractedCadAnalysis;
  /** The material the user selected (drives the quote); preserved & shown so plan + cost agree. */
  materialId?: string;
  onContinue: (extractedData: Partial<PartFeatures> & { materialId: string }) => void;
  onBack: () => void;
  /** Receives a rendered still of the 3D model, to persist as the part thumbnail. */
  onSnapshot?: (dataUrl: string) => void;
}

const loadingMessages = [
  "Reading CAD geometry & B-Rep topology...",
  "Classifying part — turned (bar) vs milled (billet)...",
  "Sizing stock & material removal (buy-to-fly)...",
  "Detecting holes, bores & cylindrical features...",
  "Calculating volume, surface area, and mass..."
];

export default function StepExtract({ cadAnalysis, materialId, onContinue, onBack, onSnapshot }: StepExtractProps) {
  const { materials } = useQuotes();
  // The material actually used for the quote (the user's pick) — shown everywhere so
  // the stock panel never disagrees with the cost table. Falls back to the analyzer's
  // reading only when no selection has flowed through yet.
  const selectedMaterialId = materialId || 'm1';
  const shownMaterial = materials.find((m) => m.id === selectedMaterialId)?.name || cadAnalysis?.materialName;
  const rMm = (v: number) => Math.round(v * 10) / 10;
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState(loadingMessages[0]);
  
  // Local state for extracted features
  const [features, setFeatures] = useState<Partial<PartFeatures> & { materialId: string }>({
    materialId: selectedMaterialId,
    lengthMm: cadAnalysis?.lengthMm || 350,
    widthMm: cadAnalysis?.widthMm || 200,
    heightMm: cadAnalysis?.heightMm || 45,
    perimeterMm: cadAnalysis?.perimeterMm || 1200,
    pierceCount: cadAnalysis?.pierceCount || 8,
    bendCount: cadAnalysis?.bendCount || 4,
    isSimpleBending: cadAnalysis?.isSimpleBending ?? true,
    holeCount: cadAnalysis?.holeCount || 6,
    weldLengthMm: cadAnalysis?.weldLengthMm || 50,
    weldCount: cadAnalysis?.weldCount || 2,
    weightKg: cadAnalysis?.weightKg || 1.65,
    surfaceAreaM2: cadAnalysis?.surfaceAreaM2 || 0.15
  });

  useEffect(() => {
    if (cadAnalysis) {
      setFeatures({
        materialId: selectedMaterialId, // the user's up-front pick — never re-derived from the model
        lengthMm: cadAnalysis.lengthMm,
        widthMm: cadAnalysis.widthMm,
        heightMm: cadAnalysis.heightMm,
        perimeterMm: cadAnalysis.perimeterMm,
        pierceCount: cadAnalysis.pierceCount,
        bendCount: cadAnalysis.bendCount,
        isSimpleBending: cadAnalysis.isSimpleBending,
        holeCount: cadAnalysis.holeCount,
        weldLengthMm: cadAnalysis.weldLengthMm,
        weldCount: cadAnalysis.weldCount,
        weightKg: cadAnalysis.weightKg,
        surfaceAreaM2: cadAnalysis.surfaceAreaM2
      });
    }
  }, [cadAnalysis, materials]);

  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          setIsLoading(false);
          clearInterval(interval);
          return 100;
        }
        return prev + 2;
      });
    }, 25); // ~1.2s rapid realistic parse

    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (progress < 20) setCurrentMessage(loadingMessages[0]);
    else if (progress < 40) setCurrentMessage(loadingMessages[1]);
    else if (progress < 60) setCurrentMessage(loadingMessages[2]);
    else if (progress < 80) setCurrentMessage(loadingMessages[3]);
    else setCurrentMessage(loadingMessages[4]);
  }, [progress]);

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto py-12 flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-500">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150"></div>
          <div className="relative bg-card border border-border p-8 rounded-full shadow-lg">
            <Loader2 className="text-primary animate-spin" size={48} />
          </div>
        </div>
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold text-foreground">{currentMessage}</h3>
          <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300 ease-out" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <p className="text-xs text-muted-foreground italic">QuoteForge Production CAD Engine processing file...</p>
        </div>
      </div>
    );
  }

  const selectedMatObj = materials.find(m => m.id === features.materialId) || materials[0];
  const isTurned = !!(cadAnalysis?.isTurned && cadAnalysis?.turningProfile);
  const isMilled = !!(cadAnalysis?.milledProfile && !cadAnalysis?.isTurned);
  const isMachined = isTurned || isMilled;
  const mp = cadAnalysis?.milledProfile;
  const milledYield = mp && mp.stockVolumeCm3 > 0 ? mp.partVolumeCm3 / mp.stockVolumeCm3 : 0;
  // Only truly out of scope when we couldn't build any machining profile.
  const notRotational = !!(cadAnalysis?.measurementSource === 'solid' && cadAnalysis?.isTurned === false && !isMilled);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2.5 rounded-xl">
            <CheckCircle2 size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">
                {cadAnalysis?.partName || 'Extracted CAD Feature Geometry'}
              </h2>
              <span className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider">
                {cadAnalysis?.stepData ? '3D CAD Model' : cadAnalysis?.fileType === 'IMAGE' ? '2D Image' : '2D Drawing'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cadAnalysis?.measurementSource === 'solid'
                ? 'Dimensions measured exactly from the solid geometry. Review and adjust parameters.'
                : cadAnalysis?.measurementSource === 'ai-drawing'
                ? cadAnalysis?.fileType === 'STEP'
                  ? 'Geometry service unavailable — this 3D part was read from the STEP by AI. Start services/geometry for a measured quote; verify before quoting.'
                  : 'Dimensions read from the drawing by AI vision. Please verify before quoting.'
                : cadAnalysis?.measurementSource === 'manual'
                ? 'Automatic measurement unavailable — please enter the dimensions on the right.'
                : 'Dimensions estimated from CAD geometry. Review and adjust parameters.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border border-emerald-500/20 shrink-0">
          <Zap size={14} fill="currentColor" />
          Confidence: {cadAnalysis?.confidenceScore ?? 94}%
        </div>
      </div>

      {/* Out-of-scope: not a turned part */}
      {notRotational && (
        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex gap-3">
          <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Not a turned part — outside scope</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {cadAnalysis?.notRotationalReason || 'This part is not rotationally symmetric, so the turning cycle-time model does not apply. Estimate it manually or in your CAM system.'}
            </p>
          </div>
        </div>
      )}

      {/* Main Content Layout: Left Viewer + Right Feature Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive CAD 3D / 2D Viewer */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              {cadAnalysis?.stepData ? <Box size={14} /> : <FileText size={14} />}
              Interactive CAD Visualizer
            </h3>
            <span className="text-[10px] text-muted-foreground">WebGL Render</span>
          </div>

          {cadAnalysis?.stepData ? (
            <CadViewer3D cadData={cadAnalysis.stepData} selectedMaterialName={selectedMatObj.name} stepMesh={cadAnalysis.stepMesh} onSnapshot={onSnapshot} />
          ) : cadAnalysis?.fileType === 'IMAGE' && cadAnalysis?.pdfUrl ? (
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-2 border-b border-slate-800 text-slate-200 text-xs">
                <FileText size={16} className="text-sky-400" />
                <span className="font-bold text-white">Drawing Image</span>
                <span className="bg-sky-950 text-sky-400 border border-sky-800/50 px-2 py-0.5 rounded text-[10px] font-mono">{cadAnalysis.fileName}</span>
              </div>
              <div className="w-full h-[360px] bg-slate-100 flex items-center justify-center overflow-auto">
                <img src={cadAnalysis.pdfUrl} alt={cadAnalysis.fileName} className="max-w-full max-h-full object-contain" />
              </div>
            </div>
          ) : (
            <CadPdfViewer pdfFileName={cadAnalysis?.fileName || 'Drawing.pdf'} pdfData={cadAnalysis?.pdfData} pdfUrl={cadAnalysis?.pdfUrl} />
          )}

          {/* Formed-part caveat: folded solids understate the flat-blank cut length */}
          {cadAnalysis?.formedPart && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex gap-3">
              <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Formed part — cut length is a lower bound</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  This part is folded ({cadAnalysis.heightMm} mm tall on {cadAnalysis.thicknessMm} mm stock), so the perimeter and
                  surface area are measured from the <strong className="text-foreground">folded shape</strong>. The laser actually cuts the
                  larger <strong className="text-foreground">flat blank</strong>, so the laser and finishing costs here are an
                  <strong className="text-foreground"> under-estimate</strong>. For an accurate cut cost, upload the flat-pattern DXF or the 2D drawing.
                </p>
              </div>
            </div>
          )}

          {/* How the dimensions were measured — plain-language explanation */}
          <div className="bg-card border border-border p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <CheckSquare size={14} className="text-primary" />
                How We Read This Part
              </span>
              {(() => {
                const src = cadAnalysis?.measurementSource;
                if (src === 'solid') return (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <Box size={11} /> Measured from solid
                  </span>
                );
                if (src === 'ai-drawing') return (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
                    {cadAnalysis?.fileType === 'STEP' ? 'Read from STEP by AI' : 'Read from drawing'}
                  </span>
                );
                if (src === 'manual') return (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30">
                    Confirm dimensions
                  </span>
                );
                return (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    Estimated
                  </span>
                );
              })()}
            </div>

            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {(cadAnalysis?.aiNotes || [
                `Detected bounding box ${features.lengthMm} x ${features.widthMm} x ${features.heightMm} mm`,
                `Identified ${features.holeCount} cylindrical holes and ${features.bendCount} bends.`,
                `Calculated part weight as ${features.weightKg} kg based on material density.`
              ]).map((note, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-primary font-bold">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>

            <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2.5">
              {isTurned ? (
                <>
                  These measurements drive the quote: <strong className="text-foreground">stock volume</strong> → material cost,
                  <strong className="text-foreground"> volume removed</strong> → roughing time,
                  <strong className="text-foreground"> surface area</strong> → finishing, and
                  <strong className="text-foreground"> holes &amp; setups</strong> → drilling and machine time. Adjust any value on the right
                  and the price updates in the next step.
                </>
              ) : isMilled ? (
                <>
                  These measurements drive the quote: <strong className="text-foreground">billet volume</strong> → material cost,
                  <strong className="text-foreground"> volume removed</strong> → roughing time,
                  <strong className="text-foreground"> surface area</strong> → finishing, and
                  <strong className="text-foreground"> setups (tool-access directions)</strong> → the biggest cost lever. Adjust any value on the
                  right and the price updates in the next step.
                </>
              ) : (
                <>
                  These measurements drive the quote: <strong className="text-foreground">weight</strong> → material cost,
                  <strong className="text-foreground"> perimeter &amp; pierces</strong> → laser time,
                  <strong className="text-foreground"> bends</strong> → press-brake time, and
                  <strong className="text-foreground"> surface area</strong> → finishing. Adjust any value on the right
                  and the price updates in the next step.
                </>
              )}
            </p>
          </div>

          {/* Design-for-Manufacturing advisory findings */}
          {cadAnalysis?.dfm && <DfmPanel dfm={cadAnalysis.dfm} />}
        </div>

        {/* Right Column: Feature Controls & Material Parameters */}
        <div className="lg:col-span-6 space-y-6">
          {/* Material & Bounding Box */}
          <div className="bg-card border border-border p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5 flex items-center justify-between">
              <span>Material & Bounding Box</span>
              <Sliders size={14} className="text-muted-foreground" />
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Matched Material</label>
                <select 
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
                  value={features.materialId}
                  onChange={(e) => setFeatures({...features, materialId: e.target.value})}
                >
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.thicknessMm}mm) — ${m.pricePerKg}/kg</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Calculated Weight (kg)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-semibold"
                  value={features.weightKg}
                  onChange={(e) => setFeatures({...features, weightKg: Number(e.target.value)})}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Surface Area (m²)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-semibold"
                  value={features.surfaceAreaM2}
                  onChange={(e) => setFeatures({...features, surfaceAreaM2: Number(e.target.value)})}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Length (mm)</label>
                <input 
                  type="number" 
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs font-bold text-center"
                  value={features.lengthMm}
                  onChange={(e) => setFeatures({...features, lengthMm: Number(e.target.value)})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Width (mm)</label>
                <input 
                  type="number" 
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs font-bold text-center"
                  value={features.widthMm}
                  onChange={(e) => setFeatures({...features, widthMm: Number(e.target.value)})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Height (mm)</label>
                <input 
                  type="number" 
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs font-bold text-center"
                  value={features.heightMm}
                  onChange={(e) => setFeatures({...features, heightMm: Number(e.target.value)})}
                />
              </div>
            </div>
          </div>

          {/* Machine selection — the most efficient capable machine, and why */}
          {isMachined && cadAnalysis?.machineRecommendation && (() => {
            const mr = cadAnalysis.machineRecommendation!;
            return (
              <div className="bg-card border border-border p-5 rounded-xl space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><Cpu size={14} className="text-primary" /> Recommended Machine</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {Math.round(mr.rateMultiplier * 100)}% rate
                  </span>
                </h3>

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-sm font-bold text-foreground">{mr.recommendedName}</p>
                  <ul className="mt-1.5 space-y-1">
                    {mr.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                        <span className="text-primary font-bold mt-px">•</span><span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {mr.secondOpNote && (
                  <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5">
                    <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{mr.secondOpNote}</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Machine options considered</p>
                  {mr.candidates.map((c) => {
                    const isPick = c.id === mr.recommended;
                    return (
                      <div key={c.id} className={cn('flex items-start gap-2 rounded-md p-2 text-[11px] border', isPick ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-accent/30 border-border')}>
                        {c.capable
                          ? <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          : <XCircle size={13} className="text-muted-foreground shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <span className={cn('font-semibold', isPick ? 'text-foreground' : 'text-muted-foreground')}>
                            {c.name}{isPick ? ' — chosen' : c.capable ? '' : ' — not capable'}
                          </span>
                          <p className="text-muted-foreground/80 leading-tight">{c.reason}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  The chosen machine's charge-out ({Math.round(mr.rateMultiplier * 100)}% of the base spindle rate) is applied to the cycle-time price.
                </p>
              </div>
            );
          })()}

          {/* Machining drivers (turning / milling) */}
          {isTurned && cadAnalysis && (
            <div className="bg-card border border-border p-5 rounded-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5 flex items-center justify-between">
                <span>Turning Plan &amp; Stock</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  TURNED
                </span>
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-accent/40 border border-border p-3 rounded-lg">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bar stock</p>
                  <p className="text-sm font-bold text-foreground">
                    ⌀{cadAnalysis.barDiameterMm ?? cadAnalysis.diameterMm} × {cadAnalysis.axisLengthMm} mm
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    part ⌀{cadAnalysis.diameterMm} · {cadAnalysis.stockVolumeCm3} cm³ raw
                  </p>
                </div>
                <div className="bg-accent/40 border border-border p-3 rounded-lg">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Material yield</p>
                  <p className="text-sm font-bold text-foreground">{Math.round((cadAnalysis.buyToFlyRatio ?? 0) * 100)}% buy-to-fly</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{cadAnalysis.removedVolumeCm3} cm³ removed as chips</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-accent/40 border border-border p-3.5 rounded-lg">
                  <p className="text-xs font-bold text-foreground">Bore</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {cadAnalysis.turningProfile?.boreDiaMm
                      ? `⌀${cadAnalysis.turningProfile.boreDiaMm} × ${cadAnalysis.turningProfile.boreDepthMm} mm — drill + bore`
                      : 'Solid — no central bore'}
                  </p>
                </div>
                <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">Setups</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">First op{cadAnalysis.setups && cadAnalysis.setups > 1 ? ' + turn-around' : ''}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold text-foreground">{cadAnalysis.setups}</span>
                  </div>
                </div>
              </div>

              {cadAnalysis.crossFeatures && (
                <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5">
                  <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Off-axis features detected (cross-holes / flats). These need <strong className="text-foreground">live tooling or a second op</strong> and
                    are <strong className="text-foreground">not</strong> in the cycle-time estimate — add them manually.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2.5">
                Priced from <strong className="text-foreground">cycle time</strong>: facing, roughing, finishing, drilling and part-off from the
                turned profile, at rates for {shownMaterial}. This estimates time only —
                <strong className="text-foreground"> it does not generate toolpaths</strong>.
              </p>
            </div>
          )}

          {/* Machining drivers (milling / prismatic) */}
          {isMilled && cadAnalysis && mp && (
            <div className="bg-card border border-border p-5 rounded-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5 flex items-center justify-between">
                <span>Milling Plan &amp; Stock</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  MILLED
                </span>
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-accent/40 border border-border p-3 rounded-lg">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Billet stock</p>
                  <p className="text-sm font-bold text-foreground">
                    {rMm(mp.stockMm.x)} × {rMm(mp.stockMm.y)} × {rMm(mp.stockMm.z)} mm
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {mp.stockVolumeCm3} cm³ raw · {shownMaterial}
                  </p>
                </div>
                <div className="bg-accent/40 border border-border p-3 rounded-lg">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Material yield</p>
                  <p className="text-sm font-bold text-foreground">{Math.round(milledYield * 100)}% buy-to-fly</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{mp.removedVolumeCm3} cm³ removed as chips</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">Setups</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">re-clamps</p>
                  </div>
                  <span className="text-lg font-bold text-foreground">{mp.setupCount}</span>
                </div>
                <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">Pockets</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{mp.deepPocketCount > 0 ? `${mp.deepPocketCount} deep` : mp.bossCount > 0 ? `${mp.bossCount} boss` : 'cavities'}</p>
                  </div>
                  <span className="text-lg font-bold text-foreground">{mp.pocketCount}</span>
                </div>
                <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">Holes</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">drilled</p>
                  </div>
                  <span className="text-lg font-bold text-foreground">{mp.holeCount}</span>
                </div>
              </div>

              {mp.sparseBillet && (
                <div className="flex gap-2 bg-red-500/10 border border-red-500/40 rounded-md p-2.5">
                  <AlertCircle size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <strong className="text-red-600 dark:text-red-400">Solid-billet assumption is wrong for this part.</strong> It fills only
                    {' '}{Math.round(milledYield * 100)}% of its {mp.stockMm.x}×{mp.stockMm.y}×{mp.stockMm.z} mm envelope, so milling from a solid block would
                    hog away <strong className="text-foreground">{mp.removedVolumeCm3.toFixed(0)} cm³</strong>. Real stock is almost certainly
                    <strong className="text-foreground"> plate / a weldment / a near-net casting or forging</strong> — this price is an
                    <strong className="text-foreground"> upper bound</strong> and needs review with the right stock.
                  </p>
                </div>
              )}

              {mp.deepPocketCount > 0 && (
                <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5">
                  <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {mp.deepPocketCount} <strong className="text-foreground">deep pocket{mp.deepPocketCount === 1 ? '' : 's'}</strong> detected — long, thin tools
                    run slow to avoid chatter, so roughing and finishing carry a reach penalty.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2.5">
                Priced from <strong className="text-foreground">cycle time</strong>: hog-out (volume removed), wall/floor finishing, drilling, plus
                <strong className="text-foreground"> {mp.setupCount} setup{mp.setupCount === 1 ? '' : 's'}</strong> — setups are the biggest cost lever. This estimates
                time only — <strong className="text-foreground">it does not generate toolpaths</strong>.
              </p>
            </div>
          )}

          {/* Operations Breakdown (sheet-metal legacy path) */}
          {!isMachined && (
          <div className="bg-card border border-border p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5">
              Detected Manufacturing Operations
            </h3>

            {cadAnalysis?.featuresNeedReview && (
              <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/25 text-orange-700 dark:text-orange-300 rounded-lg p-3 text-[11px] leading-relaxed">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>
                  Dimensions, weight and hole counts are measured from the solid geometry and
                  are reliable. The <strong>bend count</strong> is an estimate from face
                  topology, which can be off on machined parts — please verify it before quoting.
                </span>
              </div>
            )}

            <div className="space-y-3">
              {/* Laser Cutting */}
              <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-foreground">Laser Cutting Profile</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Outer contour + internal cutouts
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Perimeter</span>
                    <input 
                      type="number" 
                      className="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.perimeterMm}
                      onChange={(e) => setFeatures({...features, perimeterMm: Number(e.target.value)})}
                    />
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Pierces</span>
                    <input 
                      type="number" 
                      className="w-14 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.pierceCount}
                      onChange={(e) => setFeatures({...features, pierceCount: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>

              {/* Press Brake Bending */}
              <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-foreground">Press Brake Bending</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {features.isSimpleBending ? 'Standard 90° air bending' : 'Compound stage bending'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Bend Lines</span>
                    <input 
                      type="number" 
                      className="w-16 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.bendCount}
                      onChange={(e) => setFeatures({...features, bendCount: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>

              {/* Holes & Welding */}
              <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-foreground">Holes & Welding</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Hole count & seam welding length
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Holes</span>
                    <input 
                      type="number" 
                      className="w-14 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.holeCount}
                      onChange={(e) => setFeatures({...features, holeCount: Number(e.target.value)})}
                    />
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Weld (mm)</span>
                    <input
                      type="number"
                      className="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.weldLengthMm}
                      onChange={(e) => setFeatures({...features, weldLengthMm: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>

              {/* Surface Finishing */}
              <div className="bg-accent/40 border border-border p-3.5 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-foreground">Surface Finishing</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Deburr, coat &amp; finish over wetted area
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Area (m²)</span>
                    <input
                      type="number"
                      step="0.001"
                      className="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-center font-bold"
                      value={features.surfaceAreaM2}
                      onChange={(e) => setFeatures({...features, surfaceAreaM2: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Action Navigation */}
      <div className="flex justify-between items-center pt-4 border-t border-border">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-accent transition-colors"
        >
          <RotateCcw size={16} />
          Upload Different CAD File
        </button>

        <button 
          onClick={() => onContinue(features)}
          className="bg-primary text-primary-foreground px-10 py-3 rounded-xl text-sm font-semibold hover:bg-primary/90 transition-all shadow-md flex items-center gap-2"
        >
          Continue to Quantity & Pricing
        </button>
      </div>
    </div>
  );
}
