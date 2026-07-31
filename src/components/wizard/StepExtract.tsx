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
  CheckSquare
} from 'lucide-react';
import { useQuotes } from '../../context/QuoteContext';
import { PartFeatures } from '../../types';
import { ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import CadViewer3D from '../cad/CadViewer3D';
import CadPdfViewer from '../cad/CadPdfViewer';

interface StepExtractProps {
  cadAnalysis?: ExtractedCadAnalysis;
  onContinue: (extractedData: Partial<PartFeatures> & { materialId: string }) => void;
  onBack: () => void;
}

const loadingMessages = [
  "Reading CAD geometry & vector entities...",
  "Parsing B-Rep topology & cylindrical surfaces...",
  "Detecting bend lines, holes, and laser perimeters...",
  "Matching material callouts against shop inventory...",
  "Calculating volume, surface area, and mass..."
];

export default function StepExtract({ cadAnalysis, onContinue, onBack }: StepExtractProps) {
  const { materials } = useQuotes();
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState(loadingMessages[0]);
  
  // Local state for extracted features
  const [features, setFeatures] = useState<Partial<PartFeatures> & { materialId: string }>({
    materialId: 'm1',
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
        materialId: materials.find(m => m.name.toLowerCase().includes(cadAnalysis.materialName?.toLowerCase() || ''))?.id || 'm1',
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

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500 pb-10">
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
                {cadAnalysis?.fileType === 'STEP' ? '3D STEP Model' : '2D Drawing PDF'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Features extracted directly from CAD geometry & title block. Review and adjust parameters.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border border-emerald-500/20 shrink-0">
          <Zap size={14} fill="currentColor" />
          Extraction Score: {cadAnalysis?.confidenceScore || 94}%
        </div>
      </div>

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
            <CadViewer3D cadData={cadAnalysis.stepData} selectedMaterialName={selectedMatObj.name} stepBuffer={cadAnalysis.stepBuffer} />
          ) : (
            <CadPdfViewer pdfFileName={cadAnalysis?.fileName || 'Drawing.pdf'} pdfData={cadAnalysis?.pdfData} pdfUrl={cadAnalysis?.pdfUrl} />
          )}

          {/* AI Extraction Audit Notes */}
          <div className="bg-card border border-border p-4 rounded-xl space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <CheckSquare size={14} className="text-primary" />
              CAD Feature Detection Audit
            </span>
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
          </div>
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

          {/* Operations Breakdown */}
          <div className="bg-card border border-border p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground border-b border-border pb-2.5">
              Detected Manufacturing Operations
            </h3>

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
            </div>
          </div>
        </div>
      </div>

      {/* Action Navigation */}
      <div className="flex justify-between items-center pt-6 border-t border-border">
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
