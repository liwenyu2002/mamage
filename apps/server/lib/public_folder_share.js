const { sourceGroups, folderBranch, publicFolderPhotoScope } = require('./folder_shares');
const { buildMediaUrl } = require('./media_access');

async function loadPublicFolderShare(db, share, { projectId = null, limit = 100, offset = 0 } = {}) {
  const [parents] = await db.query(`SELECT source_folder_id AS folderId FROM folder_shares
    WHERE id = ? AND organization_id = ? AND source_unit_id = ? AND mode = 'public'
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
  [share.folder_share_id, share.organization_id, share.unit_id]);
  if (!parents.length) return null;
  const rootId = parents[0].folderId;
  const branch = folderBranch(await sourceGroups(db, share.organization_id, share.unit_id), rootId);
  if (!branch.length) return null;
  const scope = publicFolderPhotoScope(share);
  const approved = share.sync_mode === 'approval' ? ' AND EXISTS (SELECT 1 FROM share_link_items approved WHERE approved.share_id = ? AND approved.photo_id = p.id)' : '';
  const params = [...scope.params, ...(share.sync_mode === 'approval' ? [share.id] : [])];
  const common = {
    code: share.code, shareCode: share.code, shareType: 'folder', title: branch.find(group => group.id === rootId).name,
    creatorName: share.creatorName, organizationName: share.organizationName,
    createdAt: share.created_at, expiresAt: share.expires_at, photos: [], limit, offset,
  };
  if (projectId) {
    const allowedIds = new Set(branch.flatMap(group => group.projectIds || []).map(Number));
    if (!allowedIds.has(Number(projectId))) return null;
    const [albums] = await db.query(`SELECT p.id, p.name FROM projects p WHERE p.id = ? AND p.organization_id = ?
      AND p.unit_id = ? AND p.restricted_to_user_id IS NULL AND EXISTS (SELECT 1 FROM internal_shares s
        WHERE s.folder_share_id = ? AND s.project_id = p.id AND s.revoked_at IS NULL) LIMIT 1`,
    [projectId, share.organization_id, share.unit_id, share.folder_share_id]);
    if (!albums.length) return null;
    const [photos] = await db.query(`SELECT p.id, p.title, p.description, p.tags, p.type, p.thumb_url AS thumbUrl,
      p.public_download_url AS publicDownloadUrl, p.playback_url AS playbackUrl, p.created_at AS createdAt,
      p.timeline_section_id AS timelineSectionId, section.name AS timelineSectionName
      FROM photos p LEFT JOIN project_timeline_sections section ON section.id = p.timeline_section_id
      WHERE ${scope.sql}${approved} AND p.project_id = ? ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`, [...params, projectId, limit, offset]);
    return { ...common, shareType: 'project', projectId: Number(projectId), title: albums[0].name,
      photos: photos.map(photo => ({ ...photo,
        url: buildMediaUrl(photo.type === 'video' ? photo.playbackUrl || photo.thumbUrl : photo.publicDownloadUrl || photo.thumbUrl, { shareId: share.id, photoId: photo.id }),
        thumbUrl: buildMediaUrl(photo.thumbUrl, { shareId: share.id, photoId: photo.id }),
        publicDownloadUrl: photo.type !== 'video' ? buildMediaUrl(photo.publicDownloadUrl, { shareId: share.id, photoId: photo.id }) : null,
        playbackUrl: buildMediaUrl(photo.playbackUrl, { shareId: share.id, photoId: photo.id }),
      })) };
  }
  const [rows] = await db.query(`SELECT album.id, album.name, COUNT(DISTINCT p.id) AS count, MAX(p.id) AS coverId
    FROM projects album JOIN internal_shares membership ON membership.project_id = album.id
    LEFT JOIN photos p ON p.project_id = album.id AND p.organization_id = album.organization_id AND p.unit_id = album.unit_id${approved}
    WHERE membership.folder_share_id = ? AND membership.revoked_at IS NULL
      AND (membership.expires_at IS NULL OR membership.expires_at > NOW())
      AND album.organization_id = ? AND album.unit_id = ? AND album.restricted_to_user_id IS NULL
    GROUP BY album.id, album.name`, [...(share.sync_mode === 'approval' ? [share.id] : []), share.folder_share_id, share.organization_id, share.unit_id]);
  const coverIds = rows.map(row => row.coverId).filter(Boolean);
  const covers = coverIds.length ? (await db.query('SELECT id, thumb_url AS thumbUrl FROM photos WHERE id IN (?)', [coverIds]))[0] : [];
  const albums = rows.map(row => ({ id: Number(row.id), name: row.name, count: Number(row.count),
    image: buildMediaUrl(covers.find(photo => Number(photo.id) === Number(row.coverId))?.thumbUrl, { shareId: share.id, photoId: row.coverId }) }));
  const eligible = new Set(albums.map(album => album.id));
  const groups = branch.map(group => ({ id: group.id, name: group.name, parentId: group.id === rootId ? null : group.parentId,
    kind: 'manual', color: group.color, tint: group.tint, symbol: group.symbol, projectIds: (group.projectIds || []).map(Number).filter(id => eligible.has(id)) }));
  return { ...common, folder: { public: true, share: { folderId: rootId, originLabel: share.organizationName || '', mode: 'read' }, groups,
    albums: albums.map(album => ({ ...album, groups: groups.filter(group => group.projectIds.includes(album.id)).map(group => group.id) })) } };
}

module.exports = { loadPublicFolderShare };
