import React from 'react';
import { IconShare } from './ui/icons';
import { resolveAssetUrl } from './services/request';
import './NewShares.css';

const STORAGE_PREFIX = 'mamage_share_seen:';
const keyOf = (kind, id) => `${kind}:${id}`;

// 「新与我共享」：相册与文件夹合并成一行提示，点开即视为已读；
// 全部已读后整块（含标题）消失，完整列表在左侧「共享」里。
export default function NewShares({ albums = [], folders = [], userId, onOpenAlbum, onOpenFolder }) {
  const storageKey = `${STORAGE_PREFIX}${userId || 'anon'}`;
  const [seen, setSeen] = React.useState(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem(storageKey) || '[]')); } catch { return new Set(); }
  });

  const items = React.useMemo(() => [
    ...folders.map(folder => ({ kind: 'folder', id: folder.id, name: folder.albumName, meta: `${folder.albumCount || 0} 个相册`, item: folder })),
    ...albums.filter(album => !album.viaFolderOnly).map(album => ({ kind: 'album', id: album.id, name: album.name,
      meta: `${album.count || 0} 张`, item: album, image: album.image ? resolveAssetUrl(album.image) : null })),
  ], [albums, folders]);

  const fresh = items.filter(item => !seen.has(keyOf(item.kind, item.id)));
  if (!fresh.length) return null;

  const dismiss = key => {
    const next = new Set(seen); next.add(key);
    setSeen(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* 本地不可写时只在内存里记 */ }
  };

  return <section className="new-shares" aria-label="新与我共享">
    <div className="new-shares-heading"><IconShare /><h2>新与我共享</h2><span>{fresh.length}</span></div>
    <div className="new-shares-list">{fresh.map(item => <button type="button" key={keyOf(item.kind, item.id)}
      className={`new-share-chip is-${item.kind}`} onClick={() => { dismiss(keyOf(item.kind, item.id));
        if (item.kind === 'folder') onOpenFolder?.(item.id); else onOpenAlbum?.(item.item); }}>
      <span className="new-share-thumb">{item.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="new-share-folder-glyph" aria-hidden="true" />}</span>
      <span className="new-share-name">{item.name || '未命名'}</span>
      <span className="new-share-meta">{item.meta}</span>
    </button>)}</div>
  </section>;
}
