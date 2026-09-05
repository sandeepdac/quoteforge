import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  File, 
  X, 
  Info, 
  Box,
  FileText,
  CheckCircle2,
  ArrowRight,
  Cpu,
  Layers
} from 'lucide-react';
import { analyzeCadFile, ExtractedCadAnalysis, CadFileInput } from '../../utils/cadAnalyzer';
import { solidFormatFor } from '../../utils/occtLoader';
import { useQuotes } from '../../context/QuoteContext';
import { useSettings } from '../../context/SettingsContext';
import { materialFamilyFor } from '../../utils/materials';
import { useMoney } from '../../utils/useMoney';

/** Reads a file blob as a base64 string (without the data: prefix) for AI extraction. */
function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface StepUploadProps {
  onContinue: (analysis?: ExtractedCadAnalysis) => void;
  onDataChange: (data: any) => void;
  data: any;
}

export default function StepUpload({ onContinue, onDataChange, data }: StepUploadProps) {
  const { materials } = useQuotes();
  const { settings } = useSettings();
  const { symbol } = useMoney();
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number; type: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ExtractedCadAnalysis | null>(null);

  const selectedMaterialId: string = data?.features?.materialId ?? materials[0]?.id ?? '';
  const setMaterialId = (id: string) => onDataChange({ features: { ...data.features, materialId: id } });

  const processFile = async (input: CadFileInput) => {
    setAnalyzing(true);
    try {
      const analysis = await analyzeCadFile(input, { machines: settings.cnc?.machines });
      setAnalysisResult(analysis);
      // Suggest the material the drawing/model named, matched by cutting-data FAMILY
      // (so "Aluminium 6082" finds the library's aluminium regardless of 6082/6061
      // or the -ium/-um spelling). The user still confirms it above; an unlabelled
      // STEP keeps whatever was already chosen, so the choice is never silently wrong.
      const named = (analysis.materialName || '').trim();
      const fam = named ? materialFamilyFor(named) : undefined;
      const match = fam ? materials.find((m) => materialFamilyFor(m.name) === fam) : undefined;
      onDataChange(
        match
          ? { cadAnalysis: analysis, features: { ...data.features, materialId: match.id } }
          : { cadAnalysis: analysis }
      );
    } catch (err) {
      console.error('CAD file analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: async (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      setUploadedFile({ name: file.name, size: file.size, type: file.type });

      if (solidFormatFor(file.name)) {
        // 3D solid (STEP/IGES/BREP): pass raw bytes for tessellation + measurement.
        const buffer = await file.arrayBuffer();
        await processFile({ name: file.name, buffer });
      } else if (/\.pdf$/i.test(file.name)) {
        // 2D PDF drawing: base64 for AI extraction + object URL for inline preview.
        const [base64, url] = [await fileToBase64(file), URL.createObjectURL(file)];
        await processFile({ name: file.name, base64, mimeType: 'application/pdf', pdfUrl: url });
      } else if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name)) {
        // Image of a drawing: base64 for AI vision + object URL for preview.
        const [base64, url] = [await fileToBase64(file), URL.createObjectURL(file)];
        await processFile({ name: file.name, base64, mimeType: file.type || 'image/png', pdfUrl: url });
      } else {
        await processFile({ name: file.name });
      }
    },
    accept: {
      'application/pdf': ['.pdf'],
      'model/step': ['.step', '.stp'],
      'model/iges': ['.iges', '.igs'],
      'application/octet-stream': ['.brep'],
      'image/vnd.dxf': ['.dxf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: false
  } as any);

  const handleProceed = () => {
    if (analysisResult) {
      onContinue(analysisResult);
    } else {
      onContinue();
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-in fade-in duration-300">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Upload Engineering CAD File</h2>
      </div>

      {/* Material — chosen up front so it's never a silent default. A STEP rarely
          states its material, so this is the one input the file can't give us. */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Layers size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Stock material</p>
            <p className="text-[11px] text-muted-foreground">Sets cutting speeds &amp; cost — confirm before quoting</p>
          </div>
        </div>
        <select
          value={selectedMaterialId}
          onChange={(e) => setMaterialId(e.target.value)}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {typeof m.pricePerKg === 'number' ? ` — ${symbol}${m.pricePerKg.toFixed(2)}/kg` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Main Drag & Drop Zone */}
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-all cursor-pointer bg-card/60 relative overflow-hidden ${
          uploadedFile ? 'p-4' : 'p-7'
        } ${isDragActive ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50'}`}
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
          <div className="w-full flex items-center gap-3 text-left">
            <div className="w-11 h-11 bg-primary/15 text-primary rounded-lg flex items-center justify-center shrink-0">
              {/\.step$|\.stp$/i.test(uploadedFile.name) ? <Box size={22} /> : <FileText size={22} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm truncate">{uploadedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(uploadedFile.size / 1024).toFixed(1)} KB • {/\.step$|\.stp$/i.test(uploadedFile.name) ? '3D STEP CAD File' : '2D Engineering Drawing'}
              </p>
            </div>
            {analysisResult && (
              <div className="hidden sm:flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium shrink-0">
                <CheckCircle2 size={15} />
                {analysisResult.measurementSource === 'solid' ? (
                  'Measured'
                ) : (
                  <>Extracted <span className="font-bold">{analysisResult.confidenceScore}%</span></>
                )}
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUploadedFile(null);
                setAnalysisResult(null);
              }}
              className="bg-muted text-muted-foreground rounded-full p-1.5 shrink-0 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              title="Remove file"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center group shadow-inner">
              <Upload className="group-hover:translate-y-[-3px] transition-transform" size={32} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground text-base">Drop your CAD drawing or 3D STEP model here</p>
            </div>
          </>
        )}
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
    </div>
  );
}
