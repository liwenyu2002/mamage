const { folderBranch } = require('./folder_shares');

const activeWorkspace = workspace => workspace.enabled && workspace.orgId && workspace.unitId && workspace.userId;
const sentStatus = () => ({ direction: 'sent', targetUnitNames: [], public: false });
function addTarget(status, name) {
  if (name && !status.targetUnitNames.includes(name)) status.targetUnitNames.push(name);
}

async function folderSharingStatuses(workspace, groups, db) {
  const statuses = Object.create(null);
  if (!activeWorkspace(workspace) || !groups.length) return {};
  const [rows] = await db.query(
    `SELECT fs.source_folder_id AS folderId, fs.mode, target.name AS targetUnitName,
       EXISTS (SELECT 1 FROM share_links link WHERE link.folder_share_id = fs.id
         AND link.organization_id = fs.organization_id AND link.unit_id = fs.source_unit_id
         AND link.revoked_at IS NULL AND (link.expires_at IS NULL OR link.expires_at > NOW())) AS publicActive
     FROM folder_shares fs LEFT JOIN organization_units target ON target.id = fs.target_unit_id
     WHERE fs.organization_id = ? AND fs.source_unit_id = ?
       AND fs.mode IN ('read', 'collaborate', 'public') AND fs.revoked_at IS NULL
       AND (fs.expires_at IS NULL OR fs.expires_at > NOW()) ORDER BY fs.id`,
    [workspace.orgId, workspace.unitId]
  );
  for (const share of rows) {
    if (share.mode === 'public' ? !Number(share.publicActive) : !share.targetUnitName) continue;
    for (const group of folderBranch(groups, share.folderId)) {
      const status = statuses[group.id] ||= sentStatus();
      if (share.mode === 'public') status.public = true;
      else addTarget(status, share.targetUnitName);
    }
  }
  return { ...statuses };
}

// Only project IDs from the authorized catalog may leave this batch. The query
// count stays bounded regardless of how many cards or nested folders are shown.
async function desktopSharingStatuses(workspace, ownedAlbums, receivedAlbums, groups, db) {
  const albums = Object.create(null);
  if (!activeWorkspace(workspace)) return { albums: {}, folders: {} };
  const ownedIds = new Set(ownedAlbums.map(album => Number(album.id)));
  if (ownedIds.size) {
    const [shares] = await db.query(
      `SELECT s.project_id AS projectId, target.name AS targetUnitName
       FROM internal_shares s JOIN organization_units target ON target.id = s.target_unit_id
       WHERE s.organization_id = ? AND s.source_unit_id = ? AND s.share_type = 'album'
         AND s.mode IN ('read', 'collaborate') AND s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at > NOW()) ORDER BY s.id`,
      [workspace.orgId, workspace.unitId]
    );
    for (const share of shares) if (ownedIds.has(Number(share.projectId))) {
      addTarget(albums[share.projectId] ||= sentStatus(), share.targetUnitName);
    }
    const [links] = await db.query(
      `SELECT link.project_id AS projectId FROM share_links link
       WHERE link.organization_id = ? AND link.unit_id = ? AND link.share_type = 'project'
         AND link.folder_share_id IS NULL AND link.revoked_at IS NULL
         AND (link.expires_at IS NULL OR link.expires_at > NOW())
       UNION
       SELECT membership.project_id AS projectId FROM share_links link
       JOIN folder_shares folder ON folder.id = link.folder_share_id
       JOIN internal_shares membership ON membership.folder_share_id = folder.id
       WHERE link.organization_id = ? AND link.unit_id = ? AND folder.mode = 'public'
         AND folder.organization_id = link.organization_id AND folder.source_unit_id = link.unit_id
         AND link.revoked_at IS NULL AND (link.expires_at IS NULL OR link.expires_at > NOW())
         AND folder.revoked_at IS NULL AND (folder.expires_at IS NULL OR folder.expires_at > NOW())
         AND membership.organization_id = folder.organization_id AND membership.source_unit_id = folder.source_unit_id
         AND membership.revoked_at IS NULL AND (membership.expires_at IS NULL OR membership.expires_at > NOW())`,
      [workspace.orgId, workspace.unitId, workspace.orgId, workspace.unitId]
    );
    for (const link of links) if (ownedIds.has(Number(link.projectId))) (albums[link.projectId] ||= sentStatus()).public = true;
  }
  for (const album of receivedAlbums) if (!ownedIds.has(Number(album.id))) albums[album.id] = {
    direction: 'received', originLabel: album.originLabel,
    mode: album.shareMode === 'collaborate' ? 'collaborate' : 'read',
  };
  return { albums: { ...albums }, folders: await folderSharingStatuses(workspace, groups, db) };
}

module.exports = { desktopSharingStatuses, folderSharingStatuses };
