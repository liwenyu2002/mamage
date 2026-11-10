import { normalizeGeometry, geometryKey } from './geometry.mjs';
export const ENGINE = 'mamage-tone-v3-srgb';
export const DEFAULT_PHOTO_ADJUSTMENTS = Object.freeze({
  version: 3, engine: ENGINE, exposure: 0, contrast: 0, highlights: 0,
  shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0,
  vibrance: 0, saturation: 0, skinSaturation: 0, skinBrightness: 0, source: 'manual', rotation: 0, crop: null,
});
const SLIDERS = ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation', 'skinSaturation', 'skinBrightness'];
export function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
const decode = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const encode = x => x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => decode(i / 255));
const TO_SRGB = Float64Array.from({ length: 65537 }, (_, i) => encode(i / 65536) * 255);
function byte(x) {
  const p = clamp(x, 0, 1) * 65536, i = Math.floor(p);
  return Math.round(TO_SRGB[i] + (TO_SRGB[Math.min(i + 1, 65536)] - TO_SRGB[i]) * (p - i));
}

// Rendered RGB files need relative white balance, not a fictitious RAW Kelvin value.
function whiteBalance(temperature, tint) {
  const t = temperature / 100, m = tint / 100;
  const gains = [2 ** (0.65 * t + 0.24 * m), 2 ** (-0.24 * m), 2 ** (-0.65 * t + 0.24 * m)];
  const y = luma(...gains);
  return gains.map(g => g / y);
}

export function normalizePhotoAdjustments(input) {
  if (input == null) return { ...DEFAULT_PHOTO_ADJUSTMENTS, wbGains: [1, 1, 1], updatedAt: null };
  let parsed = input;
  if (typeof input === 'string') parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('invalid adjustments');
  const version = Number(parsed.version || (Object.hasOwn(parsed, 'exposure') ? 3 : 2));
  if (![1, 2, 3].includes(version)) throw new TypeError('unsupported tone version');
  // The old adjustment engine is retired. Never reinterpret its parameters.
  if (version < 3) return normalizePhotoAdjustments(null);
  const result = { ...DEFAULT_PHOTO_ADJUSTMENTS, exposure: clamp(parsed.exposure, -4, 4),
    source: parsed.source === 'auto' ? 'auto' : 'manual', updatedAt: parsed.updatedAt || null };
  for (const key of SLIDERS) result[key] = clamp(parsed[key], -100, 100);
  result.wbGains = whiteBalance(result.temperature, result.tint);
  Object.assign(result, normalizeGeometry(parsed));
  return result;
}

export function buildPhotoAdjustments(values = DEFAULT_PHOTO_ADJUSTMENTS, source = 'manual') {
  const a = normalizePhotoAdjustments(values);
  return { ...a, source, updatedAt: new Date().toISOString() };
}

export function isDefaultPhotoAdjustments(input) {
  const a = normalizePhotoAdjustments(input);
  const keys = ['exposure', ...SLIDERS];
  return keys.every(k => Math.abs(a[k] || 0) < 0.00001)
    && a.wbGains.every(g => Math.abs(g - 1) < 0.00001) && !a.rotation && !a.crop;
}

export function getToneAdjustmentKey(input) {
  const a = normalizePhotoAdjustments(input);
  return [a.engine, a.exposure, ...SLIDERS.map(k => a[k]), ...a.wbGains, geometryKey(a)].join('|');
}

