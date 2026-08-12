import { Material } from '../types';

/**
 * Machining stock library. A CNC shop buys solid bar/plate by alloy, not by sheet
 * gauge — so these are the alloys the shop actually runs, priced per kg (edit in
 * Materials). Aluminium 6082 is first so it's the default for this aluminium-heavy
 * shop; every name maps to a cutting-data family via materialFamilyFor().
 */
export const mockMaterials: Material[] = [
  { id: 'm1', name: 'Aluminium 6082', pricePerKg: 16.50, density: 2700, thicknessMm: 25, lastPriceUpdate: '2026-07-22T09:00:00.000Z' },
  { id: 'm2', name: 'Aluminium 7075', pricePerKg: 22.00, density: 2810, thicknessMm: 25, lastPriceUpdate: '2026-07-22T09:00:00.000Z' },
  { id: 'm3', name: 'Mild Steel EN8', pricePerKg: 2.50, density: 7850, thicknessMm: 25, lastPriceUpdate: '2026-07-14T09:00:00.000Z' },
  { id: 'm4', name: 'Stainless 303', pricePerKg: 6.50, density: 8000, thicknessMm: 25, lastPriceUpdate: '2026-06-30T09:00:00.000Z' },
  { id: 'm5', name: 'Stainless 316', pricePerKg: 8.50, density: 8000, thicknessMm: 25, lastPriceUpdate: '2026-06-30T09:00:00.000Z' },
  { id: 'm6', name: 'Brass CZ121', pricePerKg: 12.00, density: 8500, thicknessMm: 25, lastPriceUpdate: '2026-07-14T09:00:00.000Z' },
  { id: 'm7', name: 'Titanium Grade 5', pricePerKg: 45.00, density: 4430, thicknessMm: 25, lastPriceUpdate: '2026-07-14T09:00:00.000Z' },
  { id: 'm8', name: 'Acetal (POM)', pricePerKg: 6.00, density: 1410, thicknessMm: 25, lastPriceUpdate: '2026-07-14T09:00:00.000Z' },
];
