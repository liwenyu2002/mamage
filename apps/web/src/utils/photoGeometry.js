import { normalizeGeometry, rotatedSize, cropPixels } from '../../../server/lib/photo_tone/geometry.mjs';

export function drawPhotoGeometry(source, target, adjustments, uncropped = false) {
  const { rotation, crop } = normalizeGeometry(adjustments);
  const bounds = rotatedSize(source.width, source.height, rotation);
  const area = cropPixels(bounds.width, bounds.height, uncropped ? null : crop);
  target.width = area.width; target.height = area.height;
  const ctx = target.getContext('2d', { colorSpace: 'srgb' });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
  ctx.save();
  ctx.translate(bounds.width / 2 - area.left, bounds.height / 2 - area.top);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  ctx.restore();
}

export function canvasFromPixels(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}
