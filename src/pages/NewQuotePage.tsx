import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StepIndicator from '../components/wizard/StepIndicator';
import StepUpload from '../components/wizard/StepUpload';
import StepExtract from '../components/wizard/StepExtract';
import StepQuantity from '../components/wizard/StepQuantity';
import StepReview from '../components/wizard/StepReview';
import { useQuotes } from '../context/QuoteContext';
import { Quote } from '../types';
import { calculateQuoteCosts, calculateWinProbability } from '../utils/estimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { generateQuoteNumber, generateId } from '../utils/idGenerator';
import { ExtractedCadAnalysis } from '../utils/cadAnalyzer';

const STEPS = ['Upload', 'AI Extraction', 'Quantity', 'Review'];

export default function NewQuotePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { addQuote, materials } = useQuotes();
  const [currentStep, setCurrentStep] = useState(1);
  const [cadAnalysis, setCadAnalysis] = useState<ExtractedCadAnalysis | undefined>(undefined);
  
  const [quoteData, setQuoteData] = useState({
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
    if (location.state?.cloneData) {
      const clone = location.state.cloneData as Quote;
      const part = location.state.partData;
      setQuoteData({
        features: part?.features || quoteData.features,
        config: {
          customerId: clone.customerId,
          quantity: clone.quantity,
          leadTimeDays: clone.leadTimeDays,
          shippingType: clone.shippingType,
          isRush: clone.isRushOrder
        }
      });
      setCurrentStep(3);
    }
  }, [location.state]);

  const handleUploadContinue = (analysis?: ExtractedCadAnalysis) => {
    if (analysis) {
      setCadAnalysis(analysis);
      
      // Match material name with inventory
      const matchedMat = materials.find(m => 
        m.name.toLowerCase().includes(analysis.materialName?.toLowerCase() || '')
      ) || materials[0];

      setQuoteData(prev => ({
        ...prev,
        features: {
          ...prev.features,
          materialId: matchedMat.id,
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

  const handleFinalize = (isDraft: boolean) => {
    const material = materials.find(m => m.id === quoteData.features.materialId) || materials[0];
    const margin = DEFAULT_SHOP_SETTINGS.defaultMargin;
    
    const costs = calculateQuoteCosts(
      quoteData.features,
      quoteData.config.quantity,
      quoteData.config.isRush,
      margin,
      material.pricePerKg,
      DEFAULT_SHOP_SETTINGS
    );

    const unitPrice = costs.subtotal + costs.overhead + costs.marginAmount;
    const grandTotal = (unitPrice * quoteData.config.quantity) + costs.rushPremium;

    const newQuote: Quote = {
      id: generateId('q-'),
      quoteNumber: generateQuoteNumber(),
      customerId: quoteData.config.customerId,
      partId: 'p1',
      status: isDraft ? 'draft' : 'sent',
      createdDate: new Date().toISOString().split('T')[0],
      validUntilDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      quantity: quoteData.config.quantity,
      leadTimeDays: quoteData.config.leadTimeDays,
      shippingType: quoteData.config.shippingType,
      isRushOrder: quoteData.config.isRush,
      marginPercent: margin,
      notes: '',
      costs,
      totalUnitPrice: unitPrice,
      grandTotal,
      winProbability: calculateWinProbability(margin, quoteData.config.leadTimeDays)
    };

    addQuote(newQuote);
    navigate(`/quotes/${newQuote.id}`);
  };

  return (
    <div className="py-4">
      <StepIndicator currentStep={currentStep} steps={STEPS} />
      
      <div className="mt-8 transition-all duration-300">
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
            onContinue={(extracted) => handleContinue(extracted)} 
            onBack={handleBack} 
          />
        )}
        {currentStep === 3 && (
          <StepQuantity 
            data={quoteData} 
            onContinue={(config) => handleContinue(config)} 
            onBack={handleBack}
            onUpdate={setQuoteData}
          />
        )}
        {currentStep === 4 && (
          <StepReview 
            data={quoteData} 
            onSend={() => handleFinalize(false)}
            onSaveDraft={() => handleFinalize(true)}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