function mapLuminance(y, a) {
  // Bounded log-exposure zones have positive derivatives at the entire slider range.
  // Keep floating-point highlight headroom until after all tone controls.
  if (a.shadows) y *= 2 ** ((a.shadows / 100) * 2 / (1 + (y / 0.065) ** 1.6));
  if (a.highlights) {
    const zone = (y / 0.45) ** 1.6;
    y *= 2 ** ((a.highlights / 100) * 1.8 * zone / (1 + zone));
  }
  let p = encode(y);
  if (a.contrast && p > 0 && p < 1) p = 1 / (1 + ((1 - p) / p) ** (2 ** (a.contrast / 100)));
  const blackPoint = -0.08 * a.blacks / 100;
  const whitePoint = 1 - 0.20 * a.whites / 100;
  p = clamp((p - blackPoint) / (whitePoint - blackPoint), 0, 1);
  return decode(p);
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function skinColorWeight(r, g, b) {
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  if (!delta) return 0;
  let hue = max === r ? 60 * (g - b) / delta : max === g ? 120 + 60 * (b - r) / delta : 240 + 60 * (r - g) / delta;
  if (hue > 180) hue -= 360;
  const saturation = delta / max;
  // A feathered color range, not semantic skin segmentation. Meter the source
  // so exposure and saturation edits cannot move the selection around.
  return smoothstep(-8, 6, hue) * (1 - smoothstep(38, 56, hue))
    * smoothstep(0.06, 0.16, saturation) * (1 - smoothstep(0.65, 0.9, saturation))
    * smoothstep(10, 36, max);
}

export function createToneProcessor(input) {
  const a = normalizePhotoAdjustments(input);
  if (isDefaultPhotoAdjustments({ ...a, rotation: 0, crop: null })) return (r, g, b) => [r, g, b];
  const exposure = 2 ** a.exposure, gains = a.wbGains.map(g => g * exposure);
  const limit = Math.max(1, luma(...gains)), size = 8192;
  const lut = Float64Array.from({ length: size + 1 }, (_, i) => mapLuminance((i / size) ** 2 * limit, a));
  const saturation = 1 + a.saturation / 100;
  const skinActive = Boolean(a.skinSaturation || a.skinBrightness);
  return (r, g, b) => {
    let lr = TO_LINEAR[r] * gains[0], lg = TO_LINEAR[g] * gains[1], lb = TO_LINEAR[b] * gains[2];
    const y = luma(lr, lg, lb), index = Math.sqrt(clamp(y / limit, 0, 1)) * size, i = Math.floor(index);
    let target = lut[i] + (lut[Math.min(size, i + 1)] - lut[i]) * (index - i);
    if (y < 1e-12) { const gray = byte(target); return [gray, gray, gray]; }
    const scale = target / y;
    lr *= scale; lg *= scale; lb *= scale;
    const skin = skinActive ? skinColorWeight(r, g, b) : 0;
    if (skin && a.skinBrightness) {
      const gain = 2 ** (a.skinBrightness / 100 * skin * 0.8);
      const shoulder = gain > 1 ? Math.min(1, Math.max(lr, lg, lb)) : target;
      const lift = gain / (1 + shoulder * (gain - 1));
      lr *= lift; lg *= lift; lb *= lift; target *= lift;
    }
    const max = Math.max(lr, lg, lb), min = Math.min(lr, lg, lb);
    const chroma = max > 1e-12 ? (max - min) / max : 0;
    let colorScale = saturation * (1 + a.vibrance / 100 * 0.65 * (1 - chroma));
    let colorLimit = Infinity;
    // Fit chroma around luminance instead of clipping RGB channels independently.
    for (const c of [lr, lg, lb]) {
      const d = c - target;
      if (d > 1e-12) colorLimit = Math.min(colorLimit, (1 - target) / d);
      else if (d < -1e-12) colorLimit = Math.min(colorLimit, -target / d);
    }
    colorScale = Math.max(0, Math.min(colorScale, colorLimit));
    if (skin && a.skinSaturation) {
      const change = a.skinSaturation / 100 * skin;
      if (change < 0) colorScale *= 1 + change;
      else {
        // Approach the gamut boundary gently; skin saturation should not create
        // hard red-channel clipping or abrupt hue changes in bright faces.
        const extra = colorScale * change, room = Math.max(0, colorLimit - colorScale) * 0.9;
        if (room > 1e-12) colorScale += extra / (1 + extra / room);
      }
    }
    return [byte(target + (lr - target) * colorScale), byte(target + (lg - target) * colorScale), byte(target + (lb - target) * colorScale)];
  };
}

export function processTonePixels(data, input, channels = 4) {
  const process = createToneProcessor(input), out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += channels) {
    const [r, g, b] = process(data[i], data[i + 1], data[i + 2]);
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
    if (channels === 4) out[i + 3] = data[i + 3];
  }
  return out;
}

function percentile(histogram, ratio) {
  const target = histogram.reduce((sum, n) => sum + n, 0) * ratio;
  let sum = 0;
  for (let i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= target) return i; }
  return 255;
}

