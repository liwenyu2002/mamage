const sharp = require('sharp');
const { normalizePhotoAdjustments, processTonePixels } = require('./engine.mjs');

async function decodePhotoToneSource(inputBuffer, options = {}) {
  const maxSize = Math.max(320, Math.min(4096, Number(options.maxSize || 4096)));
  // libvips handles source profiles/orientation; pixels have an explicit sRGB contract.
  return sharp(inputBuffer, { failOn: 'error' }).rotate()
    .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').flatten({ background: '#ffffff' }).removeAlpha()
    .raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
}

async function renderAdjustedPhotoBuffer(inputBuffer, adjustments, options = {}) {
  const a = normalizePhotoAdjustments(adjustments);
  const quality = Math.max(70, Math.min(98, Number(options.quality || 96)));
  const { data, info } = await decodePhotoToneSource(inputBuffer, options);
  const out = processTonePixels(data, a, 3);
  const image = sharp(Buffer.from(out), { raw: { width: info.width, height: info.height, channels: 3 } })
    .withIccProfile('srgb');
  if (options.format === 'png') return image.png().toBuffer();
  if (options.format === 'webp') return image.webp({ quality, smartSubsample: true }).toBuffer();
  return image.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
}

async function renderPhotoToneWorkingCopy(inputBuffer, maxSize = 1280) {
  const meta = await sharp(inputBuffer).metadata();
  const rotated = meta.orientation >= 5 && meta.orientation <= 8;
  const buffer = await renderAdjustedPhotoBuffer(inputBuffer, null, { maxSize, format: 'png' });
  return { buffer, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
}
module.exports = { renderAdjustedPhotoBuffer, renderPhotoToneWorkingCopy, decodePhotoToneSource };
