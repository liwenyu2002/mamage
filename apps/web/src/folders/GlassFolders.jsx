import React from 'react';
import { IconSearch, IconPlus, IconChevronLeft, IconChevronRight, IconGridView, IconListView, IconClose, IconStar, IconSparkleAI, IconSimilarStack, IconTimelineFlow, IconSliders, IconMoreStroked, IconGroupRescue } from '../ui/icons';
import { folderPath, groupAlbums, folderPreviewItems, ROOT_DROP_ID } from './folderTree';
const DEFAULT_COLLECTION_COLOR = '#ffffff';
const SUPPORTS_FAN_DEPTH = typeof CSS !== 'undefined' && CSS.supports('translate', '0 0 1px');
function GroupSymbol({ group }) {
  const Icon = { timeline: IconTimelineFlow, image: IconSimilarStack, grid: IconGridView }[group.symbol] || IconGridView;
  return <Icon />;
}


function folderContentsLabel(folderCount, albumCount) {
  return [folderCount ? `${folderCount} 个文件夹` : '', albumCount ? `${albumCount} 个相册` : ''].filter(Boolean).join(' · ') || '空文件夹';
}

const CollectionCaption = React.memo(function CollectionCaption({ group, entry, index, coverCount, albumCount, photoCount, childCount = 0, directAlbumCount, visible }) {
  const item = entry?.item;
  const folder = entry?.kind === 'folder';
  return <span className={`acp-collection-caption${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
    <span className="acp-collection-stamp"><GroupSymbol group={folder ? item : group} /><span>{entry ? folder ? '子文件夹' : group.name : '文件夹'}</span>
      <small>{entry ? `${index + 1} / ${coverCount}` : childCount ? `${childCount + directAlbumCount} 项` : `${albumCount} 册`}</small></span>
    <strong title={item?.name || group.name}>{item?.name || group.name}</strong>
    <span className="acp-collection-meta">{folder ? folderContentsLabel(entry.childCount, entry.albumCount) : item ? `${item.count} 张照片` : childCount ? folderContentsLabel(childCount, directAlbumCount) : `${photoCount.toLocaleString()} 张照片`}</span>
  </span>;
});

export function CollectionCard({ group, groups = [], albums, onSelect, onOpen, pinned, onPin, onAppearance, onMove, onManage, surfaceColor = DEFAULT_COLLECTION_COLOR, folderColors = {}, preview = false,
  getAlbumDragProps, getFolderDragProps, dropProps, sortDragProps, dropActive = false, isAlbumDragging = false, dropMessage }) {
  const items = React.useMemo(() => groupAlbums(group, albums, groups), [group, albums, groups]);
  const childCount = groups.filter(item => item.parentId === group.id).length;
  const previewItems = React.useMemo(() => folderPreviewItems(group, albums, groups), [group, albums, groups]);
  const covers = React.useMemo(() => previewItems.slice(0, 9), [previewItems]);
  const directAlbumCount = previewItems.length - childCount;
  const photoCount = React.useMemo(() => items.reduce((sum, album) => sum + album.count, 0), [items]);
  const [expanded, setExpanded] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuBelow, setMenuBelow] = React.useState(false);
  const cardRef = React.useRef(null);
  const coverRefs = React.useRef([]);
  const footerRef = React.useRef(null);
  const toolsRef = React.useRef(null);
  const menuTriggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const menuId = React.useId();
  const boundsRef = React.useRef(null);
  const pointerType = React.useRef('mouse');
  const activeRef = React.useRef(0);
  const pendingRef = React.useRef(0);
  const frameRef = React.useRef(null);
  const active = covers[Math.min(activeIndex, covers.length - 1)];
  const selectIndex = (index) => { if (index !== activeRef.current) { activeRef.current = index; setActiveIndex(index); } };
  const cancelScrub = () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; };
  const openMenu = () => {
    const bounds = menuTriggerRef.current.getBoundingClientRect();
    setMenuBelow(bounds.top < 164 && window.innerHeight - bounds.bottom > bounds.top);
    cancelScrub(); setMenuOpen(true);
  };
  const closeMenu = () => { setMenuOpen(false); menuTriggerRef.current?.focus({ preventScroll: true }); };
  const runAction = (action) => { closeMenu(); action(); };
  const fitFanToViewport = () => {
    const card = cardRef.current;
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    // Read both bounds before changing the fan styles; also refresh the scrub range on resize.
    boundsRef.current = card.querySelector('.acp-fan-stage').getBoundingClientRect();
    const mainBounds = card.closest('.acp-main')?.getBoundingClientRect() || { left: 0, right: window.innerWidth };
    const nearLeft = bounds.left - Math.max(0, mainBounds.left) < 40;
    const nearRight = Math.min(window.innerWidth, mainBounds.right) - bounds.right < 40;
    const nearEdge = nearLeft || nearRight;
    const nearScreenEdge = bounds.left < 40 || window.innerWidth - bounds.right < 40;
    card.style.setProperty('--fan-open-spread', nearScreenEdge ? '22%' : nearEdge ? '28%' : '43%');
    card.style.setProperty('--fan-open-angle', nearScreenEdge ? '5deg' : nearEdge ? '12deg' : '15deg');
    card.style.setProperty('--fan-active-extra', nearScreenEdge ? '1%' : '4%');
    card.style.setProperty('--fan-edge-scale', nearScreenEdge ? '1.04' : '');
  };
  React.useEffect(() => {
    const next = Math.min(activeRef.current, Math.max(0, covers.length - 1));
    if (next !== activeRef.current) selectIndex(next);
  }, [covers.length]);
  React.useEffect(() => () => cancelScrub(), []);
  React.useEffect(() => {
    if (isAlbumDragging) { cancelScrub(); setExpanded(false); setMenuOpen(false); }
  }, [isAlbumDragging]);
  React.useEffect(() => {
    if (!menuOpen) return undefined;
    menuRef.current?.querySelector('[role^="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event) => {
      if (toolsRef.current?.contains(event.target)) return;
      cancelScrub(); setMenuOpen(false); setExpanded(false);
    };
    const dismiss = () => setMenuOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menuOpen]);
  React.useEffect(() => {
    if (!expanded) return undefined;
    const closeOutside = (event) => { if (!cardRef.current?.contains(event.target)) { cancelScrub(); setExpanded(false); } };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', fitFanToViewport);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('resize', fitFanToViewport); };
  }, [expanded]);
  const scrub = (event, immediate = false) => {
    if (event.pointerType !== 'mouse' || !covers.length || menuOpen || isAlbumDragging) return;
    const bounds = boundsRef.current;
    if (!bounds) return;
    const fraction = Math.max(0, Math.min(.999, (event.clientX - bounds.left) / bounds.width));
    const next = Math.floor(fraction * covers.length);
    pendingRef.current = next;
    if (immediate) { cancelScrub(); selectIndex(next); return; }
    if (frameRef.current !== null || next === activeRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current !== activeRef.current) selectIndex(pendingRef.current);
    });
  };
  const openEntry = entry => {
    if (entry.kind === 'folder') onSelect(entry.item.id);
    else onOpen(entry.item);
  };
  const openCover = (event, index) => {
    if (preview) return;
    if (pointerType.current === 'touch' && event.detail !== 0 && (!expanded || activeIndex !== index)) {
      if (!expanded) fitFanToViewport();
      selectIndex(index); setExpanded(true); return;
    }
    openEntry(covers[event.detail === 0 || pointerType.current !== 'mouse' || !expanded ? index : activeRef.current]);
  };
  return <article {...dropProps} ref={cardRef} className={`acp-collection${childCount ? ' acp-collection-folder' : ''}${expanded && active ? ' is-expanded' : ''}${menuOpen ? ' is-menu-open' : ''}${dropActive ? ' is-drop-target' : ''}`} aria-label={group.name}
    style={{ '--acp-accent': group.color, '--acp-tint': group.tint, '--acp-surface': surfaceColor }}
    onPointerDown={(event) => { pointerType.current = event.pointerType; }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') { cancelScrub(); setExpanded(false); } }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { cancelScrub(); setExpanded(false); setMenuOpen(false); } }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { cancelScrub(); setExpanded(false); footerRef.current?.focus(); }
      if (!event.target.closest('.acp-fan-cover') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? covers.length - 1
        : (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + covers.length) % covers.length;
      coverRefs.current[next]?.focus();
    }}>
    {childCount > 0 && <button className="acp-folder-tab" aria-label={`进入子目录 ${group.name}`} title={`进入 ${group.name}`} disabled={preview} onClick={() => onSelect(group.id)}><GroupSymbol group={group} /><span>{childCount}</span></button>}
    <div className="acp-fan-viewport"><div className="acp-fan-stage" onPointerEnter={(event) => {
      if (event.pointerType !== 'mouse' || menuOpen || isAlbumDragging) return;
      fitFanToViewport();
      setExpanded(true); scrub(event, true);
    }} onPointerMove={scrub}>
      {covers.map((entry, index) => {
        const { item, kind } = entry;
        const folder = kind === 'folder';
        const position = covers.length === 1 ? 0 : (index / (covers.length - 1)) * 2 - 1;
        return <button {...(!preview && (folder ? getFolderDragProps?.(item) : getAlbumDragProps?.(item)))} key={`${kind}:${item.id}`} ref={(element) => { coverRefs.current[index] = element; }}
          className={`acp-fan-cover${folder ? ' acp-fan-folder' : ''}${expanded && index === activeIndex ? ' is-active' : ''}`} disabled={preview}
          aria-label={`${folder ? '进入子文件夹' : '预览相册'} ${item.name}`} aria-pressed={expanded && index === activeIndex}
          style={{ '--fan-position': position, '--fan-arc': Math.abs(position), '--fan-depth': 10 + covers.length - index,
            '--child-folder-surface': folder ? folderColors[item.id] || DEFAULT_COLLECTION_COLOR : undefined,
            '--child-folder-accent': folder ? item.color : undefined,
            zIndex: SUPPORTS_FAN_DEPTH ? undefined : expanded && index === activeIndex ? 30 : 10 + covers.length - index }}
          onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) { if (!expanded) fitFanToViewport(); cancelScrub(); selectIndex(index); setExpanded(true); } }}
          onClick={(event) => openCover(event, index)}>{folder ? <>
            <span className="acp-fan-folder-shell" aria-hidden="true"><span className="acp-fan-folder-sheets" /><span className="acp-fan-folder-pocket" /></span>
            <span className="acp-fan-folder-copy"><span className="acp-fan-folder-topline"><GroupSymbol group={item} /><small>{entry.childCount + entry.albumCount} 项</small></span>
              <strong title={item.name}>{item.name}</strong><span className="acp-fan-folder-foot"><span>文件夹</span><IconChevronRight /></span></span>
          </> : <>
            <img src={item.image} alt="" loading="lazy" draggable={false} />
            <span className="acp-fan-album-stamp" aria-hidden="true"><IconSimilarStack /><span>{item.count}</span></span></>}</button>;
      })}
      {!covers.length && <span className="acp-fan-empty"><GroupSymbol group={group} /></span>}
    </div></div>
    {dropActive && <span className="acp-collection-drop-label" role="status"><GroupSymbol group={group} />{dropMessage}</span>}
    {previewItems.length > 9 && <span className="acp-fan-overflow">+{previewItems.length - 9}</span>}
    <div className="acp-collection-glass">
      <div className="acp-collection-frost" aria-hidden="true">{covers.slice(0, 3).map(({ kind, item }) => kind === 'folder'
        ? <span key={`folder:${item.id}`} style={{ background: folderColors[item.id] || DEFAULT_COLLECTION_COLOR }} /> : <img src={item.image} alt="" key={`album:${item.id}`} loading="lazy" draggable={false} />)}</div>
      <button {...sortDragProps} ref={footerRef} className="acp-collection-label" disabled={preview}
        aria-label={expanded && active ? `${active.kind === 'folder' ? '打开文件夹' : '打开相册'} ${active.item.name}` : `打开文件夹 ${group.name}`}
        onClick={() => expanded && active ? openEntry(active) : onSelect(group.id)}>
        <CollectionCaption group={group} albumCount={items.length} photoCount={photoCount} childCount={childCount} directAlbumCount={directAlbumCount} visible={!expanded || !active} />
        {covers.map((entry, index) => <CollectionCaption key={`${entry.kind}:${entry.item.id}`} group={group} entry={entry} index={index}
          coverCount={covers.length} visible={expanded && index === activeIndex} />)}
      </button>
    </div>
    <div ref={toolsRef} className="acp-collection-tools">
      <button ref={menuTriggerRef} className="acp-collection-more" disabled={preview} title="更多操作"
        aria-label={`更多操作 ${group.name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
        onClick={() => menuOpen ? closeMenu() : openMenu()} onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(); }
        }}><IconMoreStroked /></button>
      {menuOpen && <div ref={menuRef} id={menuId} className={`acp-collection-actions${menuBelow ? ' is-below' : ''}`} role="menu" aria-label={`文件夹操作 ${group.name}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
          if (event.key === 'Tab') { setMenuOpen(false); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const buttons = [...menuRef.current.querySelectorAll('[role^="menuitem"]')];
          const index = buttons.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus({ preventScroll: true });
        }}>
        <button role="menuitem" aria-label={`进入文件夹 ${group.name}`} onClick={() => runAction(() => onSelect(group.id))}><IconGridView /><span>打开文件夹</span></button>
        <button role="menuitemcheckbox" aria-checked={pinned} className={pinned ? 'is-pinned' : ''} aria-label={`${pinned ? '取消置顶' : '置顶'} ${group.name}`}
          onClick={() => runAction(() => onPin(`group:${group.id}`))}><IconStar /><span>{pinned ? '取消置顶' : '置顶文件夹'}</span></button>
        <button role="menuitem" aria-label={`调整外观 ${group.name}`} onClick={() => runAction(() => onAppearance(group))}><IconSliders /><span>我的外观</span></button>
        {onMove && <button role="menuitem" aria-label={`移动文件夹 ${group.name}`} onClick={() => runAction(() => onMove(group))}><IconListView /><span>移动文件夹</span></button>}
        {onManage && <button role="menuitem" onClick={() => runAction(() => onManage(group))}><IconSliders /><span>编辑文件夹</span></button>}
      </div>}
    </div>
  </article>;
}

export function AlbumShortcut({ album, group, groups, albums, onOpen, onSelect, sortDragProps, sortDropProps, dropTargetId, description }) {
  const items = group ? albums.filter(item => item.groups.includes(group.id)) : [];
  const childCount = group ? groups.filter(item => item.parentId === group.id).length : 0;
  const name = group?.name || album.name;
  return <article {...sortDropProps} className={`acp-shortcut acp-shortcut-${group?.layout || 'album'}${group && dropTargetId === group.id ? ' is-drop-target' : ''}`} style={{ '--acp-accent': group?.color || '#515c67', '--acp-tint': group?.tint || '#e6e9ec' }}>
    <button {...sortDragProps} data-collection-id={group?.id} title={`${name}${description ? `\n${description}` : ''}\n拖拽调整顺序`} aria-label={group ? `打开文件夹 ${name}` : `打开 ${name}`} onClick={() => group ? onSelect(group.id) : onOpen(album)}>
      <span className="acp-shortcut-media">{childCount ? <GroupSymbol group={group} /> : <span className="acp-shortcut-thumbs">{(group ? items.slice(0, group.layout === 'panorama' ? 1 : 2) : [album]).map((item) => <img src={item.image} alt="" key={item.id} draggable={false} />)}</span>}
        {group && <span className="acp-shortcut-symbol"><GroupSymbol group={group} /></span>}</span>
      <span className="acp-shortcut-copy"><strong>{name}</strong><small>{description ?? (group ? childCount ? `${childCount} 个子文件夹 · ${items.length} 册` : `文件夹 · ${items.length} 册` : `相册 · ${album.count} 张`)}</small></span>
      <IconChevronRight />
    </button>
  </article>;
}

export function AlbumDirectory({ groups, albums, sections, selected, view, isDesktop, activeSection, onView, onJump, onSelect, onCreate, getGroupDropProps, getFolderDragProps, dropTargetId, expandedFolders, onToggleFolder, desktopExpanded, onToggleDesktop, workspaceName, organizationName, canOrganize }) {
  const treeId = React.useId();
  const selectedPath = folderPath(groups.find(group => group.id === selected), groups);
  const renderFolder = (group, level = 0) => {
    const children = groups.filter(item => item.parentId === group.id);
    const expanded = expandedFolders.includes(group.id);
    const active = selected === group.id;
    const ancestor = !active && selectedPath.some(item => item.id === group.id);
    return <li key={group.id} className="acp-folder-node">
      <div {...getGroupDropProps(group)} className={`acp-folder-row${active ? ' is-selected' : ''}${ancestor ? ' is-ancestor' : ''}${dropTargetId === group.id ? ' is-drop-target' : ''}`}
        style={{ '--folder-level': level, '--acp-accent': group.color, '--acp-tint': group.tint }}>
        {children.length > 0 ? <button type="button" className="acp-folder-toggle" aria-label={`${expanded ? '收起' : '展开'} ${group.name}`} aria-expanded={expanded}
          aria-controls={`${treeId}-${group.id}`} onClick={() => onToggleFolder(group.id)}><IconChevronRight /></button> : <span className="acp-folder-toggle-space" />}
        <button {...getFolderDragProps(group)} type="button" className="acp-folder-link" aria-current={active ? 'page' : undefined} title={folderPath(group, groups).map(item => item.name).join(' / ')} onClick={() => onSelect(group.id)}>
          <span className="acp-directory-symbol is-collection"><GroupSymbol group={group} /></span><span>{group.name}</span><small>{groupAlbums(group, albums, groups).length}</small>
        </button>
      </div>
      {children.length > 0 && <ul id={`${treeId}-${group.id}`} className="acp-folder-children" hidden={!expanded}>{children.map(child => renderFolder(child, level + 1))}</ul>}
    </li>;
  };
  return <nav className="acp-directory" aria-label="相册目录">
    <div className="acp-directory-brand"><span className="acp-directory-team" aria-hidden="true"><IconGroupRescue /></span><div><strong>{workspaceName}</strong><small>{organizationName}</small></div></div>
    <div className="acp-directory-links acp-directory-main-links">
      <div className="acp-directory-links acp-directory-desktop-row"><button {...getGroupDropProps(null)} className={`acp-directory-desktop-link${isDesktop && activeSection === 'desktop' ? ' is-selected' : ''}${dropTargetId === ROOT_DROP_ID ? ' is-drop-target' : ''}`}
        aria-current={isDesktop && activeSection === 'desktop' ? 'page' : undefined} aria-controls="desktop" onClick={() => onJump('desktop')}>
        <span className="acp-directory-symbol"><IconGroupRescue /></span><span>小组空间</span></button>
        <button type="button" className="acp-directory-desktop-toggle" aria-label={`${desktopExpanded ? '收起' : '展开'}小组空间`} title={`${desktopExpanded ? '收起' : '展开'}小组空间`}
          aria-expanded={desktopExpanded} aria-controls={`${treeId}-desktop-sections`} onClick={onToggleDesktop}><IconChevronRight /></button>
      </div>
    </div>
    <div id={`${treeId}-desktop-sections`} className="acp-directory-links acp-directory-sections" aria-label="小组空间板块" hidden={!desktopExpanded}>
      {sections.map(({ id, name, Icon }) => <button key={id} className={isDesktop && activeSection === id ? 'is-selected' : ''}
        aria-current={isDesktop && activeSection === id ? 'location' : undefined} aria-controls={id === 'collections' ? id : `desktop-${id}`} onClick={() => onJump(id)}>
        <span className="acp-directory-symbol"><Icon /></span><span>{name}</span></button>)}
    </div>
    <div className="acp-directory-links acp-directory-utility"><button className={selected === 'all' && view === 'unfiled' ? 'is-selected' : ''}
      aria-current={selected === 'all' && view === 'unfiled' ? 'page' : undefined} onClick={() => onView('unfiled')}>
      <span className="acp-directory-symbol"><IconListView /></span><span>未归类</span><small>{albums.filter((album) => !album.groups.length).length}</small></button></div>
    <div className="acp-directory-heading"><h2>文件夹</h2>{canOrganize && <button className="acp-icon" title="新建文件夹" aria-label="新建目录文件夹" onClick={onCreate}><IconPlus /></button>}</div>
    <ul className="acp-folder-tree" aria-label="多级文件夹">{groups.filter(group => !group.parentId).map(group => renderFolder(group))}</ul>
    <div className="acp-directory-foot"><span />当前小组织空间</div>
  </nav>;
}


