export function generateQuoteNumber(): string {
  const currentYear = new Date().getFullYear();
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `Q-${currentYear}-${randomNum}`;
}

export function generateId(prefix: string = ''): string {
  return `${prefix}${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Next sequential document number for a series, e.g. JOB-1042 / INV-1042.
 * Sequential (not random) because work orders and invoices are shop records the
 * floor and the accounts refer to by number — gaps and collisions confuse people
 * and, for invoices, auditors. Existing numbers are scanned so the counter
 * survives a reload without a separate stored sequence.
 */
export function nextDocNumber(existing: string[], prefix: string, start = 1001): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = start - 1;
  for (const n of existing) {
    const m = re.exec((n ?? '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}
