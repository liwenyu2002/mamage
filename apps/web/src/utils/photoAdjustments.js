const ENGINE = 'mamage-tone-v1';

const DEFAULT_PHOTO_ADJUSTMENTS = Object.freeze({
  version: 1,
  engine: ENGINE,
  brightness: 0,
  contrast: 0,
  whites: 0,
  highlights: 0,
  shadows: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  wbGains: [1, 1, 1],
  source: 'manual',
});

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function computeWbGains(temperature = 0, tint = 0) {
  const t = clamp(temperature, -100, 100) / 100;
  const g = clamp(tint, -100, 100) / 100;
  return [
    clamp(1 + t * 0.22, 0.5, 1.8),
    clamp(1 - g * 0.16, 0.5, 1.8),
    clamp(1 - t * 0.22, 0.5, 1.8),
  ];
}

function normalizePhotoAdjustments(input) {
  if (!input) return { ...DEFAULT_PHOTO_ADJUSTMENTS, wbGains: [...DEFAULT_PHOTO_ADJUSTMENTS.wbGains] };
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  const brightness = clamp(parsed.brightness, -100, 100, 0);
  const contrast = clamp(parsed.contrast, -100, 100, 0);
  const whites = clamp(parsed.whites, -100, 100, 0);
  const highlights = clamp(parsed.highlights, -100, 100, 0);
  const shadows = clamp(parsed.shadows, -100, 100, 0);
  const blacks = clamp(parsed.blacks, -100, 100, 0);
  const temperature = clamp(parsed.temperature, -100, 100, 0);
  const tint = clamp(parsed.tint, -100, 100, 0);
  const rawGains = Array.isArray(parsed.wbGains) && parsed.wbGains.length >= 3
    ? parsed.wbGains
    : computeWbGains(temperature, tint);
  return {
    version: 1,
    engine: ENGINE,
    brightness,
    contrast,
    whites,
    highlights,
    shadows,
    blacks,
    temperature,
    tint,
    wbGains: [0, 1, 2].map((idx) => clamp(rawGains[idx], 0.5, 1.8, 1)),
    source: parsed.source || 'manual',
    updatedAt: parsed.updatedAt || null,
  };
}

function buildPhotoAdjustments(values = {}, source = 'manual') {
  const base = normalizePhotoAdjustments(values);
  const wbGains = computeWbGains(base.temperature, base.tint);
  return {
    ...base,
    wbGains,
    source,
    updatedAt: new Date().toISOString(),
  };
}

function isDefaultPhotoAdjustments(input) {
  const a = normalizePhotoAdjustments(input);
  return Math.abs(a.brightness) < 0.01
    && Math.abs(a.contrast) < 0.01
    && Math.abs(a.whites) < 0.01
    && Math.abs(a.highlights) < 0.01
    && Math.abs(a.shadows) < 0.01
    && Math.abs(a.blacks) < 0.01
    && Math.abs(a.temperature) < 0.01
    && Math.abs(a.tint) < 0.01;
}

function getPhotoAdjustmentStyle(input) {
  const a = normalizePhotoAdjustments(input);
  if (isDefaultPhotoAdjustments(a)) return undefined;
  const zoneExposure = (a.whites * 0.002)
    + (a.highlights * 0.0012)
    + (a.shadows * 0.0008)
    + (a.blacks * 0.0005);
  const zoneContrast = ((a.whites - a.blacks) * 0.0018)
    + ((a.highlights - a.shadows) * 0.0012);
  const exposure = Math.pow(2, ((a.brightness / 100) * 1.25) + zoneExposure);
  const contrast = clamp(1 + (a.contrast / 100) * 0.72 + zoneContrast, 0.25, 2.2, 1);
  const temp = a.temperature / 100;
  const tint = a.tint / 100;
  const sepia = Math.max(0, temp) * 0.14;
  const hue = (-temp * 8) + (tint * 10);
  const saturate = 1 + Math.abs(temp) * 0.05 + Math.abs(tint) * 0.06;
  return {
    filter: `brightness(${exposure.toFixed(4)}) contrast(${contrast.toFixed(4)}) saturate(${saturate.toFixed(4)}) sepia(${sepia.toFixed(4)}) hue-rotate(${hue.toFixed(3)}deg)`,
  };
}

function srgbToLinear(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const x = clamp(v, 0, 1);
  const y = x <= 0.0031308 ? x * 12.92 : (1.055 * Math.pow(x, 1 / 2.4)) - 0.055;
  return clamp(Math.round(y * 255), 0, 255);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1, 0);
  return x * x * (3 - (2 * x));
}

function zoneDeltaForLuma(luma, adjustments) {
  const blacksMask = 1 - smoothstep(0.03, 0.28, luma);
  const shadowsMask = 1 - smoothstep(0.18, 0.56, luma);
  const highlightsMask = smoothstep(0.48, 0.86, luma);
  const whitesMask = smoothstep(0.72, 0.98, luma);

  return ((adjustments.blacks / 100) * 0.12 * blacksMask)
    + ((adjustments.shadows / 100) * 0.18 * shadowsMask)
    + ((adjustments.highlights / 100) * 0.16 * highlightsMask)
    + ((adjustments.whites / 100) * 0.11 * whitesMask);
}

