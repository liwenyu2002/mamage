import React from 'react';
import { Button, Toast } from './ui';
import { IconChevronRight, IconSimilarStack, IconShare, IconGridView } from './ui/icons';
import {
  listReceivedShares, listSentShares, listReceivedFolderShares, listSentFolderShares,
} from './services/workspaceService';
import './SharedCenter.css';

const day = value => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function Row({ kind, name, meta, count, onOpen }) {
  const Icon = kind === 'folder' ? IconGridView : IconSimilarStack;
  return <button type="button" className="share-row" onClick={onOpen} disabled={!onOpen}>
    <span className={`share-row-icon is-${kind}`}><Icon /></span>
    <span className="share-row-main">
      <strong>{name || '未命名'}</strong>
      <small>{meta}</small>
    </span>
    {count !== null && count !== undefined && count !== ''
      ? <span className="share-row-count">{typeof count === 'string' ? count : `${count} 个相册`}</span> : null}
    {onOpen ? <IconChevronRight className="share-row-chevron" /> : null}
  </button>;
}

export default function SharedCenter({ albums = [], onClose, onOpenAlbum }) {
  const [tab, setTab] = React.useState('received');
  const [state, setState] = React.useState({ loading: true, error: '', received: { albums: [], folders: [] }, sent: { albums: [], folders: [] } });
  const [openId, setOpenId] = React.useState('');

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      setState(current => ({ ...current, loading: true, error: '' }));
      try {
        const [recvAlbums, sentAlbums, recvFolders, sentFolders] = await Promise.all([
          listReceivedShares().catch(() => []), listSentShares().catch(() => []),
          listReceivedFolderShares().catch(() => []), listSentFolderShares().catch(() => []),
        ]);
        if (!active) return;
        setState({
          loading: false, error: '',
          received: { albums: Array.isArray(recvAlbums) ? recvAlbums : [], folders: Array.isArray(recvFolders) ? recvFolders : [] },
          sent: { albums: Array.isArray(sentAlbums) ? sentAlbums : [], folders: Array.isArray(sentFolders) ? sentFolders : [] },
        });
      } catch (error) {
        if (!active) return;
        setState(current => ({ ...current, loading: false, error: error?.message || '读取共享列表失败' }));
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const incomingSharedAlbums = React.useCallback(() => {
    // 与本组织共享的相册（来自桌面接口，能直接打开）
    return albums || [];
  }, [albums]);

  const openReceivedAlbum = row => {
    const match = incomingSharedAlbums().find(album => String(album.name) === String(row.albumName)
      || (row.projectId && String(album.id) === String(row.projectId)));
    if (match) { onOpenAlbum?.(match); onClose?.(); return; }
    Toast.info('该相册已在本组织内，请在「与我共享」里打开');
  };

  const openReceivedFolder = row => {
    const id = row.id;
    setOpenId(String(id));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('sharedFolder', String(id));
      window.location.href = url.toString();
    } catch { Toast.info('无法打开该共享文件夹'); }
  };

  const data = state[tab];
  const total = state.received.albums.length + state.received.folders.length + state.sent.albums.length + state.sent.folders.length;

  return <div className="share-center-backdrop" role="dialog" aria-modal="true" aria-label="共享文件">
    <div className="share-center">
      <header className="share-center-head">
        <div><h2><IconShare /> 共享文件</h2><span>{state.loading ? '正在读取…' : `共 ${total} 项`}</span></div>
        <Button size="small" theme="borderless" onClick={onClose}>关闭</Button>
      </header>

      <div className="share-center-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'received'} className={tab === 'received' ? 'is-active' : ''}
          onClick={() => setTab('received')}>与我共享 <small>{state.received.albums.length + state.received.folders.length}</small></button>
        <button type="button" role="tab" aria-selected={tab === 'sent'} className={tab === 'sent' ? 'is-active' : ''}
          onClick={() => setTab('sent')}>我分享的 <small>{state.sent.albums.length + state.sent.folders.length}</small></button>
      </div>

      {state.error ? <p className="share-center-error" role="alert">{state.error}</p> : null}

      <div className="share-center-body" role="tabpanel">
        {state.loading ? <p className="share-center-empty">正在读取共享…</p> : null}

        {!state.loading && data.folders.map(row => <Row key={`folder-${row.id}`} kind="folder"
          name={row.albumName} count={row.albumCount}
          meta={tab === 'received'
            ? [`来自 ${row.sourceUnitName || row.sourceOrganizationName || '其他小组'}`, day(row.createdAt)].filter(Boolean).join(' · ')
            : [`发给 ${row.targetUnitName || row.targetUserName || '其他小组'}`, day(row.createdAt)].filter(Boolean).join(' · ')}
          onOpen={tab === 'received' ? () => openReceivedFolder(row) : undefined} />)}

        {!state.loading && data.albums.map(row => <Row key={`album-${row.id}`} kind="album"
          name={row.albumName}
          count={row.snapshotCount ? `${row.snapshotCount} 张` : null}
          meta={tab === 'received'
            ? [`来自 ${row.sharedByName || row.sourceUnitName || '同事'}`, row.snapshotCount ? `${row.snapshotCount} 张` : '', day(row.createdAt)].filter(Boolean).join(' · ')
            : [`发给 ${row.targetUnitName || row.targetUserName || '其他小组'}`, day(row.createdAt)].filter(Boolean).join(' · ')}
          onOpen={tab === 'received' ? () => openReceivedAlbum(row) : undefined} />)}

        {!state.loading && !data.folders.length && !data.albums.length ? (
          <p className="share-center-empty">{tab === 'received' ? '还没有人分享文件给你' : '你还没有分享给其他小组'}</p>
        ) : null}
      </div>

      <footer className="share-center-foot">
        <span>收到·{state.received.albums.length + state.received.folders.length}　发出·{state.sent.albums.length + state.sent.folders.length}</span>
        <span>点开可查看；文件夹共享会打开对应目录</span>
      </footer>
      {openId ? <span className="share-center-loading" role="status">正在打开共享文件夹…</span> : null}
    </div>
  </div>;
}
