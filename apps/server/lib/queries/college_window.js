const { pool } = require('../../db');
const { buildMediaUrl } = require('../media_access');
const { displayPhotoRow } = require('../photo_tone/artifacts.cjs');
const { publicationText, DELIVERY_PATH, PUBLIC_IMAGE_PATH, RESTRICTED_TAGS, ANONYMIZED_TAGS } = require('../college_window_policy');

// p/pr are the source rows, never an album or folder shortcut granted to this unit.
const SOURCE_JOIN = 'LEFT JOIN projects pr ON pr.id = p.project_id';
// Direct imports belong to their destination album; an internal copy carries share provenance.
const SOURCE_ATTRIBUTION_OK = `(p.source_attribution IS NULL OR (
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.source_attribution, '$.type')), '') = 'external_import'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.source_attribution, '$.provider')), '') IN ('photoplus', 'alltuu')
  AND JSON_CONTAINS_PATH(p.source_attribution, 'one', '$.shareId', '$.sourceUnitId', '$.sourceOrganizationId', '$.sourcePhotoUuid', '$.copiedAt') = 0
))`;
const SOURCE_OK = `
  p.organization_id = ?
  AND (p.unit_id IS NULL OR p.unit_id = ?)
  AND ((p.project_id IS NULL AND p.unit_id = ?)
    OR (pr.id IS NOT NULL AND pr.organization_id = p.organization_id AND pr.unit_id = ?
      AND pr.restricted_to_user_id IS NULL AND COALESCE(pr.tags, '') NOT REGEXP '${RESTRICTED_TAGS}'))
  AND p.type IN ('normal', 'cover', 'photo', 'image') AND ${SOURCE_ATTRIBUTION_OK}
  AND COALESCE(CAST(p.tags AS CHAR CHARACTER SET utf8mb4), '') NOT REGEXP '${RESTRICTED_TAGS}'
  AND EXISTS (SELECT 1 FROM organization_units ou
    WHERE ou.id = ? AND ou.organization_id = p.organization_id AND ou.archived_at IS NULL)`;
const ORIGINAL_OK = `COALESCE(CAST(p.tags AS CHAR CHARACTER SET utf8mb4), '') NOT REGEXP '${ANONYMIZED_TAGS}'`;
const CURRENT_PUBLICATION = `(w.original_url IS NULL OR (
  CAST(w.original_url AS BINARY) = CAST(p.url AS BINARY) AND ${ORIGINAL_OK}
))`;

function sourceWhere(scope, workspace) {
  return { sql: SOURCE_OK + (workspace?.ownPhotosOnly ? ' AND p.photographer_id = ?' : ''),
    params: [scope.orgId, scope.unitId, scope.unitId, scope.unitId, scope.unitId,
      ...(workspace?.ownPhotosOnly ? [workspace.userId] : [])] };
}

function anyTag(...tags) {
  return '(' + tags.map(tag => `COALESCE(JSON_CONTAINS(p.tags, '${JSON.stringify(tag)}'), 0)`).join(' OR ') + ')';
}

function contentWhere(contentFilter) {
  if (!['no-faces', 'no-people'].includes(contentFilter)) return '';
  const noPeople = `(${anyTag('无人', '无人物')} AND NOT ${anyTag('人物', '单人', '双人', '多人', '群像', '人像', '背影')})`;
  const positiveEvidence = contentFilter === 'no-faces' ? `(${noPeople} OR ${anyTag('无人脸', '无可见人脸')})` : noPeople;
  // Missing face rows do not imply that an image has been analysed or that it has no faces.
  return `AND p.ai_status = 'done' AND ${positiveEvidence}
    AND NOT ${anyTag('人脸', '正脸', '侧脸', '合影', '自拍', '面部特写')}
    AND NOT EXISTS (SELECT 1 FROM photo_faces cwf WHERE cwf.organization_id = p.organization_id AND cwf.photo_id = p.id)`;
}

function candidateWhere(scope, workspace, excluded = [], contentFilter) {
  const source = sourceWhere(scope, workspace);
  return {
    sql: `(${source.sql} AND ${ORIGINAL_OK} AND NOT EXISTS (SELECT 1 FROM college_window_photos active WHERE active.active_photo_id = p.id)
      ${excluded.length ? 'AND p.id NOT IN (?)' : ''} ${contentWhere(contentFilter)})`,
    params: [...source.params, ...(excluded.length ? [excluded] : [])],
  };
}

const SOURCE_COLUMNS = `p.id, p.project_id AS projectId, p.url AS sourceKey, p.url, p.thumb_url AS thumbUrl,
  p.adjustments, p.tags, p.type, pr.name AS albumName,
  CASE WHEN p.ai_status = 'done' THEN COALESCE(NULLIF(p.description, ''), p.detailed_description) END AS aiDescription`;

async function readSources(scope, workspace, ids, db = pool, { lock = false, contentFilter } = {}) {
  if (!ids.length) return [];
  const eligible = candidateWhere(scope, workspace, [], contentFilter);
  const [rows] = await db.query(`SELECT ${SOURCE_COLUMNS} FROM photos p ${SOURCE_JOIN}
    WHERE p.id IN (?) AND ${eligible.sql} ORDER BY p.id${lock ? ' FOR UPDATE' : ''}`, [ids, ...eligible.params]);
  return rows;
}

async function eligibleIds(scope, workspace, ids, db = pool, contentFilter) {
  if (!ids.length) return [];
  const eligible = candidateWhere(scope, workspace, [], contentFilter);
  const [rows] = await db.query(`SELECT p.id FROM photos p ${SOURCE_JOIN} WHERE p.id IN (?) AND ${eligible.sql}`,
    [ids, ...eligible.params]);
  const matched = new Set(rows.map(row => Number(row.id)));
  return ids.filter(id => matched.has(id));
}

