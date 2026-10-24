const crypto = require('crypto');
const { json, validateGroups } = require('./album_desktop');

async function createAlbumCopy(db, parent, projectId) {
  const [projects] = await db.query(
    `SELECT name, description, event_date, meta, tags, type FROM projects
     WHERE id = ? AND organization_id = ? AND unit_id = ? AND restricted_to_user_id IS NULL LIMIT 1`,
    [projectId, parent.organization_id, parent.source_unit_id]
  );
  if (!projects.length) throw Error('FOLDER_COPY_SOURCE_CHANGED');
  const [sections] = await db.query('SELECT id, name, section_time, sort_order FROM project_timeline_sections WHERE project_id = ? ORDER BY sort_order, id', [projectId]);
  const [photos] = await db.query(
    `SELECT ph.*, p.name AS source_album_name FROM photos ph JOIN projects p ON p.id = ph.project_id
     WHERE ph.project_id = ? AND ph.organization_id = ? AND ph.unit_id = ? ORDER BY ph.id FOR SHARE`,
    [projectId, parent.organization_id, parent.source_unit_id]
  );
  const [created] = await db.query(
    `INSERT INTO internal_shares (organization_id, source_unit_id, target_unit_id, target_user_id,
       share_type, mode, project_id, created_by, expires_at, snapshot_json, folder_share_id)
     VALUES (?, ?, ?, ?, 'album', 'copy', ?, ?, ?, ?, ?)`,
    [parent.organization_id, parent.source_unit_id, parent.target_unit_id, parent.target_user_id,
      projectId, parent.created_by, parent.expires_at, JSON.stringify({ project: projects[0], sections }), parent.id]
  );
  for (let offset = 0; offset < photos.length; offset += 400) await db.query(
    'INSERT INTO internal_share_items (share_id, photo_id, snapshot_json) VALUES ?',
    [photos.slice(offset, offset + 400).map(photo => [created.insertId, photo.id, JSON.stringify(photo)])]
  );
  await db.query(`INSERT INTO organization_copy_jobs (share_id, organization_id, target_unit_id, requested_by, system_initiated)
    VALUES (?, ?, ?, ?, 1)`, [created.insertId, parent.organization_id, parent.target_unit_id, parent.created_by]);
}

async function attachFolderCopy(db, parent, sourceProjectId = null, copiedProjectId = null) {
  const snapshot = json(parent.snapshot_json, {}), sourceGroups = snapshot.groups || [];
  if (!sourceGroups.length) throw Error('FOLDER_COPY_SNAPSHOT_MISSING');
  await db.query(`INSERT IGNORE INTO album_desktop_workspaces (organization_id, unit_key, state) VALUES (?, ?, '{"groups":[]}')`,
    [parent.organization_id, parent.target_unit_id]);
  const [rows] = await db.query('SELECT state FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ? FOR UPDATE',
    [parent.organization_id, parent.target_unit_id]);
  const state = json(rows[0]?.state, {}), groups = Array.isArray(state.groups) ? state.groups : [];
  const copiedId = id => `copyfolder-${parent.id}-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 20)}`;
  const next = groups.map(group => ({ ...group, projectIds: [...(group.projectIds || [])] }));
  if (copiedProjectId && !next.some(group => group.id === copiedId(parent.source_folder_id))) throw Error('FOLDER_COPY_TARGET_MISSING');
  for (const source of sourceGroups) {
    let target = next.find(group => group.id === copiedId(source.id));
    if (!target) {
      if (copiedProjectId) {
        if ((source.projectIds || []).includes(Number(sourceProjectId))) throw Error('FOLDER_COPY_TARGET_CHANGED');
        continue;
      }
      target = { ...source, id: copiedId(source.id), name: source.id === parent.source_folder_id ? `${source.name}（副本）`.slice(0, 80) : source.name,
        parentId: source.id === parent.source_folder_id ? null : copiedId(source.parentId), projectIds: [],
        createdBy: parent.target_user_id || null, kind: 'manual',
        ...(parent.target_user_id ? { restrictedToUserId: Number(parent.target_user_id) } : {}) };
      next.push(target);
    }
    if (copiedProjectId && (source.projectIds || []).includes(Number(sourceProjectId)) && !target.projectIds.includes(Number(copiedProjectId))) target.projectIds.push(Number(copiedProjectId));
  }
  validateGroups(next, new Set(next.flatMap(group => group.projectIds || []).map(Number)));
  await db.query('UPDATE album_desktop_workspaces SET state = ?, revision = revision + 1 WHERE organization_id = ? AND unit_key = ?',
    [JSON.stringify({ ...state, groups: next }), parent.organization_id, parent.target_unit_id]);
  return copiedId(parent.source_folder_id);
}

module.exports = { createAlbumCopy, attachFolderCopy };
