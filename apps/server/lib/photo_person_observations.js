const crypto = require('node:crypto');
const { modelVersion, normalizeEvidence, ratioBox } = require('./person_visual_evidence');
const { normalizeProfile } = require('./person_visual_inference');
const { usableFaceSql } = require('./face_result_policy');
const VERSION = 'face-bound-profile-20261016-v1';
const enabled = () => process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED === '1';

// Identity is resolved at read time; correcting a person must not change the visual observation.
function sourceKey(face) {
  return crypto.createHash('sha256').update(JSON.stringify([VERSION, modelVersion(), Number(face.id), Number(face.photoId),
    ratioBox(face), face.photoUrl || null, face.thumbUrl || null])).digest('hex');
}

async function loadPhotoFaces(photoIds, db = require('../db').pool) {
  if (!photoIds.length) return [];
  const [faces] = await db.query(`SELECT pf.id,pf.photo_id AS photoId,pf.person_id AS personId,fp.name AS personName,
    pf.face_no AS faceNo,pf.status,pf.bbox_x AS x,pf.bbox_y AS y,pf.bbox_w AS w,pf.bbox_h AS h,pf.bbox_unit AS unit,
    pf.image_width AS imageWidth,pf.image_height AS imageHeight,p.url AS photoUrl,p.thumb_url AS thumbUrl
    FROM photo_faces pf JOIN photos p ON p.id=pf.photo_id
    LEFT JOIN face_persons fp ON fp.id=pf.person_id AND fp.organization_id=pf.organization_id
    WHERE pf.photo_id IN (?) AND pf.organization_id=p.organization_id AND COALESCE(p.type,'')<>'video'
      AND ${usableFaceSql('pf')} ORDER BY pf.photo_id,pf.face_no,pf.id`, [photoIds]);
  return faces;
}

async function readObservations(faces, db = require('../db').pool) {
  if (!enabled() || !faces.length) return new Map();
  const [rows] = await db.query('SELECT face_id,source_key,observation_json,analyzed_at FROM photo_person_observations WHERE face_id IN (?)',
    [faces.map(face => Number(face.id))]);
  const byId = new Map(faces.map(face => [Number(face.id), face]));
  const result = new Map();
  for (const row of rows) {
    const face = byId.get(Number(row.face_id));
    if (!face || row.source_key !== sourceKey(face) || !ratioBox(face)) continue;
    let raw;
    try { raw = typeof row.observation_json === 'string' ? JSON.parse(row.observation_json) : row.observation_json; }
    catch { continue; }
    if (!raw || raw.version !== VERSION) continue;
    const evidence = normalizeEvidence(raw);
    result.set(Number(face.id), { ...evidence, profile: normalizeProfile(raw.profile, evidence.binding),
      model: modelVersion(), analyzedAt: row.analyzed_at, state: 'done' });
  }
  return result;
}

async function saveObservation(face, raw, db = require('../db').pool) {
  const evidence = normalizeEvidence(raw);
  if (!ratioBox(face)) return;
  const observation = { ...evidence, profile: normalizeProfile(raw?.profile, evidence.binding), version: VERSION };
  await db.query(`INSERT INTO photo_person_observations (face_id,source_key,observation_json,analyzed_at)
    VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE source_key=VALUES(source_key),
      observation_json=VALUES(observation_json),analyzed_at=NOW()`,
  [face.id, sourceKey(face), JSON.stringify(observation)]);
}

function presentPeople(faces, observations) {
  return faces.map(face => {
    const value = observations.get(Number(face.id));
    return { faceId: Number(face.id), faceNo: Number(face.faceNo), personId: face.personId ? Number(face.personId) : null,
      personName: face.personName || null, identityStatus: face.status, bbox: ratioBox(face),
      status: value ? (value.binding === 'clear' ? 'ready' : 'uncertain') : 'not-analyzed',
      ...(value ? { binding: value.binding, visibility: value.visibility, colors: value.colors,
        ...value.profile, analyzedAt: value.analyzedAt } : {}) };
  });
}

module.exports = { VERSION, enabled, sourceKey, loadPhotoFaces, readObservations, saveObservation, presentPeople };
