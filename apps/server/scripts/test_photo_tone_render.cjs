const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const tone = require('../lib/photo_tone/engine.mjs');
const { decodePhotoToneSource, renderAdjustedPhotoBuffer, renderPhotoToneWorkingCopy } = require('../lib/photo_tone/render.cjs');

test('server output is the exact same RGB processor with an embedded sRGB profile', async () => {
  const colors = Buffer.from([120,80,30,20,40,60,240,230,200,0,0,0]);
  const input = await sharp(colors, { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
  const a = { ...tone.DEFAULT_PHOTO_ADJUSTMENTS, exposure: 0.7, highlights: -40, shadows: 30, temperature: 15, vibrance: 25, skinBrightness: 30, skinSaturation: -20 };
  const rendered = await renderAdjustedPhotoBuffer(input, a, { format: 'png' });
  const meta = await sharp(rendered).metadata();
  assert.equal(meta.space, 'srgb'); assert.ok(meta.icc.length > 100);
  const pixels = await sharp(rendered).removeAlpha().raw().toBuffer();
  assert.deepEqual(pixels, Buffer.from(tone.processTonePixels(colors, a, 3)));
});

test('rotated camera sources normalize once and working pixels match the render input', async () => {
  const input = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ab4d20' } })
    .withMetadata({ orientation: 8 }).jpeg().toBuffer();
  const working = await renderPhotoToneWorkingCopy(input);
  assert.equal(working.width, 40); assert.equal(working.height, 60);
  const meta = await sharp(working.buffer).metadata();
  assert.equal(meta.width, 40); assert.equal(meta.height, 60); assert.equal(meta.orientation, undefined);
  const normalized = await decodePhotoToneSource(input);
  assert.deepEqual(await sharp(working.buffer).removeAlpha().raw().toBuffer(), normalized.data);
});

test('a non-sRGB input is converted, not merely relabelled, before rendering', async () => {
  const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#b74a31' } }).withIccProfile('p3').png().toBuffer();
  const working = await renderPhotoToneWorkingCopy(input);
  const decoded = await decodePhotoToneSource(input);
  assert.deepEqual(await sharp(working.buffer).raw().toBuffer(), decoded.data);
  const meta = await sharp(working.buffer).metadata();
  const reference = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#b74a31' } }).withIccProfile('srgb').png().toBuffer();
  assert.deepEqual(meta.icc, (await sharp(reference).metadata()).icc);
  for (const [i, value] of [183, 74, 49].entries()) assert.ok(Math.abs(decoded.data[i] - value) <= 2);
});
