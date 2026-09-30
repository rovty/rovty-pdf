import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ScannerClient } from './scannerClient';
import { scanPageLayout, type ScanPage, type ScanExportOptions } from './scannerTypes';
import type { Output } from './types';
export async function exportScans(
  pages: ScanPage[],
  client: ScannerClient,
  options: ScanExportOptions,
  progress: (value: number) => void,
  signal: AbortSignal,
): Promise<Output> {
  if (!pages.length) throw new Error('Add at least one scan.');
  const pdf = await PDFDocument.create();
  pdf.setProducer('Rovty PDF');
  pdf.setCreator('Rovty PDF');
  pdf.setTitle(options.name.trim() || 'Scanned document');
  const labelFont = options.idLayout ? await pdf.embedFont(StandardFonts.Helvetica) : undefined;
  for (const [index, page] of pages.entries()) {
    signal.throwIfAborted();
    const rendered = await client.run({
      action: 'render',
      blob: page.source,
      quad: page.quad,
      settings: page,
      maxEdge: options.quality === 'high' ? 3200 : 2200,
    });
    signal.throwIfAborted();
    const image = await pdf.embedJpg(await rendered.blob.arrayBuffer());
    if (options.idLayout) {
      const sheet = index % 2 === 0 ? pdf.addPage([595.28, 841.89]) : pdf.getPages().at(-1)!;
      const cardWidth = (85.6 * 72) / 25.4,
        cardHeight = (54 * 72) / 25.4;
      const scale = Math.min(cardWidth / image.width, cardHeight / image.height);
      const width = image.width * scale,
        height = image.height * scale;
      const top = index % 2 === 0 ? 700 : 470;
      sheet.drawText(index % 2 === 0 ? 'Front' : 'Back', {
        x: (595.28 - cardWidth) / 2,
        y: top + 14,
        size: 9,
        font: labelFont,
        color: rgb(0.4, 0.4, 0.4),
      });
      sheet.drawImage(image, { x: (595.28 - width) / 2, y: top - height, width, height });
    } else {
      const layout = scanPageLayout(image.width, image.height, options);
      pdf.addPage([layout.width, layout.height]).drawImage(image, {
        x: layout.x,
        y: layout.y,
        width: layout.drawnWidth,
        height: layout.drawnHeight,
      });
    }
    progress((index + 1) / pages.length);
  }
  signal.throwIfAborted();
  const name = (options.name.trim() || 'Rovty scan')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\.pdf$/i, '')
    .slice(0, 100);
  return { name: `${name || 'Rovty scan'}.pdf`, bytes: await pdf.save(), mime: 'application/pdf' };
}