export function measureToneFaces(data, image, detections = []) {
  const { width, height } = image || {};
  const result = { faces: [], samples: [] }, boxes = [];
  if (!(width > 0 && height > 0) || data.length !== width * height * 4) return result;
  for (const face of (Array.isArray(detections) ? detections : []).slice(0, 256)) {
    if (!face || (face.score != null && (!Number.isFinite(Number(face.score)) || Number(face.score) < 0.7))) continue;
    let { left, top, width: w, height: h } = face;
    if (![left, top, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const baseW = face.imageWidth || image.naturalWidth, baseH = face.imageHeight || image.naturalHeight;
    if (baseW > 0 && baseH > 0 && Math.abs((baseW / baseH) / (width / height) - 1) > 0.03) continue;
    if (face.unit !== 'ratio') {
      if (!(baseW > 0 && baseH > 0)) continue;
      left /= baseW; top /= baseH; w /= baseW; h /= baseH;
    }
    if (left < 0 || top < 0 || left + w > 1.01 || top + h > 1.01 || w * width < 12 || h * height < 12) continue;
    if (boxes.some(b => {
      const overlap = Math.max(0, Math.min(left + w, b.left + b.w) - Math.max(left, b.left))
        * Math.max(0, Math.min(top + h, b.top + b.h) - Math.max(top, b.top));
      return overlap / (w * h + b.w * b.h - overlap) > 0.7;
    })) continue;
    boxes.push({ left, top, w, h });
    const histogram = Array(256).fill(0);
    // Sample the inner face, excluding most hair/background. Use a median so
    // eyes, glasses and individual highlights cannot dominate exposure.
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const px = Math.min(width - 1, Math.floor((left + w * (0.2 + (x + 0.5) / 24 * 0.6)) * width));
      const py = Math.min(height - 1, Math.floor((top + h * (0.25 + (y + 0.5) / 24 * 0.55)) * height));
      const i = (py * width + px) * 4;
      if (data[i + 3] >= 10) histogram[Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
    }
    if (histogram.reduce((sum, n) => sum + n, 0) < 144) continue;
    const median = percentile(histogram, 0.5);
    if (median < 16 || median > 245) continue;
    result.faces.push({ median, highlights: percentile(histogram, 0.9) });
  }
  if (result.faces.length) {
    const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 4096)));
    for (let y = Math.floor(step / 2); y < height; y += step) for (let x = Math.floor(step / 2); x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= 10) result.samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  return result;
}

function protectAutoMidtones(a) {
  while (a.highlights < 0) {
    let safe = true;
    for (let n = 40; n <= 190; n += 5) {
      if (encode(mapLuminance(decode(n / 255) * 2 ** a.exposure, a)) * 255 < n - 1) { safe = false; break; }
    }
    if (safe) break;
    a.highlights++;
  }
}

