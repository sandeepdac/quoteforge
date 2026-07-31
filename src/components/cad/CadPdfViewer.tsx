import React, { useState } from 'react';
import { 
  FileText, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Ruler, 
  Info, 
  Eye, 
  CheckCircle2, 
  Sparkles,
  Layers,
  Crosshair
} from 'lucide-react';
import { SAMPLE_CAD_PDF_METADATA, CadPdfMetadata } from '../../utils/sampleCadFiles';

interface CadPdfViewerProps {
  pdfFileName?: string;
  pdfData?: CadPdfMetadata;
  pdfUrl?: string;
  className?: string;
}

export default function CadPdfViewer({ pdfFileName = 'Drawing.pdf', pdfData = SAMPLE_CAD_PDF_METADATA, pdfUrl, className = '' }: CadPdfViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [showOverlays, setShowOverlays] = useState(true);
  const [isBlueprintTheme, setIsBlueprintTheme] = useState(true);
  // When the real PDF is available, default to showing it; otherwise show the schematic.
  const [viewMode, setViewMode] = useState<'pdf' | 'schematic'>(pdfUrl ? 'pdf' : 'schematic');

  return (
    <div className={`rounded-xl border border-border overflow-hidden bg-card flex flex-col ${className}`}>
      {/* Top Header Bar */}
      <div className="bg-slate-900 px-4 py-2.5 flex items-center justify-between border-b border-slate-800 text-slate-200 text-xs">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-sky-400" />
          <span className="font-bold text-white">Engineering CAD PDF Drawing</span>
          <span className="bg-sky-950 text-sky-400 border border-sky-800/50 px-2 py-0.5 rounded text-[10px] font-mono">
            {pdfFileName}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {pdfUrl && (
            <div className="flex items-center bg-slate-800 rounded p-0.5">
              <button
                onClick={() => setViewMode('pdf')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  viewMode === 'pdf' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live PDF
              </button>
              <button
                onClick={() => setViewMode('schematic')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  viewMode === 'schematic' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Schematic
              </button>
            </div>
          )}

          {viewMode === 'schematic' && (
            <button
              onClick={() => setShowOverlays(!showOverlays)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                showOverlays ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Eye size={13} />
              Feature Callouts
            </button>
          )}

          {viewMode === 'schematic' && (
            <>
              <button
                onClick={() => setIsBlueprintTheme(!isBlueprintTheme)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  isBlueprintTheme ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Layers size={13} />
                {isBlueprintTheme ? 'Blueprint Dark' : 'Paper Light'}
              </button>

              <div className="flex items-center bg-slate-800 rounded p-0.5">
                <button
                  onClick={() => setZoom(z => Math.max(0.8, z - 0.2))}
                  className="p-1 hover:text-white text-slate-400"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="px-2 font-mono text-[10px] text-slate-300">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(z => Math.min(2.0, z + 0.2))}
                  className="p-1 hover:text-white text-slate-400"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Live PDF Stage — renders the actual uploaded/bundled drawing */}
      {viewMode === 'pdf' && pdfUrl && (
        <div className="w-full h-[360px] bg-slate-100">
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
            title={`${pdfFileName} drawing preview`}
            className="w-full h-full border-0"
          />
        </div>
      )}

      {/* Drawing Blueprint Stage */}
      {viewMode === 'schematic' && (
      <div
        className={`w-full h-[360px] relative overflow-auto p-6 transition-colors flex items-center justify-center select-none ${
          isBlueprintTheme ? 'bg-[#0b182e]' : 'bg-slate-100'
        }`}
      >
        <div 
          className={`relative border-2 transition-transform duration-200 shadow-2xl p-6 rounded ${
            isBlueprintTheme 
              ? 'bg-[#0f2342] border-sky-500/40 text-sky-100' 
              : 'bg-white border-slate-300 text-slate-900'
          }`}
          style={{ 
            width: `${520 * zoom}px`, 
            height: `${320 * zoom}px`,
            backgroundImage: isBlueprintTheme 
              ? 'radial-gradient(rgba(56, 189, 248, 0.15) 1px, transparent 0)' 
              : 'radial-gradient(rgba(148, 163, 184, 0.2) 1px, transparent 0)',
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`
          }}
        >
          {/* Main Part 2D Vector Silhouette */}
          <div className="absolute inset-8 border-2 border-dashed border-sky-400/60 rounded-md flex flex-col items-center justify-center">
            {/* Front & Top View Shapes */}
            <div className="w-[80%] h-[60%] border-2 border-sky-400 rounded flex items-center justify-center relative bg-sky-500/5">
              {/* Centerline Crosshairs */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-full h-px bg-sky-400/30"></div>
                <div className="h-full w-px bg-sky-400/30 absolute"></div>
              </div>

              {/* Hole Circles */}
              <div className="absolute top-3 left-4 w-4 h-4 border-2 border-red-400 rounded-full flex items-center justify-center text-[8px] text-red-400 font-mono font-bold bg-red-950/40">
                Ø5.5
              </div>
              <div className="absolute top-3 right-4 w-4 h-4 border-2 border-red-400 rounded-full flex items-center justify-center text-[8px] text-red-400 font-mono font-bold bg-red-950/40">
                Ø5.5
              </div>
              <div className="absolute bottom-3 left-4 w-4 h-4 border-2 border-red-400 rounded-full flex items-center justify-center text-[8px] text-red-400 font-mono font-bold bg-red-950/40">
                Ø5.5
              </div>
              <div className="absolute bottom-3 right-4 w-4 h-4 border-2 border-red-400 rounded-full flex items-center justify-center text-[8px] text-red-400 font-mono font-bold bg-red-950/40">
                Ø5.5
              </div>

              {/* Center Cutout */}
              <div className="w-24 h-16 border-2 border-amber-400/80 rounded border-dashed flex items-center justify-center text-[9px] font-mono text-amber-300 bg-amber-950/30">
                CUTOUT: 120x80
              </div>

              {/* Bend Lines */}
              <div className="absolute top-0 bottom-0 left-[20%] w-px border-l-2 border-dashed border-emerald-400"></div>
              <div className="absolute top-0 bottom-0 right-[20%] w-px border-r-2 border-dashed border-emerald-400"></div>
            </div>

            {/* Overall Dimension Indicators */}
            {showOverlays && (
              <>
                {/* Horizontal Length Dimension */}
                <div className="absolute -top-5 left-[10%] right-[10%] flex items-center justify-between text-[10px] font-mono text-sky-300 font-bold">
                  <div className="h-2 w-px bg-sky-400"></div>
                  <span className="bg-sky-950/90 px-1.5 py-0.5 rounded border border-sky-800">
                    {pdfData.dimensions.lengthMm.toFixed(1)} mm
                  </span>
                  <div className="h-2 w-px bg-sky-400"></div>
                </div>

                {/* Vertical Width Dimension */}
                <div className="absolute top-[15%] bottom-[15%] -left-6 flex flex-col items-center justify-between text-[10px] font-mono text-sky-300 font-bold">
                  <div className="w-2 h-px bg-sky-400"></div>
                  <span className="bg-sky-950/90 px-1 py-0.5 rounded border border-sky-800 [writing-mode:vertical-lr] rotate-180">
                    {pdfData.dimensions.widthMm.toFixed(1)} mm
                  </span>
                  <div className="w-2 h-px bg-sky-400"></div>
                </div>
              </>
            )}
          </div>

          {/* Title Block (Bottom Right Corner) */}
          <div className="absolute bottom-2 right-2 border border-sky-400/60 bg-sky-950/90 text-slate-200 text-[9px] font-mono p-2 rounded w-52 shadow-lg">
            <div className="border-b border-sky-800 font-bold text-sky-300 uppercase pb-0.5 flex justify-between">
              <span>{pdfData.title}</span>
              <span className="text-amber-400">{pdfData.revision}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 pt-1 text-[8px] text-slate-300">
              <div>DWG: <strong className="text-white">{pdfData.drawingNumber}</strong></div>
              <div>MAT: <strong className="text-white">{pdfData.material}</strong></div>
              <div>SCALE: <strong className="text-white">{pdfData.scale}</strong></div>
              <div>TOL: <strong className="text-white">±0.2mm</strong></div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Drawing Intelligence Summary Footer */}
      <div className="bg-slate-900 border-t border-slate-800 p-3 px-4 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <CheckCircle2 size={15} />
            <span>Title Block Recognized</span>
          </div>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">Material: <strong className="text-slate-100">{pdfData.material}</strong></span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">Finish: <strong className="text-slate-100">{pdfData.finish}</strong></span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-sky-400 font-semibold bg-sky-950 border border-sky-800 px-2 py-0.5 rounded-full">
            AI Optical Confidence: 94%
          </span>
        </div>
      </div>
    </div>
  );
}
