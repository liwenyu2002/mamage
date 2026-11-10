const test = require('node:test');
const assert = require('node:assert/strict');
const tone = require('../lib/photo_tone/engine.mjs');

const edit = values => ({ ...tone.DEFAULT_PHOTO_ADJUSTMENTS, ...values });
const rgb = (v, values = {}) => tone.createToneProcessor(edit(values))(v, v, v);

test('neutral settings preserve every gray and sampled colors exactly', () => {
  const process = tone.createToneProcessor(edit({}));
  for (let n = 0; n < 256; n++) assert.deepEqual(process(n, n, n), [n, n, n]);
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17)
    for (let b = 0; b < 256; b += 17) assert.deepEqual(process(r, g, b), [r, g, b]);
});

test('shadows lift dark detail without turning pure black gray', () => {
  assert.deepEqual(rgb(0, { shadows: 100 }), [0, 0, 0]);
  assert.ok(rgb(48, { shadows: 70 })[0] > 48);
  assert.ok(rgb(240, { shadows: 70 })[0] - 240 < 5);
});

test('each tone control and combined extremes remain monotonic', () => {
  const cases = [];
  for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']) {
    for (const value of [-100, -50, 50, 100]) cases.push({ [key]: key === 'exposure' ? value / 25 : value });
  }
  let seed = 913;
  for (let i = 0; i < 150; i++) {
    const values = {};
    for (const key of ['contrast', 'highlights', 'shadows', 'whites', 'blacks']) {
      seed = (seed * 16807) % 2147483647;
      values[key] = seed % 201 - 100;
    }
    cases.push(values);
  }
  for (const values of cases) {
    const process = tone.createToneProcessor(edit(values));
    let last = -1;
    for (let n = 0; n < 256; n++) {
      const [r, g, b] = process(n, n, n);
      assert.ok(r >= last, `reversed tones at ${n}: ${JSON.stringify(values)}`);
      assert.equal(r, g); assert.equal(g, b); last = r;
    }
  }
});

test('exposure is linear-light stops, not encoded RGB brightness', () => {
  const linear = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const a = linear(64 / 255), b = linear(rgb(64, { exposure: 1 })[0] / 255);
  assert.ok(Math.abs(b / a - 2) < 0.025);
  assert.ok(rgb(210, { exposure: 1, highlights: -100 })[0] < rgb(240, { exposure: 1, highlights: -100 })[0], 'highlights must not be clipped before tone mapping');
});

test('white balance responds continuously without a stale derived gain', () => {
  const p = tone.createToneProcessor(tone.buildPhotoAdjustments(edit({ temperature: 50, wbGains: [1, 1, 1] })));
  const [r, g, b] = p(128, 128, 128);
  assert.ok(r > g && g > b);
  assert.ok(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b - 128) < 7);
  const m = tone.createToneProcessor(edit({ tint: 50 }))(128, 128, 128);
  assert.ok(m[0] > m[1] && m[2] > m[1]);
});

test('saturation can remove color; gamut handling never produces invalid channels', () => {
  const mono = tone.createToneProcessor(edit({ saturation: -100 }))(210, 110, 70);
  assert.equal(mono[0], mono[1]); assert.equal(mono[1], mono[2]);
  const p = tone.createToneProcessor(edit({ exposure: 2, temperature: 100, tint: -100, saturation: 100, vibrance: 100 }));
  for (const color of [[255,0,0],[0,255,0],[0,0,255],[240,120,70]]) {
    for (const v of p(...color)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 255);
  }
});

test('retired saved adjustments revert to original pixels without reinterpreting values', () => {
  for (const old of [{ version: 1, brightness: 100 }, { version: 2, shadows: 100, wbGains: [2, 0.5, 1] }, { brightness: 50 }]) {
    const neutral = tone.normalizePhotoAdjustments(old);
    assert.equal(neutral.version, 3);
    assert.equal(tone.isDefaultPhotoAdjustments(neutral), true);
    const process = tone.createToneProcessor(old);
    for (const color of [[0,0,0],[16,16,16],[190,110,80],[120,180,250]]) assert.deepEqual(process(...color), color);
  }
});

