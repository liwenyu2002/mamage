// Local-only preview: callbacks never return a server album ID, so no upload can start.
import React from 'react';
import CreateAlbumModal from '../CreateAlbumModal';
import EditAlbumModal from '../EditAlbumModal';
import AlbumDetailsFields from '../AlbumDetailsFields';
import AlbumFormModal from '../AlbumFormModal';
import AlbumActionBar from '../AlbumActionBar';
import { Toast } from '../ui';
import { IconSearch, IconSliders, IconListView, IconMoreStroked, IconEditStroked, IconPlus, IconTrash } from '../ui/icons';
import { setPermissions } from '../permissions/permissionStore';
import './albumFormPrototype.css';

setPermissions(['projects.create', 'upload.photo']);
const INITIAL_ALBUM = { name: '2026 劳育美育活动', description: '走进田园，记录劳动实践与秋日收获。', eventDate: '2026-10-30', createdAt: '2026-10-30', tags: ['劳动实践', '校园活动'] };

export default function AlbumFormPrototype() {
  const [mode, setMode] = React.useState(new URLSearchParams(window.location.search).get('mode') || '');
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState(false);
  const [inAlbum, setInAlbum] = React.useState(new URLSearchParams(window.location.search).get('view') === 'album');
  const [hasAlbum, setHasAlbum] = React.useState(true);
  const [media, setMedia] = React.useState([{ id: 'sample', name: 'MaMage.png', url: '/icons/icon-512.png', type: 'image/png' }]);
  const [selectedMedia, setSelectedMedia] = React.useState([]);
  const [stagedFiles, setStagedFiles] = React.useState([]);
  const fileUrls = React.useRef([]);
  const [functionsOpen, setFunctionsOpen] = React.useState(false);
  const [mediaFilter, setMediaFilter] = React.useState('all');
  const [dockInactive, setDockInactive] = React.useState(Boolean(mode));
  const primaryRef = React.useRef(null);
  const wasDockInactive = React.useRef(dockInactive);
  const menuRef = React.useRef(null);
  const settingsRef = React.useRef(null);
  const [album, setAlbum] = React.useState(INITIAL_ALBUM);
  const [title, setTitle] = React.useState(album.name);
  const [description, setDescription] = React.useState(album.description);
  const [date, setDate] = React.useState(album.eventDate);
  const [tags, setTags] = React.useState(album.tags);
  const selectedCount = inAlbum ? selectedMedia.length : (selected ? 1 : 0);
  const changeView = next => {
    setInAlbum(next); setSelecting(false); setSelected(false); setSelectedMedia([]); setFunctionsOpen(false);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('view', 'album'); else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  };
  React.useEffect(() => () => fileUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const openEdit = () => {
    setTitle(album.name || '');
    setDescription(album.description || '');
    setDate(album.eventDate || '');
    setTags(album.tags || []);
    setFunctionsOpen(false);
    setMode('edit');
  };
  React.useEffect(() => {
    if (mode) { setDockInactive(true); return undefined; }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setDockInactive(false), reduced ? 0 : 230);
    return () => clearTimeout(timer);
  }, [mode]);
  React.useEffect(() => {
    if (wasDockInactive.current && !dockInactive && document.activeElement === document.body) primaryRef.current?.focus({ preventScroll: true });
    wasDockInactive.current = dockInactive;
  }, [dockInactive]);
  React.useEffect(() => {
    if (!functionsOpen) return undefined;
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type !== 'keydown' && (menuRef.current?.contains(event.target) || settingsRef.current?.contains(event.target) || event.target.closest('.detail-bottom-nav-item--functions'))) return;
      setFunctionsOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [functionsOpen]);
  const save = () => {
    setAlbum({ ...album, name: title, description, eventDate: date, tags });
    setMode('');
    Toast.success('本地草稿已保存');
  };

  return <main className="mamage-shell afp-page">
    <div className="mamage-dynamic-backdrop" aria-hidden="true" />
    <nav className="afp-nav" aria-label="导航">
      <button data-glass="clear" aria-label="小组空间" title="小组空间" onClick={() => { setMode(''); changeView(false); }}><IconListView /></button>
      <div className="afp-search" data-glass="clear"><span>搜索</span><IconSearch /></div>
      <button ref={settingsRef} data-glass="clear" aria-label="相册功能" title="相册功能" aria-expanded={functionsOpen} onClick={() => setFunctionsOpen(value => !value)}><IconSliders /></button>
      <button data-glass="clear" aria-label="李文宇" title="李文宇">李</button>
    </nav>
    <section className="afp-workspace">
      <p className="afp-breadcrumb">学工与融媒体中心 <span>/</span> 相册</p>
      <header><h1>{inAlbum ? album.name : '小组空间'}</h1><span>{inAlbum ? `${media.length} 个文件` : `${hasAlbum ? 1 : 0} 个相册`}</span></header>
      {inAlbum ? <div className="afp-media-grid">
        {media.filter(item => mediaFilter === 'all' || item.type.startsWith(`${mediaFilter}/`)).map(item => <label key={item.id} className={`afp-media${selectedMedia.includes(item.id) ? ' is-selected' : ''}`}>
          {item.type.startsWith('video/') ? <video src={item.url} controls={!selecting} /> : <img src={item.url} alt={item.name} />}
          {selecting && <input type="checkbox" aria-label={`选择文件 ${item.name}`} checked={selectedMedia.includes(item.id)}
            onChange={event => setSelectedMedia(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />}
          <span>{item.name}</span>
        </label>)}
      </div> : <>
      <h2>本层相册 <small>{hasAlbum ? 1 : 0}</small></h2>
      {hasAlbum && <article className={`afp-album${selected ? ' is-selected' : ''}`}>
        {selecting && <label className="afp-album-selection"><input type="checkbox" aria-label={`选择相册 ${album.name}`} checked={selected} onChange={event => setSelected(event.target.checked)} /></label>}
        <button className="afp-album-cover" aria-label={`打开相册 ${album.name}`} onClick={() => selecting ? setSelected(value => !value) : changeView(true)}><img src="/icons/icon-512.png" alt="MaMage 相册封面" /></button>
        <div><strong>{album.name}</strong><button title="编辑相册" aria-label="卡片编辑相册" onClick={() => setMode('card-edit')}><IconMoreStroked /></button></div>
        <p>{album.description}</p><time>{album.eventDate}</time>
      </article>}
      </>}
    </section>
    <AlbumActionBar variant={inAlbum ? 'adaptive-album' : 'adaptive'} inactive={dockInactive} selecting={selecting} selectedCount={selectedCount}
      onSelect={() => { setSelecting(value => !value); setSelected(false); setSelectedMedia([]); setFunctionsOpen(false); }}
      onDelete={() => setMode('delete')}
      onFunctions={() => setFunctionsOpen(value => !value)} functionsOpen={functionsOpen}
      primaryLabel={inAlbum ? '上传照片或视频' : '新建相册'} primaryProps={{ ref: primaryRef, 'aria-expanded': mode === 'create' || mode === 'upload', 'aria-haspopup': 'dialog', onClick: () => { setFunctionsOpen(false); setMode(inAlbum ? 'upload' : 'create'); } }} />
    {functionsOpen && <div className={`afp-functions${inAlbum ? ' afp-functions--dock' : ''}`} ref={menuRef} role="group" aria-label="相册功能" data-glass="readable">
      {inAlbum && <div className="afp-media-filter" role="group" aria-label="媒体类型">{[['all', '全部'], ['image', '照片'], ['video', '视频']].map(([value, label]) =>
        <button key={value} aria-pressed={mediaFilter === value} onClick={() => { setMediaFilter(value); setSelectedMedia([]); }}>{label}</button>)}</div>}
      <button onClick={openEdit}><IconEditStroked />编辑相册</button>
    </div>}
    <CreateAlbumModal presentation="dock" originRef={primaryRef} visible={mode === 'create'} onClose={() => setMode('')}
      createProject={async payload => { setHasAlbum(true); setAlbum({ ...INITIAL_ALBUM, name: payload.title, description: payload.description, eventDate: payload.eventDate, tags: payload.tags || [] }); return {}; }} />
    <AlbumFormModal title="上传照片或视频" presentation="dock" originRef={primaryRef} visible={mode === 'upload'}
      onCancel={() => { setMode(''); setStagedFiles([]); }} okText="添加到相册" okButtonProps={{ disabled: !stagedFiles.length }} onOk={() => {
        setMedia(items => [...items, ...stagedFiles.map(file => {
          const url = URL.createObjectURL(file); fileUrls.current.push(url);
          return { id: url, name: file.name, type: file.type, url };
        })]);
        setStagedFiles([]); setMode('');
      }}>
      <label className="afp-upload-picker"><IconPlus /><span>选择照片和视频</span><input type="file" accept="image/*,video/*" multiple aria-label="选择照片和视频"
        onChange={event => { setStagedFiles(items => [...items, ...Array.from(event.target.files)]); event.target.value = ''; }} /></label>
      <ul className="afp-upload-list">{stagedFiles.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span>
        <button aria-label={`移除文件 ${file.name}`} onClick={() => setStagedFiles(files => files.filter((_, i) => i !== index))}><IconTrash /></button></li>)}</ul>
    </AlbumFormModal>
    <AlbumFormModal title={inAlbum ? '删除文件' : '删除相册'} visible={mode === 'delete'} okText="删除" okButtonProps={{ type: 'danger', disabled: !selectedCount }}
      onCancel={() => setMode('')} onOk={() => {
        if (inAlbum) setMedia(items => items.filter(item => !selectedMedia.includes(item.id))); else setHasAlbum(false);
        setMode(''); setSelected(false); setSelectedMedia([]);
      }}>
      <p>确定删除所选的 {selectedCount} {inAlbum ? '个文件' : '个相册'}？</p>
    </AlbumFormModal>
    <AlbumFormModal title="编辑相册" className="detail-edit-modal" width={600} visible={mode === 'edit'}
      onCancel={() => setMode('')} onOk={save} okText="保存相册" okButtonProps={{ disabled: !title.trim() }}>
      <div className="detail-edit-modal-body"><AlbumDetailsFields title={title} onTitleChange={setTitle}
        description={description} onDescriptionChange={setDescription} eventDate={date} onEventDateChange={setDate}
        tags={tags} onTagsChange={setTags} /></div>
    </AlbumFormModal>
    {mode === 'card-edit' && <EditAlbumModal album={album} onClose={() => setMode('')}
      saveProject={async () => {}} onSaved={next => { setAlbum(next); setMode(''); Toast.success('本地草稿已保存'); }} />}
  </main>;
}
