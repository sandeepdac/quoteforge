import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  File, 
  X, 
  Info, 
  Box, 
  FileText, 
  Sparkles, 
  CheckCircle2, 
  ArrowRight,
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { analyzeCadFile, ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import { SAMPLE_STEP_BRACKET, SAMPLE_STEP_ENCLOSURE } from '../../utils/sampleCadFiles';

interface StepUploadProps {
  onContinue: (analysis?: ExtractedCadAnalysis) => void;
  onDataChange: (data: any) => void;
  data: any;
}

export default function StepUpload({ onContinue, onDataChange, data }: StepUploadProps) {
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number; type: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ExtractedCadAnalysis | null>(null);
  
  // Manual inputs fallback
  const [manualPartName, setManualPartName] = useState('');
  const [manualWidth, setManualWidth] = useState('');
  const [manualLength, setManualLength] = useState('');

  const processFile = async (fileName: string, content?: string, buffer?: ArrayBuffer) => {
    setAnalyzing(true);
    try {
      const analysis = await analyzeCadFile({ name: fileName, content, buffer });
      setAnalysisResult(analysis);
      onDataChange({ cadAnalysis: analysis });
    } catch (err) {
      console.error('CAD file analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: async (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        setUploadedFile({ name: file.name, size: file.size, type: file.type });
        
        if (/\.step$|\.stp$/i.test(file.name)) {
          const text = await file.text();
          await processFile(file.name, text);
        } else {
          await processFile(file.name);
        }
      }
    },
    accept: {
      'application/pdf': ['.pdf'],
      'model/step': ['.step', '.stp'],
      'image/vnd.dxf': ['.dxf'],
      'application/acad': ['.dwg'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: false
  } as any);

  const handleLoadSampleStep = async () => {
    setUploadedFile({ name: 'Precision_Bracing_Bracket.step', size: 14200, type: 'model/step' });
    await processFile('Precision_Bracing_Bracket.step', SAMPLE_STEP_BRACKET);
  };

  const handleLoadSamplePdf = async () => {
    setUploadedFile({ name: 'Control_Chassis_Drawing.pdf', size: 245000, type: 'application/pdf' });
    await processFile('Control_Chassis_Drawing.pdf');
  };

  const handleProceed = () => {
    if (analysisResult) {
      onContinue(analysisResult);
    } else {
      onContinue();
    }
  };

  const handleManualContinue = (e: React.FormEvent) => {
    e.preventDefault();
    onContinue();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Upload Engineering CAD File</h2>
        <p className="text-muted-foreground text-sm">
          Production-grade parser reads native 3D STEP CAD (.step/.stp) models and 2D PDF engineering drawings.
        </p>
      </div>

      {/* Main Drag & Drop Zone */}
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-5 transition-all cursor-pointer bg-card/60 relative overflow-hidden ${
          isDragActive ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50'
        }`}
      >
        <input {...getInputProps()} />

        {analyzing ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
              <Cpu className="absolute inset-0 m-auto text-primary" size={24} />
            </div>
            <div>
              <p className="font-semibold text-foreground text-base">Parsing CAD Geometry & Features...</p>
              <p className="text-xs text-muted-foreground mt-1">Reading B-Rep solids, surface topology, and drawing title block</p>
            </div>
          </div>
        ) : uploadedFile ? (
          <div className="flex flex-col items-center gap-4 text-center w-full max-w-md bg-accent/40 p-5 rounded-xl border border-border">
            <div className="w-14 h-14 bg-primary/15 text-primary rounded-xl flex items-center justify-center relative">
              {/\.step$|\.stp$/i.test(uploadedFile.name) ? <Box size={30} /> : <FileText size={30} />}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setUploadedFile(null); 
                  setAnalysisResult(null); 
                }}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow hover:scale-110 transition-transform"
                title="Remove File"
              >
                <X size={12} />
              </button>
            </div>

            <div>
              <p className="font-semibold text-foreground text-sm truncate max-w-xs">{uploadedFile.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(uploadedFile.size / 1024).toFixed(1)} KB • {/\.step$|\.stp$/i.test(uploadedFile.name) ? '3D STEP CAD File' : '2D Engineering Drawing'}
              </p>
            </div>

            {analysisResult && (
              <div className="w-full bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 size={16} />
                  CAD Geometry & Title Block Extracted
                </span>
                <span className="font-bold">{analysisResult.confidenceScore}% Score</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center group shadow-inner">
              <Upload className="group-hover:translate-y-[-3px] transition-transform" size={32} />
            </div>
            <div className="text-center space-y-1">
              <p className="font-semibold text-foreground text-base">Drop your CAD drawing or 3D STEP model here</p>
              <p className="text-xs text-muted-foreground">
                Supports <strong className="text-foreground">.STEP, .STP, .PDF, .DXF, .DWG, .PNG, .JPG</strong> (up to 50MB)
              </p>
            </div>
          </>
        )}
      </div>

      {/* Quick Test Demo Presets */}
      <div className="bg-card border border-border p-5 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles size={14} className="text-amber-500" />
            Quick Demo Presets (Test Production CAD Reader)
          </span>
          <span className="text-[10px] text-muted-foreground">Click to load instantly</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleLoadSampleStep}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-primary/5 text-left transition-all group bg-background"
          >
            <div className="w-10 h-10 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
              <Box size={22} />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-foreground truncate">Precision Bracket.step</p>
              <p className="text-[10px] text-muted-foreground">3D STEP ISO-10303-21 B-Rep Model</p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleLoadSamplePdf}
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-primary/5 text-left transition-all group bg-background"
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
              <FileText size={22} />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-foreground truncate">Control Chassis Blueprint.pdf</p>
              <p className="text-[10px] text-muted-foreground">2D CAD PDF Drawing with Title Block</p>
            </div>
          </button>
        </div>
      </div>

      {/* Feature capabilities notice */}
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-4 flex gap-3 text-xs text-foreground/80 leading-relaxed">
        <ShieldCheck className="text-primary shrink-0 mt-0.5" size={20} />
        <p>
          <strong>Prod-Grade CAD Pipeline:</strong> Automatically calculates 3D bounding box (L x W x H), surface area, pierce points, cylindrical holes, bend lines, material callouts, and estimated manufacturing operations with instant WebGL 3D/2D preview in the next step.
        </p>
      </div>

      {/* Continue button if file loaded */}
      {analysisResult && (
        <div className="flex justify-end pt-2 animate-in slide-in-from-bottom-2 duration-300">
          <button
            type="button"
            onClick={handleProceed}
            className="bg-primary text-primary-foreground px-8 py-3 rounded-xl text-sm font-semibold hover:bg-primary/90 transition-all shadow-md flex items-center gap-2"
          >
            Inspect Extracted CAD Features
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {!analysisResult && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border"></span>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-3 text-muted-foreground font-medium">or enter dimensions manually</span>
            </div>
          </div>

          <form onSubmit={handleManualContinue} className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Part Name</label>
              <input 
                type="text" 
                placeholder="e.g. Front Panel Chassis" 
                className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={manualPartName}
                onChange={(e) => setManualPartName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Estimated Width (mm)</label>
              <input 
                type="number" 
                placeholder="200" 
                className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={manualWidth}
                onChange={(e) => setManualWidth(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Estimated Length (mm)</label>
              <input 
                type="number" 
                placeholder="350" 
                className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={manualLength}
                onChange={(e) => setManualLength(e.target.value)}
              />
            </div>
            <div className="col-span-2 pt-2 flex justify-end">
              <button 
                type="submit"
                className="bg-primary text-primary-foreground px-8 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-all shadow-sm"
              >
                Continue
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
