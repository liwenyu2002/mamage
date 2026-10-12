export const MAX_FOLDER_DEPTH = 5;
export const FOLDER_DEPTH_LIMIT_MESSAGE = `最多支持 ${MAX_FOLDER_DEPTH} 级文件夹`;
export const ROOT_DROP_ID = 'folder-root';
export function folderPath(group, groups) {
  const path = [], seen = new Set();
  while (group && !seen.has(group.id)) {
    path.unshift(group); seen.add(group.id);
    group = groups.find(item => item.id === group.parentId);
  }
  return path;
}

export function folderBranchHeight(sourceId, groups) {
  return Math.max(1, ...groups.map(group => {
    const path = folderPath(group, groups);
    const index = path.findIndex(item => item.id === sourceId);
    return index < 0 ? 0 : path.length - index;
  }));
}

export function folderMoveIssue(sourceId, targetId, groups) {
  const source = groups.find(group => group.id === sourceId);
  const target = groups.find(group => group.id === targetId);
  if (!source) return '文件夹已不存在';
  if (targetId && !target) return '目标文件夹已不存在';
  if (source.id === targetId) return '不能移入自身';
  if (folderPath(target, groups).some(group => group.id === sourceId)) return '不能移入自己的子文件夹';
  if ((source.parentId || null) === (targetId || null)) return target ? '已经在这个文件夹中' : '已经在顶层';
  if (folderPath(target, groups).length + folderBranchHeight(sourceId, groups) > MAX_FOLDER_DEPTH) return FOLDER_DEPTH_LIMIT_MESSAGE;
  return '';
}

export function groupAlbums(group, albums, groups = []) {
  const ids = new Set(groups.filter(item => folderPath(item, groups).some(parent => parent.id === group.id)).map(item => item.id));
  return albums.filter((album) => album.groups.some(id => ids.has(id)));
}

export function folderPreviewItems(group, albums, groups) {
  return [
    ...groups.filter(item => item.parentId === group.id).map(item => ({
      kind: 'folder', item,
      childCount: groups.filter(child => child.parentId === item.id).length,
      albumCount: albums.filter(album => album.groups.includes(item.id)).length,
    })),
    ...albums.filter(album => album.groups.includes(group.id)).map(item => ({ kind: 'album', item })),
  ];
}


