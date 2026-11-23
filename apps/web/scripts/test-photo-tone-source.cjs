const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const tone = require('../../server/lib/photo_tone/engine.mjs');

function loadClient(environment = {}) {
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(path.resolve(__dirname, '../src/utils/photoAdjustments.js'), 'utf8'), {
    filename: 'photoAdjustments.js', configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const sandbox = { module, exports: module.exports, URL,
    require(name) { assert.equal(name, '../../../server/lib/photo_tone/engine.mjs'); return tone; },
    Image: class { constructor() { this.naturalWidth = 5000; this.naturalHeight = 3333; } async decode() {} },
    document: { createElement(name) {
      assert.equal(name, 'canvas');
      return { getContext: () => ({ fillRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }) }) };
    } },
    ...environment,
  };
  vm.runInNewContext(code, sandbox, { filename: 'photoAdjustments.js' });
  return module.exports;
}

test('saved edit metadata survives client normalization without entering render parameters', () => {
  const client = loadClient();
  const baked = { photoId: 11, revision: 'e5d29c79-fa9a-4145-b617-c9316a8ee9fc', width: 959, height: 719 };
  for (const input of [{ version: 3, exposure: 0.4, baked }, JSON.stringify({ version: 3, exposure: 0.4, baked })]) {
    const saved = client.normalizePhotoAdjustments(input);
    assert.equal(saved.baked.revision, baked.revision);
    assert.equal(saved.exposure, 0.4);
    assert.equal(client.buildPhotoAdjustments(saved).baked, undefined);
  }
  assert.equal(tone.isDefaultPhotoAdjustments(client.normalizePhotoAdjustments('{')), true);
});

test('the editor rejects a preview returned in place of advertised full-resolution pixels', async () => {
  const client = loadClient({ fetch: async () => new Response(new Blob(), { headers: {
    'X-MaMage-Tone-Engine': tone.ENGINE, 'X-MaMage-Source-Width': '6000', 'X-MaMage-Source-Height': '4000',
  } }) });
  await assert.rejects(client.loadTonePixels('/api/photos/11/pixel-source?variant=working&full=1',
    { authenticated: true, fullResolution: true }), /未取得完整分辨率原图/);
});

test('original-quality editing does not reuse downscaled or transferred pixel buffers', async () => {
  const client = loadClient();
  const preview = await client.loadTonePixels('fixture-original', { maxSize: 1280 });
  assert.deepEqual([preview.width, preview.height], [1280, 853]);
  const original = await client.loadTonePixels('fixture-original', { maxSize: 1280, fullResolution: true });
  assert.deepEqual([original.width, original.height], [5000, 3333]);
  assert.notEqual(original, preview);
  structuredClone(original.data, { transfer: [original.data.buffer] });
  assert.equal(original.data.byteLength, 0);
  const reopened = await client.loadTonePixels('fixture-original', { fullResolution: true });
  assert.notEqual(reopened, original);
  assert.equal(reopened.data.byteLength, 4);
  assert.deepEqual([reopened.width, reopened.height], [5000, 3333]);
});
