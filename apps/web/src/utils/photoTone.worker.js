import { processTonePixels, analyzeTonePixels, measureToneFaces } from '../../../server/lib/photo_tone/engine.mjs';

let source, metering, meteringKey, autoKey, auto;
self.onmessage = ({ data: message }) => {
  if (message.type === 'source') { source = message.source; metering = undefined; meteringKey = undefined; autoKey = undefined; return; }
  if (message.type !== 'render' || !source) return;
  try {
    const start = performance.now();
    if (message.meteringKey !== meteringKey) {
      meteringKey = message.meteringKey;
      metering = measureToneFaces(source.data, source, message.faces);
    }
    const pixels = processTonePixels(source.data, message.adjustments);
    const key = JSON.stringify([meteringKey, ...['temperature', 'tint', 'saturation', 'vibrance', 'skinBrightness', 'skinSaturation'].map(k => message.adjustments[k])]);
    const analysis = analyzeTonePixels(source.data, pixels, message.adjustments, metering, key === autoKey ? auto : undefined);
    autoKey = key; auto = analysis.autoAdjustments;
    self.postMessage({ id: message.id, pixels, analysis, duration: performance.now() - start }, [pixels.buffer]);
  } catch (error) { self.postMessage({ id: message.id, error: error.message }); }
};
