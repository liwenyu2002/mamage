const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/services/photoService.js'), 'utf8');
const file = { name: 'test.jpg', size: 10, type: 'image/jpeg' };

function harness({ failAllCompletions = false, failThumbnail = false } = {}) {
  const calls = [];
  let completeCount = 0, finishOriginal;
  const context = {
    Promise, setTimeout: callback => setTimeout(callback, 1),
    MAX_VIDEO_API_FALLBACK_BYTES: 5 * 1024 ** 3,
    parseMaybeJsonTags: tags => tags, emitUploadProgress() {},
    createThumbnailBlob: async () => ({ size: 2 }),
    putSignedObject: async target => {
      if (!failThumbnail) return;
      if (target.key === 'thumb') throw new Error('thumbnail upload failed');
      await new Promise(resolve => { finishOriginal = resolve; });
    },
    requestUploadJson: async (route, options) => {
      calls.push({ route, options });
      if (route.endsWith('/init')) return { sessionToken: 'signed-session', original: { key: 'original' }, thumb: { key: 'thumb' } };
      assert.equal(options.data.sessionToken, 'signed-session');
      if (route.endsWith('/abort')) return {};
      completeCount++;
      if (failAllCompletions || completeCount === 1) throw new TypeError('Failed to fetch');
      return { id: 77 };
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function abortDirectUpload('), source.indexOf('async function uploadViaApi(')), context);
  vm.runInContext(source.slice(source.indexOf('function shouldFallbackToApi('), source.indexOf('function parseErrorBody(')), context);
  return { context, calls, finishOriginal: () => finishOriginal() };
}

(async () => {
  const retried = harness();
  assert.equal((await retried.context.uploadViaDirectCos(file, { projectId: 1 })).id, 77);
  assert.equal(retried.calls.filter(call => call.route.endsWith('/complete')).length, 2);
  assert.equal(retried.calls.filter(call => call.route.endsWith('/abort')).length, 0);

  const unknown = harness({ failAllCompletions: true });
  await assert.rejects(unknown.context.uploadViaDirectCos(file, { projectId: 1 }), error => {
    assert.equal(error.directUploadCompletionUnknown, true);
    assert.equal(unknown.context.shouldFallbackToApi(error, file), false, 'uncertain completion must not trigger a duplicate API upload');
    return true;
  });
  assert.equal(unknown.calls.filter(call => call.route.endsWith('/abort')).length, 0, 'lost completion responses must not delete committed media');

  const partial = harness({ failThumbnail: true });
  const upload = partial.context.uploadViaDirectCos(file, { projectId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(partial.calls.filter(call => call.route.endsWith('/abort')).length, 0, 'abort must wait for both uploads to settle');
  partial.finishOriginal();
  await assert.rejects(upload, /thumbnail upload failed/);
  assert.equal(partial.calls.filter(call => call.route.endsWith('/abort')).length, 1);
  console.log('PASS: photo completion retry, ambiguous-response protection and partial-upload cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