async function shortlist(scope, workspace, ids, db = pool, contentFilter) {
  const sources = new Map((await readSources(scope, workspace, ids, db, { contentFilter })).map(row => [Number(row.id), row]));
  return ids.flatMap(id => {
    const row = sources.get(id);
    if (!row) return [];
    const display = displayPhotoRow(row);
    const thumbUrl = buildMediaUrl(display.thumbUrl || display.url,
      { userId: workspace.userId, photoId: row.id });
    return [{ photoId: id, thumbUrl, ...publicationText(row, [], true) }];
  });
}

async function confirmedNames(scope, ids, db = pool, { lock = false } = {}) {
  const names = new Map();
  if (!ids.length) return names;
  const [rows] = await db.query(
    `SELECT pf.photo_id AS photoId, fp.name FROM photo_faces pf JOIN face_persons fp
       ON fp.id = pf.person_id AND fp.organization_id = pf.organization_id
      JOIN face_identity_feedback reviewed ON reviewed.face_id = pf.id AND reviewed.person_id = fp.id
        AND reviewed.organization_id = pf.organization_id AND reviewed.photo_id = pf.photo_id
        AND reviewed.sample_kind IN ('explicit', 'group')
      WHERE pf.organization_id = ? AND pf.photo_id IN (?) AND pf.status = 'confirmed'
        AND COALESCE(fp.name, '') <> '' ORDER BY pf.photo_id, fp.name, pf.id${lock ? ' FOR UPDATE' : ''}`,
    [scope.orgId, ids]);
  for (const row of rows) {
    const key = Number(row.photoId);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(row.name);
  }
  return names;
}

const PUBLICATION_COLUMNS = `w.id, w.photo_id AS photoId, w.width, w.height, w.sha256, w.metadata, w.published_at AS publishedAt,
  w.original_url IS NOT NULL AS original, p.thumb_url AS thumbUrl`;

function publicShape(row) {
  const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  return { id: row.id, width: row.width, height: row.height, sha256: row.sha256, publishedAt: row.publishedAt,
    albumName: metadata?.albumName ?? null, peopleNames: metadata?.peopleNames ?? [], description: metadata?.description ?? null,
    imagePath: `${DELIVERY_PATH}/photos/${row.id}/image`,
    ...(row.original ? { publicImagePath: `${PUBLIC_IMAGE_PATH}/${row.id}` } : {}) };
}

async function listPublished(scope, workspace, { after, limit }, db = pool) {
  const eligible = sourceWhere(scope, workspace);
  const [rows] = await db.query(`SELECT ${PUBLICATION_COLUMNS} FROM college_window_photos w
    JOIN photos p ON p.id = w.photo_id ${SOURCE_JOIN}
    WHERE w.organization_id = ? AND w.unit_id = ? AND w.revoked_at IS NULL
      AND ${eligible.sql} AND ${CURRENT_PUBLICATION}${after ? ' AND w.id > ?' : ''} ORDER BY w.id LIMIT ?`,
  [scope.orgId, scope.unitId, ...eligible.params, ...(after ? [after] : []), limit + 1]);
  return {
    photos: rows.slice(0, limit).map(row => workspace ? { ...publicShape(row), photoId: row.photoId,
      ...(row.original && row.thumbUrl ? { thumbUrl: buildMediaUrl(row.thumbUrl,
        { userId: workspace.userId, photoId: row.photoId }) } : {}) } : publicShape(row)),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

async function getPublished(scope, workspace, id, db = pool) {
  const eligible = sourceWhere(scope, workspace);
  const [rows] = await db.query(`SELECT w.object_key AS objectKey, w.original_url AS originalUrl, w.sha256 FROM college_window_photos w
    JOIN photos p ON p.id = w.photo_id ${SOURCE_JOIN}
    WHERE w.id = ? AND w.organization_id = ? AND w.unit_id = ? AND w.revoked_at IS NULL
      AND ${eligible.sql} AND ${CURRENT_PUBLICATION}`,
  [id, scope.orgId, scope.unitId, ...eligible.params]);
  return rows[0] || null;
}

async function insertPublished(scope, workspace, releases, db) {
  await db.query(`INSERT INTO college_window_photos
    (id, organization_id, unit_id, photo_id, object_key, original_url, metadata, width, height, sha256, published_by) VALUES ?`,
  [releases.map(item => [item.id, scope.orgId, scope.unitId, item.photoId, item.objectKey ?? null,
    item.originalUrl ?? null, JSON.stringify(item.metadata), item.width ?? null, item.height ?? null, item.sha256 ?? null, workspace.userId])]);
}

async function withdraw(scope, workspace, id, db = pool) {
  const ownerFilter = workspace.ownPhotosOnly ? ' AND p.photographer_id = ?' : '';
  const [result] = await db.query(`UPDATE college_window_photos w JOIN photos p ON p.id = w.photo_id
      SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoked_by = ?, w.revoke_reason = 'operator'
    WHERE w.id = ? AND w.organization_id = ? AND w.unit_id = ? AND w.revoked_at IS NULL${ownerFilter}`,
  [workspace.userId, id, scope.orgId, scope.unitId, ...(workspace.ownPhotosOnly ? [workspace.userId] : [])]);
  return result.affectedRows === 1;
}

module.exports = { candidateWhere, readSources, eligibleIds, shortlist, confirmedNames, listPublished, getPublished, insertPublished, withdraw };
