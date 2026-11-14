import React from 'react';
import { IconGridView, IconSimilarStack } from './ui/icons';
import { listSentShares, listSentFolderShares } from './services/workspaceService';
import './SharedBoard.css';

// 「我分享的」列表：沿用相册桌面既有的胶囊行样式，不另造卡片。
export default function SentShares({ onOpen }) {
  const [state, setState] = React.useState({ loading: true, albums: [], folders: [] });
  React.useEffect(() => {
    let active = true;
    (async () => {
      const [albums, folders] = await Promise.all([
        listSentShares().catch(() => []), listSentFolderShares().catch(() => []),
      ]);
      if (active) setState({ loading: false, albums: Array.isArray(albums) ? albums : [], folders: Array.isArray(folders) ? folders : [] });
    })();
    return () => { active = false; };
  }, []);
  const count = state.albums.length + state.folders.length;
  if (state.loading) return <p className="acp-empty">正在读取我分享的内容…</p>;
  if (!count) return <p className="acp-empty">你还没有把文件分享给其他小组</p>;
  return <div className="share-sent-chips">
    {state.folders.map(folder => <button type="button" className="share-sent-chip" key={`f-${folder.id}`} onClick={() => onOpen?.(folder)}>
      <span className="share-sent-icon is-folder"><IconGridView /></span>
      <span className="share-sent-body"><strong>{folder.albumName || '未命名文件夹'}</strong>
        <small>{folder.albumCount || 0} 个相册 · {folder.targetUnitName || folder.targetUserName || '其他小组'}</small></span>
    </button>)}
    {state.albums.map(album => <button type="button" className="share-sent-chip" key={`a-${album.id}`} onClick={() => onOpen?.(album)}>
      <span className="share-sent-icon"><IconSimilarStack /></span>
      <span className="share-sent-body"><strong>{album.albumName || '未命名相册'}</strong>
        <small>{album.snapshotCount ? `${album.snapshotCount} 张 · ` : ''}{album.targetUnitName || album.targetUserName || '其他小组'}</small></span>
    </button>)}
  </div>;
}
