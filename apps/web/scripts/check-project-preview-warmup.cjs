const assert = require('node:assert/strict');
const babel = require('@babel/core');
const path = require('node:path');
const source = babel.transformFileSync(path.resolve(__dirname, '../src/services/projectPreviewWarmup.js'), { presets: [require.resolve('@babel/preset-env')] }).code;
const mod = { exports: {} }, calls = [];
let active = 0, peak = 0, fail = false;
class FakeImage {
  set src(value) {
    calls.push(value); peak = Math.max(peak, ++active);
    setTimeout(() => { active--; if (fail) this.onerror?.(); else this.onload?.(); }, 3);
  }
  async decode() {}
}
new Function('module', 'exports', 'Image', source)(mod, mod.exports, FakeImage);
const warm = mod.exports.warmProjectPreviewImages;
(async () => {
  const sources = Array.from({ length: 20 }, (_, index) => `photo-${index}.jpg`);
  const [first, second] = await Promise.all([warm(sources), warm(sources)]);
  assert.equal(first.length, 20); assert.equal(second.length, 20);
  assert.equal(calls.length, 20, 'shared URLs load once');
  assert.equal(peak, 4, 'image download/decode concurrency stays bounded');
  await warm(sources); assert.equal(calls.length, 20, 'repeated hover uses warmed images');
  const aborted = new AbortController(); aborted.abort();
  assert.deepEqual(await warm(['never.jpg'], { signal: aborted.signal }), []);
  assert.equal(calls.length, 20);
  const controller = new AbortController();
  const cancelled = warm(sources.map(src => `cancel-${src}`), { signal: controller.signal });
  controller.abort(); assert.deepEqual(await cancelled, []);
  assert.equal(calls.length, 24, 'leaving the viewport skips queued work');
  const shared = new AbortController();
  const cancelledShared = warm(['shared.jpg'], { signal: shared.signal });
  const retained = warm(['shared.jpg']); shared.abort();
  assert.deepEqual(await cancelledShared, []); assert.deepEqual(await retained, ['shared.jpg']);
  assert.equal(calls.filter(src => src === 'shared.jpg').length, 1);
  fail = true; assert.deepEqual(await warm(['retry.jpg']), []);
  fail = false; assert.deepEqual(await warm(['retry.jpg']), ['retry.jpg']);
  assert.equal(calls.filter(src => src === 'retry.jpg').length, 2);
  console.log('PASS: 20-image warmup, concurrency=4, cache, shared consumers, viewport cancellation and error retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
