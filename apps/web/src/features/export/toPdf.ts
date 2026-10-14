import type { TripExport } from 'contracts';
import { buildPdfModel } from './exportModel';

/** Builds the summary PDF in the browser (jsPDF loaded on demand); readable on a phone, printable. */
export async function toPdfBlob(exp: TripExport): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const model = buildPdfModel(exp);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  let y = margin + 10;

  doc.setFontSize(18);
  doc.text(model.title, margin, y);
  y += 20;
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(model.subtitle, margin, y);
  y += 16;
  if (model.notice) {
    doc.text(doc.splitTextToSize(model.notice, doc.internal.pageSize.getWidth() - margin * 2) as string[], margin, y);
    y += 24;
  }
  doc.setTextColor(0);

  for (const section of model.sections) {
    doc.setFontSize(12);
    doc.text(section.heading, margin, y + 14);
    autoTable(doc, {
      startY: y + 20,
      head: [section.head],
      body: section.body.length ? section.body : [[...section.head.map((_, i) => (i === 0 ? 'Sin datos' : ''))]],
      margin: { left: margin, right: margin },
      styles: { fontSize: 10 },
      headStyles: { fillColor: [15, 118, 110] },
      columnStyles: Object.fromEntries(section.head.slice(1).map((_, i) => [i + 1, { halign: 'right' as const }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(model.footer, margin, doc.internal.pageSize.getHeight() - 20);
  return doc.output('blob');
}