test('version, gains, and all new controls survive JSON round trips and keying', () => {
  const a = tone.buildPhotoAdjustments(edit({ exposure: 1.25, vibrance: 22, saturation: -14, skinSaturation: -20, skinBrightness: 25 }));
  assert.deepEqual(tone.normalizePhotoAdjustments(JSON.stringify(a)), tone.normalizePhotoAdjustments(a));
  assert.equal(a.skinSaturation, -20); assert.equal(a.skinBrightness, 25);
  assert.notEqual(tone.getToneAdjustmentKey(edit({ skinBrightness: 1 })), tone.getToneAdjustmentKey(edit({})));
  assert.notEqual(tone.getToneAdjustmentKey(edit({ skinSaturation: 1 })), tone.getToneAdjustmentKey(edit({})));
  assert.notEqual(tone.getToneAdjustmentKey(a), tone.getToneAdjustmentKey(edit({})));
  assert.equal(tone.getToneAdjustmentKey({ version: 2, brightness: 100 }), tone.getToneAdjustmentKey(edit({})));
  assert.equal(tone.isDefaultPhotoAdjustments(a), false);
  assert.equal(tone.isDefaultPhotoAdjustments({ wbGains: [1.1, 1, 1] }), true);
  assert.throws(() => tone.normalizePhotoAdjustments({ version: 999 }), /version/);
});

const linear = n => n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4;
const luminance = rgb => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const chroma = rgb => Math.max(...rgb.map(linear)) - Math.min(...rgb.map(linear));

test('skin controls selectively adjust warm skin colors without changing neutral or unrelated colors', () => {
  const brighter = tone.createToneProcessor(edit({ skinBrightness: 60 }));
  const dimmer = tone.createToneProcessor(edit({ skinBrightness: -60 }));
  const richer = tone.createToneProcessor(edit({ skinSaturation: 60 }));
  const softer = tone.createToneProcessor(edit({ skinSaturation: -60 }));
  for (const color of [[201, 143, 109], [154, 104, 76], [83, 56, 42], [235, 204, 188]]) {
    assert.ok(luminance(brighter(...color)) > luminance(color) * (color[0] >= 230 ? 1.025 : 1.08));
    assert.ok(luminance(dimmer(...color)) < luminance(color) * 0.95);
    assert.ok(chroma(richer(...color)) > chroma(color) * (color[0] >= 230 ? 1.01 : 1.1));
    assert.ok(chroma(softer(...color)) < chroma(color) * 0.85);
    assert.ok(Math.abs(luminance(softer(...color)) - luminance(color)) < 0.004, 'Skin saturation preserves luminance');
  }
  for (const color of [[0, 0, 0], [255, 255, 255], [120, 120, 120], [30, 110, 210], [40, 180, 80], [220, 210, 40], [240, 20, 20]]) {
    for (const process of [brighter, dimmer, richer, softer]) assert.deepEqual(process(...color), color);
  }
});

