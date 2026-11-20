import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { renderPersonalCanvas, encodePersonalCanvas } from './utils/personalImageTools';
import { getToneAdjustmentKey } from './utils/photoAdjustments';

export default function PersonalFileThumbnail({ item }) {
  const marked = Boolean(item.annotations?.length);
  const key = JSON.stringify([item.id, getToneAdjustmentKey(item.adjustments), item.annotations || []]);
  const [thumbnail, setThumbnail] = React.useState(null);
  React.useEffect(() => {
    if (!marked) return undefined;
    const abort = new AbortController(); let url;
    void (async () => {
      let canvas;
      try {
        canvas = await renderPersonalCanvas(item, { signal: abort.signal });
        const result = await encodePersonalCanvas(canvas, { format: 'png', maxEdge: 160, signal: abort.signal });
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(result.blob); setThumbnail({ key, url });
      } catch { /* A failed private thumbnail must not fall back to the original. */ }
      finally { if (canvas) canvas.width = canvas.height = 0; }
    })();
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, marked]);
  if (!marked) return <img src={item.url} alt={item.name} />;
  return thumbnail?.key === key ? <img src={thumbnail.url} alt={item.name} data-flattened="true" />
    : <span className="personal-private-thumbnail" aria-label="正在准备已遮挡的缩略图"><ShieldCheck size={20} /></span>;
}
