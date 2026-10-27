const { VERSION, evidenceKey, judgeEvidence, assertionState } = require('./person_visual_evidence');
const { usableFaceSql } = require('./face_result_policy');
const NAMESPACE = 'person-visual-evidence';
const memory = new Map();

function visualSearchEnabled(options = {}) {
  if (process.env.SEARCH_VISUAL_ENABLED !== '1' || options.faceSearchAllowed === false || !options.userId) return false;
  const users = String(process.env.SEARCH_VISUAL_USER_IDS || '').split(',').map(Number).filter(Boolean);
  return !users.length || users.includes(Number(options.userId));
}

function decodePayload(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}

async function readEvidence(faces, { db = require('../db').pool, durable = require('./distributed_runtime').distributed() } = {}) {
  const keys = faces.map(face => evidenceKey(face));
  if (!keys.length) return new Map();
  const entries = durable ? (await db.query(
    'SELECT state_key, payload FROM runtime_state WHERE namespace = ? AND state_key IN (?) AND expires_at > ?',
    [NAMESPACE, keys, Date.now()]))[0].map(row => [row.state_key, decodePayload(row.payload)])
    : keys.map(key => [key, memory.get(key)]);
  const result = new Map(entries.filter(([, value]) => value?.version === VERSION && value.expiresAt > Date.now()));
  if (process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED === '1') {
    const missing = faces.filter(face => !result.has(evidenceKey(face)) || result.get(evidenceKey(face)).state === 'failed'
      || result.get(evidenceKey(face)).binding !== 'clear' || !result.get(evidenceKey(face)).profile);
    const observations = await require('./photo_person_observations').readObservations(missing, db);
    for (const face of missing) {
      const observation = observations.get(Number(face.id));
      const existing = result.get(evidenceKey(face));
      if (observation && (observation.binding === 'clear' || !existing)) {
        result.set(evidenceKey(face), existing?.binding === 'clear' && existing.state !== 'failed'
          ? { ...observation, ...existing, profile: existing.profile || observation.profile } : observation);
      }
    }
  }
  return result;
}

async function writeEvidence(face, evidence, { db = require('../db').pool, durable = require('./distributed_runtime').distributed() } = {}) {
  const key = evidenceKey(face);
  const ttl = evidence.state === 'failed' ? 900000 : (evidence.binding === 'clear' ? 90 : 7)*86400000;
  const value = { ...evidence, version: VERSION, expiresAt: Date.now() + ttl };
  if (durable) await db.query(`INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`,
  [NAMESPACE,key,JSON.stringify(value),value.expiresAt]);
  else {
    memory.delete(key); memory.set(key,value);
    while (memory.size > 2000) memory.delete(memory.keys().next().value);
  }
}

async function loadFaces(photoIds, personId, db = require('../db').pool) {
  if (!photoIds.length) return [];
  if (personId !== null && (!Number.isSafeInteger(Number(personId)) || Number(personId) <= 0)) return [];
  const [faces] = await db.query(`SELECT pf.id,pf.photo_id AS photoId,pf.person_id AS personId,
    pf.bbox_x AS x,pf.bbox_y AS y,pf.bbox_w AS w,pf.bbox_h AS h,pf.bbox_unit AS unit,
    pf.image_width AS imageWidth,pf.image_height AS imageHeight,p.url AS photoUrl,p.thumb_url AS thumbUrl
    FROM photo_faces pf INNER JOIN photos p ON p.id=pf.photo_id
    WHERE pf.photo_id IN (?)${personId ? ' AND pf.person_id=?' : ''} AND pf.organization_id=p.organization_id AND ${usableFaceSql('pf')}
    ORDER BY pf.photo_id,pf.id`, personId ? [photoIds,personId] : [photoIds]);
  return faces;
}

