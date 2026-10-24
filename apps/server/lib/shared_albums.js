const { pool } = require('../db');
const { buildMediaUrl } = require('./media_access');
const { metadataEditScope } = require('./workspace_access');
const { desktopSharingStatuses } = require('./card_sharing_status');

async function listSharedAlbums(workspace, db = pool) {
  if (!workspace.enabled || !workspace.unitId || !workspace.userId || !workspace.orgId) return [];
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.unit_id AS unitId, p.created_at AS createdAt, p.updated_at AS updatedAt,
            grants.shareId, grants.canCollaborate, grants.sharedAt, grants.hasDirectShare,
            source.name AS sourceUnitName, org.name AS sourceOrganizationName,
            (SELECT COUNT(*) FROM photos c WHERE c.project_id = p.id
             AND c.organization_id = p.organization_id) AS count,
            ph.id AS photoId, ph.thumb_url AS coverThumb, ph.url AS coverUrl
     FROM projects p
     JOIN (
       SELECT s.project_id, MIN(s.id) AS shareId,
              MAX(s.mode = 'collaborate') AS canCollaborate, MAX(s.created_at) AS sharedAt,
              MAX(s.folder_share_id IS NULL) AS hasDirectShare
       FROM internal_shares s
       WHERE s.organization_id = ? AND s.target_unit_id = ?
         AND (s.target_user_id IS NULL OR s.target_user_id = ?)
         AND s.share_type = 'album' AND s.mode IN ('read', 'collaborate')
         AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())
       GROUP BY s.project_id
     ) grants ON grants.project_id = p.id
     JOIN organization_units source ON source.id = p.unit_id
     JOIN organizations org ON org.id = p.organization_id
     LEFT JOIN photos ph ON ph.id = (
       SELECT i.id FROM photos i WHERE i.project_id = p.id AND i.organization_id = p.organization_id
         AND (i.type IS NULL OR i.type <> 'video') ORDER BY i.created_at DESC, i.id DESC LIMIT 1
     )
     WHERE p.organization_id = ? AND p.unit_id <> ?
       AND (p.restricted_to_user_id IS NULL OR p.restricted_to_user_id = ? OR ? = 1)
     ORDER BY grants.sharedAt DESC, p.id DESC`,
    [workspace.orgId, workspace.unitId, workspace.userId,
      workspace.orgId, workspace.unitId, workspace.userId, workspace.collegeAdmin ? 1 : 0]
  );
  return rows.map(row => ({
    id: Number(row.id), name: row.name, title: row.name, count: Number(row.count) || 0,
    isShared: true, unitId: Number(row.unitId),
    viaFolderOnly: !Number(row.hasDirectShare),
    canEdit: metadataEditScope(workspace) !== 'none' && (workspace.collegeAdmin || Boolean(Number(row.canCollaborate))),
    year: String(new Date(row.createdAt).getFullYear()),
    shareId: Number(row.shareId), shareMode: Number(row.canCollaborate) ? 'collaborate' : 'read',
    sourceUnitName: row.sourceUnitName, sourceOrganizationName: row.sourceOrganizationName,
    originLabel: [row.sourceOrganizationName, row.sourceUnitName].filter(Boolean).join(' / '),
    sharedAt: row.sharedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
    image: row.coverThumb || row.coverUrl
      ? buildMediaUrl(row.coverThumb || row.coverUrl, { userId: workspace.userId, photoId: row.photoId }) : null,
  }));
}

// Called only after project read access has been checked by the route.
async function getAlbumSharingStatus(workspace, project, db = pool) {
  if (!workspace.enabled || !workspace.unitId || !workspace.userId || !workspace.orgId
    || Number(project?.organization_id) !== Number(workspace.orgId)) return null;
  const ownUnit = Number(project.unit_id) === Number(workspace.unitId);
  if (ownUnit) {
    const { albums } = await desktopSharingStatuses(workspace, [project], [], [], db);
    return albums[project.id] || null;
  }
  const params = [workspace.orgId, project.id, project.unit_id];
  let recipientScope = '';
  if (!ownUnit) {
    recipientScope = ' AND s.target_unit_id = ? AND (s.target_user_id IS NULL OR s.target_user_id = ?)';
    params.push(workspace.unitId, workspace.userId);
  }
  const [shares] = await db.query(
    `SELECT s.mode, source.name AS sourceUnitName, org.name AS sourceOrganizationName,
            target.name AS targetUnitName
     FROM internal_shares s
     JOIN organization_units source ON source.id = s.source_unit_id
     JOIN organizations org ON org.id = s.organization_id
     JOIN organization_units target ON target.id = s.target_unit_id
     WHERE s.organization_id = ? AND s.project_id = ? AND s.source_unit_id = ?
       AND s.share_type = 'album' AND s.mode IN ('read', 'collaborate')
       AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())${recipientScope}
     ORDER BY s.id`, params
  );
  if (!ownUnit) {
    if (!shares.length) return null;
    return {
      direction: 'received',
      originLabel: [shares[0].sourceOrganizationName, shares[0].sourceUnitName].filter(Boolean).join(' / '),
      mode: shares.some(share => share.mode === 'collaborate') ? 'collaborate' : 'read',
    };
  }
}

module.exports = { listSharedAlbums, getAlbumSharingStatus };
