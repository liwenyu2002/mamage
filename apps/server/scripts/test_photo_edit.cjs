const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
const tone = require('../lib/photo_tone/engine.mjs');
const geometry = require('../lib/photo_tone/geometry.mjs');
const { preparePhotoEdit } = require('../lib/photo_tone/save.cjs');
const { getBakedEdit, editRevision, publicAdjustments, displayPhotoRow, savedDisplayKey } = require('../lib/photo_tone/artifacts.cjs');
const { renderAdjustedPhotoBuffer, renderPhotoToneWorkingCopy } = require('../lib/photo_tone/render.cjs');

const settings = patch => ({ ...tone.DEFAULT_PHOTO_ADJUSTMENTS, ...patch });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture() {
  const original = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#618398' } }).jpeg().toBuffer();
  const row = { id: 13, type: 'normal', url: 'uploads/units/1/original.jpg', thumbUrl: 'uploads/units/1/thumb.jpg', adjustments: null };
  const objects = new Map([[row.url, original]]), events = [];
  const storage = { isConfigured: () => true,
    uploadBuffer: async (key, buffer) => { objects.set(key, buffer); events.push(['upload', key]); },
    deleteObjects: async keys => { keys.forEach(key => objects.delete(key)); events.push(['delete', keys]); return { deleted: keys }; } };
  const prepare = (adjustments, options = {}) => preparePhotoEdit({ row: { ...row }, adjustments: settings(adjustments),
    baseRevision: editRevision(row), storage, loadOriginal: async source => {
      assert.equal(source.url, row.url); return objects.get(row.url);
    }, ...options });
  return { row, original, objects, storage, events, prepare };
}

test('full working pixels and saved render do not shrink to preview resolution', async () => {
  const original = await sharp({ create: { width: 4800, height: 80, channels: 3, background: '#b18763' } }).jpeg().toBuffer();
  const working = await renderPhotoToneWorkingCopy(original, 1280, true);
  assert.equal((await sharp(working.buffer).metadata()).width, 4800);
  const saved = await renderAdjustedPhotoBuffer(original, settings({ exposure: 0.5 }), { fullResolution: true });
  const meta = await sharp(saved).metadata();
  assert.equal(meta.width, 4800); assert.equal(meta.height, 80); assert.ok(meta.icc);
});

test('quarter turns, arbitrary rotation, normalized crops and aspect crops have matching geometry', async () => {
  const f = await fixture();
  for (const rotation of [0, 90, -90, -180, 17.5, -23, 120]) {
    const bounds = geometry.rotatedSize(240, 160, rotation);
    const crop = geometry.fitCropAspect(bounds.width, bounds.height, geometry.straightenedCrop(240, 160, rotation), 4 / 3);
    const expected = geometry.cropPixels(bounds.width, bounds.height, crop);
    const output = await renderAdjustedPhotoBuffer(f.original, settings({ rotation, crop }), { fullResolution: true, format: 'png' });
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, expected.width, String(rotation)); assert.equal(meta.height, expected.height);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const corners = [0, (info.width - 1) * info.channels, (info.height - 1) * info.width * info.channels, data.length - info.channels];
    for (const i of corners) assert.ok(Math.min(...data.subarray(i, i + 3)) < 240, `Empty corner at ${rotation}`);
  }
  assert.equal(geometry.normalizeGeometry({ rotation: 450 }).rotation, 90);
});

test('save uses the original once, publishes one raster, replaces only after commit, and reset restores original', async () => {
  const f = await fixture(), sourceHash = digest(f.original);
  const first = await f.prepare({ exposure: 0.8, rotation: 90, crop: { x: .1, y: .1, width: .8, height: .8 } });
  assert.equal(f.row.adjustments, null);
  first.assertCurrent(f.row); f.row.adjustments = first.saved; await first.committed();
  const old = getBakedEdit(f.row);
  assert.deepEqual([old.width, old.height], [128, 192]);
  assert.equal(displayPhotoRow(f.row).url, old.url);
  assert.equal(savedDisplayKey(f.row, f.row.thumbUrl), old.thumbUrl);
  assert.equal(savedDisplayKey(f.row, f.row.url), old.url);
  assert.equal(savedDisplayKey(f.row, 'unrelated.jpg'), 'unrelated.jpg');
  const second = await f.prepare({ exposure: 1.2 });
  assert.ok(f.objects.has(old.url), 'Prior edit remains available until commit');
  second.assertCurrent(f.row); f.row.adjustments = second.saved; await second.committed();
  assert.equal(f.objects.has(old.url), false);
  assert.deepEqual([getBakedEdit(f.row).width, getBakedEdit(f.row).height], [240, 160], 'Re-edit starts from uncropped original');
  const publicValue = publicAdjustments(f.row.adjustments, f.row.id);
  assert.equal(publicValue.baked.url, undefined); assert.equal(publicValue.baked.retired, undefined);
  assert.equal(getBakedEdit({ ...f.row, id: 14 }), null, 'A copied manifest cannot serve another photo artifact');
  const reset = await f.prepare({}); f.row.adjustments = reset.saved; await reset.committed();
  assert.equal(getBakedEdit(f.row), null); assert.equal(f.objects.size, 1);
  assert.equal(digest(f.objects.get(f.row.url)), sourceHash);
});

test('partial upload and aborted transaction preserve the prior edit and clean new artifacts', async () => {
  const f = await fixture();
  const initial = await f.prepare({ exposure: .5 }); f.row.adjustments = initial.saved;
  const before = new Set(f.objects.keys());
  const upload = f.storage.uploadBuffer;
  f.storage.uploadBuffer = async (key, data) => { if (key.endsWith('.webp')) throw Error('storage unavailable'); await upload(key, data); };
  await assert.rejects(f.prepare({ exposure: 1 }), /storage unavailable/);
  assert.deepEqual(new Set(f.objects.keys()), before);
  f.storage.uploadBuffer = upload;
  const pending = await f.prepare({ shadows: 20 });
  await pending.abort(); assert.deepEqual(new Set(f.objects.keys()), before);
  assert.equal(f.row.adjustments.exposure, .5);
});

test('stale editors and concurrent commits cannot overwrite a newer edit', async () => {
  const f = await fixture(), revision = editRevision(f.row);
  const pending = await f.prepare({ exposure: .2 });
  const other = await f.prepare({ exposure: .5 }); f.row.adjustments = other.saved;
  assert.throws(() => pending.assertCurrent(f.row), { status: 409 }); await pending.abort();
  await assert.rejects(f.prepare({ exposure: 2 }, { baseRevision: revision }), { status: 409 });
  assert.equal(f.row.adjustments.exposure, .5);
  assert.ok(f.objects.has(getBakedEdit(f.row).url));
  await assert.rejects(f.prepare({}, { row: { ...f.row, type: 'video' } }), { status: 400 });
});

test('render failures and unavailable storage leave originals and parameters untouched', async () => {
  const f = await fixture();
  await assert.rejects(f.prepare({ exposure: 1 }, { render: async () => { throw Error('decoder failed'); } }), /decoder failed/);
  f.storage.isConfigured = () => false;
  await assert.rejects(f.prepare({ exposure: 1 }), { status: 503 });
  assert.equal(f.objects.size, 1); assert.equal(f.row.adjustments, null);
});