test('skin selection has soft boundaries and extreme adjustments keep valid highlight headroom', () => {
  const process = tone.createToneProcessor(edit({ skinBrightness: 100, skinSaturation: 100 }));
  let previous;
  for (let g = 60; g < 240; g++) {
    const pixel = process(240, g, 140);
    assert.ok(pixel.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    if (previous) assert.ok(Math.max(...pixel.map((n, i) => Math.abs(n - previous[i]))) <= 6, `Hard skin-mask edge at ${g}`);
    previous = pixel;
  }
  const bright = tone.createToneProcessor(edit({ skinBrightness: 100 }))(243, 221, 203);
  assert.ok(Math.max(...bright) < 255, 'Skin lift does not clip a previously unclipped face');
  const a = tone.normalizePhotoAdjustments(edit({ skinSaturation: 1000, skinBrightness: -1000 }));
  assert.equal(a.skinSaturation, 100); assert.equal(a.skinBrightness, -100);
});

function scene(distribution) {
  return Uint8ClampedArray.from(distribution.flatMap(([value, count]) =>
    Array.from({ length: count }, () => [value, value, value, 255]).flat()));
}

test('auto tone does not darken a subject to normalize its bright background', () => {
  const source = scene([[100, 20], [220, 80]]);
  const suggestion = tone.analyzeTonePixels(source, source, null).autoAdjustments;
  assert.ok(tone.processTonePixels(source, suggestion)[0] >= 99, 'The dim subject must not get darker');
  assert.ok(suggestion.exposure >= 0);
});

test('auto tone preserves balanced, high-key, and low-key intent', () => {
  for (const distribution of [[[110, 25], [150, 50], [190, 25]], [[200, 20], [240, 80]], [[8, 70], [40, 20], [200, 10]]]) {
    const source = scene(distribution);
    const a = tone.analyzeTonePixels(source, source, null).autoAdjustments;
    assert.equal(a.exposure, 0);
    assert.ok(a.shadows <= 8);
    assert.ok(a.highlights >= -12);
  }
});

test('auto gently lifts underexposure, limits highlight correction, and protects midtones', () => {
  const source = scene([[28, 20], [70, 60], [135, 20]]);
  const a = tone.analyzeTonePixels(source, source, null).autoAdjustments;
  assert.ok(a.exposure > 0 && a.exposure <= 0.5);
  assert.ok(tone.createToneProcessor(a)(70, 70, 70)[0] > 70);
  const backlit = scene([[32, 25], [130, 55], [250, 20]]);
  const b = tone.analyzeTonePixels(backlit, backlit, null).autoAdjustments;
  assert.ok(b.highlights < 0 && b.highlights >= -12);
  const process = tone.createToneProcessor(b);
  for (let n = 40; n <= 190; n++) assert.ok(process(n, n, n)[0] >= n - 1, `Auto darkened midtone ${n}`);
});

test('auto always meters the source and never changes white balance or color controls', () => {
  const source = scene([[30, 20], [80, 50], [190, 30]]);
  const manual = edit({ exposure: -1, temperature: 17, tint: -8, saturation: -6, vibrance: 22, skinSaturation: -12, skinBrightness: 18 });
  const first = tone.analyzeTonePixels(source, tone.processTonePixels(source, manual), manual).autoAdjustments;
  const second = tone.analyzeTonePixels(source, tone.processTonePixels(source, first), first).autoAdjustments;
  assert.equal(tone.getToneAdjustmentKey(first), tone.getToneAdjustmentKey(second));
  for (const key of ['temperature', 'tint', 'saturation', 'vibrance', 'skinSaturation', 'skinBrightness']) assert.equal(first[key], manual[key]);
});

test('auto leaves empty, transparent, black, and flat white inputs unchanged', () => {
  for (const source of [new Uint8ClampedArray(), new Uint8ClampedArray(400), scene([[0, 100]]), scene([[255, 100]])]) {
    const a = tone.analyzeTonePixels(source, source, null).autoAdjustments;
    assert.equal(tone.isDefaultPhotoAdjustments(a), true);
  }
});

function faceScene(faceValues = [80], background = 225) {
  const width = 200, height = 120, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([background, background, background, 255], i);
  const faces = faceValues.map((value, index) => {
    const left = 12 + index * 60, top = 30, w = 40, h = 50;
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) data.set([value, value, value, 255], (y * width + x) * 4);
    return { left, top, width: w, height: h, imageWidth: width, imageHeight: height, unit: 'pixel', score: 0.98 };
  });
  return { data, width, height, faces };
}

test('reliable face regions get priority without forcing all skin tones to one brightness', () => {
  const fixture = faceScene();
  const metering = tone.measureToneFaces(fixture.data, fixture, fixture.faces);
  const a = tone.analyzeTonePixels(fixture.data, fixture.data, null, metering);
  assert.equal(a.metering.faceCount, 1);
  assert.equal(a.metering.mode, 'faces');
  assert.ok(a.autoAdjustments.exposure > 0);
  const pixel = tone.createToneProcessor(a.autoAdjustments)(80, 80, 80)[0];
  assert.ok(pixel > 80 && pixel < 125, 'Dark skin must not be normalized to pale gray');
  const normal = faceScene([155]);
  const b = tone.analyzeTonePixels(normal.data, normal.data, null, tone.measureToneFaces(normal.data, normal, normal.faces));
  assert.equal(b.autoAdjustments.exposure, 0);
});

