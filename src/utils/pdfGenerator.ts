/**
 * A mock PDF generator utility that simulates creating a quote PDF.
 * In a real app, this would use jspdf or a similar library.
 */

export function downloadQuotePDF(quoteData: any, customerData: any, partData: any) {
  const content = `
QUOTE FORGE - OFFICIAL QUOTE
----------------------------
Quote Number: ${quoteData.quoteNumber}
Date: ${new Date().toLocaleDateString()}
Valid Until: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}

CUSTOMER
----------------------------
Company: ${customerData?.name || 'N/A'}
Contact: ${customerData?.contactName || 'N/A'}
Email: ${customerData?.email || 'N/A'}

PART SPECIFICATIONS
----------------------------
Part Name: ${partData?.name || 'N/A'}
Material: ${partData?.materialId || 'N/A'}
Dimensions: ${partData?.features?.lengthMm || 0} x ${partData?.features?.widthMm || 0} mm
Thickness: ${partData?.thicknessMm || 0} mm

COST BREAKDOWN
----------------------------
Quantity: ${quoteData.quantity}
Unit Price: $${quoteData.totalUnitPrice.toFixed(2)}
Subtotal: $${(quoteData.totalUnitPrice * quoteData.quantity).toFixed(2)}
Rush Premium: $${quoteData.rushPremium ? quoteData.rushPremium.toFixed(2) : '0.00'}
----------------------------
TOTAL AMOUNT: $${quoteData.grandTotal.toFixed(2)}

TERMS & CONDITIONS
----------------------------
${customerData?.terms || 'Net 30'}
Lead Time: ${quoteData.leadTimeDays || 10} business days
  `;

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${quoteData.quoteNumber}_Quote.pdf`; // Using .pdf for authentic feel
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
