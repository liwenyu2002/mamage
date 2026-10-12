// Shared column navigation; all writes stay in the permission-aware workspace controller.
import React from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft, IconChevronRight, IconPlus, IconMoreStroked, IconStar,
  IconSimilarStack, IconListView, IconSliders, IconGridView, IconSearch, IconClose } from '../ui/icons';
import './folderColumns.css';

function FolderGlyph({ color }) {
  return <span className="acp-column-folder-glyph" style={color && color !== '#ffffff' ? { '--folder-row-color': color } : undefined} aria-hidden="true" />;
}

export default function FolderColumns({ groups, albums, path, onSelect, onOpen, onCreate,
  onPin, pins, onAppearance, onMove, onOrganize, onOrder, colors, getFolderDragProps, getAlbumDragProps,
  getGroupDropProps, dropTargetId, maxDepth, query, draftQuery, onSearch, onDraftQuery,
  searchGroups, searchAlbums, view, onView, onManagePins, workspaceName = '小组空间', canOrganize = false, onEditFolder, onCreateAlbum, onEditAlbum }) {
  const railRef = React.useRef(null);
  const pathRef = React.useRef(null);
  const panelRefs = React.useRef([]);
  const menuRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);
  const pendingFocus = React.useRef(null);
  const [albumChoice, setAlbumChoice] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const parent = path[path.length - 1] || null;
  const parentId = parent?.id || null;
  const virtualGroup = query ? { id: `search:${query}`, name: '搜索结果', virtual: true }
    : view === 'unfiled' ? { id: 'unfiled', name: '未归类', virtual: true } : null;
  const scope = virtualGroup?.id || parentId || 'root';
  const chosenAlbum = albumChoice?.scope === scope ? albums.find(album => album.id === albumChoice.id) : null;
  const columns = virtualGroup ? [null, virtualGroup] : [null, ...path];
  const pathKey = virtualGroup?.id || path.map(group => group.id).join('/');
  const pinEntries = pins.map(key => {
    const [type, id] = key.split(':');
    const item = type === 'group' ? groups.find(group => group.id === id) : albums.find(album => String(album.id) === id);
    return item ? { kind: type === 'group' ? 'folder' : 'album', item } : null;
  }).filter(Boolean);
  const unfiledCount = albums.filter(album => !album.groups.length).length;
  const openFolder = id => { setAlbumChoice(null); setMenu(null); onSelect(id || 'all'); };
  const choose = (entry, columnIndex) => {
    if (entry.kind === 'folder') openFolder(entry.item.id);
    else {
      const group = columns[columnIndex];
      if (!group?.virtual) onSelect(group?.id || 'all');
      setAlbumChoice({ id: entry.item.id, scope: group?.id || 'root' });
    }
  };
  const openPin = entry => {
    if (entry.kind === 'folder') openFolder(entry.item.id);
    else {
      const groupId = entry.item.groups[0];
      if (groupId) onSelect(groupId); else onView('unfiled');
      setAlbumChoice({ id: entry.item.id, scope: groupId || 'unfiled' });
    }
  };
  const back = () => {
    if (chosenAlbum) setAlbumChoice(null);
    else openFolder(virtualGroup ? null : path[path.length - 2]?.id);
  };

  React.useEffect(() => {
    let frame;
    const align = (animate = true) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rail = railRef.current;
        const last = panelRefs.current[chosenAlbum ? columns.length : columns.length - 1];
        if (!rail || !last) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const left = Math.max(0, last.offsetLeft + last.offsetWidth - rail.clientWidth);
        rail.scrollTo({ left, behavior: reduce || !animate ? 'instant' : 'smooth' });
        if (pathRef.current) pathRef.current.scrollLeft = pathRef.current.scrollWidth;
        if (pendingFocus.current) {
          const { column, id } = pendingFocus.current;
          const target = panelRefs.current[column === 'last' ? columns.length - 1 : column];
          const rows = [...(target?.querySelectorAll('.acp-column-row-main') || [])];
          (rows.find(row => row.dataset.entryId === id) || rows[0])?.focus({ preventScroll: true });
          pendingFocus.current = null;
        }
      });
    };
    let width = railRef.current?.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = railRef.current?.clientWidth;
      if (nextWidth !== width) { width = nextWidth; align(false); }
    });
    if (railRef.current) observer.observe(railRef.current);
    align();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [pathKey, chosenAlbum?.id]);

  React.useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const outside = event => { if (!menuRef.current?.contains(event.target)) setMenu(null); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setMenu(null); returnFocusRef.current?.focus({ preventScroll: true });
    };
    const dismiss = event => { if (!menuRef.current?.contains(event.target)) setMenu(null); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  const showMenu = (event, entry) => {
    event.preventDefault(); event.stopPropagation();
    returnFocusRef.current = event.currentTarget.closest('.acp-column-row')?.querySelector('.acp-column-row-main, .acp-column-shortcut-main');
    const rect = event.currentTarget.getBoundingClientRect();
    const context = event.type === 'contextmenu';
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    setMenu({ entry, left: Math.max(8, Math.min(context ? event.clientX : rect.right - 198, window.innerWidth - 206 * zoom)) / zoom,
      top: Math.max(8, Math.min(context ? event.clientY : rect.bottom + 5, window.innerHeight - 320 * zoom)) / zoom });
  };
  const run = action => { setMenu(null); returnFocusRef.current?.focus({ preventScroll: true }); action(); };
  const onRowKeyDown = (event, entry, columnIndex, rowIndex, entries) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const key = event.key;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      const index = key === 'Home' ? 0 : key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, rowIndex + (key === 'ArrowDown' ? 1 : -1)));
      panelRefs.current[columnIndex]?.querySelectorAll('.acp-column-row-main')[index]?.focus();
      choose(entries[index], columnIndex);
    } else if (key === 'ArrowLeft' && columnIndex > 0) {
      pendingFocus.current = { column: columnIndex - 1, id: columns[columnIndex]?.id };
      openFolder(columns[columnIndex - 1]?.id);
    } else if (key === 'ArrowRight' && entry.kind === 'folder') {
      const next = panelRefs.current[columnIndex + 1];
      if (path[columnIndex]?.id === entry.item.id && next) next.querySelector('.acp-column-row-main')?.focus({ preventScroll: true });
      else { pendingFocus.current = { column: 'last' }; choose(entry, columnIndex); }
    } else if (key === 'Enter' && entry.kind === 'album') onOpen(entry.item);
    else if (key !== 'ArrowLeft') choose(entry, columnIndex);
  };
  const menuEntry = menu?.entry;
  const menuFolder = menuEntry?.kind === 'folder';
  const pinKey = menuEntry ? `${menuFolder ? 'group' : 'album'}:${menuEntry.item.id}` : '';

  return <section className="acp-column-browser" id="collections" data-desktop-section="collections" aria-label="文件夹分栏浏览">
    <span className="acp-section-spotlight" aria-hidden="true" />
    <div className="acp-column-toolbar">
      <button className="acp-icon" type="button" aria-label="返回上一级目录" title="返回上一级" disabled={!path.length && !chosenAlbum && !virtualGroup} onClick={back}><IconChevronLeft /></button>
      <div className="acp-column-title"><IconListView /><h1>小组空间</h1><span>{workspaceName}</span></div>
      <form className="acp-column-search" role="search" onSubmit={event => { event.preventDefault(); setAlbumChoice(null); onSearch(draftQuery); }}>
        <input aria-label="搜索相册或文件夹" placeholder="搜索相册或文件夹" value={draftQuery} onChange={event => onDraftQuery(event.target.value)} />
        {draftQuery && <button className="acp-icon" type="button" aria-label="清空搜索" title="清空搜索" onClick={() => onSearch('')}><IconClose /></button>}
        <button className="acp-icon" type="submit" aria-label="搜索" title="搜索"><IconSearch /></button>
      </form>
      {canOrganize && <button className="acp-icon" type="button" aria-label="调整本层文件夹顺序" title="调整本层文件夹顺序" onClick={onOrder} disabled={groups.filter(group => (group.parentId || null) === parentId).length < 2}><IconSliders /></button>}
      {canOrganize && <button className="acp-icon" type="button" aria-label={`在${parent?.name || '小组空间'}新建文件夹`} title={path.length >= maxDepth ? `最多支持 ${maxDepth} 级文件夹` : '新建文件夹'} onClick={() => onCreate(parentId)}><IconPlus /></button>}
      {onCreateAlbum && <button className="acp-icon" type="button" title="新建相册" aria-label="新建相册" onClick={() => onCreateAlbum(parent)}><IconSimilarStack /></button>}
    </div>
    <div className="acp-column-rail" ref={railRef}>
      {columns.map((group, columnIndex) => {
        const entries = group?.virtual ? [
          ...(query ? searchGroups.map(item => ({ kind: 'folder', item })) : []),
          ...searchAlbums.map(item => ({ kind: 'album', item })),
        ] : [
          ...groups.filter(item => (item.parentId || null) === (group?.id || null)).map(item => ({ kind: 'folder', item })),
          ...(group ? albums.filter(album => album.groups.includes(group.id)).map(item => ({ kind: 'album', item })) : []),
        ];
        return <section key={group?.id || 'root'} className={`acp-folder-column${dropTargetId === (group?.id || 'folder-root') ? ' is-drop-target' : ''}`}
          ref={element => { panelRefs.current[columnIndex] = element; }} aria-label={`${group?.name || '小组空间'}内容`} {...(group?.virtual ? {} : getGroupDropProps(group))}>
          <header className="acp-column-heading"><span title={group?.name || '小组空间'}>{group?.name || '小组空间'}</span><small>{entries.length}</small></header>
          <div className="acp-column-list">
            {!group && <>
              {pinEntries.length > 0 && <div className="acp-column-pins" aria-label="我的置顶">
                <div className="acp-column-section-label"><span>我的置顶 <small>仅自己</small></span><button className="acp-icon" type="button" aria-label="管理我的置顶" title="管理我的置顶" onClick={onManagePins}><IconSliders /></button></div>
                {pinEntries.map(entry => <div className="acp-column-row" key={`pin:${entry.kind}:${entry.item.id}`} onContextMenu={event => showMenu(event, entry)}
                  {...(entry.kind === 'folder' ? getGroupDropProps(entry.item) : {})}>
                  <button type="button" className="acp-column-shortcut-main" aria-label={`打开置顶 ${entry.item.name}`} title={entry.item.name}
                    {...(entry.kind === 'folder' ? getFolderDragProps(entry.item) : getAlbumDragProps(entry.item))} onClick={() => openPin(entry)}>
                    {entry.kind === 'folder' ? <FolderGlyph color={colors[entry.item.id]} /> : <span className="acp-column-album-thumb">{entry.item.image ? <img src={entry.item.image} alt="" draggable={false} decoding="async" /> : <IconSimilarStack />}</span>}
                    <span className="acp-column-row-name">{entry.item.name}</span><span className="acp-column-pin"><IconStar /></span>
                  </button>
                  <button className="acp-column-more" type="button" aria-label={`置顶操作 ${entry.item.name}`} title="更多操作" aria-haspopup="menu" onClick={event => showMenu(event, entry)}><IconMoreStroked /></button>
                </div>)}
              </div>}
              <div className="acp-column-section-label"><span>小组文件夹</span></div>
            </>}
            {entries.map((entry, rowIndex) => {
              const { kind, item } = entry;
              const folder = kind === 'folder';
              const selected = folder ? path[columnIndex]?.id === item.id : chosenAlbum?.id === item.id && albumChoice?.scope === group?.id;
              const pinned = pins.includes(`${folder ? 'group' : 'album'}:${item.id}`);
              const count = folder ? groups.filter(child => child.parentId === item.id).length + albums.filter(album => album.groups.includes(item.id)).length : item.count;
              return <div key={`${kind}:${item.id}`} className={`acp-column-row${selected ? ' is-selected' : ''}${folder && (path[columnIndex + 1] || chosenAlbum) ? ' is-ancestor' : ''}${dropTargetId === item.id ? ' is-drop-target' : ''}`}
                {...(folder ? getGroupDropProps(item) : {})} onContextMenu={event => showMenu(event, entry)}>
                <button type="button" className="acp-column-row-main" data-entry-id={item.id} {...(folder ? getFolderDragProps(item) : getAlbumDragProps(item))}
                  aria-label={`${folder ? '浏览文件夹' : '预览相册'} ${item.name}`} aria-pressed={selected}
                  title={`${item.name} · ${count} ${folder ? '项' : '张照片'}`} onClick={() => choose(entry, columnIndex)}
                  onDoubleClick={() => { if (!folder) onOpen(item); }} onKeyDown={event => onRowKeyDown(event, entry, columnIndex, rowIndex, entries)}>
                  {folder ? <FolderGlyph color={colors[item.id]} /> : <span className="acp-column-album-thumb">{item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" draggable={false} /> : <IconSimilarStack />}</span>}
                  <span className="acp-column-row-name">{item.name}</span>
                  {pinned && <span className="acp-column-pin" aria-label="已置顶"><IconStar /></span>}
                  {folder && <IconChevronRight className="acp-column-chevron" />}
                </button>
                <button type="button" className="acp-column-more" title="更多操作" aria-label={`文件操作 ${item.name}`} aria-haspopup="menu" aria-expanded={menuEntry?.item.id === item.id && menuEntry?.kind === kind}
                  onClick={event => showMenu(event, entry)}><IconMoreStroked /></button>
              </div>;
            })}
            {!group && <div className="acp-column-utility"><button type="button" className={`acp-column-unfiled${view === 'unfiled' ? ' is-selected' : ''}`} onClick={() => { setAlbumChoice(null); onView('unfiled'); }}><IconSimilarStack /><span>未归类</span><small>{unfiledCount}</small><IconChevronRight /></button></div>}
            {!entries.length && <div className="acp-column-empty"><FolderGlyph /><span>{query ? '没有匹配的结果' : group?.virtual ? '没有未归类的相册' : '空文件夹'}</span>{canOrganize && !group?.virtual && <button type="button" onClick={() => onCreate(group?.id || null)}><IconPlus />新建文件夹</button>}</div>}
          </div>
          <footer>{entries.filter(entry => entry.kind === 'folder').length} 个文件夹{group && ` · ${entries.filter(entry => entry.kind === 'album').length} 个相册`}</footer>
        </section>;
      })}
      {chosenAlbum ? <aside className="acp-column-inspector" ref={element => { panelRefs.current[columns.length] = element; }} aria-label="选中相册预览">
        <header className="acp-column-heading"><span>相册预览</span><IconSimilarStack /></header>
        <div className="acp-column-album-preview"><button className="acp-column-cover" type="button" onClick={() => onOpen(chosenAlbum)} aria-label={`打开相册 ${chosenAlbum.name}`}>{chosenAlbum.image ? <img src={chosenAlbum.image} alt={chosenAlbum.name} decoding="async" /> : <IconSimilarStack />}</button>
          <h3>{chosenAlbum.name}</h3><dl><div><dt>照片</dt><dd>{chosenAlbum.count} 张</dd></div><div><dt>更新时间</dt><dd>{chosenAlbum.time || (chosenAlbum.updatedAt ? new Date(chosenAlbum.updatedAt).toLocaleDateString() : '暂无')}</dd></div><div><dt>所在文件夹</dt><dd>{chosenAlbum.groups.map(id => groups.find(group => group.id === id)?.name).filter(Boolean).join('、') || '未归类'}</dd></div></dl>
          <button className="acp-column-open" type="button" onClick={() => onOpen(chosenAlbum)}>打开相册<IconChevronRight /></button>
        </div>
      </aside> : <aside className="acp-column-rest" aria-label="当前目录概览"><FolderGlyph color={colors[parentId]} /><strong>{virtualGroup?.name || parent?.name || '小组空间'}</strong><span>{query ? `“${query}”` : parent ? '文件夹' : workspaceName}</span></aside>}
    </div>
    <nav className="acp-column-path" ref={pathRef} aria-label="分栏当前位置"><button type="button" onClick={() => openFolder(null)} {...getGroupDropProps(null)}><IconGridView /><span>小组空间</span></button>
      {path.map(group => <React.Fragment key={group.id}><IconChevronRight /><button type="button" onClick={() => openFolder(group.id)} {...getGroupDropProps(group)} aria-current={group.id === parentId ? 'location' : undefined} title={group.name}>{group.name}</button></React.Fragment>)}
      {virtualGroup && <><IconChevronRight /><span>{virtualGroup.name}</span></>}
      {chosenAlbum && <><IconChevronRight /><span>{chosenAlbum.name}</span></>}
    </nav>
    {menuEntry && createPortal(<div ref={menuRef} className="acp-column-context-menu" role="menu" aria-label={`${menuEntry.item.name}操作`} style={{ left: menu.left, top: menu.top }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
      <button role="menuitem" onClick={() => run(() => menuFolder ? openFolder(menuEntry.item.id) : onOpen(menuEntry.item))}><IconChevronRight /><span>打开{menuFolder ? '文件夹' : '相册'}</span></button>
      <button role="menuitemcheckbox" aria-checked={pins.includes(pinKey)} onClick={() => run(() => onPin(pinKey))}><IconStar /><span>{pins.includes(pinKey) ? '取消置顶' : '加入我的置顶'}</span></button>
      {menuFolder ? <>
        {canOrganize && <button role="menuitem" onClick={() => run(() => onCreate(menuEntry.item.id))}><IconPlus /><span>新建子文件夹</span></button>}
        {canOrganize && <button role="menuitem" onClick={() => run(() => onMove(menuEntry.item))}><IconListView /><span>移动到…</span></button>}
        {canOrganize && <button role="menuitem" onClick={() => run(() => onEditFolder(menuEntry.item))}><IconSliders /><span>编辑文件夹</span></button>}
        <button role="menuitem" onClick={() => run(() => onAppearance(menuEntry.item))}><IconSliders /><span>我的文件夹外观</span></button>
      </> : <>{canOrganize && <button role="menuitem" onClick={() => run(() => onOrganize(menuEntry.item))}><IconListView /><span>整理到文件夹</span></button>}{onEditAlbum && <button role="menuitem" onClick={() => run(() => onEditAlbum(menuEntry.item))}><IconSliders /><span>编辑相册</span></button>}</>}
    </div>, document.body)}
  </section>;
}

