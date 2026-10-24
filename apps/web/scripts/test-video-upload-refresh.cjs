const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const assert = require('node:assert/strict'), { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/services/photoService.js'), 'utf8');

test('transcoding is not announced before the server has accepted the uploaded video into the album', async () => {
  const phases = [], calls = [];
  let finishComplete;
  const file = { size: 10, name: 'raw.mp4', type: 'video/mp4', slice: () => ({ size: 10 }) };
  const context = { Promise, setTimeout, DIRECT_VIDEO_PROXY_UPLOAD_CONCURRENCY: 1,
    resolveUploadApiUrl: value => value, getAuthHeaders: () => ({}), readHeader: () => '',
    emitUploadProgress: (_callback, event) => phases.push(event.phase), abortDirectVideoUpload: async () => {},
    requestWithUploadProgress: async () => ({ status: 200, responseText: JSON.stringify({ etag: 'part-etag' }), headers: {} }),
    requestUploadJson: async url => { calls.push(url); return new Promise(resolve => { finishComplete = resolve; }); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function uploadViaDirectVideoPartProxy('), source.indexOf('async function uploadViaDirectVideo(file,')), context);
  const upload = context.uploadViaDirectVideoPartProxy({ sessionId: 'session', partSize: 5 * 1024 ** 2, partCount: 1, partUploadUrlPath: '/part/{partNumber}' }, file);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  const beforeAccepted = phases.slice();
  finishComplete({ id: 11, processingStatus: 'transcoding' });
  assert.equal((await upload).id, 11);
  assert.ok(!beforeAccepted.includes('video-processing'), 'Transferred bytes still awaiting the complete response are not yet a persistent transcoding album entry');
});
