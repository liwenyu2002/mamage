const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const tone = require('../../server/lib/photo_tone/engine.mjs');

test('original-quality editing does not reuse or downsize a cached preview', async () => {
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
      return { getContext: () => ({ fillRect() {}, drawImage() {}, getImageData: () => ({ data: [] }) }) };
    } },
  };
  vm.runInNewContext(code, sandbox, { filename: 'photoAdjustments.js' });
  const preview = await module.exports.loadTonePixels('fixture-original', { maxSize: 1280 });
  assert.deepEqual([preview.width, preview.height], [1280, 853]);
  const original = await module.exports.loadTonePixels('fixture-original', { maxSize: 1280, fullResolution: true });
  assert.deepEqual([original.width, original.height], [5000, 3333]);
  assert.notEqual(original, preview);
  assert.equal(await module.exports.loadTonePixels('fixture-original', { fullResolution: true }), original);
});
