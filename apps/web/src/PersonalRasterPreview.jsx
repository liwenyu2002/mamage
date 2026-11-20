import React from 'react';
import { renderPersonalCanvas } from './utils/personalImageTools';
import { getToneAdjustmentKey } from './utils/photoAdjustments';
import { personalPdfLayout } from './utils/personalDocumentLayout';

export default function PersonalRasterPreview({ item, pdf }) {
  const ref = React.useRef(null);
  const [busy, setBusy] = React.useState(true), [error, setError] = React.useState('');
  const key = JSON.stringify([item.id, getToneAdjustmentKey(item.adjustments), item.annotations || [], pdf && [pdf.paper, pdf.orientation, pdf.margin]]);
  React.useEffect(() => {
    const abort = new AbortController();
    setBusy(true); setError('');
    if (ref.current) { ref.current.width = ref.current.height = 0; delete ref.current.dataset.ready; }
    void (async () => {
      let source;
      try {
        source = await renderPersonalCanvas(item, { signal: abort.signal });
        if (abort.signal.aborted || !ref.current) return;
        const target = ref.current, context = target.getContext('2d', { colorSpace: 'srgb' });
        if (pdf) {
          const layout = personalPdfLayout(source.width, source.height, pdf), scale = Math.min(1.8, 1200 / Math.max(layout.pageWidth, layout.pageHeight));
          target.width = Math.max(1, Math.round(layout.pageWidth * scale)); target.height = Math.max(1, Math.round(layout.pageHeight * scale));
          context.fillStyle = '#fff'; context.fillRect(0, 0, target.width, target.height);
          context.drawImage(source, layout.x * scale, layout.y * scale, layout.imageWidth * scale, layout.imageHeight * scale);
        } else { target.width = source.width; target.height = source.height; context.drawImage(source, 0, 0); }
        target.dataset.ready = 'true';
      } catch (e) { if (!abort.signal.aborted) setError(e.message); }
      finally { if (source) source.width = source.height = 0; if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => abort.abort();
  }, [key]);
  return <><canvas ref={ref} className={`personal-original-image${pdf ? ' personal-pdf-page' : ''}`} aria-label={pdf ? 'PDF 页面预览' : item.name} hidden={busy || Boolean(error)} />
    {busy ? <span className="personal-canvas-progress" role="status">正在读取图片…</span> : error ? <p className="personal-error" role="alert">{error}</p> : null}</>;
}