function applyToneToRgbNormalized(r, g, b, a) {
  const exposure = Math.pow(2, (a.brightness / 100) * 1.25);
  const contrast = (a.contrast / 100) * 0.65;
  const gains = Array.isArray(a.wbGains) ? a.wbGains : [1, 1, 1];
  let lr = srgbToLinear(r) * gains[0] * exposure;
  let lg = srgbToLinear(g) * gains[1] * exposure;
  let lb = srgbToLinear(b) * gains[2] * exposure;
  const luma = clamp((0.2126 * lr) + (0.7152 * lg) + (0.0722 * lb), 0, 1, 0);
  const zoneDelta = zoneDeltaForLuma(luma, a);
  lr = clamp(lr + zoneDelta, 0, 1);
  lg = clamp(lg + zoneDelta, 0, 1);
  lb = clamp(lb + zoneDelta, 0, 1);
  const applyContrast = (x) => clamp(x + contrast * (x - 0.5) * 4 * x * (1 - x), 0, 1);
  lr = applyContrast(lr);
  lg = applyContrast(lg);
  lb = applyContrast(lb);
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

function applyToneToRgb(r, g, b, input) {
  return applyToneToRgbNormalized(r, g, b, normalizePhotoAdjustments(input));
}

function getLuma(r, g, b) {
  return clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), 0, 255);
}

function percentileFromHistogram(histogram, ratio) {
  const total = histogram.reduce((sum, v) => sum + v, 0);
  if (!total) return 0;
  const target = total * ratio;
  let acc = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    acc += histogram[i];
    if (acc >= target) return i;
  }
  return 255;
}

function histogramRangeRatio(histogram, start, end) {
  const total = histogram.reduce((sum, v) => sum + v, 0);
  if (!total) return 0;
  const from = Math.max(0, Math.min(255, Math.floor(start)));
  const to = Math.max(from, Math.min(255, Math.ceil(end)));
  let count = 0;
  for (let i = from; i <= to; i += 1) count += histogram[i] || 0;
  return count / total;
}

function previewTonePercentiles(data, adjustments, sampleStep = 12) {
  const histogram = Array(256).fill(0);
  const step = Math.max(1, Math.floor(sampleStep));
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    const [r, g, b] = applyToneToRgb(data[i], data[i + 1], data[i + 2], adjustments);
    histogram[getLuma(r, g, b)] += 1;
  }
  return {
    p01: percentileFromHistogram(histogram, 0.01),
    p99: percentileFromHistogram(histogram, 0.99),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!/^blob:|^data:/i.test(String(src || ''))) {
      img.crossOrigin = 'anonymous';
    }
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片无法用于直方图计算'));
    img.src = src;
  });
}

