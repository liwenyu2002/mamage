const ENGINE = 'mamage-tone-v1';

const DEFAULT_PHOTO_ADJUSTMENTS = Object.freeze({
  version: 1,
  engine: ENGINE,
  brightness: 0,
  contrast: 0,
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
    && Math.abs(a.temperature) < 0.01
    && Math.abs(a.tint) < 0.01;
}

function getPhotoAdjustmentStyle(input) {
  const a = normalizePhotoAdjustments(input);
  if (isDefaultPhotoAdjustments(a)) return undefined;
  const exposure = Math.pow(2, (a.brightness / 100) * 1.25);
  const contrast = 1 + (a.contrast / 100) * 0.72;
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

function applyToneToRgb(r, g, b, input) {
  const a = normalizePhotoAdjustments(input);
  const exposure = Math.pow(2, (a.brightness / 100) * 1.25);
  const contrast = (a.contrast / 100) * 0.65;
  const gains = Array.isArray(a.wbGains) ? a.wbGains : [1, 1, 1];
  let lr = srgbToLinear(r) * gains[0] * exposure;
  let lg = srgbToLinear(g) * gains[1] * exposure;
  let lb = srgbToLinear(b) * gains[2] * exposure;
  const applyContrast = (x) => clamp(x + contrast * (x - 0.5) * 4 * x * (1 - x), 0, 1);
  lr = applyContrast(lr);
  lg = applyContrast(lg);
  lb = applyContrast(lb);
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
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

  const p10 = percentileFromHistogram(sourceHistogram, 0.1);
  const p50 = percentileFromHistogram(sourceHistogram, 0.5);
  const p90 = percentileFromHistogram(sourceHistogram, 0.9);
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

  const median = Math.max(8, p50);
  const ev = clamp(Math.log2(115 / median), -0.72, 0.72);
  const brightness = clamp((ev / 1.25) * 100, -58, 58);
  const spread = p90 - p10;
  const contrast = clamp((122 - spread) * 0.45, -18, 34);
  const autoAdjustments = buildPhotoAdjustments({
    brightness,
    contrast,
    temperature: autoTemperature,
    tint: autoTint,
  }, 'auto');

  return {
    sourceHistogram,
    adjustedHistogram,
    clipping,
    stats: { p10, p50, p90, colorSamples },
    autoAdjustments,
  };
}

export {
  DEFAULT_PHOTO_ADJUSTMENTS,
  normalizePhotoAdjustments,
  buildPhotoAdjustments,
  isDefaultPhotoAdjustments,
  getPhotoAdjustmentStyle,
  analyzePhotoTone,
};
