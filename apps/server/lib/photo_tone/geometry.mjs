const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const limit = (value, low, high) => Math.max(low, Math.min(high, value));

export function normalizeGeometry(input = {}) {
  const angle = finite(input.rotation, 0);
  const rotation = Math.round((((angle + 180) % 360 + 360) % 360 - 180) * 100) / 100;
  const value = input.crop;
  let crop = null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const x = limit(finite(value.x, 0), 0, 0.999);
    const y = limit(finite(value.y, 0), 0, 0.999);
    const width = limit(finite(value.width, 1), 0.001, 1 - x);
    const height = limit(finite(value.height, 1), 0.001, 1 - y);
    if (x > 0 || y > 0 || width < 1 || height < 1) crop = { x, y, width, height };
  }
  return { rotation, crop };
}

export function rotatedSize(width, height, angle) {
  const r = angle * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { width: Math.max(1, Math.round(width * c + height * s)), height: Math.max(1, Math.round(height * c + width * s)) };
}

export function cropPixels(width, height, crop) {
  const c = normalizeGeometry({ crop }).crop || { x: 0, y: 0, width: 1, height: 1 };
  const left = limit(Math.round(c.x * width), 0, width - 1), top = limit(Math.round(c.y * height), 0, height - 1);
  return { left, top, width: limit(Math.round(c.width * width), 1, width - left), height: limit(Math.round(c.height * height), 1, height - top) };
}

// Largest centered rectangle inside the rotated image, so straightening starts
// with a crop that excludes the empty corners. Manual crops remain explicit.
export function straightenedCrop(width, height, angle) {
  const bounds = rotatedSize(width, height, angle);
  const r = Math.abs(angle * Math.PI / 180), s = Math.abs(Math.sin(r)), c = Math.abs(Math.cos(r));
  if (s < 1e-8 || c < 1e-8) return null;
  const long = Math.max(width, height), short = Math.min(width, height);
  let w, h;
  if (short <= 2 * s * c * long || Math.abs(s - c) < 1e-8) {
    const half = short / 2;
    [w, h] = width >= height ? [half / s, half / c] : [half / c, half / s];
  } else {
    const cos2 = c * c - s * s;
    w = (width * c - height * s) / cos2;
    h = (height * c - width * s) / cos2;
  }
  w = Math.min(bounds.width, Math.max(1, Math.floor(w)));
  h = Math.min(bounds.height, Math.max(1, Math.floor(h)));
  return { x: (bounds.width - w) / 2 / bounds.width, y: (bounds.height - h) / 2 / bounds.height,
    width: w / bounds.width, height: h / bounds.height };
}

export function geometryKey(input) {
  const { rotation, crop } = normalizeGeometry(input);
  return JSON.stringify([rotation, crop]);
}

export function fitCropAspect(width, height, crop, aspect) {
  const area = normalizeGeometry({ crop }).crop || { x: 0, y: 0, width: 1, height: 1 };
  if (!(aspect > 0)) return crop;
  const w = Math.min(area.width * width, area.height * height * aspect);
  const h = w / aspect;
  return { x: area.x + (area.width - w / width) / 2, y: area.y + (area.height - h / height) / 2,
    width: w / width, height: h / height };
}
