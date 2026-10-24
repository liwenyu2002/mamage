const crypto = require('node:crypto');
const { coordinator, distributed } = require('./distributed_runtime');
const { loadFaces, readEvidence, writeEvidence } = require('./search_visual_index');
const { evidenceKey, normalizeEvidence, modelVersion } = require('./person_visual_evidence');
const { analyzePeople } = require('./person_visual_inference');
const { waitForIdle } = require('./runtime_lifecycle');
const queue = []; const pending = new Set();
let running = 0; let stopping = false;
const shutdown = new AbortController();

async function processProfile(job) {
  const profiles = require('./photo_person_observations');
  const current = await profiles.loadPhotoFaces([job.photoId]);
  const cached = await profiles.readObservations(current);
  const faces = current.filter(face => job.keys?.includes(profiles.sourceKey(face)) && !cached.has(Number(face.id))).slice(0,4);
  if (!faces.length) return;
  const signal = AbortSignal.any([shutdown.signal,AbortSignal.timeout(90000)]);
  const buffer = await readThumbnail(faces[0],signal);
  const values = await analyzePeople(buffer,faces,{ signal, profile:true });
  const latest = await profiles.loadPhotoFaces([job.photoId]);
  const valid = new Set(latest.map(face => profiles.sourceKey(face)));
  for (const face of faces) {
    signal.throwIfAborted();
    if (valid.has(profiles.sourceKey(face))) await profiles.saveObservation(face,values.get(Number(face.id)));
  }
}

async function readThumbnail(face, signal) {
  const storage = require('./cos_storage');
  const key = storage.keyFromUrlOrPath(face.thumbUrl || face.photoUrl);
  if (!storage.isConfigured() || !key || !storage.isSafeKey(key)) throw Error('VISUAL_SOURCE_UNAVAILABLE');
  const source = await storage.getObject(key, { signal });
  const limit = 8*1024*1024;
  let bytes = 0; const chunks = [];
  try {
    if (Number(source.ContentLength) > limit) throw Error('VISUAL_SOURCE_TOO_LARGE');
    for await (const chunk of source.Body) {
      signal.throwIfAborted(); bytes += chunk.length;
      if (bytes > limit) throw Error('VISUAL_SOURCE_TOO_LARGE');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks,bytes);
  } finally { source.Body?.destroy?.(); }
}

async function processJob(job) {
  if (stopping || (job.profile ? !require('./photo_person_observations').enabled() : process.env.SEARCH_VISUAL_ENABLED !== '1')) return;
  running++;
  let faces = [];
  try {
    if (job.profile) return await processProfile(job);
    const current = await loadFaces([job.photoId],job.personId);
    faces = current.filter(face => job.keys?.includes(evidenceKey(face))).slice(0,4);
    const cached = await readEvidence(faces);
    faces = faces.filter(face => !cached.get(evidenceKey(face)) || cached.get(evidenceKey(face)).state === 'failed'
      || (job.assertions||[]).some(item=>!cached.get(evidenceKey(face)).assertions?.[item.key]));
    if (!faces.length) return;
    const signal = AbortSignal.any([shutdown.signal,AbortSignal.timeout(60000)]);
    const buffer = await readThumbnail(faces[0],signal);
    const evidence = await analyzePeople(buffer,faces,{ signal, assertions:job.assertions||[] });
    const latest = await loadFaces([job.photoId],job.personId);
    const valid = new Set(latest.map(face => evidenceKey(face)));
    for (const face of faces) {
      if (valid.has(evidenceKey(face))) {
        const next = evidence.get(Number(face.id));
        const assertions = Object.fromEntries(Object.entries({...cached.get(evidenceKey(face))?.assertions,...next.assertions}).slice(-32));
        await writeEvidence(face,{ ...next, assertions, state: 'done', model: modelVersion(), analyzedAt: new Date().toISOString() });
      }
    }
  } catch (error) {
    for (const face of faces) await writeEvidence(face,{ ...normalizeEvidence(null), state: 'failed',
      observation: '视觉核验暂不可用', model: modelVersion() }).catch(() => {});
    const reason = String(error.code || error.message || '');
    const safeReason = /^(?:HUB_|VISUAL_)[A-Z0-9_]{1,64}$/.test(reason) ? reason
      : ['AbortError','TimeoutError'].includes(error.name) ? 'VISUAL_ABORTED' : 'VISUAL_PROCESSING_FAILED';
    throw new Error(`PERSON_VISUAL_ANALYSIS_FAILED:${safeReason}`,{cause:error});
  } finally { running--; }
}

function drain() {
  if (stopping || running || !queue.length) return;
  if (require('./ai_tags_worker').queueLength() > 0) {
    const timer = setTimeout(drain,1000); timer.unref(); return;
  }
  const item = queue.shift();
  processJob(item.job).catch(() => {}).finally(() => { pending.delete(item.key); setImmediate(drain); });
}

async function enqueue(faces, assertions = [], { profile = false } = {}) {
  if (stopping || !faces.length || (profile ? !require('./photo_person_observations').enabled() : process.env.SEARCH_VISUAL_ENABLED !== '1')) return false;
  const keys = faces.map(face => profile ? require('./photo_person_observations').sourceKey(face) : evidenceKey(face)).sort();
  const key = (profile ? 'profile:' : '')+crypto.createHash('sha256').update(keys.join(':')+assertions.map(item=>item.key).sort().join(':')).digest('hex')+':'+Math.floor(Date.now()/900000);
  const job = { photoId: Number(faces[0].photoId), personId: Number(faces[0].personId), keys, assertions, profile };
  if (distributed()) {
    if (profile) return coordinator.enqueue('person-visual',key,job,{ priority: 75 });
    const [existing] = await require('../db').pool.query("SELECT status FROM runtime_tasks WHERE kind='person-visual' AND dedupe_key=?",[key]);
    if (existing.length) return ['queued','running'].includes(existing[0].status);
    const [[count]] = await require('../db').pool.query("SELECT COUNT(*) AS total FROM runtime_tasks WHERE kind='person-visual' AND status IN ('queued','running')");
    if (Number(count.total) >= 128) return false;
    return coordinator.enqueue('person-visual',key,job,{ priority: 50 });
  }
  if (queue.length+running >= 128 || pending.has(key)) return false;
  pending.add(key); queue.push({ key,job }); setImmediate(drain); return true;
}

async function enqueuePhoto(photoId) {
  if (stopping || process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED !== '1') return 0;
  const profiles = require('./photo_person_observations');
  const faces = await profiles.loadPhotoFaces([photoId]);
  const cached = await profiles.readObservations(faces);
  const missing = faces.filter(face => !cached.has(Number(face.id)));
  let accepted = 0;
  for (let index = 0; index < missing.length; index += 4) {
    if (await enqueue(missing.slice(index,index+4),[],{profile:true})) accepted += Math.min(4,missing.length-index);
  }
  return accepted;
}

async function stop() {
  stopping = true; queue.length = 0; shutdown.abort();
  await waitForIdle(() => running === 0);
}

coordinator.register('person-visual','vision',processJob);
module.exports = { enqueue, enqueuePhoto, processJob, readThumbnail, stop };