async function reviewAnonymousCandidates(candidates, request, signal, db) {
  const faces = await loadFaces(candidates.map(row => row.id), null, db);
  const observations = await require('./photo_person_observations').readObservations(faces, db);
  signal?.throwIfAborted();
  const byPhoto = new Map();
  for (const face of faces) {
    const rows = byPhoto.get(Number(face.photoId)) || [];
    rows.push(observations.get(Number(face.id)));byPhoto.set(Number(face.photoId),rows);
  }
  const matchedIds = [],unknownIds = [];let rejected = 0;
  for (const candidate of candidates) {
    const rows = byPhoto.get(Number(candidate.id)) || [];
    const positive = rows.map(row => judgeEvidence({ positive: request.positive, negative: [] }, row, { allowMulticolor: true }));
    const excluded = rows.flatMap(row => request.negative.map(condition =>
      judgeEvidence({ positive: [condition], negative: [] }, row, { allowMulticolor: true })));
    // A non-black neighbour cannot cancel another person's black clothing; unknown is never evidence of absence.
    if (excluded.includes('match')) rejected++;
    else if (!rows.length || excluded.includes('unknown') || (!positive.includes('match') && positive.includes('unknown'))) unknownIds.push(Number(candidate.id));
    else if (positive.includes('match')) matchedIds.push(Number(candidate.id));
    else rejected++;
  }
  return { matchedIds,unknownIds,candidateCount: candidates.length,rejected,checked: candidates.length-unknownIds.length,
    pending: 0,uncertain: unknownIds.length,queued: 0,unavailable: false };
}

async function reviewCandidates({ candidates, request, signal, enqueue = process.env.SEARCH_VISUAL_ENQUEUE_ENABLED !== '0', db = require('../db').pool }) {
  signal?.throwIfAborted();
  if (request.anonymous) return reviewAnonymousCandidates(candidates, request, signal, db);
  const faces = await loadFaces(candidates.map(row => row.id), request.personId, db);
  const cached = await readEvidence(faces, { db });
  const assertions = [...request.positive,...request.negative].filter(item=>item.kind==='assertion');
  const byPhoto = new Map();
  for (const face of faces) {
    const list = byPhoto.get(Number(face.photoId)) || []; list.push(face); byPhoto.set(Number(face.photoId),list);
  }
  const matchedIds = []; const unknownIds = []; const missing = []; let rejected = 0;
  for (const photo of candidates) {
    const photoFaces = byPhoto.get(Number(photo.id)) || [];
    const states = photoFaces.map(face => {
      const evidence = cached.get(evidenceKey(face));
      if (!evidence || assertions.some(item => !evidence.assertions?.[item.key] && assertionState(item, evidence) === 'unknown')) missing.push(face);
      return judgeEvidence(request, evidence);
    });
    if (states.includes('match')) matchedIds.push(Number(photo.id));
    else if (!states.length || states.includes('unknown')) unknownIds.push(Number(photo.id));
    else rejected++;
  }
  signal?.throwIfAborted();
  const unresolved = new Set(unknownIds);
  const pendingFaces = missing.filter(face=>unresolved.has(Number(face.photoId)));
  const pendingCount = new Set(pendingFaces.map(face=>Number(face.photoId))).size;
  let queued = 0; let unavailable = false;
  if (enqueue && pendingFaces.length) {
    const groups = new Map();
    for (const face of pendingFaces) {
      const batch = groups.get(Number(face.photoId)) || []; batch.push(face); groups.set(Number(face.photoId),batch);
    }
    for (const batch of groups.values()) {
      signal?.throwIfAborted();
      try { if (await require('./search_visual_worker').enqueue(batch.slice(0,4),assertions)) queued++; }
      catch { unavailable = true; }
    }
  }
  return { matchedIds, unknownIds, candidateCount: candidates.length, rejected,
    checked: candidates.length-unknownIds.length, pending: pendingCount,
    uncertain: unknownIds.length-pendingCount, queued, unavailable };
}

module.exports = { visualSearchEnabled, reviewCandidates, loadFaces, readEvidence, writeEvidence, NAMESPACE };
