import React from 'react';
import { IconShare } from './ui/icons';
import { request } from './services/request';
import { sharingStatusText } from './utils/sharingStatus';
import './albumSharingStatus.css';

export default function AlbumSharingStatus({ projectId, folderId, unitId, suspended = false }) {
  const [result, setResult] = React.useState(null);
  const resourceId = folderId || projectId;
  const resourceKey = `${folderId ? 'folder' : 'album'}:${resourceId}:${unitId}`;
  React.useEffect(() => {
    if (!resourceId || !unitId || suspended) return undefined;
    const controller = new AbortController();
    let canceled = false;
    let requestId = 0;
    const refresh = () => {
      const current = ++requestId;
      return request(folderId ? `/api/folder-shares/status/${encodeURIComponent(folderId)}`
        : `/api/projects/${encodeURIComponent(projectId)}/sharing-status`, { signal: controller.signal })
      .then(data => { if (!canceled && current === requestId) setResult({ resourceKey, sharing: data?.sharing }); })
      .catch(() => { if (!canceled && current === requestId) setResult(null); });
    };
    refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      canceled = true;
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId, folderId, unitId, resourceId, resourceKey, suspended]);

  const sharing = result?.resourceKey === resourceKey ? result.sharing : null;
  const text = sharingStatusText(sharing);
  if (!text) return null;
  return <div className="album-sharing-status" role="status" aria-label={`${folderId ? '文件夹' : '相册'}共享状态`}>
    <IconShare aria-hidden="true" />
    <span>{text}</span>
  </div>;
}
