/**
 * Quote PDF generator — dependency-free.
 *
 * Writes a real, valid PDF 1.4 document (the old version wrote a plain-text blob
 * with a .pdf name, which every PDF viewer reported as corrupt). It emits the file
 * by hand — objects, content stream, and a correct cross-reference table — using
 * the built-in Helvetica fonts, so nothing has to be embedded and no library is
 * required. Layout is a single Letter page: shop header, customer, part, an
 * itemised cost breakdown and terms.
 */
import type { Quote, Customer, Part, Material, ShopSettings } from '../types';

export const PAGE_W = 612; // US Letter, points
export const PAGE_H = 792;
export const MARGIN = 54;

// Approx Helvetica advance widths (fraction of em) for right-aligning columns.
const W_DIGIT = 0.556;
const W_NARROW = 0.278; // . , : space ( ) i l
const W_WIDE = 0.722; // W M — treated generously
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    if (/[0-9$]/.test(ch)) w += W_DIGIT;
    else if (/[.,: ()il]/.test(ch)) w += W_NARROW;
    else if (/[WM]/.test(ch)) w += W_WIDE;
    else w += 0.55;
  }
  return w * size;
}

/** Escape ( ) and \ and drop characters Latin-1 can't encode. */
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/⌀/g, 'dia ')
    .replace(/[–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '') // keep printable ASCII + Latin-1
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

/** Minimal content-stream builder in top-left coordinates (y grows downward). */
export class Page {
  private ops: string[] = [];

  text(x: number, yTop: number, s: string, font: 'F1' | 'F2' = 'F1', size = 10) {
    this.ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${(PAGE_H - yTop).toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  textRight(xRight: number, yTop: number, s: string, font: 'F1' | 'F2' = 'F1', size = 10) {
    this.text(xRight - textWidth(s, size), yTop, s, font, size);
  }
  line(x1: number, yTop: number, x2: number, width = 0.5, gray = 0.8) {
    const y = (PAGE_H - yTop).toFixed(2);
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y} m ${x2.toFixed(2)} ${y} l S 0 G`);
  }
  stream(): string {
    return this.ops.join('\n');
  }
}

export interface QuotePdfInput {
  quote: Quote;
  customer?: Customer;
  part?: Part;
  material?: Material;
  shop?: Partial<ShopSettings>;
}

/** Build the quote PDF as a Blob (application/pdf). */
export function buildQuotePdf(input: QuotePdfInput): Blob {
  const { quote, customer, part, material, shop } = input;
  const p = new Page();
  let y = MARGIN;

  // --- Header --------------------------------------------------------------
  p.text(MARGIN, y + 4, shop?.name || 'QuoteForge Machining', 'F2', 20);
  p.textRight(PAGE_W - MARGIN, y + 2, 'QUOTATION', 'F2', 18);
  y += 20;
  if (shop?.address) {
    for (const ln of String(shop.address).split(/,\s*/)) {
      p.text(MARGIN, y, ln, 'F1', 9);
      y += 11;
    }
  }
  // Meta (right column)
  let my = MARGIN + 24;
  const metaRight = (label: string, val: string) => {
    p.textRight(PAGE_W - MARGIN - 90, my, label, 'F1', 9);
    p.textRight(PAGE_W - MARGIN, my, val, 'F2', 9);
    my += 13;
  };
  metaRight('Quote #', quote.quoteNumber || '-');
  metaRight('Date', new Date().toLocaleDateString());
  metaRight('Valid until', quote.validUntilDate || new Date(Date.now() + 30 * 864e5).toLocaleDateString());

  y = Math.max(y, my) + 8;
  p.line(MARGIN, y, PAGE_W - MARGIN, 1, 0.6);
  y += 22;

  // --- Bill to + Part (two columns) ---------------------------------------
  const colR = PAGE_W / 2 + 10;
  p.text(MARGIN, y, 'BILL TO', 'F2', 9);
  p.text(colR, y, 'PART', 'F2', 9);
  y += 15;
  const rows: Array<[string, string]> = [
    [customer?.name || 'N/A', part?.name || 'N/A'],
    [customer?.contactName || '', material?.name || part?.materialId || ''],
    [customer?.email || '', part?.features ? `${part.features.lengthMm || 0} x ${part.features.widthMm || 0} x ${part.features.heightMm || 0} mm` : ''],
  ];
  for (const [l, r] of rows) {
    if (l) p.text(MARGIN, y, l, 'F1', 10);
    if (r) p.text(colR, y, r, 'F1', 10);
    y += 14;
  }
  y += 14;

  // --- Cost table ----------------------------------------------------------
  const xDesc = MARGIN;
  const xQty = 330;
  const xUnit = 430;
  const xTotal = PAGE_W - MARGIN;
  p.line(MARGIN, y - 4, PAGE_W - MARGIN, 0.5, 0.85);
  p.text(xDesc, y + 8, 'DESCRIPTION', 'F2', 9);
  p.textRight(xQty, y + 8, 'QTY', 'F2', 9);
  p.textRight(xUnit, y + 8, 'UNIT', 'F2', 9);
  p.textRight(xTotal, y + 8, 'TOTAL', 'F2', 9);
  y += 14;
  p.line(MARGIN, y, PAGE_W - MARGIN, 0.5, 0.85);
  y += 16;

  const unit = quote.totalUnitPrice ?? 0;
  const qty = quote.quantity ?? 1;
  p.text(xDesc, y, part?.name || 'Machined part', 'F1', 10);
  p.textRight(xQty, y, String(qty), 'F1', 10);
  p.textRight(xUnit, y, money(unit), 'F1', 10);
  p.textRight(xTotal, y, money(unit * qty), 'F1', 10);
  y += 16;

  // Itemised operations from the cached machining breakdown, if present. When a
  // per-setup plan exists, list it the way the shop reads a job — Setup → each
  // operation with its cutter — then the material/setup/tooling charges.
  const plan = quote.machiningCosts?.plan;
  const lineFor = (label: string, value: number, indent = 12, font: 'F1' | 'F2' = 'F1') => {
    p.text(xDesc + indent, y, label, font, 8.5);
    p.textRight(xTotal, y, money(value * qty), font, 8.5);
    y += 12;
  };
  if (plan && plan.setups.length) {
    let lines = 0;
    const cap = 22; // keep the breakdown on the page
    const mat = quote.machiningCosts?.lineItems?.find((l) => l.key === 'material');
    if (mat) { lineFor(mat.name, mat.value); lines++; }
    for (const s of plan.setups) {
      if (lines >= cap) break;
      p.text(xDesc + 8, y, s.name, 'F2', 8.5); y += 12; lines++;
      for (const op of s.operations) {
        if (lines >= cap) break;
        p.text(xDesc + 18, y, `${op.name} — ${op.tool}`, 'F1', 8);
        p.textRight(xTotal, y, money(op.cost * qty), 'F1', 8);
        y += 11; lines++;
      }
    }
    for (const key of ['noncut', 'setup', 'setupCharge', 'fixture', 'tooling']) {
      const li = quote.machiningCosts?.lineItems?.find((l) => l.key === key);
      if (li && li.value > 0.005 && lines < cap + 6) { lineFor(li.name, li.value); lines++; }
    }
  } else {
    const items = quote.machiningCosts?.lineItems ?? [];
    for (const li of items.slice(0, 8)) {
      p.text(xDesc + 12, y, `- ${li.name}`, 'F1', 8.5);
      p.textRight(xTotal, y, money((li.value ?? 0) * qty), 'F1', 8.5);
      y += 12;
    }
  }
  y += 6;
  p.line(MARGIN, y, PAGE_W - MARGIN, 0.5, 0.85);
  y += 16;

  // --- Totals --------------------------------------------------------------
  const totalRow = (label: string, val: string, bold = false, size = 10) => {
    p.textRight(xUnit, y, label, bold ? 'F2' : 'F1', size);
    p.textRight(xTotal, y, val, bold ? 'F2' : 'F1', size);
    y += bold ? 20 : 15;
  };
  if (quote.costs?.rushPremium) {
    totalRow('Rush premium', money(quote.costs.rushPremium));
  }
  totalRow('GRAND TOTAL', money(quote.grandTotal ?? unit * qty), true, 13);

  // --- Terms ---------------------------------------------------------------
  y += 10;
  p.line(MARGIN, y, PAGE_W - MARGIN, 0.5, 0.85);
  y += 18;
  p.text(MARGIN, y, 'TERMS', 'F2', 9);
  y += 14;
  p.text(MARGIN, y, `Payment: ${customer?.terms || 'Net 30'}`, 'F1', 10);
  y += 14;
  p.text(MARGIN, y, `Lead time: ${quote.leadTimeDays ?? 10} business days`, 'F1', 10);
  y += 14;
  if (quote.notes) {
    y += 6;
    p.text(MARGIN, y, 'Notes:', 'F2', 9);
    y += 13;
    for (const ln of wrap(quote.notes, 96)) {
      p.text(MARGIN, y, ln, 'F1', 9);
      y += 12;
    }
  }

  // --- Footer --------------------------------------------------------------
  p.line(MARGIN, PAGE_H - MARGIN, PAGE_W - MARGIN, 0.5, 0.85);
  p.text(MARGIN, PAGE_H - MARGIN + 14, 'This quotation is an estimate and subject to review of final drawings and tolerances.', 'F1', 8);
  p.textRight(PAGE_W - MARGIN, PAGE_H - MARGIN + 14, 'Generated by QuoteForge', 'F1', 8);

  return assemblePdf(p.stream());
}

/** Simple greedy word-wrap to a character budget. */
export function wrap(s: string, width: number, maxLines = 6): string[] {
  const words = String(s).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Wrap a content stream into a complete, valid single-page PDF with an xref table. */
export function assemblePdf(content: string): Blob {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // Latin-1 bytes (esc() guarantees every char is <= 0xFF).
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Build the quote PDF and trigger a download. */
export function downloadQuotePDF(
  quote: Quote,
  customer?: Customer,
  part?: Part,
  material?: Material,
  shop?: Partial<ShopSettings>
) {
  const blob = buildQuotePdf({ quote, customer, part, material, shop });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${quote.quoteNumber || 'quote'}_Quote.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
