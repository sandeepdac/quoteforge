import { describe, it, expect } from 'vitest';
import { buildQuotePdf, esc } from './pdfGenerator';
import type { Quote, Customer, Part, Material, ShopSettings } from '../types';

const quote = {
  quoteNumber: 'Q-1042',
  quantity: 10,
  leadTimeDays: 12,
  validUntilDate: '2026-02-01',
  notes: 'Deburr all edges. First-article inspection required.',
  totalUnitPrice: 84.5,
  grandTotal: 845,
  costs: { materialCost: 24, subtotal: 60, overhead: 7.2, marginAmount: 17.3, rushPremium: 0 },
  machiningCosts: {
    lineItems: [
      { key: 'material', name: 'Billet stock', driver: '', value: 24, color: '#000' },
      { key: 'rough', name: 'Roughing', driver: '', value: 20, color: '#000' },
    ],
  },
} as unknown as Quote;

const customer = { name: 'Acme Aerospace', contactName: 'Dana Lee', email: 'dana@acme.com', terms: 'Net 45' } as unknown as Customer;
const part = { name: 'Bracket ⌀20', materialId: 'm1', features: { lengthMm: 120, widthMm: 80, heightMm: 25 } } as unknown as Part;
const material = { name: 'Aluminium 6082' } as unknown as Material;
const shop = { name: 'Turncircuit Ltd', address: '1 Mill Road, Sheffield' } as unknown as ShopSettings;

async function bytesOf(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

describe('buildQuotePdf', () => {
  it('produces a real application/pdf blob', async () => {
    const blob = buildQuotePdf({ quote, customer, part, material, shop });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(600);
  });

  it('is a well-formed PDF (header, EOF, single page, fonts)', async () => {
    const s = await bytesOf(buildQuotePdf({ quote, customer, part, material, shop }));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('/Count 1');
    expect(s).toContain('/BaseFont /Helvetica');
    expect(s).toContain('startxref');
  });

  it('has a correct xref table (offsets point at their objects)', async () => {
    const s = await bytesOf(buildQuotePdf({ quote, customer, part, material, shop }));
    // Parse the xref entries and verify each non-free offset lands on "<n> 0 obj".
    // Use the xref TABLE (\nxref\n), not the 'xref' inside 'startxref'.
    const xrefIdx = s.indexOf('\nxref\n') + 1;
    const header = s.slice(xrefIdx).match(/xref\s+0\s+(\d+)/);
    expect(header).not.toBeNull();
    const entryRe = /(\d{10}) (\d{5}) (n|f)\s/g;
    let m: RegExpExecArray | null;
    let objNum = 0;
    while ((m = entryRe.exec(s.slice(xrefIdx))) !== null) {
      const [, off, , kind] = m;
      if (kind === 'n') {
        const at = parseInt(off, 10);
        expect(s.slice(at, at + 20)).toContain(`${objNum} 0 obj`);
      }
      objNum++;
    }
    expect(objNum).toBeGreaterThanOrEqual(7); // 6 objects + the free entry
  });

  it('escapes parentheses so text cannot corrupt the stream', async () => {
    const tricky = { ...quote, notes: 'Chamfer (0.5mm) both ends \\ verify' } as unknown as Quote;
    const s = await bytesOf(buildQuotePdf({ quote: tricky, customer, part, material, shop }));
    expect(s).toContain('\\(0.5mm\\)');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('renders the money figures and shop name', async () => {
    const s = await bytesOf(buildQuotePdf({ quote, customer, part, material, shop }));
    expect(s).toContain('Turncircuit Ltd');
    expect(s).toContain('845.00');
    expect(s).toContain('GRAND TOTAL');
  });

  it('survives missing customer / part / shop', async () => {
    const blob = buildQuotePdf({ quote });
    const s = await bytesOf(blob);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

// --- Currency -------------------------------------------------------------
// The shop picks a currency in Settings, and the quote PDF hardcoded '$'. A
// shop set to GBP had dollars printed on the document it sent to its customer.
describe('the quote PDF prints the shop currency', () => {
  const base = {
    quote: { id: 'q1', quoteNumber: 'Q-1', unitPrice: 123.45, grandTotal: 123.45, quantity: 1 } as any,
    customer: { id: 'c1', name: 'Acme' } as any,
    part: { id: 'p1', name: 'Part', features: {} } as any,
    material: { id: 'm1', name: 'Aluminium 6082', pricePerKg: 6 } as any,
  };
  const textOf = async (blob: Blob) => await blob.text();

  it('uses £ when the shop is set to GBP, not $', async () => {
    const pdf = await textOf(buildQuotePdf({ ...base, shop: { currency: 'GBP' } as any }));
    // £ must reach the reader as the single byte 0xA3, written as an octal
    // escape — a raw character would be UTF-8 encoded and render as "Â£".
    expect(pdf).toContain('\\243');
    expect(pdf).toContain('WinAnsiEncoding');
  });

  it('still uses $ when the shop is set to USD', async () => {
    const pdf = await textOf(buildQuotePdf({ ...base, shop: { currency: 'USD' } as any }));
    expect(pdf).toContain('$');
    expect(pdf).not.toContain('\\243');
  });

  it('defaults to $ when no currency is configured', async () => {
    const pdf = await textOf(buildQuotePdf({ ...base }));
    expect(pdf).toContain('$');
  });

  it('escapes every non-ASCII character as a byte the reader can decode', () => {
    // Anything left raw here would be re-encoded by the Blob and drawn wrong.
    const out = esc('£100 — 50µm ⌀12 €9');
    expect(out).not.toMatch(/[^\x00-\x7F]/);
    expect(out).toContain('\\243'); // £
    expect(out).toContain('\\200'); // €
    expect(out).toContain('dia 12');
  });
});
