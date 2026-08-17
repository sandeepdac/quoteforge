import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StepIndicator from '../components/wizard/StepIndicator';
import StepUpload from '../components/wizard/StepUpload';
import StepExtract from '../components/wizard/StepExtract';
import StepQuantity from '../components/wizard/StepQuantity';
import StepReview from '../components/wizard/StepReview';
import { useQuotes } from '../context/QuoteContext';
import { useSettings } from '../context/SettingsContext';
import { Quote, Part } from '../types';
import { calculateWinProbability } from '../utils/estimator';
import { resolveQuoteCosts } from '../utils/quoteCosts';
import { generateQuoteNumber, generateId } from '../utils/idGenerator';
import { generatePartThumbnail } from '../utils/partThumbnail';
import { ExtractedCadAnalysis, stripCadForStorage } from '../utils/cadAnalyzer';

const STEPS = ['Upload', 'Extraction', 'Quantity', 'Review'];

export default function NewQuotePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { addQuote, updateQuote, addPart, materials } = useQuotes();
  const { settings } = useSettings();
  const [currentStep, setCurrentStep] = useState(1);
  const [cadAnalysis, setCadAnalysis] = useState<ExtractedCadAnalysis | undefined>(undefined);
  // A rendered still of the 3D model, captured on the extraction step, used as the
  // part thumbnail instead of the generic schematic.
  const [partImage, setPartImage] = useState<string | undefined>(undefined);
  // The source part's thumbnail when cloning (so the clone keeps the same image).
  const [seedThumbnail, setSeedThumbnail] = useState<string | undefined>(undefined);
  // When editing an existing quote, we update it in place instead of creating one.
  const [editBase, setEditBase] = useState<Quote | null>(null);
  // Generate the quote number once so the Review preview matches the saved quote.
  const [quoteNumber, setQuoteNumber] = useState(generateQuoteNumber);

  const [quoteData, setQuoteData] = useState<any>({
    partName: 'Custom Fabricated Part',
    features: {
      materialId: 'm1',
      lengthMm: 0,
      widthMm: 0,
      heightMm: 0,
      perimeterMm: 0,
      pierceCount: 0,
      bendCount: 0,
      isSimpleBending: true,
      holeCount: 0,
      weldLengthMm: 0,
      weldCount: 0,
      weightKg: 0,
      surfaceAreaM2: 0
    },
    config: {
      customerId: '',
      quantity: 1,
      leadTimeDays: 14,
      shippingType: 'ship' as const,
      isRush: false
    }
  });

  useEffect(() => {
    const state = location.state as
      | {
          cloneData?: Quote; partData?: Part; cloneCad?: ExtractedCadAnalysis;
          editQuote?: Quote; editPart?: Part; editCad?: ExtractedCadAnalysis;
        }
      | null;
    if (!state) return;
    const isEdit = !!state.editQuote;
    const src = state.editQuote ?? state.cloneData;
    const part = state.editPart ?? state.partData;
    if (!src && !part) return;

    // Restore the CAD analysis for BOTH edit and clone, so a machining quote is
    // re-priced on the machining model (not the fabrication fallback).
    const cad = state.editCad ?? state.cloneCad;
    if (cad) setCadAnalysis(cad);
    // Carry the source part's image so a clone keeps the same thumbnail.
    if (part?.thumbnail) setSeedThumbnail(part.thumbnail);
    setQuoteData((prev: any) => ({
      ...prev,
      partName: part?.name ?? prev.partName,
      features: part?.features
        ? { ...prev.features, materialId: part.materialId, ...part.features }
        : prev.features,
      config: src
        ? {
            customerId: src.customerId,
            quantity: src.quantity,
            leadTimeDays: src.leadTimeDays,
            shippingType: src.shippingType,
            isRush: src.isRushOrder,
          }
        : prev.config,
    }));
    if (isEdit && state.editQuote) {
      setEditBase(state.editQuote);
      setQuoteNumber(state.editQuote.quoteNumber);
      // Jump straight to Review (the extraction data + cost are restored). Clones
      // land on Quantity as before.
      setCurrentStep(state.editCad ? 4 : 3);
    } else {
      setCurrentStep(3);
    }
  }, [location.state]);

  const handleUploadContinue = (analysis?: ExtractedCadAnalysis) => {
    if (analysis) {
      setCadAnalysis(analysis);

      // Material is the user's up-front choice (pre-filled from the drawing when it
      // named one, on the Upload step). Never silently override it from the model
      // here — an unlabelled STEP would otherwise re-default and mis-price.
      setQuoteData(prev => ({
        ...prev,
        partName: analysis.partName || 'Custom Fabricated Part',
        features: {
          ...prev.features,
          lengthMm: analysis.lengthMm,
          widthMm: analysis.widthMm,
          heightMm: analysis.heightMm,
          perimeterMm: analysis.perimeterMm,
          pierceCount: analysis.pierceCount,
          bendCount: analysis.bendCount,
          isSimpleBending: analysis.isSimpleBending,
          holeCount: analysis.holeCount,
          weldLengthMm: analysis.weldLengthMm,
          weldCount: analysis.weldCount,
          weightKg: analysis.weightKg,
          surfaceAreaM2: analysis.surfaceAreaM2
        }
      }));
    }
    setCurrentStep(2);
  };

  const handleContinue = (data?: any) => {
    if (currentStep === 2 && data) {
      setQuoteData(prev => ({ ...prev, features: { ...prev.features, ...data } }));
    }
    if (currentStep === 3 && data) {
      setQuoteData(prev => ({ ...prev, config: { ...prev.config, ...data } }));
    }
    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  // Start every step at the top. The app scrolls inside <main>, not the window,
  // so without this you keep the previous step's scroll position — landing at the
  // bottom of the next step (e.g. past the customer selector on Quantity).
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 });
  }, [currentStep]);

  const handleFinalize = (isDraft: boolean, opts?: { margin?: number; notes?: string }) => {
    const material = materials.find(m => m.id === quoteData.features.materialId) || materials[0];
    // Use the margin chosen on the Review step (falls back to the shop default), and
    // the shop's live settings — so the saved quote matches what was previewed.
    const margin = opts?.margin ?? settings.defaultMargin;

    // Price through the SAME resolver the preview/review use, so the saved quote
    // matches exactly — turned parts on the turning model, milled on the milling
    // model, everything else on the fabrication model.
    const resolved = resolveQuoteCosts({
      cadAnalysis,
      features: quoteData.features,
      materialName: material.name,
      materialPricePerKg: material.pricePerKg,
      quantity: quoteData.config.quantity,
      isRush: quoteData.config.isRush,
      margin,
      settings,
    });
    const { costs, unitPrice, grandTotal, machiningCosts, machineClass } = resolved;
    const persistedCad = cadAnalysis ? stripCadForStorage(cadAnalysis) : undefined;

    // --- Editing an existing quote: update it in place + log a revision ------
    if (editBase) {
      const changes: string[] = [];
      if (editBase.quantity !== quoteData.config.quantity) changes.push(`qty ${editBase.quantity}→${quoteData.config.quantity}`);
      if (Math.abs(editBase.marginPercent - margin) > 0.0001) changes.push(`margin ${(editBase.marginPercent * 100).toFixed(0)}%→${(margin * 100).toFixed(0)}%`);
      if (editBase.leadTimeDays !== quoteData.config.leadTimeDays) changes.push(`lead ${editBase.leadTimeDays}→${quoteData.config.leadTimeDays}d`);
      if (editBase.customerId !== quoteData.config.customerId) changes.push('customer changed');
      const summary = changes.length ? `Edited — ${changes.join(', ')}` : 'Re-priced';
      const updated: Quote = {
        ...editBase,
        status: isDraft ? 'draft' : editBase.status === 'draft' ? 'sent' : editBase.status,
        customerId: quoteData.config.customerId,
        quantity: quoteData.config.quantity,
        leadTimeDays: quoteData.config.leadTimeDays,
        shippingType: quoteData.config.shippingType,
        isRushOrder: quoteData.config.isRush,
        marginPercent: margin,
        notes: opts?.notes ?? editBase.notes,
        costs,
        totalUnitPrice: unitPrice,
        grandTotal,
        winProbability: calculateWinProbability(margin, quoteData.config.leadTimeDays),
        machineClass,
        machiningCosts,
        cadAnalysis: persistedCad ?? editBase.cadAnalysis,
        revisions: [
          ...(editBase.revisions ?? [{ at: editBase.createdDate, summary: 'Quote created', unitPrice: editBase.totalUnitPrice, grandTotal: editBase.grandTotal }]),
          { at: new Date().toISOString(), summary, unitPrice, grandTotal },
        ],
      };
      updateQuote(updated);
      navigate(`/quotes/${updated.id}`);
      return;
    }

    // Persist the actual measured part so the quote references its real geometry,
    // and it shows up in the Parts catalog — instead of pointing at a mock part.
    const { materialId, ...partFeatures } = quoteData.features;
    const partName: string = quoteData.partName || 'Custom Fabricated Part';
    const newPart: Part = {
      id: generateId('p-'),
      name: partName,
      materialId,
      thicknessMm: cadAnalysis?.thicknessMm ?? material.thicknessMm,
      features: partFeatures,
      thumbnail: partImage ?? seedThumbnail ?? generatePartThumbnail(partName, partFeatures),
      lastQuotedDate: new Date().toISOString().split('T')[0],
      quoteCount: 1,
    };
    addPart(newPart);

    const newQuote: Quote = {
      id: generateId('q-'),
      quoteNumber,
      customerId: quoteData.config.customerId,
      partId: newPart.id,
      status: isDraft ? 'draft' : 'sent',
      createdDate: new Date().toISOString().split('T')[0],
      validUntilDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      quantity: quoteData.config.quantity,
      leadTimeDays: quoteData.config.leadTimeDays,
      shippingType: quoteData.config.shippingType,
      isRushOrder: quoteData.config.isRush,
      marginPercent: margin,
      notes: opts?.notes ?? '',
      costs,
      totalUnitPrice: unitPrice,
      grandTotal,
      winProbability: calculateWinProbability(margin, quoteData.config.leadTimeDays),
      machineClass,
      machiningCosts,
      cadAnalysis: persistedCad,
      revisions: [
        { at: new Date().toISOString(), summary: 'Quote created from CAD extraction', unitPrice, grandTotal },
      ],
    };

    addQuote(newQuote);
    navigate(`/quotes/${newQuote.id}`);
  };

  return (
    <div className="py-2">
      <StepIndicator currentStep={currentStep} steps={STEPS} />

      <div className="mt-4 transition-all duration-300">
        {currentStep === 1 && (
          <StepUpload 
            data={quoteData} 
            onContinue={(analysis) => handleUploadContinue(analysis)} 
            onDataChange={(data) => setQuoteData(prev => ({ ...prev, ...data }))}
          />
        )}
        {currentStep === 2 && (
          <StepExtract
            cadAnalysis={cadAnalysis}
            materialId={quoteData.features.materialId}
            onContinue={(extracted) => handleContinue(extracted)}
            onBack={handleBack}
            onSnapshot={setPartImage}
            savedThumbnail={partImage ?? seedThumbnail}
          />
        )}
        {currentStep === 3 && (
          <StepQuantity
            data={quoteData}
            cadAnalysis={cadAnalysis}
            onContinue={(config) => handleContinue(config)}
            onBack={handleBack}
            onUpdate={setQuoteData}
          />
        )}
        {currentStep === 4 && (
          <StepReview
            data={quoteData}
            cadAnalysis={cadAnalysis}
            partImage={partImage ?? seedThumbnail}
            quoteNumber={quoteNumber}
            onSend={(opts) => handleFinalize(false, opts)}
            onSaveDraft={(opts) => handleFinalize(true, opts)}
            onBack={handleBack}
            onUpdate={setQuoteData}
          />
        )}
      </div>
    </div>
  );
}
