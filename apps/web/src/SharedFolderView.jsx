import React from 'react';
import { Button } from './ui';
import { IconChevronLeft, IconChevronRight, IconShare, IconGridView } from './ui/icons';
import { getFolderShare } from './services/workspaceService';
import { resolveAssetUrl } from './services/request';
import { CollectionCard } from './folders/GlassFolders';
import { folderPath } from './folders/folderTree';
import ProjectCard from './ProjectCard';
import CardSharingStatus from './CardSharingStatus';
import './sharedAlbums.css';
import './sharedFolderView.css';
import './AlbumDesktop.css';
import './folders/folders.css';
import './folders/folderColumns.css';

export function SharedFolders({ folders = [], onOpen, compact = false }) {
  if (!folders.length) return null;
  return <section className={`shared-albums${compact ? ' shared-albums-compact' : ''}`} aria-label="与我共享的文件夹">
    <div className="shared-albums-heading"><IconShare /><h2>与我共享的文件夹</h2><span>{folders.length}</span></div>
    <div className="shared-albums-list">{folders.map(folder => <div className="shared-album-entry" key={folder.id}>
      <button className="shared-album-link" onClick={() => onOpen(folder.id)} aria-label={`打开共享文件夹 ${folder.albumName}`}>
        <span className="shared-album-cover"><span className="acp-column-folder-glyph" aria-hidden="true" /></span>
        <span className="shared-album-info"><strong>{folder.albumName}</strong><span className="shared-album-origin">来自 {folder.originLabel}</span>
          <span className="shared-album-meta">{folder.albumCount} 个相册 · {folder.mode === 'collaborate' ? '共同编辑' : folder.mode === 'copy' ? folder.copyStatus === 'failed' ? '复制失败' : folder.copyStatus === 'ready' ? '副本已就绪' : '正在复制' : '只读'}{folder.mode !== 'copy' ? ' · 实时共享' : ''}</span></span>
        <IconChevronRight className="shared-album-arrow" />
      </button>
    </div>)}</div>
  </section>;
}

export function FolderShareBrowser({ data, onOpen, onBack, folderStyle = 'glass', initialFolderId }) {
  const { share, albums } = data;
  const groups = React.useMemo(() => data.groups.map(group => ({ ...group, sharing: {
    direction: 'received', originLabel: share.originLabel, mode: share.mode,
  } })), [data.groups, share.originLabel, share.mode]);
  const [selected, setSelected] = React.useState(initialFolderId || share.folderId);
  const root = groups.find(group => group.id === share.folderId);
  const current = groups.find(group => group.id === selected) || root;
  if (!current) return <div className="desktop-load-state" role="alert">文件夹已不存在<Button onClick={onBack}>返回</Button></div>;
  const path = folderPath(current, groups), children = groups.filter(group => group.parentId === current.id);
  const items = albums.filter(album => current.projectIds.includes(album.id));
  return <section className={`shared-folder-view${folderStyle === 'classic' ? ' is-classic' : ''}`} aria-label="共享文件夹内容">
    <nav className="acp-folder-breadcrumb" aria-label="共享文件夹位置"><button onClick={onBack}><IconChevronLeft />返回</button>
      {path.map(group => <React.Fragment key={group.id}><IconChevronRight /><button aria-current={group.id === current.id ? 'page' : undefined} onClick={() => setSelected(group.id)}>{group.name}</button></React.Fragment>)}
    </nav>
    <h1>{current.name}</h1>
    <div className="album-sharing-status"><IconShare /><span>来自 {share.originLabel} · {share.mode === 'collaborate' ? '共同编辑' : '只读'} · 实时共享</span></div>
    {children.length > 0 && <div className={folderStyle === 'classic' ? 'shared-folder-rows' : 'acp-all-collections'}>
      {children.map(group => folderStyle === 'classic' ? <button className="shared-folder-row" key={group.id} onClick={() => setSelected(group.id)}>
        <span className="acp-column-folder-glyph" aria-hidden="true" /><span className="acp-column-row-copy"><strong>{group.name}</strong><CardSharingStatus item={group} type="文件夹" /></span><IconChevronRight />
      </button> : <CollectionCard key={group.id} group={group} groups={groups} albums={albums.map(album => ({ ...album, image: resolveAssetUrl(album.image) }))}
        onSelect={setSelected} onOpen={onOpen} />)}
    </div>}
    {items.length > 0 && <div className="acp-albums">{items.map(album => <ProjectCard key={album.id} {...album} title={album.name}
      cover={resolveAssetUrl(album.image)} previewsEnabled={!data.public} onClick={() => onOpen(album)} onPreviewOpen={photo => onOpen(album, photo)} />)}</div>}
    {!children.length && !items.length && <div className="shared-folder-empty"><IconGridView /><p>这个文件夹暂时没有可查看的内容</p></div>}
  </section>;
}

export default function SharedFolderView({ shareId, onOpen, onBack, folderStyle }) {
  const [result, setResult] = React.useState(null), [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true, sequence = 0;
    setResult(null); setError('');
    const load = async () => {
      const current = ++sequence;
      try {
        const data = await getFolderShare(shareId);
        if (active && current === sequence) { setResult({ id: shareId, data }); setError(''); }
      } catch (err) { if (active && current === sequence) { setResult(null); setError(err.status === 404 ? '共享已失效，或你没有访问权限' : '共享文件夹加载失败，请重试'); } }
    };
    const visible = () => { if (!document.hidden) void load(); };
    void load(); const timer = setInterval(visible, 30000);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [shareId]);
  if (error) return <div className="desktop-load-state" role="alert"><p>{error}</p><Button onClick={onBack}>返回小组空间</Button></div>;
  if (!result || result.id !== shareId) return <div className="desktop-load-state" role="status">正在加载共享文件夹…</div>;
  if (result.data.copyFolderId) return <div className="desktop-load-state" role="status"><p>{result.data.share.copyStatus === 'failed' ? '部分相册复制失败，可在分享记录中重试' : result.data.share.copyStatus === 'ready' ? '独立副本已就绪' : '正在后台复制相册，已完成的部分可先查看'}</p>
    <Button onClick={() => { window.location.href = `/?folder=${encodeURIComponent(result.data.copyFolderId)}`; }}>打开副本文件夹</Button><Button onClick={onBack}>返回</Button></div>;
  return <FolderShareBrowser key={shareId} data={result.data} onOpen={(album, photo) => onOpen(album.id, photo)} onBack={onBack} folderStyle={folderStyle} />;
}
