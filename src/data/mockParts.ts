import { Part } from '../types';

export const mockParts: Part[] = [
  {
    id: 'p1',
    name: 'Precision Chassis Rail V2',
    materialId: 'm2',
    thicknessMm: 6.0,
    thumbnail: 'https://images.unsplash.com/photo-1504917595217-d4dc5f9c4739?auto=format&fit=crop&q=80&w=800',
    quoteCount: 42,
    lastQuotedDate: '2026-04-18',
    features: {
      perimeterMm: 3200,
      pierceCount: 12,
      bendCount: 4,
      isSimpleBending: true,
      weldLengthMm: 450,
      weldCount: 2,
      holeCount: 24,
      surfaceAreaM2: 0.85,
      weightKg: 12.4,
      lengthMm: 1200,
      widthMm: 150,
      heightMm: 80
    }
  },
  {
    id: 'p2',
    name: 'Heavy Duty Support Bracket',
    materialId: 'm1',
    thicknessMm: 3.0,
    thumbnail: 'https://images.unsplash.com/photo-1540304453527-62f979142a17?auto=format&fit=crop&q=80&w=800',
    quoteCount: 124,
    lastQuotedDate: '2026-04-15',
    features: {
      perimeterMm: 850,
      pierceCount: 4,
      bendCount: 2,
      isSimpleBending: true,
      weldLengthMm: 0,
      weldCount: 0,
      holeCount: 6,
      surfaceAreaM2: 0.045,
      weightKg: 1.15,
      lengthMm: 150,
      widthMm: 150,
      heightMm: 45
    }
  },
  {
    id: 'p3',
    name: 'Main Electronic Enclosure',
    materialId: 'm3',
    thicknessMm: 2.0,
    thumbnail: 'https://images.unsplash.com/photo-1555664424-778a1e5e1b48?auto=format&fit=crop&q=80&w=800',
    quoteCount: 18,
    lastQuotedDate: '2026-04-10',
    features: {
      perimeterMm: 4500,
      pierceCount: 24,
      bendCount: 12,
      isSimpleBending: false,
      weldLengthMm: 1200,
      weldCount: 8,
      holeCount: 32,
      surfaceAreaM2: 1.15,
      weightKg: 18.2,
      lengthMm: 600,
      widthMm: 450,
      heightMm: 200
    }
  },
  {
    id: 'p4',
    name: 'Exhaust Flange Adapter',
    materialId: 'm4',
    thicknessMm: 10.0,
    thumbnail: 'https://images.unsplash.com/photo-1534067783941-51c9c23ecefd?auto=format&fit=crop&q=80&w=800',
    quoteCount: 6,
    lastQuotedDate: '2026-04-05',
    features: {
      perimeterMm: 600,
      pierceCount: 1,
      bendCount: 0,
      isSimpleBending: true,
      weldLengthMm: 0,
      weldCount: 0,
      holeCount: 8,
      surfaceAreaM2: 0.02,
      weightKg: 1.5,
      lengthMm: 180,
      widthMm: 180,
      heightMm: 10
    }
  },
  {
    id: 'p5',
    name: 'Thermal Heat Sink Plate',
    materialId: 'm6',
    thicknessMm: 1.5,
    thumbnail: 'https://images.unsplash.com/photo-1581091215307-9548b114d436?auto=format&fit=crop&q=80&w=800',
    quoteCount: 29,
    lastQuotedDate: '2026-04-19',
    features: {
      perimeterMm: 1200,
      pierceCount: 60,
      bendCount: 0,
      isSimpleBending: true,
      weldLengthMm: 0,
      weldCount: 0,
      holeCount: 50,
      surfaceAreaM2: 0.09,
      weightKg: 0.5,
      lengthMm: 300,
      widthMm: 300,
      heightMm: 1.5
    }
  }
];
