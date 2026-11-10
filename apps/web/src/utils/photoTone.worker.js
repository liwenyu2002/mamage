import { processTonePixels, analyzeTonePixels, measureToneFaces } from '../../../server/lib/photo_tone/engine.mjs';

let source, metering, meteringKey;
self.onmessage = ({ data: message }) => {
  if (message.type === 'source') { source = message.source; metering = undefined; meteringKey = undefined; return; }
  if (message.type !== 'render' || !source) return;
  try {
    const start = performance.now();
    if (message.meteringKey !== meteringKey) {
      meteringKey = message.meteringKey;
      metering = measureToneFaces(source.data, source, message.faces);
    }
    const pixels = processTonePixels(source.data, message.adjustments);
    const analysis = analyzeTonePixels(source.data, pixels, message.adjustments, metering);
    self.postMessage({ id: message.id, pixels, analysis, duration: performance.now() - start }, [pixels.buffer]);
  } catch (error) { self.postMessage({ id: message.id, error: error.message }); }
};
