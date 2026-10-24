const { json } = require('./album_desktop');

function folderBranch(groups, folderId) {
  if (!Array.isArray(groups) || !groups.some(group => group.id === folderId && group.kind !== 'smart' && !group.restrictedToUserId)) return [];
  const ids = new Set([folderId]);
  for (let size = -1; size !== ids.size;) {
    size = ids.size;
    for (const group of groups) if (group.kind !== 'smart' && !group.restrictedToUserId && ids.has(group.parentId)) ids.add(group.id);
  }
  return groups.filter(group => ids.has(group.id));
}

async function sourceGroups(db, orgId, unitId, lock = false) {
  const [rows] = await db.query(
    `SELECT state FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ?${lock ? ' FOR UPDATE' : ''}`,
    [orgId, unitId]
  );
  const groups = json(rows[0]?.state, {}).groups;
  return Array.isArray(groups) ? groups : [];
}

// The parent grant owns its derived album grants. Membership changes and revocations
// happen in the same transaction as the source folder edit, not in a background job.
async function syncFolderShares(db, orgId, unitId, groups) {
  const [shares] = await db.query(
    `SELECT * FROM folder_shares WHERE organization_id = ? AND source_unit_id = ?
       AND mode <> 'copy' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE`, [orgId, unitId]
  );
  if (!shares.length) return;
  const ids = [...new Set(groups.flatMap(group => Array.isArray(group.projectIds) ? group.projectIds : []).map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const [projects] = ids.length ? await db.query(
    `SELECT id FROM projects WHERE organization_id = ? AND unit_id = ?
       AND restricted_to_user_id IS NULL AND id IN (?)`, [orgId, unitId, ids]
  ) : [[]];
  const eligible = new Set(projects.map(project => Number(project.id)));
  for (const share of shares) {
    const branch = folderBranch(groups, share.source_folder_id);
    if (!branch.length) {
      await db.query('UPDATE folder_shares SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [share.id]);
      await db.query('UPDATE internal_shares SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [share.id]);
      await db.query('UPDATE share_links SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [share.id]);
      continue;
    }
    const desired = new Set(branch.flatMap(group => group.projectIds || []).map(Number).filter(id => eligible.has(id)));
    const [current] = await db.query(
      'SELECT id, project_id FROM internal_shares WHERE folder_share_id = ? AND revoked_at IS NULL FOR UPDATE', [share.id]
    );
    const retained = new Set();
    for (const grant of current) {
      if (desired.has(Number(grant.project_id)) && !retained.has(Number(grant.project_id))) retained.add(Number(grant.project_id));
      else await db.query('UPDATE internal_shares SET revoked_at = NOW() WHERE id = ? AND folder_share_id = ?', [grant.id, share.id]);
    }
    for (const projectId of desired) if (!retained.has(projectId)) await db.query(
      `INSERT INTO internal_shares (organization_id, source_unit_id, target_unit_id, target_user_id,
         share_type, mode, project_id, created_by, expires_at, folder_share_id)
       VALUES (?, ?, ?, ?, 'album', ?, ?, ?, ?, ?)`,
      [orgId, unitId, share.target_unit_id, share.target_user_id, share.mode === 'public' ? 'read' : share.mode,
        projectId, share.created_by, share.expires_at, share.id]
    );
    const root = branch.find(group => group.id === share.source_folder_id);
    if (root.name !== share.folder_name) await db.query('UPDATE folder_shares SET folder_name = ? WHERE id = ?', [root.name, share.id]);
  }
}

async function listFolderShares(workspace, db, direction = 'received') {
  if (!workspace.enabled || !workspace.unitId || !workspace.orgId || !workspace.userId) return [];
  const received = direction === 'received';
  const [rows] = await db.query(
    `SELECT fs.id, fs.source_folder_id AS folderId, fs.folder_name AS albumName,
            fs.mode, fs.expires_at AS expiresAt, fs.revoked_at AS revokedAt, fs.created_at AS createdAt,
            fs.source_unit_id AS sourceUnitId, fs.target_unit_id AS targetUnitId,
            source.name AS sourceUnitName, org.name AS sourceOrganizationName,
            target.name AS targetUnitName, recipient.name AS targetUserName,
            CASE WHEN fs.mode = 'copy' THEN
              CASE WHEN EXISTS (SELECT 1 FROM organization_copy_jobs j JOIN internal_shares s ON s.id = j.share_id
                WHERE s.folder_share_id = fs.id AND j.status = 'failed') THEN 'failed'
              WHEN EXISTS (SELECT 1 FROM organization_copy_jobs j JOIN internal_shares s ON s.id = j.share_id
                WHERE s.folder_share_id = fs.id AND j.status <> 'ready') THEN 'copying' ELSE 'ready' END
              ELSE NULL END AS copyStatus,
            CASE WHEN fs.mode = 'copy' THEN (SELECT COUNT(DISTINCT s.project_id) FROM internal_shares s WHERE s.folder_share_id = fs.id)
            ELSE (SELECT COUNT(DISTINCT s.project_id) FROM internal_shares s JOIN projects p ON p.id = s.project_id
             WHERE s.folder_share_id = fs.id AND s.revoked_at IS NULL
               AND p.organization_id = fs.organization_id AND p.unit_id = fs.source_unit_id
               AND p.restricted_to_user_id IS NULL) END AS albumCount
     FROM folder_shares fs
     JOIN organization_units source ON source.id = fs.source_unit_id
     JOIN organizations org ON org.id = fs.organization_id
     LEFT JOIN organization_units target ON target.id = fs.target_unit_id
     LEFT JOIN users recipient ON recipient.id = fs.target_user_id
     WHERE fs.organization_id = ? AND fs.${received ? 'target' : 'source'}_unit_id = ?
       ${received ? `AND (fs.target_user_id IS NULL OR fs.target_user_id = ?)
       AND fs.revoked_at IS NULL AND (fs.expires_at IS NULL OR fs.expires_at > NOW())` : ''}
     ORDER BY fs.created_at DESC, fs.id DESC`,
    [workspace.orgId, workspace.unitId, ...(received ? [workspace.userId] : [])]
  );
  return rows.map(row => ({ ...row, shareType: 'folder', id: Number(row.id), albumCount: Number(row.albumCount),
    originLabel: [row.sourceOrganizationName, row.sourceUnitName].filter(Boolean).join(' / ') }));
}

function publicFolderPhotoScope(share, alias = 'p') {
  return {
    sql: `${alias}.organization_id = ? AND ${alias}.unit_id = ? AND EXISTS (
      SELECT 1 FROM internal_shares membership JOIN projects original ON original.id = membership.project_id
      JOIN folder_shares folder ON folder.id = membership.folder_share_id
      WHERE membership.folder_share_id = ? AND membership.project_id = ${alias}.project_id
        AND membership.revoked_at IS NULL AND (membership.expires_at IS NULL OR membership.expires_at > NOW())
        AND folder.mode = 'public' AND folder.revoked_at IS NULL
        AND (folder.expires_at IS NULL OR folder.expires_at > NOW())
        AND original.organization_id = ? AND original.unit_id = ? AND original.restricted_to_user_id IS NULL)`,
    params: [share.organization_id, share.unit_id, share.folder_share_id, share.organization_id, share.unit_id],
  };
}

module.exports = { folderBranch, sourceGroups, syncFolderShares, listFolderShares, publicFolderPhotoScope };
