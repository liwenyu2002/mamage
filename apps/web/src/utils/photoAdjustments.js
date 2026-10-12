const ENGINE = 'mamage-tone-v2-acr-like';

const DEFAULT_PHOTO_ADJUSTMENTS = Object.freeze({
  version: 2,
  engine: ENGINE,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
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
  const highlights = clamp(parsed.highlights, -100, 100, 0);
  const shadows = clamp(parsed.shadows, -100, 100, 0);
  const whites = clamp(parsed.whites, -100, 100, 0);
  const blacks = clamp(parsed.blacks, -100, 100, 0);
  const temperature = clamp(parsed.temperature, -100, 100, 0);
  const tint = clamp(parsed.tint, -100, 100, 0);
  const rawGains = Array.isArray(parsed.wbGains) && parsed.wbGains.length >= 3
    ? parsed.wbGains
    : computeWbGains(temperature, tint);
  return {
    version: 2,
    engine: ENGINE,
    brightness,
    contrast,
    highlights,
    shadows,
    whites,
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
  const zoneExposure = (a.highlights * 0.00075)
    + (a.shadows * 0.00065)
    + (a.whites * 0.00095)
    + (a.blacks * 0.00035);
  const zoneContrast = ((a.whites - a.blacks) * 0.00095)
    + ((a.highlights - a.shadows) * 0.00055);
  const exposure = Math.pow(2, ((a.brightness / 100) * 1.12) + zoneExposure);
  const contrast = clamp(1 + (a.contrast / 100) * 0.54 + zoneContrast, 0.45, 1.85, 1);
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

function linearToSrgb(v, dither = 0) {
  const x = clamp(v, 0, 1);
  const y = x <= 0.0031308 ? x * 12.92 : (1.055 * Math.pow(x, 1 / 2.4)) - 0.055;
  return clamp(Math.round((y * 255) + dither), 0, 255);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1, 0);
  return x * x * (3 - (2 * x));
}

function curvePushPull(luma, sliderValue, mask, scale) {
  const amount = (clamp(sliderValue, -100, 100, 0) / 100) * clamp(mask, 0, 1, 0) * scale;
  if (Math.abs(amount) < 0.00001) return luma;
  const strength = 1 - Math.exp(-Math.abs(amount) * 2.2);
  if (amount > 0) {
    return clamp(luma + (1 - luma) * strength, 0, 1, luma);
  }
  return clamp(luma - luma * strength, 0, 1, luma);
}

function applyMidtoneContrast(luma, contrastValue) {
  const amount = (clamp(contrastValue, -100, 100, 0) / 100) * 0.58;
  if (Math.abs(amount) < 0.00001) return luma;
  const midMask = Math.pow(clamp(4 * luma * (1 - luma), 0, 1, 0), 0.72);
  return clamp(luma + amount * (luma - 0.5) * midMask, 0, 1, luma);
}

function acrLikeToneMapLuma(luma, adjustments) {
  let y = clamp(luma, 0, 1, 0);
  const highlightsMask = smoothstep(0.44, 0.82, y) * (1 - smoothstep(0.96, 1, y) * 0.42);
  y = curvePushPull(y, adjustments.highlights, highlightsMask, 0.34);

  const shadowsMask = (1 - smoothstep(0.18, 0.58, y)) * (0.38 + smoothstep(0.012, 0.11, y) * 0.62);
  y = curvePushPull(y, adjustments.shadows, shadowsMask, 0.36);

  const whitesMask = smoothstep(0.68, 0.985, y);
  y = curvePushPull(y, adjustments.whites, whitesMask, 0.3);

  const blacksMask = 1 - smoothstep(0.012, 0.32, y);
  y = curvePushPull(y, adjustments.blacks, blacksMask, 0.28);

  return applyMidtoneContrast(y, adjustments.contrast);
}

function fitRgbToLuma(lr, lg, lb, sourceLuma, targetLuma) {
  const y = clamp(targetLuma, 0, 1, 0);
  if (sourceLuma <= 0.000001) return [y, y, y];
  const ratio = clamp(y / sourceLuma, 0, 8, 1);
  let nr = lr * ratio;
  let ng = lg * ratio;
  let nb = lb * ratio;
  const maxChannel = Math.max(nr, ng, nb);
  if (maxChannel > 1) {
    const overshoot = maxChannel - 1;
    const blendToGray = smoothstep(0, 0.42, overshoot) * 0.72;
    nr += (y - nr) * blendToGray;
    ng += (y - ng) * blendToGray;
    nb += (y - nb) * blendToGray;
  }
  return [clamp(nr, 0, 1), clamp(ng, 0, 1), clamp(nb, 0, 1)];
}

function applyToneToRgbNormalized(r, g, b, a, dither = 0) {
  const exposure = Math.pow(2, (a.brightness / 100) * 1.12);
  const gains = Array.isArray(a.wbGains) ? a.wbGains : [1, 1, 1];
  let lr = srgbToLinear(r) * gains[0] * exposure;
  let lg = srgbToLinear(g) * gains[1] * exposure;
  let lb = srgbToLinear(b) * gains[2] * exposure;
  const luma = clamp((0.2126 * lr) + (0.7152 * lg) + (0.0722 * lb), 0, 1, 0);
  const mappedLuma = acrLikeToneMapLuma(luma, a);
  [lr, lg, lb] = fitRgbToLuma(lr, lg, lb, luma, mappedLuma);
  return [linearToSrgb(lr, dither), linearToSrgb(lg, dither), linearToSrgb(lb, dither)];
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

function previewToneStats(data, adjustments, sampleStep = 12) {
  const histogram = Array(256).fill(0);
  const step = Math.max(1, Math.floor(sampleStep));
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    const [r, g, b] = applyToneToRgb(data[i], data[i + 1], data[i + 2], adjustments);
    histogram[getLuma(r, g, b)] += 1;
  }
  const total = histogram.reduce((sum, v) => sum + v, 0) || 1;
  return {
    p005: percentileFromHistogram(histogram, 0.005),
    p01: percentileFromHistogram(histogram, 0.01),
    p50: percentileFromHistogram(histogram, 0.5),
    p99: percentileFromHistogram(histogram, 0.99),
    p995: percentileFromHistogram(histogram, 0.995),
    shadows: (histogram[0] || 0) / total,
    highlights: (histogram[255] || 0) / total,
  };
}

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function orderedDither(x, y, strength = 0.55) {
  const idx = ((y & 3) * 4) + (x & 3);
  return ((BAYER_4[idx] / 15) - 0.5) * strength;
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

  const brightTail = histogramRangeRatio(sourceHistogram, 238, 255);
  const clippedBright = histogramRangeRatio(sourceHistogram, 252, 255);
  const darkTail = histogramRangeRatio(sourceHistogram, 0, 18);
  const clippedDark = histogramRangeRatio(sourceHistogram, 0, 3);
  const lowKeyPressure = clamp((90 - p50) / 62, 0, 1, 0) * clamp((184 - p90) / 132, 0, 1, 0);
  const tonalRange = p90 - p10;
  const highDynamicRange = clamp((tonalRange - 132) / 88, 0, 0.8, 0);
  const targetMedian = 108 - lowKeyPressure * 22 + clamp((p50 - 148) / 86, 0, 1, 0) * 8;
  const maxLiftEv = 0.2 - lowKeyPressure * 0.06;
  const maxDropEv = -0.24 + highDynamicRange * 0.12;
  const median = Math.max(10, p50);
  let ev = Math.log2(targetMedian / median) * (1 - highDynamicRange * 0.75);
  ev = clamp(ev, maxDropEv, maxLiftEv);
  let brightness = clamp((ev / 1.12) * 100, -22, 18);
  let contrast = clamp((118 - tonalRange) * 0.08, -6, 10);
  const protectHighlights = sourceP99 > 246 || p97 > 232 || brightTail > 0.08 || clippedBright > 0.003;
  const highlightsBase = protectHighlights
    ? -((Math.max(0, sourceP99 - 246) * 0.13) + (Math.max(0, p97 - 232) * 0.11) + (brightTail * 16) + (clippedBright * 44))
    : (p90 > 212 ? -((p90 - 212) * 0.12) : (p90 < 156 ? (156 - p90) * 0.06 : 0));
  let highlights = clamp(highlightsBase, -22, protectHighlights ? 0 : 8);
  const shadowsBase = p10 < 44
    ? ((44 - p10) * 0.16) + (darkTail * 10)
    : (p10 > 82 ? -((p10 - 82) * 0.07) : 0);
  let shadows = clamp(shadowsBase * (1 - lowKeyPressure * 0.45), -8, 20);
  let whites = clamp(
    sourceP99 > 250 ? -((sourceP99 - 250) * 0.16) - (clippedBright * 36) : (sourceP99 < 226 && brightTail < 0.035 ? (226 - sourceP99) * 0.07 : 0),
    -10,
    10,
  );
  const blacksBase = p02 < 5
    ? ((5 - p02) * 0.18) + (clippedDark * 32)
    : (p02 > 22 && darkTail < 0.035 ? -((p02 - 22) * 0.11) : 0);
  let blacks = clamp(blacksBase - lowKeyPressure * 4, -10, 8);

  const protectTone = previewToneStats(data, {
    brightness,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature: autoTemperature,
    tint: autoTint,
  });
  const darkGap = clamp((protectTone.p01 - Math.max(4, Math.min(18, p02 + 5))) / 28, 0, 0.65, 0);
  if (darkGap > 0) {
    if (brightness > 0) brightness *= (1 - darkGap);
    if (shadows > 0) shadows *= (1 - darkGap);
    blacks = clamp(blacks - darkGap * 7, -10, 8);
  }
  const highlightGap = clamp((Math.min(250, Math.max(236, sourceP99 - 3)) - protectTone.p99) / 28, 0, 0.65, 0);
  if (highlightGap > 0) {
    if (brightness < 0) brightness *= (1 - highlightGap);
    if (highlights < 0) highlights *= (1 - highlightGap);
    if (whites < 0) whites *= (1 - highlightGap);
    contrast *= (1 - highlightGap * 0.35);
  }
  if (protectTone.shadows > 0.003) {
    const clipGuard = clamp(protectTone.shadows / 0.012, 0, 0.75, 0);
    if (blacks < 0) blacks *= (1 - clipGuard);
    if (contrast > 0) contrast *= (1 - clipGuard * 0.35);
  }
  if (protectTone.highlights > 0.003) {
    const clipGuard = clamp(protectTone.highlights / 0.012, 0, 0.75, 0);
    if (whites > 0) whites *= (1 - clipGuard);
    if (highlights > 0) highlights *= (1 - clipGuard);
    if (brightness > 0) brightness *= (1 - clipGuard * 0.4);
  }
  const autoAdjustments = buildPhotoAdjustments({
    brightness: Math.round(brightness),
    contrast: Math.round(contrast),
    highlights: Math.round(highlights),
    shadows: Math.round(shadows),
    whites: Math.round(whites),
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
  const maxSize = Math.max(320, Math.min(4096, Number(options.maxSize || 1600)));
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
  const ditherStrength = clamp(options.ditherStrength, 0, 1.2, 0.56);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dither = orderedDither(x, y, ditherStrength);
    const [r, g, b] = applyToneToRgbNormalized(data[i], data[i + 1], data[i + 2], normalized, dither);
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