test('face priority respects other bright faces and a near-clipping background', () => {
  const fixture = faceScene([75, 205], 252);
  const metering = tone.measureToneFaces(fixture.data, fixture, fixture.faces);
  const a = tone.analyzeTonePixels(fixture.data, fixture.data, null, metering);
  const result = tone.processTonePixels(fixture.data, a.autoAdjustments);
  const stats = tone.analyzeTonePixels(fixture.data, result, a.autoAdjustments, metering);
  assert.equal(a.metering.faceCount, 2);
  assert.ok(stats.clipping.highlights <= 0.003, 'Face priority must not blow out the background');
  const process = tone.createToneProcessor(a.autoAdjustments);
  assert.ok(process(205, 205, 205)[0] < 238, 'Already bright faces stay protected');
  assert.ok(process(75, 75, 75)[0] >= 75);
});

test('face metering rejects unreliable geometry, de-duplicates, and handles image scaling', () => {
  const fixture = faceScene();
  const f = fixture.faces[0];
  const ratio = { ...f, left: f.left / fixture.width, top: f.top / fixture.height, width: f.width / fixture.width, height: f.height / fixture.height, unit: 'ratio' };
  const scaled = { ...f, left: f.left * 10, top: f.top * 10, width: f.width * 10, height: f.height * 10, imageWidth: 2000, imageHeight: 1200 };
  const invalid = [{ ...f, score: 0.2 }, { ...f, width: 2 }, { ...f, left: -80 }, { ...f, imageWidth: 120, imageHeight: 200 }, { ...f, left: NaN }];
  assert.equal(tone.measureToneFaces(fixture.data, fixture, invalid).faces.length, 0);
  const a = tone.measureToneFaces(fixture.data, fixture, [f, ratio, scaled]);
  assert.equal(a.faces.length, 1);
  assert.equal(a.faces[0].median, 80);
  const noFaces = tone.analyzeTonePixels(fixture.data, fixture.data, null, tone.measureToneFaces(fixture.data, fixture, invalid));
  assert.equal(noFaces.metering.mode, 'global');
});

test('projector backlight gets stronger face recovery without copying the example preset', () => {
  for (const faceValue of [45, 65, 85]) {
    const fixture = faceScene([faceValue], 250);
    const metering = tone.measureToneFaces(fixture.data, fixture, fixture.faces);
    const a = tone.analyzeTonePixels(fixture.data, fixture.data, null, metering).autoAdjustments;
    const process = tone.createToneProcessor(a);
    assert.ok(process(faceValue, faceValue, faceValue)[0] >= faceValue + 25, JSON.stringify(a));
    assert.ok(process(250, 250, 250)[0] < 254);
    assert.ok(a.highlights < -24, 'Bright screens need more than the former -24 shoulder cap');
    assert.ok(a.blacks <= 0);
    assert.equal(a.skinBrightness, 0); assert.equal(a.saturation, 0);
    assert.ok(process(20, 20, 20)[0] < 40, 'Room shadows retain a black anchor');
  }
});

test('saturated display colors do not masquerade as blown white highlights and block face recovery', () => {
  const fixture = faceScene([70], 245);
  for (let y = 0; y < fixture.height; y++) for (let x = 121; x < fixture.width; x++) {
    fixture.data.set([28, 98, 252, 255], (y * fixture.width + x) * 4);
  }
  const metering = tone.measureToneFaces(fixture.data, fixture, fixture.faces);
  const a = tone.analyzeTonePixels(fixture.data, fixture.data, null, metering).autoAdjustments;
  const process = tone.createToneProcessor(a);
  assert.ok(process(70, 70, 70)[0] >= 95, JSON.stringify(a));
  assert.ok(process(245, 245, 245)[0] < 250, 'Bright neutral screen detail stays below white clipping');
  const blue = process(28, 98, 252);
  assert.ok(blue[2] > blue[1] && blue[1] > blue[0], 'The colored screen retains its hue ordering');
});
