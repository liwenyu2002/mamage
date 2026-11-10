const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');
const { renderAdjustedPhotoBuffer } = require('./render.cjs');
sharp.concurrency(1);
sharp.cache(false);
(async () => {
  const buffer = await renderAdjustedPhotoBuffer(Buffer.from(workerData.input), workerData.adjustments,
    { fullResolution: true, quality: 96 });
  const meta = await sharp(buffer).metadata();
  const thumb = await sharp(buffer).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .withIccProfile('srgb').webp({ quality: 90 }).toBuffer();
  parentPort.postMessage({ buffer, thumb, width: meta.width, height: meta.height });
})().catch(error => parentPort.postMessage({ error: error.message }));
