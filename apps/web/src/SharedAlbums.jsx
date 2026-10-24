import React from 'react';
import { IconShare, IconSimilarStack, IconChevronRight, IconPlus, IconListView } from './ui/icons';
import { resolveAssetUrl } from './services/request';
import './sharedAlbums.css';

export default function SharedAlbums({ albums = [], onOpen, onAdd, savedIds = [], compact = false }) {
  albums = albums.filter(album => !album.viaFolderOnly);
  if (!albums.length) return null;
  return <section className={`shared-albums${compact ? ' shared-albums-compact' : ''}`} aria-label="与我共享"
    id={compact ? undefined : 'desktop-shared'} data-desktop-section={compact ? undefined : 'shared'}>
    <div className="shared-albums-heading"><IconShare /><h2>与我共享</h2><span>{albums.length}</span></div>
    <div className="shared-albums-list">{albums.map(album => <div className="shared-album-entry" key={album.id}><button type="button"
      className="shared-album-link" aria-label={`打开共享相册 ${album.name}`} onClick={() => onOpen(album)}>
      <span className="shared-album-cover">{album.image ? <img src={resolveAssetUrl(album.image)} alt="" loading="lazy" decoding="async" /> : <IconSimilarStack />}</span>
      <span className="shared-album-info"><strong>{album.name}</strong><span className="shared-album-origin">来自 {album.originLabel || album.sourceUnitName}</span>
        <span className="shared-album-meta">{album.count} 张 · {album.shareMode === 'collaborate' ? '共同编辑' : '只读'} · 实时共享</span></span>
      <IconChevronRight className="shared-album-arrow" />
    </button>{onAdd && <button type="button" className="shared-album-add"
      aria-label={`${savedIds.includes(album.id) ? '整理共享相册' : '添加到本组织文件夹'} ${album.name}`}
      title={savedIds.includes(album.id) ? '整理共享相册' : '添加到本组织文件夹'} onClick={() => onAdd(album)}>
      {savedIds.includes(album.id) ? <IconListView /> : <IconPlus />}
    </button>}</div>)}</div>
  </section>;
}