async function analyzePhotoTone(src, adjustments, options = {}) {
  if (!src) throw new Error('缺少图片地址');
  const maxSize = Math.max(160, Math.min(1200, Number(options.maxSize || 640)));
  const img = await loadImage(src);
  const naturalW = img.naturalWidth || img.width || maxSize;
  const naturalH = img.naturalHeight || img.height || maxSize;
  const scale = Math.min(1, maxSize / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const sourceHistogram = Array(256).fill(0);
  const adjustedHistogram = Array(256).fill(0);
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let colorSamples = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 10) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = getLuma(r, g, b);
    sourceHistogram[luma] += 1;
    const [ar, ag, ab] = applyToneToRgb(r, g, b, adjustments);
    adjustedHistogram[getLuma(ar, ag, ab)] += 1;

    if (luma > 28 && luma < 238) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 88) {
        rSum += r;
        gSum += g;
        bSum += b;
        colorSamples += 1;
      }
    }
  }

  const p02 = percentileFromHistogram(sourceHistogram, 0.02);
  const p10 = percentileFromHistogram(sourceHistogram, 0.1);
  const p50 = percentileFromHistogram(sourceHistogram, 0.5);
  const p90 = percentileFromHistogram(sourceHistogram, 0.9);
  const p97 = percentileFromHistogram(sourceHistogram, 0.97);
  const sourceP99 = percentileFromHistogram(sourceHistogram, 0.99);
  const p01 = percentileFromHistogram(adjustedHistogram, 0.01);
  const p99 = percentileFromHistogram(adjustedHistogram, 0.99);
  const total = adjustedHistogram.reduce((sum, v) => sum + v, 0) || 1;
  const clipping = {
    shadows: adjustedHistogram[0] / total,
    highlights: adjustedHistogram[255] / total,
    p01,
    p99,
  };

  let autoTemperature = 0;
  let autoTint = 0;
  if (colorSamples > 80) {
    const avgR = rSum / colorSamples;
    const avgG = gSum / colorSamples;
    const avgB = bSum / colorSamples;
    autoTemperature = clamp(((avgB - avgR) / 255) * 150, -35, 35);
    autoTint = clamp(((avgG - ((avgR + avgB) / 2)) / 255) * 150, -28, 28);
  }

  const brightTail = histogramRangeRatio(sourceHistogram, 240, 255);
  const clippedBright = histogramRangeRatio(sourceHistogram, 252, 255);
  const lowKeyPressure = clamp((92 - p50) / 58, 0, 1, 0) * clamp((188 - p90) / 128, 0, 1, 0);
  const tonalRange = p90 - p10;
  const highDynamicRange = clamp((tonalRange - 135) / 85, 0, 0.7, 0);
  const targetMedian = 104 - lowKeyPressure * 24 + clamp((p50 - 142) / 80, 0, 1, 0) * 10;
  const maxLiftEv = 0.26 - lowKeyPressure * 0.08;
  const maxDropEv = -0.32 + highDynamicRange * 0.18;
  const median = Math.max(10, p50);
  let ev = Math.log2(targetMedian / median) * (1 - highDynamicRange * 0.75);
  ev = clamp(ev, maxDropEv, maxLiftEv);
  let brightness = clamp((ev / 1.25) * 100, -28, 24);
  let contrast = clamp((112 - tonalRange) * 0.14, -8, 12);
  let whites = clamp(
    sourceP99 > 246 ? -((sourceP99 - 246) * 0.42) - (clippedBright * 70) : (sourceP99 < 220 ? (220 - sourceP99) * 0.16 : 0),
    -12,
    8,
  );
  const protectHighlights = sourceP99 > 246 || p97 > 230 || brightTail > 0.08;
  const highlightsBase = protectHighlights
    ? -((Math.max(0, sourceP99 - 245) * 0.22) + (Math.max(0, p97 - 228) * 0.13) + (brightTail * 24))
    : (p90 > 210 ? -((p90 - 210) * 0.22) : (p90 < 155 ? (155 - p90) * 0.12 : 0));
  let highlights = clamp(highlightsBase, -16, protectHighlights ? 0 : 10);
  const shadowLiftScale = 1 - lowKeyPressure * 0.5;
  const shadowsBase = p10 < 42 ? (42 - p10) * 0.24 : (p10 > 78 ? -((p10 - 78) * 0.12) : 0);
  let shadows = clamp(shadowsBase * shadowLiftScale, -10, 18);
  const blacksBase = p02 < 8 ? (8 - p02) * 0.06 : (p02 > 28 ? -((p02 - 28) * 0.18) : 0);
  let blacks = clamp(blacksBase - lowKeyPressure * 7, -10, 8);

  const protectTone = previewTonePercentiles(data, {
    brightness,
    contrast,
    whites,
    highlights,
    shadows,
    blacks,
    temperature: autoTemperature,
    tint: autoTint,
  });
  const darkGap = clamp((protectTone.p01 - Math.max(5, p02 + 4)) / 24, 0, 0.65, 0);
  if (darkGap > 0) {
    if (brightness > 0) brightness *= (1 - darkGap);
    if (shadows > 0) shadows *= (1 - darkGap);
    blacks = clamp(blacks - darkGap * 8, -10, 8);
  }
  const highlightGap = clamp((Math.min(248, sourceP99) - protectTone.p99) / 24, 0, 0.65, 0);
  if (highlightGap > 0) {
    if (brightness < 0) brightness *= (1 - highlightGap);
    if (highlights < 0) highlights *= (1 - highlightGap);
    if (whites < 0) whites *= (1 - highlightGap);
    contrast *= (1 - highlightGap * 0.35);
  }
  const autoAdjustments = buildPhotoAdjustments({
    brightness: Math.round(brightness),
    contrast: Math.round(contrast),
    whites: Math.round(whites),
    highlights: Math.round(highlights),
    shadows: Math.round(shadows),
    blacks: Math.round(blacks),
    temperature: autoTemperature,
    tint: autoTint,
  }, 'auto');

  return {
    sourceHistogram,
    adjustedHistogram,
    clipping,
    stats: { p02, p10, p50, p90, p97, p99: sourceP99, colorSamples },
    autoAdjustments,
  };
}

async function renderPhotoAdjustmentsToCanvas(canvas, src, adjustments, options = {}) {
  if (!canvas) throw new Error('缺少画布');
  if (!src) throw new Error('缺少图片地址');
  const maxSize = Math.max(320, Math.min(2400, Number(options.maxSize || 1600)));
  const img = await loadImage(src);
  const naturalW = img.naturalWidth || img.width || maxSize;
  const naturalH = img.naturalHeight || img.height || maxSize;
  const scale = Math.min(1, maxSize / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');

  canvas.width = width;
  canvas.height = height;
  canvas.style.aspectRatio = `${width} / ${height}`;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const normalized = normalizePhotoAdjustments(adjustments);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    const [r, g, b] = applyToneToRgbNormalized(data[i], data[i + 1], data[i + 2], normalized);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);

  return {
    width,
    height,
    naturalWidth: naturalW,
    naturalHeight: naturalH,
  };
}

export {
  DEFAULT_PHOTO_ADJUSTMENTS,
  normalizePhotoAdjustments,
  buildPhotoAdjustments,
  isDefaultPhotoAdjustments,
  getPhotoAdjustmentStyle,
  analyzePhotoTone,
  renderPhotoAdjustmentsToCanvas,
};