function prioritizeFaces(a, histogram, metering) {
  if (!metering?.faces?.length || !metering.samples?.length) return;
  const medians = metering.faces.map(face => face.median).sort((x, y) => x - y);
  const faceMid = medians[Math.floor((medians.length - 1) * 0.35)];
  const lowKey = percentile(histogram, 0.5) < 45;
  const backlit = !lowKey && percentile(histogram, 0.95) >= 220
    && percentile(histogram, 0.95) - faceMid >= 100;
  // Recover a relative amount of facial detail, not one universal skin value.
  // A bright projection screen allows stronger shadow recovery than a low-key scene.
  const target = faceMid + clamp((backlit ? 140 - faceMid : 118 - faceMid)
    * (backlit ? 0.65 : 0.5), 0, lowKey ? 9 : backlit ? 50 : 18);
  if (target <= faceMid) return;
  const baseline = { ...a, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  const baselineProcess = createToneProcessor(baseline);
  // A saturated LED channel reaching the sRGB gamut boundary is not white
  // highlight loss. The renderer already fits chroma; guard scene luminance here.
  const unclipped = metering.samples.filter(rgb => luma(...baselineProcess(...rgb)) < 254);
  const brightestFace = Math.max(...metering.faces.map(face => face.highlights));
  const gray = (value, settings) => encode(mapLuminance(decode(value / 255) * 2 ** settings.exposure, settings)) * 255;
  const upper = percentile(histogram, 0.99);
  let best = baseline, bestCost = (target - faceMid) ** 2;
  const maxEv = lowKey ? 0.2 : backlit ? 2.25 : 0.65;
  const shadows = lowKey ? [0, 4, 8] : backlit ? [0, 25, 50, 70, 85] : [0, 10, 20, 30];
  for (let step = 0; step <= 9; step++) for (const shadow of shadows) {
    const candidate = { ...baseline, exposure: Math.round(step / 9 * maxEv * 100) / 100, shadows: shadow };
    candidate.contrast = backlit ? Math.round(Math.min(13, shadow * 0.15)) : 0;
    // Find the softest shoulder that holds previously unclipped screen whites.
    const ceiling = Math.max(upper, 245);
    if (upper > 200 && gray(upper, candidate) > ceiling) {
      let low = -100, high = 0;
      for (let n = 0; n < 8; n++) {
        const middle = (low + high) / 2;
        if (gray(upper, { ...candidate, highlights: middle }) > ceiling) high = middle;
        else low = middle;
      }
      candidate.highlights = Math.floor(low);
    }
    // Shadow recovery must not wash out the room's black anchor.
    if (backlit) {
      const anchor = Math.min(24, percentile(histogram, 0.1));
      const lifted = gray(anchor, candidate) / 255, desired = anchor / 255;
      candidate.blacks = -Math.round(clamp((lifted - desired) / (1 - desired) / 0.08 * 100, 0, 60));
    }
    const result = gray(faceMid, candidate);
    if (result < faceMid || gray(brightestFace, candidate) > Math.max(brightestFace, 238)) continue;
    if (medians.some(value => gray(value, candidate) < value - 1)) continue;
    if (backlit && gray(20, candidate) >= 40) continue;
    // Keep midtone separation instead of selecting an aggressively flattened curve.
    if (gray(190, candidate) - gray(80, candidate) < 65) continue;
    const cost = (result - target) ** 2 + candidate.exposure ** 2 * 2 + shadow ** 2 * 0.0005;
    if (cost >= bestCost) continue;
    const process = createToneProcessor(candidate);
    const newlyClipped = unclipped.reduce((n, rgb) => n + (luma(...process(...rgb)) >= 254 ? 1 : 0), 0);
    if (newlyClipped / metering.samples.length > 0.003) continue;
    best = candidate; bestCost = cost;
  }
  Object.assign(a, best);
}

function suggestAutoTone(histogram, input, metering) {
  const a = { ...normalizePhotoAdjustments(input), exposure: 0, contrast: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  const count = histogram.reduce((sum, n) => sum + n, 0);
  if (!count) return buildPhotoAdjustments(a, 'auto');
  const p05 = percentile(histogram, 0.05), p25 = percentile(histogram, 0.25);
  const p50 = percentile(histogram, 0.5), p90 = percentile(histogram, 0.9), p99 = percentile(histogram, 0.99);
  if (p90 - p05 < 24 || p90 < 32) {
    prioritizeFaces(a, histogram, metering);
    return buildPhotoAdjustments(a, 'auto');
  }
  // Bright backgrounds are not evidence of overexposure. Preserve high/low-key
  // intent; only lift broadly dim midtones, never force the scene to middle gray.
  if (p50 >= 45 && p50 < 105 && p90 < 200) {
    a.exposure = Math.round(clamp(Math.log2(decode(110 / 255) / decode(p50 / 255)) * 0.5, 0, 0.5) * 20) / 20;
  }
  if (p25 < 100 && p50 < 170 && p90 >= 80) {
    a.shadows = Math.round(clamp((100 - p25) * 0.5, 0, p50 < 45 ? 8 : 22));
  }
  if (p99 > 242 && p25 < 100 && p50 < 190) {
    a.highlights = -Math.round(clamp((p99 - 238) * 0.8, 0, 12));
    // Check the combined curve: highlight protection must not undo the lift or
    // darken existing midtones. This small histogram-only probe stays off the UI thread.
    protectAutoMidtones(a);
  }
  prioritizeFaces(a, histogram, metering);
  return buildPhotoAdjustments(a, 'auto');
}

export function analyzeTonePixels(source, output, input, metering, cachedAuto) {
  const sourceHistogram = Array(256).fill(0), adjustedHistogram = Array(256).fill(0);
  let dark = 0, bright = 0, count = 0;
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] < 10) continue;
    sourceHistogram[Math.round(luma(source[i], source[i + 1], source[i + 2]))]++;
    adjustedHistogram[Math.round(luma(output[i], output[i + 1], output[i + 2]))]++;
    if (Math.max(output[i], output[i + 1], output[i + 2]) >= 254) bright++;
    if (Math.max(output[i], output[i + 1], output[i + 2]) <= 1) dark++;
    count++;
  }
  const autoAdjustments = cachedAuto || suggestAutoTone(sourceHistogram, input, metering);
  return { sourceHistogram, adjustedHistogram,
    metering: { mode: metering?.faces?.length ? 'faces' : 'global', faceCount: metering?.faces?.length || 0 },
    clipping: { shadows: dark / (count || 1), highlights: bright / (count || 1) }, autoAdjustments };
}
