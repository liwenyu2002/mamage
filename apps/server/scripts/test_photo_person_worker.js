const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const profiles = require('../lib/photo_person_observations');

function fixture({ inferenceError } = {}) {
  let changed = false, seen = 0;
  let faces = Array.from({ length: 5 }, (_, index) => ({ id: 10 + index, photoId: 101,
    personId: 100 + index, x: 0.1 + index * 0.1, y: 0.1, w: 0.05, h: 0.1, thumbUrl: '/thumb.jpg' }));
  const writes = [], jobs = [];
  const dependencies = {
    'node:crypto': require('node:crypto'),
    './distributed_runtime': { distributed: () => true, coordinator: {
      register() {}, enqueue: async (kind, key, job, options) => { jobs.push({ kind, key, job, options }); return true; },
    } },
    './search_visual_index': {},
    './person_visual_evidence': require('../lib/person_visual_evidence'),
    './runtime_lifecycle': { waitForIdle: async () => {} },
    './photo_person_observations': { ...profiles, enabled: () => true,
      loadPhotoFaces: async () => ++seen > 1 && changed ? faces.map(face => ({ ...face, x: face.x + 0.01 })) : faces,
      readObservations: async () => new Map(), saveObservation: async (face, value) => writes.push({ face, value }),
    },
    './person_visual_inference': { analyzePeople: async (_buffer, selected, options) => {
      assert.equal(options.profile, true);
      if (inferenceError) throw inferenceError;
      return new Map(selected.map(face => [Number(face.id), { binding: 'clear', profile: { description: '可见人物' } }]));
    } },
    './cos_storage': { keyFromUrlOrPath: () => 'uploads/thumb.jpg', isConfigured: () => true, isSafeKey: () => true,
      getObject: async () => ({ ContentLength: 4, Body: Readable.from([Buffer.from('test')]) }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../lib/search_visual_worker.js'), 'utf8'), {
    module, exports: module.exports, require: key => {
      if (!dependencies[key]) throw Error(`Unexpected dependency: ${key}`);
      return dependencies[key];
    }, process: { env: { PHOTO_PERSON_OBSERVATIONS_ENABLED: '1' } },
    Buffer, AbortController, AbortSignal, setTimeout, setImmediate,
  });
  return { worker: module.exports, jobs, writes, faces, change: () => { changed = true; seen = 0; },
    reassign: () => { faces = faces.map(face => ({ ...face, personId: 77 })); } };
}

test('uploads enqueue every face in bounded low-priority groups, independent of search feature flag', async () => {
  const f = fixture();
  assert.equal(await f.worker.enqueuePhoto(101), 5);
  assert.deepEqual(f.jobs.map(job => job.job.keys.length), [4, 1]);
  assert.ok(f.jobs.every(job => job.kind === 'person-visual' && job.job.profile && job.options.priority === 75));
  assert.ok(f.jobs.every(job => !JSON.stringify(job).includes('可见人物')));
  await f.worker.processJob(f.jobs[0].job);
  assert.equal(f.writes.length, 4);
  f.reassign();
  await f.worker.processJob(f.jobs[1].job);
  assert.equal(f.writes.length, 5, 'identity correction preserves face-bound observations');
  await f.worker.stop();
});

test('geometry changed during inference is never saved against the new face position', async () => {
  const f = fixture();
  await f.worker.enqueuePhoto(101);
  f.change();
  await f.worker.processJob(f.jobs[0].job);
  assert.equal(f.writes.length, 0);
  await f.worker.stop();
});

test('profile failures retain a safe reason for retries without persisting upstream content', async () => {
  for (const [error,reason] of [
    [Object.assign(new Error('private upstream response'),{code:'HUB_VISION_OUTPUT_INVALID'}),'HUB_VISION_OUTPUT_INVALID'],
    [new Error('private source URL and credentials'),'VISUAL_PROCESSING_FAILED'],
  ]) {
    const f = fixture({ inferenceError:error });
    await f.worker.enqueuePhoto(101);
    await assert.rejects(f.worker.processJob(f.jobs[0].job),next=>{
      assert.equal(next.message,`PERSON_VISUAL_ANALYSIS_FAILED:${reason}`);
      return true;
    });
    assert.equal(f.writes.length,0);
    await f.worker.stop();
  }
});
