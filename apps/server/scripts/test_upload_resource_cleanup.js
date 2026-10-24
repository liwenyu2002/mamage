const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const { PassThrough, Transform } = require('node:stream');
const uploadSource = fs.readFileSync(require.resolve('../routes/upload'), 'utf8');
const photoSource = fs.readFileSync(require.resolve('../routes/photos'), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
const until = async check => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Test condition timed out');
};

async function testLateUploadCleanup() {
  const objects = new Set(), deleted = [];
  let finishOriginal;
  const context = {
    console: quiet, Promise,
    req: { file: { buffer: Buffer.from('original') } },
    res: { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } },
    timings: {}, nowMs: Date.now, originalKey: 'original.jpg', thumbKey: 'thumb.jpg',
    mimeType: 'image/jpeg', UPLOAD_CACHE_CONTROL: '', uploadedKeys: [],
    cosStorage: {
      uploadBuffer: key => new Promise(resolve => {
        finishOriginal = () => { objects.add(key); resolve({}); };
      }),
      deleteObjects: async keys => { deleted.push(...keys); keys.forEach(key => objects.delete(key)); },
    },
    createThumbBuffer: async () => { throw new Error('thumbnail failed'); },
  };
  vm.createContext(context);
  const start = uploadSource.indexOf('    let thumbBuffer = null;');
  const end = uploadSource.indexOf('    let insertedId;', start);
  vm.runInContext(`async function run() { ${uploadSource.slice(start, end)} }`, context);
  const result = context.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deleted.length, 0, 'cleanup must wait for the late original upload');
  finishOriginal();
  await result;
  assert.equal(context.res.statusCode, 502);
  assert.deepEqual(deleted, ['original.jpg']);
  assert.equal(objects.size, 0, 'late successful upload must not become an orphan');
}

async function testDeletedVideoCleanup() {
  const jobs = [], objects = new Set(), deleted = [], removedTemps = [];
  let previewCalls = 0;
  const context = {
    console: quiet, path, VIDEO_PREVIEW_ENABLED: true, VIDEO_PLAYBACK_ENABLED: true,
    VIDEO_UPLOAD_TMP_DIR: '/isolated-test', VIDEO_TMP_MIN_FREE_BYTES: 1, UPLOAD_CACHE_CONTROL: '',
    uuidv4: () => 'test', playbackJobsWaiting: jobs, backgroundStopping: false, drainPlaybackQueue() {}, distributed: () => false,
    tmpDirFreeBytes: async () => 100000,
    fs: { createWriteStream: () => ({}) }, pipeline: async () => {},
    prepareVideoForStreaming: async () => ({ fastStarted: true, filePath: '/isolated-test/fast.mp4', cleanupPath: '/isolated-test/fast.mp4', size: 10 }),
    createVideoPosterForPreview: async () => { previewCalls++; },
    enableVideoSemanticAnalysis: async () => { throw new Error('deleted video must not be analyzed'); },
    unlinkFileQuiet: file => removedTemps.push(file),
    pool: { query: async () => [[]] },
    cosStorage: {
      headObject: async () => ({ ContentLength: 10 }), getObject: async () => ({ Body: {} }),
      uploadFile: async key => { objects.add(key); },
      deleteObjects: async keys => { deleted.push(...keys); keys.forEach(key => objects.delete(key)); },
    },
  };
  vm.createContext(context);
  vm.runInContext(uploadSource.slice(uploadSource.indexOf('function enqueueDirectVideoPostProcess('), uploadSource.indexOf('function parseProjectId(')), context);
  context.enqueueDirectVideoPostProcess({ insertedId: 1, sourceKey: 'video.mp4', mimeType: 'video/mp4', thumbKey: 'thumb.jpg', thumbRel: '/thumb.jpg' });
  await jobs[0]();
  assert.deepEqual(deleted, ['video.mp4']);
  assert.equal(objects.size, 0, 'faststart must not recreate a deleted original');
  assert.equal(previewCalls, 0);
  assert.equal(removedTemps.length, 2);
  context.tmpDirFreeBytes = async () => 25;
  context.enableVideoSemanticAnalysis = async () => {};
  context.cosStorage.getObject = async () => { throw Error('must not download a video when working space is insufficient'); };
  await assert.rejects(context.enqueueDirectVideoPostProcess({ insertedId: 2, sourceKey: 'too-large.mp4' }, true),
    /INSUFFICIENT_STORAGE_FOR_VIDEO_PROCESSING/);
  assert.equal(deleted.length, 1, 'capacity rejection cannot delete the uploaded original');
  context.backgroundStopping = true;
  assert.equal(context.enqueueDirectVideoPostProcess({ insertedId: 2, sourceKey: 'second.mp4' }), false);
  assert.equal(jobs.length, 1, 'shutdown must not accept another video processing task');
}

async function testZipCancellation() {
  let upstreamClosed = false, upstream;
  const server = http.createServer((_req, response) => {
    upstream = response;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.write(Buffer.alloc(4096));
    const ticker = setInterval(() => response.write(Buffer.alloc(4096)), 10);
    response.on('close', () => { clearInterval(ticker); upstreamClosed = true; });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const res = new PassThrough();
  res.resume();
  try {
    const context = {
      console: quiet, require, URL, path, Transform, res,
      archiver: require('archiver'), cosStorage: {}, buildInternalMediaUrl: url => url,
      ZIP_MAX_REMOTE_BYTES: 1024 * 1024, ZIP_REMOTE_TIMEOUT_MS: 1000,
    };
    vm.createContext(context);
    const start = photoSource.indexOf("    const archive = archiver('zip'");
    const end = photoSource.indexOf('    const streamToLimitedBuffer', start);
    vm.runInContext(`function createZip() { ${photoSource.slice(start, end)} return appendRemoteFileToArchive; }`, context);
    const append = context.createZip();
    assert.equal(await append(`http://127.0.0.1:${server.address().port}/video`, 'video.mp4'), true);
    assert.equal(upstreamClosed, false, 'upstream must still be streaming before cancellation');
    res.destroy();
    await until(() => upstreamClosed);
  } finally {
    res.destroy();
    upstream?.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  await testLateUploadCleanup();
  await testDeletedVideoCleanup();
  await testZipCancellation();
  console.log('PASS: late upload cleanup, deleted-video faststart cleanup and ZIP upstream cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
