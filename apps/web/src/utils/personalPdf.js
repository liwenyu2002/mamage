import { renderPersonalCanvas, encodePersonalCanvas } from './personalImageTools';
import { personalPdfLayout } from './personalDocumentLayout';
import { rotatedSize, cropPixels } from '../../../server/lib/photo_tone/geometry.mjs';

const check = signal => { if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError'); };

export async function exportPersonalPdf(items, options = {}, onProgress) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('PDF 需要 1–20 张图片');
  const pixels = items.reduce((sum, item) => {
    const bounds = rotatedSize(item.width, item.height, item.adjustments?.rotation || 0);
    const area = cropPixels(bounds.width, bounds.height, item.adjustments?.crop);
    personalPdfLayout(area.width, area.height, options);
    return sum + area.width * area.height;
  }, 0);
  if (pixels > 120000000) throw new Error('本次 PDF 图片总像素过大，请分批导出或先缩小图片');
  check(options.signal);
  const { PDFDocument } = await import(/* webpackChunkName: "personal-pdf-engine" */ 'pdf-lib');
  const document = await PDFDocument.create();
  document.setCreator('MaMage'); document.setProducer('MaMage');
  const title = String(options.title || '图片资料').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) || '图片资料';
  document.setTitle(title);
  let totalBytes = 0;
  for (let index = 0; index < items.length; index++) {
    check(options.signal);
    const canvas = await renderPersonalCanvas(items[index], options);
    try {
      // Embed only the flattened, redacted raster. Never attach the source file.
      const context = canvas.getContext('2d');
      context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height); context.globalCompositeOperation = 'source-over';
      const { blob } = await encodePersonalCanvas(canvas, { format: 'png', maxEdge: Math.max(canvas.width, canvas.height), signal: options.signal });
      totalBytes += blob.size;
      if (totalBytes > 80000000) throw new Error('PDF 图片内容超过 80 MB，请分批导出或先压缩图片');
      check(options.signal);
      const image = await document.embedPng(await blob.arrayBuffer());
      const layout = personalPdfLayout(canvas.width, canvas.height, options);
      document.addPage([layout.pageWidth, layout.pageHeight]).drawImage(image, {
        x: layout.x, y: layout.y, width: layout.imageWidth, height: layout.imageHeight,
      });
      await document.flush();
      onProgress?.(index + 1, items.length);
    } finally { canvas.width = canvas.height = 0; }
  }
  check(options.signal);
  const data = await document.save();
  check(options.signal);
  return { blob: new Blob([data], { type: 'application/pdf' }), pages: items.length,
    name: `${title.replace(/[<>:"/\\|?*]/g, '_')}.pdf` };
}
