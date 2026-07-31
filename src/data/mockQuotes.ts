import { Quote } from '../types';
import { mockParts } from './mockParts';
import { mockMaterials } from './mockMaterials';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { calculateQuoteCosts, calculateWinProbability } from '../utils/estimator';

const generateMockQuote = (
  id: string,
  quoteNumber: string,
  customerId: string,
  partId: string,
  status: Quote['status'],
  createdDate: string,
  quantity: number,
  margin: number,
  lossReason?: Quote['lossReason'],
  actualLeadTimeDays?: number
): Quote => {
  const part = mockParts.find(p => p.id === partId)!;
  const material = mockMaterials.find(m => m.id === part.materialId)!;
  
  const costs = calculateQuoteCosts(
    part.features,
    quantity,
    false,
    margin,
    material.pricePerKg,
    DEFAULT_SHOP_SETTINGS
  );

  const unitTotal = costs.subtotal + costs.overhead + costs.marginAmount;
  const grandTotal = unitTotal * quantity;

  return {
    id,
    quoteNumber,
    customerId,
    partId,
    status,
    createdDate,
    validUntilDate: new Date(new Date(createdDate).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    quantity,
    leadTimeDays: Math.floor(Math.random() * 10) + 7,
    shippingType: 'ship',
    isRushOrder: false,
    marginPercent: margin,
    notes: 'Standard fabrication quote based on AI extraction.',
    costs,
    totalUnitPrice: unitTotal,
    grandTotal,
    winProbability: calculateWinProbability(margin, 14),
    lossReason,
    actualLeadTimeDays
  };
};

export const mockQuotes: Quote[] = [
  // Q1 2026
  generateMockQuote('q1', 'Q-2026-0001', 'c1', 'p1', 'won', '2026-01-05', 50, 0.25, undefined, 12),
  generateMockQuote('q2', 'Q-2026-0002', 'c2', 'p1', 'won', '2026-01-12', 100, 0.22, undefined, 14),
  generateMockQuote('q3', 'Q-2026-0003', 'c3', 'p2', 'lost', '2026-01-15', 10, 0.35, 'Price too High'),
  generateMockQuote('q18', 'Q-2026-0018', 'c6', 'p4', 'won', '2026-02-10', 25, 0.30, undefined, 10),
  generateMockQuote('q19', 'Q-2026-0019', 'c3', 'p2', 'lost', '2026-02-12', 50, 0.28, 'Lead Time'),
  generateMockQuote('q22', 'Q-2026-0022', 'c7', 'p2', 'won', '2026-01-05', 10, 0.25, undefined, 15),
  generateMockQuote('q30', 'Q-2026-0030', 'c1', 'p3', 'lost', '2026-02-20', 100, 0.30, 'Price too High'),
  generateMockQuote('q31', 'Q-2026-0031', 'c2', 'p4', 'won', '2026-02-25', 20, 0.20, undefined, 12),
  
  // Q2 2026
  generateMockQuote('q8', 'Q-2026-0008', 'c2', 'p2', 'won', '2026-03-20', 200, 0.18, undefined, 13),
  generateMockQuote('q14', 'Q-2026-0014', 'c2', 'p5', 'lost', '2026-03-15', 5, 0.40, 'Lost to Competitor'),
  generateMockQuote('q15', 'Q-2026-0015', 'c4', 'p1', 'won', '2026-04-18', 1000, 0.12, undefined, 18),
  generateMockQuote('q9', 'Q-2026-0009', 'c8', 'p3', 'won', '2026-04-21', 100, 0.22, undefined, 14),
  generateMockQuote('q10', 'Q-2026-0010', 'c5', 'p5', 'won', '2026-04-22', 50, 0.15, undefined, 12),
  generateMockQuote('q13', 'Q-2026-0013', 'c8', 'p2', 'won', '2026-04-22', 40, 0.25, undefined, 11),
  generateMockQuote('q23', 'Q-2026-0023', 'c5', 'p3', 'won', '2026-04-20', 100, 0.20, undefined, 9),
  generateMockQuote('q24', 'Q-2026-0024', 'c4', 'p4', 'won', '2026-04-21', 200, 0.22, undefined, 13),

  // Current / Active (May 2026)
  generateMockQuote('q4', 'Q-2026-0004', 'c4', 'p3', 'sent', '2026-04-28', 500, 0.20),
  generateMockQuote('q5', 'Q-2026-0005', 'c5', 'p5', 'sent', '2026-04-30', 20, 0.25),
  generateMockQuote('q6', 'Q-2026-0006', 'c1', 'p4', 'draft', '2026-05-01', 5, 0.30),
  generateMockQuote('q11', 'Q-2026-0011', 'c4', 'p4', 'sent', '2026-05-02', 150, 0.25),
  generateMockQuote('q12', 'Q-2026-0012', 'c1', 'p1', 'sent', '2026-05-03', 10, 0.30),
  generateMockQuote('q16', 'Q-2026-0016', 'c5', 'p3', 'sent', '2026-05-02', 200, 0.25),
  generateMockQuote('q17', 'Q-2026-0017', 'c1', 'p2', 'draft', '2026-05-04', 100, 0.25),
  generateMockQuote('q20', 'Q-2026-0020', 'c8', 'p5', 'sent', '2026-05-03', 10, 0.35),
  generateMockQuote('q21', 'Q-2026-0021', 'c2', 'p1', 'won', '2026-05-01', 500, 0.18, undefined, 4),
  generateMockQuote('q32', 'Q-2026-0032', 'c5', 'p1', 'won', '2026-05-02', 10, 0.22, undefined, 3),
  generateMockQuote('q33', 'Q-2026-0033', 'c4', 'p2', 'won', '2026-05-03', 5, 0.25, undefined, 2),
  generateMockQuote('q34', 'Q-2026-0034', 'c8', 'p3', 'sent', '2026-05-04', 20, 0.20),
  generateMockQuote('q35', 'Q-2026-0035', 'c2', 'p4', 'sent', '2026-05-04', 15, 0.18),
  generateMockQuote('q36', 'Q-2026-0036', 'c1', 'p5', 'sent', '2026-05-04', 30, 0.22),
];
