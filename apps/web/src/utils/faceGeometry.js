function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getFaceBoxStyle(face, fallback) {
  if (!face) return { display: 'none' };
  let left = finiteNumber(face.left);
  let top = finiteNumber(face.top);
  let width = finiteNumber(face.width);
  let height = finiteNumber(face.height);
  if ([left, top, width, height].some((value) => value == null)) return { display: 'none' };
  if (width <= 0 || height <= 0) return { display: 'none' };
  if (face.unit !== 'ratio') {
    const baseW = finiteNumber(face.imageWidth) || finiteNumber(fallback?.width);
    const baseH = finiteNumber(face.imageHeight) || finiteNumber(fallback?.height);
    if (baseW > 0 && baseH > 0) {
      left /= baseW; top /= baseH; width /= baseW; height /= baseH;
    } else if (!(Math.abs(left) <= 1.05 && Math.abs(top) <= 1.05 && Math.abs(width) <= 1.2 && Math.abs(height) <= 1.2)) {
      return { display: 'none' };
    }
  }
  const l = Math.max(0, Math.min(1, left));
  const t = Math.max(0, Math.min(1, top));
  const w = Math.max(0, Math.min(1, left + width) - l);
  const h = Math.max(0, Math.min(1, top + height) - t);
  if (!w || !h) return { display: 'none' };
  return { left: `${l * 100}%`, top: `${t * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
}
