const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(bytesPerQuality) {
  const counts = { decodes: 0, encodes: 0 };
  function sharp(_input, options = {}) {
    if (!options.raw) counts.decodes++;
    let quality; let raw = false;
    const chain = { rotate: () => chain, flatten: () => chain, toColorspace: () => chain,
      raw() { raw = true; return chain; }, jpeg(opts) { quality = opts.quality; return chain; },
      async toBuffer() {
        if (raw) return { data: Buffer.alloc(48), info: { width: 4, height: 4, channels: 3 } };
        counts.encodes++;
        return { data: Buffer.alloc(quality * bytesPerQuality), info: { width: 4, height: 4 } };
      } };
    return chain;
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/public_download_variant.js'), 'utf8'), {
    module, Buffer, require: name => { assert.equal(name, 'sharp'); return sharp; },
  });
  return { counts, create: module.exports.createPublicDownloadBuffer };
}

test('a source fitting at maximum quality requires only one JPEG encode', async () => {
  const f = fixture(10); const result = await f.create(Buffer.from('source'), { maxBytes: 1000 });
  assert.equal(result.quality, 92); assert.equal(f.counts.encodes, 1);
});
test('quality search decodes original once and preserves highest fitting quality', async () => {
  const f = fixture(10); const result = await f.create(Buffer.from('source'), { maxBytes: 400 });
  assert.equal(result.quality, 40); assert.equal(result.bytes, 400); assert.equal(f.counts.decodes, 1);
});
