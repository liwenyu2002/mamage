// Account-scoped desktop with shared workspace collections and production album data.
import React from 'react';
import { createPortal } from 'react-dom';
import { Button, MotionModal } from './ui';
import { IconSearch, IconPlus, IconChevronLeft, IconChevronRight, IconGridView, IconListView,
  IconClose, IconStar, IconSparkleAI, IconSimilarStack, IconTimelineFlow, IconSliders, IconMoreStroked, IconEditStroked } from './ui/icons';
import { LiquidGlassDefs } from './liquidGlass';
import ProjectCard from './ProjectCard';
import { resolveAssetUrl } from './services/request';
import { loadAlbumDesktop, createDesktopSaver } from './services/albumDesktopService';
import { fetchProjectImportStatuses, createProject } from './services/projectService';
import { canAny } from './permissions/permissionStore';
import AlbumActionBar from './AlbumActionBar';
import './AlbumDesktop.css';

const CreateAlbumModal = React.lazy(() => import('./CreateAlbumModal'));
const EditAlbumModal = React.lazy(() => import('./EditAlbumModal'));

const SUPPORTS_FAN_DEPTH = typeof CSS !== 'undefined' && CSS.supports('translate', '0 0 1px');
const ALBUM_DRAG_TYPE = 'application/x-mamage-album';
const ORDER_DRAG_TYPE = 'application/x-mamage-album-order';
const COLORS = [{ color: '#93464e', tint: '#f0e2e3', name: '玫瑰红' }, { color: '#466c55', tint: '#e0e9de', name: '松叶绿' },
  { color: '#4a6f91', tint: '#dfe8f1', name: '雾蓝' }, { color: '#8c6a28', tint: '#eee8d7', name: '麦金' }];
const DEFAULT_COLLECTION_COLOR = '#ffffff';
const COLLECTION_COLORS = [{ color: DEFAULT_COLLECTION_COLOR, name: '白色' }, ...COLORS.map(({ tint, name }) => ({ color: tint, name }))];
const DESKTOP_SECTIONS = [
  { id: 'pins', name: '我的置顶', Icon: IconStar },
  { id: 'collections', name: '相册集', Icon: IconSimilarStack },
  { id: 'updates', name: '最近更新', Icon: IconListView },
];

function groupAlbums(group, albums) {
  if (group.kind === 'smart') return albums.filter((album) => (!group.rule.year || album.year === group.rule.year)
    && (!group.rule.group || album.groups.includes(group.rule.group)) && (!group.rule.text || album.name.includes(group.rule.text)));
  return albums.filter((album) => album.groups.includes(group.id));
}

const orderKey = (item) => String(typeof item === 'object' ? item.id : item);
function reorderItems(items, sourceId, targetId, position) {
  const source = items.findIndex((item) => orderKey(item) === sourceId);
  if (source < 0 || sourceId === targetId || !items.some((item) => orderKey(item) === targetId)) return items;
  const next = [...items];
  const [item] = next.splice(source, 1);
  const destination = next.findIndex((entry) => orderKey(entry) === targetId) + (position === 'after' ? 1 : 0);
  if (source === destination) return items;
  next.splice(destination, 0, item);
  return next;
}

function albumSearch(query) {
  const now = new Date().getFullYear();
  const year = /去年/.test(query) ? String(now - 1) : /今年/.test(query) ? String(now) : null;
  const text = query.replace(/今年|去年/g, '').trim();
  return { year, group: null, text, literal: '' };
}

function suggestCollections(albums, groups) {
  const tokens = (value) => new Set((String(value).match(/[\\u4e00-\\u9fff]{2,}|[a-zA-Z]{3,}/g) || []).flatMap(word => word.length > 2 ? Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)) : [word]));
  return albums.filter(a => !a.groups.length).flatMap(album => {
    const words = tokens(album.name);
    const match = groups.filter(g => g.kind !== 'smart').map(group => ({ group, terms:[...tokens(group.name)].filter(t=>words.has(t)) })).sort((a,b)=>b.terms.length-a.terms.length)[0];
    return match?.terms.length ? [{id:album.id,group:match.group.id,reason:`该相册尚未归类，标题与相册集名称都包含「${match.terms[0]}」。`}] : [];
  }).slice(0, 8);
}

function GroupSymbol({ group }) {
  const Icon = { timeline: IconTimelineFlow, image: IconSimilarStack, grid: IconGridView, smart: IconSparkleAI }[group.symbol] || IconGridView;
  return <Icon />;
}

function AlbumCard({ album, groups, onOpen, onOrganize, pinned, onPin, dragProps, canOrganize, importStatus, selecting, selected, onToggle, previewScope }) {
  const group = groups.find(g => album.groups.includes(g.id));
  const [menuOpen,setMenuOpen]=React.useState(false);
  const [position,setPosition]=React.useState({});
  const trigger=React.useRef(null), menu=React.useRef(null);
  const close=()=>{setMenuOpen(false);trigger.current?.focus({preventScroll:true})};
  const open=()=>{window.scrollTo({top:window.scrollY,behavior:'instant'});const bounds=trigger.current.getBoundingClientRect(),scale=parseFloat(getComputedStyle(document.documentElement).zoom)||1;setPosition({left:Math.max(8,Math.min(innerWidth-204*scale,bounds.right-180*scale))/scale,top:Math.max(8,Math.min(innerHeight-110*scale,bounds.bottom+6))/scale});setMenuOpen(true)};
  React.useEffect(()=>{
    if(!menuOpen)return undefined;
    menu.current?.querySelector('button')?.focus({preventScroll:true});
    const outside=event=>{if(!menu.current?.contains(event.target)&&!trigger.current?.contains(event.target))setMenuOpen(false)};
    const escape=event=>{if(event.key==='Escape')close()};
    const dismiss=()=>setMenuOpen(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    window.addEventListener('wheel',dismiss,{passive:true});window.addEventListener('touchmove',dismiss,{passive:true});window.addEventListener('resize',dismiss);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('wheel',dismiss);window.removeEventListener('touchmove',dismiss);window.removeEventListener('resize',dismiss)};
  },[menuOpen]);
  const action=callback=>{close();callback()};
  return <div className={`desktop-album${selecting ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`} {...dragProps}>
    <ProjectCard {...album} title={album.name} coverSrc={album.image} cover={album.image} images={album.images || []}
      thumbnails={album.thumbnails || []} subtitle={group?.name || ''} pinned={pinned} importStatus={importStatus} previewScope={previewScope} selectionMode={selecting}
      onClick={() => selecting ? onToggle(album.id) : onOpen(album)}
      onPreviewOpen={photo => selecting ? onToggle(album.id) : onOpen(album, photo)} />
    {selecting && <label className="collection-album-check"><input type="checkbox" aria-label={`选择相册 ${album.name}`} checked={selected} onChange={() => onToggle(album.id)} /><span aria-hidden="true" /></label>}
    {!selecting && <button ref={trigger} className="desktop-album-menu-trigger" aria-label={`更多操作 ${album.name}`} title="更多操作" aria-haspopup="menu" aria-expanded={menuOpen}
      onClick={()=>menuOpen?close():open()}><IconMoreStroked /></button>
    }
    {menuOpen && createPortal(<div ref={menu} className="desktop-photo-menu acp-collection-actions" role="menu" aria-label={`相册操作 ${album.name}`} style={position}
      onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...menu.current.querySelectorAll('button')],index=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}>
        <button role="menuitemcheckbox" aria-checked={pinned} onClick={()=>action(()=>onPin(`album:${album.id}`))}><IconStar /><span>{pinned ? '取消置顶' : '置顶相册'}</span></button>
        {canOrganize && <button role="menuitem" onClick={()=>action(()=>onOrganize(album))}><IconListView /><span>整理到相册集</span></button>}
      </div>,document.body)}
  </div>;
}

const CollectionCaption = React.memo(function CollectionCaption({ group, album, index, coverCount, albumCount, photoCount, visible }) {
  return <span className={`acp-collection-caption${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
    <span className="acp-collection-stamp"><GroupSymbol group={group} /><span>{album ? group.name : group.kind === 'smart' ? '智能相册集' : '相册集'}</span>
      <small>{album ? `${index + 1} / ${coverCount}` : `${albumCount} 册`}</small></span>
    <strong title={album?.name || group.name}>{album?.name || group.name}</strong>
    <span className="acp-collection-meta">{album ? `${album.count} 张照片` : `${photoCount.toLocaleString()} 张照片${group.kind === 'smart' ? ' · 自动更新' : ''}`}</span>
  </span>;
});

function CollectionCard({ group, albums, onSelect, onOpen, pinned, onPin, onAppearance, onManage, surfaceColor = DEFAULT_COLLECTION_COLOR, preview = false,
  getAlbumDragProps, dropProps, sortDragProps, dropActive = false, isAlbumDragging = false, dropMessage }) {
  const items = React.useMemo(() => groupAlbums(group, albums), [group, albums]);
  const covers = React.useMemo(() => items.slice(0, 9), [items]);
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
    const nearEdge = Math.min(bounds.left, window.innerWidth - bounds.right) < 40;
    card.style.setProperty('--fan-open-spread', nearEdge ? '28%' : '43%');
    card.style.setProperty('--fan-open-angle', nearEdge ? '12deg' : '15deg');
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
  const openCover = (event, index) => {
    if (preview) return;
    if (pointerType.current === 'touch' && event.detail !== 0 && (!expanded || activeIndex !== index)) {
      if (!expanded) fitFanToViewport();
      selectIndex(index); setExpanded(true); return;
    }
    onOpen(covers[event.detail === 0 || pointerType.current !== 'mouse' || !expanded ? index : activeRef.current]);
  };
  return <article {...dropProps} ref={cardRef} className={`acp-collection${expanded && active ? ' is-expanded' : ''}${menuOpen ? ' is-menu-open' : ''}${dropActive ? group.kind === 'smart' ? ' is-drop-blocked' : ' is-drop-target' : ''}`} aria-label={group.name}
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
    <div className="acp-fan-viewport"><div className="acp-fan-stage" onPointerEnter={(event) => {
      if (event.pointerType !== 'mouse' || menuOpen || isAlbumDragging) return;
      fitFanToViewport();
      setExpanded(true); scrub(event, true);
    }} onPointerMove={scrub}>
      {covers.map((album, index) => {
        const position = covers.length === 1 ? 0 : (index / (covers.length - 1)) * 2 - 1;
        return <button {...(!preview && getAlbumDragProps?.(album))} key={album.id} ref={(element) => { coverRefs.current[index] = element; }}
          className={`acp-fan-cover${expanded && index === activeIndex ? ' is-active' : ''}`} disabled={preview}
          aria-label={`预览相册 ${album.name}`} aria-pressed={expanded && index === activeIndex}
          style={{ '--fan-position': position, '--fan-arc': Math.abs(position), '--fan-depth': 10 + covers.length - index,
            zIndex: SUPPORTS_FAN_DEPTH ? undefined : expanded && index === activeIndex ? 30 : 10 + covers.length - index }}
          onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) { if (!expanded) fitFanToViewport(); cancelScrub(); selectIndex(index); setExpanded(true); } }}
          onClick={(event) => openCover(event, index)}>{album.image ? <img src={album.image} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="desktop-empty-cover"><IconSimilarStack /></span>}
          <span className="acp-fan-album-stamp" aria-hidden="true"><IconSimilarStack /><span>{album.count}</span></span></button>;
      })}
      {!covers.length && <span className="acp-fan-empty"><GroupSymbol group={group} /></span>}
    </div></div>
    {dropActive && <span className="acp-collection-drop-label" role="status"><GroupSymbol group={group} />{dropMessage}</span>}
    {items.length > 9 && <span className="acp-fan-overflow">+{items.length - 9}</span>}
    <div className="acp-collection-glass">
      <div className="acp-collection-frost" aria-hidden="true">{covers.filter(album=>album.image).slice(0, 3).map((album) => <img src={album.image} alt="" key={album.id} loading="lazy" draggable={false} />)}</div>
      <button {...sortDragProps} ref={footerRef} className="acp-collection-label" disabled={preview}
        aria-label={expanded && active ? `打开相册 ${active.name}` : `打开相册集 ${group.name}`}
        onClick={() => expanded && active ? onOpen(active) : onSelect(group.id)}>
        <CollectionCaption group={group} albumCount={items.length} photoCount={photoCount} visible={!expanded || !active} />
        {covers.map((album, index) => <CollectionCaption key={album.id} group={group} album={album} index={index}
          coverCount={covers.length} visible={expanded && index === activeIndex} />)}
      </button>
    </div>
    <div ref={toolsRef} className="acp-collection-tools">
      <button ref={menuTriggerRef} className="acp-collection-more" disabled={preview} title="更多操作"
        aria-label={`更多操作 ${group.name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
        onClick={() => menuOpen ? closeMenu() : openMenu()} onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(); }
        }}><IconMoreStroked /></button>
      {menuOpen && <div ref={menuRef} id={menuId} className={`acp-collection-actions${menuBelow ? ' is-below' : ''}`} role="menu" aria-label={`相册集操作 ${group.name}`}
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
        <button role="menuitem" aria-label={`查看全部相册 ${group.name}`} onClick={() => runAction(() => onSelect(group.id))}><IconGridView /><span>查看全部相册</span></button>
        <button role="menuitemcheckbox" aria-checked={pinned} className={pinned ? 'is-pinned' : ''} aria-label={`${pinned ? '取消置顶' : '置顶'} ${group.name}`}
          onClick={() => runAction(() => onPin(`group:${group.id}`))}><IconStar /><span>{pinned ? '取消置顶' : '置顶相册集'}</span></button>
        <button role="menuitem" aria-label={`调整外观 ${group.name}`} onClick={() => runAction(() => onAppearance(group))}><IconSliders /><span>我的外观</span></button>
        {onManage && <button role="menuitem" onClick={() => runAction(() => onManage(group))}><IconSliders /><span>编辑相册集</span></button>}
      </div>}
    </div>
  </article>;
}

function AlbumShortcut({ album, group, albums, onOpen, onSelect, sortDragProps, sortDropProps, dropTargetId, description }) {
  const items = group ? groupAlbums(group, albums) : [];
  const name = group?.name || album.name;
  return <article {...sortDropProps} className={`acp-shortcut acp-shortcut-${group?.layout || 'album'}${group && dropTargetId === group.id ? group.kind === 'smart' ? ' is-drop-blocked' : ' is-drop-target' : ''}`} style={{ '--acp-accent': group?.color || '#515c67', '--acp-tint': group?.tint || '#e6e9ec' }}>
    <button {...sortDragProps} data-collection-id={group?.id} title={`${name}${description ? `\n${description}` : ''}\n拖拽调整顺序`} aria-label={group ? `打开相册集 ${name}` : `打开 ${name}`} onClick={() => group ? onSelect(group.id) : onOpen(album)}>
      <span className="acp-shortcut-media">{group?.kind === 'smart' ? <><IconSparkleAI /><small>{group.rule.year || '智能'}</small></>
        : <span className="acp-shortcut-thumbs">{(group ? items.slice(0, group.layout === 'panorama' ? 1 : 2) : [album]).map((item) => item.image ? <img src={item.image} alt="" key={item.id} loading="lazy" decoding="async" draggable={false} /> : <IconSimilarStack key={item.id} />)}</span>}
        {group && group.kind !== 'smart' && <span className="acp-shortcut-symbol"><GroupSymbol group={group} /></span>}</span>
      <span className="acp-shortcut-copy"><strong>{name}</strong><small>{description ?? (group ? `${group.kind === 'smart' ? '智能集' : '相册集'} · ${items.length} 册` : `相册 · ${album.count} 张`)}</small></span>
      <IconChevronRight />
    </button>
  </article>;
}

function AlbumDirectory({ groups, albums, sections, selected, view, isDesktop, activeSection, onView, onJump, onSelect, onCreate, getGroupDropProps, dropTargetId, workspaceName, organizationName, canOrganize }) {
  return <nav className="acp-directory" aria-label="相册目录">
    <div className="acp-directory-brand"><img src="/favicon.svg" alt="" /><div><strong>{workspaceName}</strong><small>{organizationName}</small></div></div>
    <div className="acp-directory-links acp-directory-main-links">
      <button className={selected === 'all' && view === 'library' ? 'is-selected' : ''}
        aria-current={selected === 'all' && view === 'library' ? 'page' : undefined} onClick={() => onView('library')}>
        <span className="acp-directory-symbol"><IconGridView /></span><span>全部相册</span><small>{albums.length}</small></button>
      <button className={isDesktop && activeSection === 'desktop' ? 'is-selected' : ''}
        aria-current={isDesktop && activeSection === 'desktop' ? 'page' : undefined} aria-controls="desktop" onClick={() => onJump('desktop')}>
        <span className="acp-directory-symbol"><IconSparkleAI /></span><span>我的桌面</span></button>
    </div>
    <div className="acp-directory-links acp-directory-sections" aria-label="我的桌面板块">
      {sections.map(({ id, name, Icon }) => <button key={id} className={isDesktop && activeSection === id ? 'is-selected' : ''}
        aria-current={isDesktop && activeSection === id ? 'location' : undefined} aria-controls={id === 'collections' ? id : `desktop-${id}`} onClick={() => onJump(id)}>
        <span className="acp-directory-symbol"><Icon /></span><span>{name}</span></button>)}
    </div>
    <div className="acp-directory-links acp-directory-utility"><button className={selected === 'all' && view === 'unfiled' ? 'is-selected' : ''}
      aria-current={selected === 'all' && view === 'unfiled' ? 'page' : undefined} onClick={() => onView('unfiled')}>
      <span className="acp-directory-symbol"><IconListView /></span><span>未归类</span><small>{albums.filter((album) => !album.groups.length).length}</small></button></div>
    <div className="acp-directory-heading"><h2>相册集</h2>{canOrganize && <button className="acp-icon" title="新建相册集" aria-label="新建目录相册集" onClick={onCreate}><IconPlus /></button>}</div>
    <div className="acp-directory-links">{groups.filter((group) => group.kind !== 'smart').map((group) => <button {...getGroupDropProps(group)} key={group.id} className={`${selected === group.id ? 'is-selected' : ''}${dropTargetId === group.id ? ' is-drop-target' : ''}`}
      aria-current={selected === group.id ? 'page' : undefined} style={{ '--acp-accent': group.color, '--acp-tint': group.tint }} onClick={() => onSelect(group.id)}>
      <span className="acp-directory-symbol is-collection"><GroupSymbol group={group} /></span><span>{group.name}</span><small>{groupAlbums(group, albums).length}</small></button>)}</div>
    <div className="acp-directory-heading"><h2>智能相册集</h2><IconSparkleAI /></div>
    <div className="acp-directory-links">{groups.filter((group) => group.kind === 'smart').map((group) => <button {...getGroupDropProps(group)} key={group.id} className={`${selected === group.id ? 'is-selected' : ''}${dropTargetId === group.id ? ' is-drop-blocked' : ''}`}
      aria-current={selected === group.id ? 'page' : undefined} style={{ '--acp-accent': group.color, '--acp-tint': group.tint }} onClick={() => onSelect(group.id)}>
      <span className="acp-directory-symbol is-collection"><GroupSymbol group={group} /></span><span>{group.name}</span><small>{groupAlbums(group, albums).length}</small></button>)}</div>
    <div className="acp-directory-foot"><span />当前小组织空间</div>
  </nav>;
}

function DesktopContent({ initial, userId, workspaceName, organizationName, onOpen, onReload, sort, dateFilter, toolbar, projectPreviews, importStatuses }) {
  const [albums, setAlbums] = React.useState(() => initial.albums.map(a => ({ ...a, image: a.image ? resolveAssetUrl(a.image) : null, groups: initial.groups.filter(g => g.projectIds?.includes(a.id)).map(g=>g.id) })));
  const [groups, setGroups] = React.useState(initial.groups);
  const [pins, setPins] = React.useState(initial.preferences.pins);
  const recentItems = initial.preferences.recentItems;
  const [orderModal, setOrderModal] = React.useState(null);
  const [selected, setSelected] = React.useState('all');
  const [view, setView] = React.useState('all');
  const [activeSection, setActiveSection] = React.useState('desktop');
  const [jumpRequest, setJumpRequest] = React.useState(null);
  const mainRef = React.useRef(null);
  const [draftQuery, setDraftQuery] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState([]);
  const [newGroup, setNewGroup] = React.useState(false);
  const [groupName, setGroupName] = React.useState('');
  const [editingGroup, setEditingGroup] = React.useState(null);
  const [deletingGroup, setDeletingGroup] = React.useState(null);
  const [saveError, setSaveError] = React.useState('');
  const [saveStatus, setSaveStatus] = React.useState('saved');
  const saverRef = React.useRef(null);
  if (!saverRef.current) saverRef.current = createDesktopSaver(initial, error => setSaveError(error?.message || '保存失败，请重新加载后重试'), setSaveStatus);
  const canOrganize = initial.canOrganize;
  const [organizing, setOrganizing] = React.useState(null);
  const [checked, setChecked] = React.useState([]);
  const [notice, setNotice] = React.useState('');
  const [pinsModal, setPinsModal] = React.useState(false);
  const [appearance, setAppearance] = React.useState(null);
  const [colorsByUser, setColorsByUser] = React.useState({ [userId]: initial.preferences.colors });
  const [review, setReview] = React.useState(false);
  const [selectingAlbums, setSelectingAlbums] = React.useState(false);
  const [selectedAlbumIds, setSelectedAlbumIds] = React.useState([]);
  const [collectionToolsOpen, setCollectionToolsOpen] = React.useState(false);
  const [creatingInGroup, setCreatingInGroup] = React.useState(null);
  const [editingAlbum, setEditingAlbum] = React.useState(null);
  const [addingAlbums, setAddingAlbums] = React.useState(false);
  const [addAlbumIds, setAddAlbumIds] = React.useState([]);
  const [addQuery, setAddQuery] = React.useState('');
  const [addLimit, setAddLimit] = React.useState(60);
  const [removingAlbums, setRemovingAlbums] = React.useState(false);
  const canCreateAlbum = canOrganize && canAny('projects.create');
  const canEditAlbum = canOrganize && canAny('projects.update');
  const scopeHeaders = initial.scope ? { 'x-mamage-unit-id': initial.scope.unitId ? String(initial.scope.unitId) : 'legacy' } : undefined;
  const mountedRef = React.useRef(true);
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [accepted, setAccepted] = React.useState([]);
  const [dismissed, setDismissed] = React.useState(initial.preferences.dismissed);
  const snapshot = () => ({ groups: groups.map(g => ({...g, projectIds: g.kind === 'smart' ? [] : albums.filter(a=>a.groups.includes(g.id)).map(a=>a.id)})), preferences: { pins, recentItems, colors: colorsByUser[userId] || {}, dismissed } });
  const snapshotRef = React.useRef(null);
  snapshotRef.current = snapshot();
  React.useEffect(() => {
    const timer = setTimeout(() => saverRef.current.save(snapshotRef.current), 300);
    return () => clearTimeout(timer);
  }, [groups, albums, pins, recentItems, colorsByUser, dismissed]);
  React.useEffect(() => () => { saverRef.current.save(snapshotRef.current); }, []);
  const setOpened = (album, photo) => {
    if (!album) return;
    onOpen(album.id, photo);
  };
  const [directoryOpen, setDirectoryOpen] = React.useState(false);
  const [draggedAlbumId, setDraggedAlbumId] = React.useState(null);
  const [dropTargetId, setDropTargetId] = React.useState(null);
  const [pendingDrop, setPendingDrop] = React.useState(null);
  const [sortSource, setSortSource] = React.useState(null);
  const [sortTarget, setSortTarget] = React.useState(null);
  const draggedAlbumRef = React.useRef(null);
  const dropTargetRef = React.useRef(null);
  const sortSourceRef = React.useRef(null);
  const sortTargetRef = React.useRef(null);
  const sortLayoutRef = React.useRef(null);
  const sortCleanupRef = React.useRef(null);
  const sortCleanupNodesRef = React.useRef(new Set());
  const endAlbumDrag = React.useCallback(() => {
    const layout = sortLayoutRef.current;
    if (layout) {
      layout.animations.forEach((animation) => animation.cancel());
      layout.ghost?.remove();
      layout.slots.forEach(({ node }) => { node.style.transform = 'none'; sortCleanupNodesRef.current.add(node); });
      if (sortCleanupRef.current !== null) cancelAnimationFrame(sortCleanupRef.current);
      sortCleanupRef.current = requestAnimationFrame(() => {
        sortCleanupRef.current = null;
        // Finish the drop's layout before restoring the ordinary hover transitions.
        const activeNodes = new Set(sortLayoutRef.current?.slots.map(({ node }) => node));
        layout.slots[0]?.node.getBoundingClientRect();
        sortCleanupNodesRef.current.forEach((node) => {
          if (activeNodes.has(node)) return;
          node.style.removeProperty('transform'); node.style.removeProperty('transition');
        });
        sortCleanupNodesRef.current.clear();
      });
    }
    draggedAlbumRef.current = null; dropTargetRef.current = null;
    setDraggedAlbumId(null); setDropTargetId(null);
    sortSourceRef.current = null; sortTargetRef.current = null;
    sortLayoutRef.current = null;
    setSortSource(null); setSortTarget(null);
  }, []);
  React.useEffect(() => () => {
    if (sortCleanupRef.current !== null) cancelAnimationFrame(sortCleanupRef.current);
    sortLayoutRef.current?.animations.forEach((animation) => animation.cancel());
    sortLayoutRef.current?.ghost?.remove();
  }, []);
  React.useEffect(() => {
    if (draggedAlbumId === null && !sortSource) return undefined;
    const escape = (event) => { if (event.key === 'Escape') endAlbumDrag(); };
    document.addEventListener('dragend', endAlbumDrag);
    window.addEventListener('blur', endAlbumDrag);
    window.addEventListener('resize', endAlbumDrag);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('dragend', endAlbumDrag);
      window.removeEventListener('blur', endAlbumDrag);
      window.removeEventListener('resize', endAlbumDrag);
      window.removeEventListener('keydown', escape);
    };
  }, [draggedAlbumId, sortSource, endAlbumDrag]);
  React.useEffect(() => { setAppearance(null); }, [userId]);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('variant')) { url.searchParams.delete('variant'); window.history.replaceState(null, '', url); }
  }, []);
  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2400); return () => clearTimeout(timer);
  }, [notice]);

  const searchPlan = albumSearch(query);
  const isLibraryView = selected === 'all' && view === 'library';
  const enrichedAlbums = React.useMemo(()=>albums.map(album=>{const preview=projectPreviews.find(p=>Number(p.id)===Number(album.id));return preview ? {...preview,...album,image:preview.coverSrc || album.image,images:preview.images || album.images,thumbnails:preview.thumbnails || album.thumbnails} : album}),[albums,projectPreviews]);
  const filtered = enrichedAlbums.filter((album) => (!query || ((!searchPlan.year || album.year === searchPlan.year) && (!searchPlan.group || album.groups.includes(searchPlan.group))
      && (!searchPlan.text || album.name.includes(searchPlan.text))
      && (!searchPlan.literal || `${album.name} ${album.groups.map((id) => groups.find((group) => group.id === id)?.name).join(' ')}`.includes(searchPlan.literal))))
    && (view !== 'unfiled' || !album.groups.length)
    && (!isLibraryView || !dateFilter?.from || String(album.eventDate || album.createdAt).slice(0,10) >= dateFilter.from)
    && (!isLibraryView || !dateFilter?.to || String(album.eventDate || album.createdAt).slice(0,10) <= dateFilter.to))
    .sort((a,b)=>{const key=sort?.key==='eventDate' ? 'eventDate' : 'createdAt';return ((Date.parse(a[key] || a.createdAt)||0)-(Date.parse(b[key] || b.createdAt)||0))*(sort?.order==='asc' ? 1:-1)});
  const currentGroup = groups.find((group) => group.id === selected);
  const collectionAlbums = currentGroup ? groupAlbums(currentGroup, filtered) : [];
  const selectedAlbumSet = new Set(selectedAlbumIds);
  const selectedAlbums = collectionAlbums.filter(album => selectedAlbumSet.has(album.id));
  const manualCollection = currentGroup && currentGroup.kind !== 'smart';
  React.useEffect(() => {
    setSelectingAlbums(false); setSelectedAlbumIds([]); setCollectionToolsOpen(false);
    setAddingAlbums(false); setRemovingAlbums(false);
  }, [selected, view, query]);
  const toggleAlbumSelection = id => setSelectedAlbumIds(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id]);
  const editCollection = () => {
    setCollectionToolsOpen(false); setEditingGroup(currentGroup); setGroupName(currentGroup.name); setNewGroup(true);
  };
  const openAddAlbums = () => {
    setCollectionToolsOpen(false); setAddAlbumIds([]); setAddQuery(''); setAddLimit(60); setAddingAlbums(true);
  };
  const addExistingAlbums = () => {
    if (!manualCollection || !canOrganize || !addAlbumIds.length) return;
    const ids = new Set(addAlbumIds);
    setAlbums(old => old.map(album => ids.has(album.id) ? { ...album, groups: [...new Set([...album.groups, currentGroup.id])] } : album));
    setAddingAlbums(false); setNotice(`已加入 ${ids.size} 个相册，原有归属保留`);
  };
  const removeSelectedAlbums = () => {
    if (!manualCollection || !canOrganize || !selectedAlbums.length) return;
    const ids = new Set(selectedAlbums.map(album => album.id));
    setAlbums(old => old.map(album => ids.has(album.id) ? { ...album, groups: album.groups.filter(id => id !== currentGroup.id) } : album));
    setRemovingAlbums(false); setSelectedAlbumIds([]); setNotice(`已移出 ${ids.size} 个相册，照片保留`);
  };
  const createInCollection = async payload => {
    const groupId = creatingInGroup.id;
    const created = await createProject(payload, { headers: scopeHeaders });
    if (!created?.id || !mountedRef.current) return created;
    // Merge into the latest snapshot so unrelated changes made during creation are preserved.
    const latest = snapshotRef.current;
    const target = latest.groups.find(group => group.id === groupId && group.kind !== 'smart');
    const date = created.eventDate || payload.eventDate || created.createdAt || new Date().toISOString();
    const album = { ...created, id: Number(created.id), name: created.projectName || created.name || created.title || payload.title,
      description: created.description ?? payload.description ?? '', eventDate: created.eventDate || payload.eventDate,
      count: Number(created.photoCount || 0), createdAt: created.createdAt || new Date().toISOString(), year: String(new Date(date).getFullYear()),
      image: null, groups: target ? [groupId] : [] };
    setAlbums(old => [...old.filter(item => item.id !== album.id), album]);
    if (!target) { setNotice('相册已创建，原相册集已变更，请重新归类'); return created; }
    const next = { ...latest, groups: latest.groups.map(group => group.id === groupId
      ? { ...group, projectIds: [...new Set([...(group.projectIds || []), album.id])] } : group) };
    snapshotRef.current = next;
    const saved = await saverRef.current.save(next);
    if (!saved && mountedRef.current) setSaveError('相册已创建，但未能加入相册集。请重新加载后将它整理进来，不要重复创建。');
    return created;
  };
  const availableToAdd = manualCollection ? enrichedAlbums.filter(album => !album.groups.includes(currentGroup.id)
    && (!addQuery.trim() || album.name.toLowerCase().includes(addQuery.trim().toLowerCase()))) : [];
  const home = !currentGroup && view === 'all' && !query;
  const selectGroup = (id) => { setSelected(id); setView('all'); setQuery(''); setDraftQuery(''); setDirectoryOpen(false); setJumpRequest(null); setActiveSection('desktop'); };
  const selectView = (id) => { setView(id); setSelected('all'); setQuery(''); setDraftQuery(''); setDirectoryOpen(false); setJumpRequest(null); };
  const jumpToSection = (id) => {
    setSelected('all'); setView('all'); setQuery(''); setDraftQuery(''); setDirectoryOpen(false);
    if (id === 'updates') setCollapsed((old) => old.filter((key) => key !== 'recent'));
    setActiveSection(id); setJumpRequest({ id });
  };
  React.useEffect(() => {
    if (!home) { if (jumpRequest) setJumpRequest(null); return undefined; }
    if (!jumpRequest) return undefined;
    const target = jumpRequest.id === 'desktop' ? mainRef.current : mainRef.current?.querySelector(`[data-desktop-section="${jumpRequest.id}"]`);
    if (!target) return undefined;
    const spotlight = target.querySelector(':scope > .acp-section-spotlight');
    if (!spotlight) return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer;
    let animation;
    const highlight = () => {
      window.removeEventListener('scroll', settled);
      window.clearTimeout(timer);
      if (reducedMotion) {
        spotlight.classList.add('is-located');
        timer = window.setTimeout(() => spotlight.classList.remove('is-located'), 1000);
        return;
      }
      animation = spotlight.animate([
        { opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: .15, offset: .45 },
        { opacity: .85, offset: .65 }, { opacity: 0 },
      ], { duration: 1300, easing: 'ease-out' });
    };
    // Debounce completion, with no geometry reads while the page is scrolling.
    const settled = () => { window.clearTimeout(timer); timer = window.setTimeout(highlight, 140); };
    const frame = window.requestAnimationFrame(() => {
      window.addEventListener('scroll', settled, { passive: true });
      target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
      settled();
    });
    return () => {
      window.cancelAnimationFrame(frame); window.removeEventListener('scroll', settled); window.clearTimeout(timer);
      animation?.cancel(); spotlight.classList.remove('is-located');
    };
  }, [home, jumpRequest]);
  const organize = (album) => { if (!canOrganize) return; setOrganizing(album); setChecked(album.groups); };
  const draggedAlbum = albums.find((album) => album.id === draggedAlbumId);
  const dropAlbum = albums.find((album) => album.id === pendingDrop?.albumId);
  const dropGroup = groups.find((group) => group.id === pendingDrop?.groupId);
  const alreadyInTarget = Boolean(dropAlbum && dropGroup && dropAlbum.groups.includes(dropGroup.id));
  const otherDropGroups = dropAlbum ? groups.filter((group) => group.id !== dropGroup?.id && dropAlbum.groups.includes(group.id)) : [];
  const orderLists = { pins, collections: groups };
  const orderSetters = { pins: setPins, collections: setGroups };
  const orderNames = { pins: '我的置顶', collections: '相册集' };
  const reorder = (list, sourceId, targetId, position) => {
    const next = reorderItems(orderLists[list], sourceId, targetId, position);
    if (next === orderLists[list]) return;
    orderSetters[list](next); setNotice(`已调整${orderNames[list]}顺序`);
  };
  const moveOne = (list, id, direction) => {
    const items = orderLists[list];
    const index = items.findIndex((item) => orderKey(item) === id);
    const target = items[index + direction];
    if (index >= 0 && target) reorder(list, id, orderKey(target), direction < 0 ? 'before' : 'after');
  };
  const previewSort = (target) => {
    const layout = sortLayoutRef.current;
    if (!layout) return;
    const next = target ? reorderItems(layout.items, sortSourceRef.current.id, target.id, target.position) : layout.items;
    const destinations = new Map(next.map((item, index) => [orderKey(item), layout.slots[index]]));
    const frames = layout.slots.map((slot) => {
      const destination = destinations.get(slot.id);
      return { node: slot.node, from: getComputedStyle(slot.node).transform,
        to: `translate3d(${destination.left - slot.left}px, ${destination.top - slot.top}px, 0)` };
    });
    layout.animations.forEach((animation) => animation.cancel()); layout.animations.clear();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    frames.forEach(({ node, from, to }) => {
      node.style.transform = to;
      if (!reduceMotion) {
        layout.animations.set(node, node.animate([{ transform: from }, { transform: to }], { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
    });
  };
  const clearSortTarget = () => {
    if (sortTargetRef.current) { previewSort(null); sortTargetRef.current = null; setSortTarget(null); }
  };
  const clearGroupTarget = () => {
    if (dropTargetRef.current !== null) { dropTargetRef.current = null; setDropTargetId(null); }
  };
  const getAlbumDragProps = (album) => ({
    draggable: true,
    'data-album-id': album.id,
    'data-album-dragging': draggedAlbumId === album.id,
    onDragStart: (event) => {
      event.stopPropagation();
      event.dataTransfer.setData(ALBUM_DRAG_TYPE, String(album.id));
      event.dataTransfer.setData('text/plain', album.name);
      event.dataTransfer.effectAllowed = 'copy';
      draggedAlbumRef.current = album.id; setDraggedAlbumId(album.id);
    },
    onDragEnd: endAlbumDrag,
  });
  const isAlbumDrag = (event) => draggedAlbumRef.current !== null && Array.from(event.dataTransfer.types).includes(ALBUM_DRAG_TYPE);
  const hoverGroup = (event, group) => {
    if (!isAlbumDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    clearSortTarget();
    event.dataTransfer.dropEffect = group.kind === 'smart' ? 'none' : 'copy';
    if (dropTargetRef.current !== group.id) { dropTargetRef.current = group.id; setDropTargetId(group.id); }
  };
  const getGroupDropProps = (group) => canOrganize ? ({
    'data-collection-id': group.id,
    onDragEnter: (event) => hoverGroup(event, group),
    onDragOver: (event) => hoverGroup(event, group),
    onDragLeave: (event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      if (dropTargetRef.current === group.id) { dropTargetRef.current = null; setDropTargetId(null); }
    },
    onDrop: (event) => {
      if (!isAlbumDrag(event)) return;
      event.preventDefault(); event.stopPropagation();
      const albumId = draggedAlbumRef.current;
      const matchesSource = event.dataTransfer.getData(ALBUM_DRAG_TYPE) === String(albumId);
      endAlbumDrag();
      if (!matchesSource) return;
      if (group.kind === 'smart') { setNotice('智能相册集按规则自动收录，不支持手动加入'); return; }
      setDirectoryOpen(false); setPendingDrop({ albumId, groupId: group.id });
    },
  }) : {};
  const getSortDragProps = (list, id, album) => ({
    ...(album ? getAlbumDragProps(album) : {}),
    draggable: true,
    title: '拖拽调整顺序',
    'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown',
    onDragStart: (event) => {
      if (album) getAlbumDragProps(album).onDragStart(event);
      else event.stopPropagation();
      const source = { list, id };
      event.dataTransfer.setData(ORDER_DRAG_TYPE, JSON.stringify(source));
      if (!album) event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = album ? 'copyMove' : 'move';
      const card = event.currentTarget.closest('[data-sort-list]');
      const container = card.parentElement;
      const slots = [...container.children].map((node) => ({ id: node.dataset.sortId, node,
        left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }));
      const ghost = card.cloneNode(true);
      ghost.removeAttribute('data-sort-list'); ghost.removeAttribute('data-sort-id');
      ghost.removeAttribute('data-collection-id');
      ghost.classList.add('acp-drag-ghost'); ghost.setAttribute('aria-hidden', 'true');
      const bounds = card.getBoundingClientRect();
      Object.assign(ghost.style, { position: 'fixed', left: '-10000px', top: '0', width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0', transform: 'none', transition: 'none' });
      document.querySelector('.acp-page').appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, event.clientX - bounds.left, event.clientY - bounds.top);
      requestAnimationFrame(() => ghost.remove());
      slots.forEach(({ node }) => { node.style.transition = 'none'; });
      sortLayoutRef.current = { list, container, slots, items: orderLists[list], animations: new Map(), ghost };
      sortSourceRef.current = source; setSortSource(source);
    },
    onDragEnd: endAlbumDrag,
    onKeyDown: (event) => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      moveOne(list, id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
    },
  });
  const sortPosition = (event, list) => {
    const source = sortSourceRef.current;
    if (!source || source.list !== list || !Array.from(event.dataTransfer.types).includes(ORDER_DRAG_TYPE)) return null;
    const layout = sortLayoutRef.current;
    const bounds = layout.container.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    const x = event.clientX - bounds.left + layout.container.scrollLeft;
    const y = event.clientY - bounds.top + layout.container.scrollTop;
    const slot = layout.slots.reduce((nearest, candidate) => {
      const distance = (item) => (x - item.left - item.width / 2) ** 2 + (y - item.top - item.height / 2) ** 2;
      return distance(candidate) < distance(nearest) ? candidate : nearest;
    });
    const vertical = list === 'collections' && (layout.slots.length < 2 || layout.slots[1].top > layout.slots[0].top);
    const fraction = vertical ? (y - slot.top) / slot.height : (x - slot.left) / slot.width;
    const groupId = list === 'collections' ? slot.id : list === 'pins' && slot.id.startsWith('group:') ? slot.id.slice(6) : null;
    // Use the original slots, not the animated card bounds, to prevent oscillating targets.
    if (canOrganize && groupId && isAlbumDrag(event) && fraction > .22 && fraction < .78) {
      return { list, id: slot.id, position: 'file', group: groups.find((group) => group.id === groupId) };
    }
    return { list, id: slot.id, position: source.id === slot.id ? 'self' : fraction < .5 ? 'before' : 'after' };
  };
  const hoverSortList = (event, list) => {
    const target = sortPosition(event, list);
    if (!target) return;
    if (target.position === 'file') { hoverGroup(event, target.group); return; }
    event.preventDefault(); event.stopPropagation(); clearGroupTarget();
    event.dataTransfer.dropEffect = 'move';
    if (target.position === 'self') {
      if (sortTargetRef.current) { previewSort(null); sortTargetRef.current = null; setSortTarget(null); }
      return;
    }
    if (sortTargetRef.current?.id !== target.id || sortTargetRef.current?.position !== target.position) {
      previewSort(target); sortTargetRef.current = target; setSortTarget(target);
    }
  };
  const getSortListProps = (list) => ({
    onDragEnterCapture: (event) => hoverSortList(event, list),
    onDragOverCapture: (event) => hoverSortList(event, list),
    onDragLeave: (event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
      if (sortSourceRef.current?.list === list) { clearSortTarget(); clearGroupTarget(); }
    },
    onDropCapture: (event) => {
      const target = sortPosition(event, list);
      if (!target) return;
      if (target.position === 'file') { getGroupDropProps(target.group).onDrop(event); return; }
      event.preventDefault(); event.stopPropagation();
      const source = sortSourceRef.current;
      const matchesSource = event.dataTransfer.getData(ORDER_DRAG_TYPE) === JSON.stringify(source);
      endAlbumDrag();
      if (matchesSource && target.position !== 'self') reorder(list, source.id, target.id, target.position);
    },
  });
  const getSortDropProps = (list, id, group) => {
    const groupDrop = group ? getGroupDropProps(group) : null;
    return {
      'data-sort-list': list,
      'data-sort-id': id,
      'data-sort-active': sortSource?.list === list,
      'data-sort-dragging': sortSource?.list === list && sortSource.id === id,
      'data-sort-position': sortTarget?.list === list && sortTarget.id === id ? sortTarget.position : undefined,
      onDragEnter: groupDrop?.onDragEnter,
      onDragOver: groupDrop?.onDragOver,
      onDragLeave: groupDrop?.onDragLeave,
      onDrop: groupDrop?.onDrop,
    };
  };
  const confirmDrop = () => {
    if (!dropAlbum || !dropGroup || alreadyInTarget || dropGroup.kind === 'smart') return;
    setAlbums((old) => old.map((album) => album.id === dropAlbum.id
      ? { ...album, groups: [...new Set([...album.groups, dropGroup.id])] } : album));
    setPendingDrop(null); setNotice(`已加入「${dropGroup.name}」，原有归属保留`);
  };
  const myColors = colorsByUser[userId] || {};
  const editAppearance = (group) => setAppearance({ groupId: group.id, userId, color: myColors[group.id] || DEFAULT_COLLECTION_COLOR });
  const appearanceGroup = appearance?.userId === userId ? groups.find((group) => group.id === appearance.groupId) : null;
  const saveAppearance = () => {
    if (!appearanceGroup) return;
    setColorsByUser((old) => {
      const colors = { ...old[userId] };
      if (appearance.color === DEFAULT_COLLECTION_COLOR) delete colors[appearance.groupId];
      else colors[appearance.groupId] = appearance.color;
      return { ...old, [userId]: colors };
    });
    setAppearance(null); setNotice('已更新我的相册集外观');
  };
  const togglePin = (key) => setPins((old) => old.includes(key) ? old.filter((item) => item !== key) : [...old, key]);
  const suggestions = suggestCollections(albums, groups).filter(item => !dismissed.includes(item.id));
  const search = (text) => { setDraftQuery(text); setQuery(text.trim()); setSelected('all'); setView('library'); };
  const createGroup = () => {
    if (!canOrganize || !groupName.trim()) return;
    if (editingGroup) {
      setGroups(old=>old.map(group=>group.id===editingGroup.id ? {...group,name:groupName.trim()} : group));
      setNewGroup(false);setEditingGroup(null);return;
    }
    const id = `group-${Date.now()}`;
    setGroups((old) => [...old, { id, ...COLORS[old.length % COLORS.length], name: groupName.trim(), layout: 'mosaic', symbol: 'grid' }]);
    setNewGroup(false); selectGroup(id);
  };
  const saveSearch = () => {
    if (!canOrganize) return;
    const id = `smart-${Date.now()}`;
    setGroups((old) => [...old, { id, ...COLORS[3], name: query, layout: 'rule', symbol: 'smart', kind: 'smart',
      rule: { year: searchPlan.year, group: searchPlan.group, text: searchPlan.text || searchPlan.literal } }]);
    selectGroup(id); setNotice('已保存为智能相册集');
  };
  const [gridPage, setGridPage] = React.useState(1);
  React.useEffect(() => setGridPage(1), [selected, view, query, sort?.key, sort?.order, dateFilter?.from, dateFilter?.to]);
  const visibleIds = (home ? filtered.slice(0,6) : currentGroup ? groupAlbums(currentGroup,filtered).slice(0,gridPage*24) : filtered.slice(0,gridPage*24)).map(a=>a.id).join(',');
  const [liveImportStatuses, setLiveImportStatuses] = React.useState(importStatuses || {});
  React.useEffect(() => {
    let active=true, timer;
    const refresh=async()=>{try{if(document.visibilityState!=='hidden' && visibleIds){const ids=visibleIds.split(',');let statuses={};for(let i=0;i<ids.length;i+=50){const result=await fetchProjectImportStatuses(ids.slice(i,i+50));statuses={...statuses,...(result.statuses || {})};}if(active)setLiveImportStatuses(old=>({...old,...statuses}));}}catch(_){}finally{if(active)timer=setTimeout(refresh,15000);}};
    refresh();return()=>{active=false;clearTimeout(timer)};
  }, [visibleIds]);
  const grid = (items) => items.length ? <div className="acp-albums">{items.slice(0,gridPage*24).map((album) => <AlbumCard key={album.id} album={album} groups={groups}
    onOpen={setOpened} onOrganize={organize} pinned={pins.includes(`album:${album.id}`)} onPin={togglePin} dragProps={selectingAlbums ? { 'data-album-id': album.id } : getAlbumDragProps(album)}
    selecting={Boolean(currentGroup && selectingAlbums)} selected={selectedAlbumSet.has(album.id)} onToggle={toggleAlbumSelection}
    canOrganize={canOrganize} importStatus={liveImportStatuses[album.id]} previewScope={initial.scope} />)}{items.length>gridPage*24 && <div className="desktop-load-more"><Button onClick={()=>setGridPage(page=>page+1)}>加载更多</Button></div>}</div> : <p className="acp-empty">这里还没有相册</p>;
  const collection = (group) => <CollectionCard key={group.id} group={group} albums={albums} onSelect={selectGroup} onOpen={setOpened}
    onManage={canOrganize ? group=>{setEditingGroup(group);setGroupName(group.name);setNewGroup(true)} : undefined}
    pinned={pins.includes(`group:${group.id}`)} onPin={togglePin} onAppearance={editAppearance} surfaceColor={myColors[group.id] || DEFAULT_COLLECTION_COLOR}
    getAlbumDragProps={getAlbumDragProps} dropProps={{ ...getGroupDropProps(group), ...getSortDropProps('collections', group.id, group) }}
    sortDragProps={canOrganize && !query ? getSortDragProps('collections', group.id) : {}} dropActive={dropTargetId === group.id} isAlbumDragging={draggedAlbumId !== null || Boolean(sortSource)}
    dropMessage={group.kind === 'smart' ? '智能相册集 · 按规则收录' : draggedAlbum?.groups.includes(group.id) ? '已在此相册集中' : `加入「${group.name}」`} />;
  const libraryGroups = isLibraryView && query ? groups.filter(group => group.name.includes(query) || groupAlbums(group, filtered).length > 0) : groups;
  const collectionsSection = <section className="acp-collections-section" id="collections" data-desktop-section="collections" aria-label="相册集">
    <span className="acp-section-spotlight" aria-hidden="true" /><div className="acp-section-heading"><h2>相册集</h2>
      <div className="acp-section-controls"><span className="acp-caption">{libraryGroups.length} 个</span>{canOrganize && <button className="acp-icon" title="调整相册集顺序" aria-label="调整相册集顺序" onClick={() => setOrderModal('collections')}><IconSliders /></button>}</div>
    </div><div {...(canOrganize && !query ? getSortListProps('collections') : {})} className="acp-all-collections">{libraryGroups.map(collection)}</div>
    {!libraryGroups.length && <p className="acp-empty">{query ? '没有匹配的相册集' : `还没有相册集${canOrganize ? '，可以从左侧目录新建' : ''}`}</p>}
  </section>;
  const section = (name, items, key) => <section className="acp-section" key={key}
    id={key === 'recent' ? 'desktop-updates' : undefined} data-desktop-section={key === 'recent' ? 'updates' : undefined}>
    {key === 'recent' && <span className="acp-section-spotlight" aria-hidden="true" />}
    <div className="acp-section-heading"><button className="acp-section-toggle" onClick={() => setCollapsed((old) => old.includes(key) ? old.filter((id) => id !== key) : [...old, key])}
      aria-expanded={!collapsed.includes(key)}><IconChevronRight className={collapsed.includes(key) ? '' : 'is-expanded'} /><h2>{name}</h2><span>{items.length}</span></button></div>
    {!collapsed.includes(key) && <div className="acp-section-content">{grid(items)}</div>}
  </section>;
  const pinOptions = [...groups.map((group) => ({ key: `group:${group.id}`, name: group.name, type: group.kind === 'smart' ? '智能相册集' : '相册集' })),
    ...albums.map((album) => ({ key: `album:${album.id}`, name: album.name, type: '相册' }))];
  const availablePins = new Set(pinOptions.map(item => item.key));
  const visiblePins = pins.filter(key => availablePins.has(key));
  const desktopSections = DESKTOP_SECTIONS.filter(({ id }) => id !== 'pins' || visiblePins.length > 0);
  React.useEffect(() => {
    if (activeSection === 'pins' && !visiblePins.length) {
      setActiveSection('desktop'); setJumpRequest(null);
    }
  }, [activeSection, visiblePins.length]);
  const directory = <AlbumDirectory groups={groups} albums={albums} sections={desktopSections} selected={selected} view={view} isDesktop={home} activeSection={activeSection}
    onView={selectView} onJump={jumpToSection} onSelect={selectGroup} workspaceName={workspaceName} organizationName={organizationName} canOrganize={canOrganize}
    onCreate={() => { setDirectoryOpen(false); setEditingGroup(null); setGroupName(''); setNewGroup(true); }} getGroupDropProps={getGroupDropProps} dropTargetId={dropTargetId} />;
  const suggestionPanel = suggestions.length > 0 && <section className="acp-suggestion-panel" aria-label="整理建议">
    <div className="acp-suggestion-heading"><IconSparkleAI /><h2>整理建议</h2><span className="acp-suggestion-count" aria-label={`${suggestions.length} 个相册待整理`}>{suggestions.length}</span>
      <button className="acp-icon" aria-label="暂时隐藏整理建议" title="暂时隐藏" onClick={() => setDismissed(suggestions.map((item) => item.id))}><IconClose /></button></div>
    <p>{suggestions.map((item) => albums.find((album) => album.id === item.id)?.name).join('、')}</p>
    <button className="acp-suggestion-open" onClick={() => { setDirectoryOpen(false); setAccepted(suggestions.map((item) => item.id)); setReview(true); }}>查看建议 <IconChevronRight /></button>
  </section>;

  return <div className={`album-desktop acp-page acp-smart-page acp-layout-sidebar acp-refined${currentGroup ? ' has-collection-toolbar' : ''}${draggedAlbumId !== null ? ' is-dragging-album' : ''}${sortSource ? ' is-sorting' : ''}`}>
    <div className="acp-workspace">
      <aside className="acp-sidebar"><div className="acp-sidebar-directory">{directory}</div>{suggestionPanel}</aside>
      <main className="acp-main" ref={mainRef} id="desktop" data-desktop-section="desktop">
        <div className="acp-page-heading"><div><div className="acp-breadcrumb">{workspaceName} <span>/</span> {currentGroup ? <button onClick={() => selectGroup('all')}>相册</button> : '素材库'}</div>
          <h1>{currentGroup?.name || ({ all: '我的桌面', library: '全部相册', recent: '最近更新', unfiled: '未归类' }[view])}<span>{currentGroup ? groupAlbums(currentGroup, albums).length : albums.length} 个相册</span></h1></div>
          <div className="acp-heading-actions"><button className="acp-icon desktop-directory-trigger" title="相册目录" aria-label="打开相册目录" onClick={()=>setDirectoryOpen(true)}><IconListView /></button></div></div>
        <div className="acp-toolbar"><div className="acp-filters"><form className="acp-search" onSubmit={(event) => { event.preventDefault(); search(draftQuery); }}><IconSparkleAI />
            <input aria-label="搜索相册或相册集" placeholder="描述你想找的相册…" value={draftQuery} onChange={(event) => { setDraftQuery(event.target.value); if (!event.target.value) setQuery(''); }} />
            {draftQuery && <button className="acp-icon" type="button" title="清空搜索" onClick={() => { setDraftQuery(''); setQuery(''); }}><IconClose /></button>}
            <button className="acp-icon" type="submit" title="搜索" aria-label="搜索"><IconSearch /></button></form>
            {isLibraryView && toolbar}</div></div>
        {saveError && <div className="desktop-save-error" role="alert">{saveError}<Button onClick={onReload}>重新加载</Button></div>}
        <span className="desktop-save-status" role="status">{saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '未保存' : ''}</span>
        <div className="acp-content" key={`${selected}-${view}`}>
          {home ? <>
            {visiblePins.length > 0 && <section className="acp-pins-section" id="desktop-pins" data-desktop-section="pins"><span className="acp-section-spotlight" aria-hidden="true" /><div className="acp-section-heading"><div className="acp-section-name"><h2>我的置顶</h2><span className="acp-personal-label">仅自己可见</span></div><button className="acp-text-button" onClick={() => setPinsModal(true)}>管理 <IconSliders /></button></div>
              <div {...getSortListProps('pins')} className="acp-shortcuts-grid acp-pins-grid">{visiblePins.map((key) => {
                const [type, id] = key.split(':');
                if (type === 'group') { const group = groups.find((item) => item.id === id); return group ? <AlbumShortcut key={key} group={group} albums={albums} onSelect={selectGroup}
                  sortDragProps={getSortDragProps('pins', key)} sortDropProps={getSortDropProps('pins', key, group)} dropTargetId={dropTargetId} /> : null; }
                const album = albums.find((item) => String(item.id) === id);
                return album ? <AlbumShortcut key={key} album={album} albums={albums} onOpen={setOpened}
                  sortDragProps={getSortDragProps('pins', key, album)} sortDropProps={getSortDropProps('pins', key)} /> : null;
              })}</div></section>}
            {collectionsSection}
            {section('最近更新', [...filtered].sort((a,b)=>(Date.parse(b.updatedAt || b.createdAt)||0)-(Date.parse(a.updatedAt || a.createdAt)||0)).slice(0, 6), 'recent')}
          </> : currentGroup ? <><div className="acp-group-caption"><button className="acp-text-button" onClick={() => selectGroup('all')}><IconChevronLeft /> 返回相册</button>{currentGroup.kind === 'smart'
              ? <span className="acp-smart-rule"><IconSparkleAI />{currentGroup.rule.year || '全部年份'} · {groups.find((group) => group.id === currentGroup.rule.group)?.name || currentGroup.rule.text || '全部活动'} · 自动更新</span> : <span>小组织共用</span>}</div>{grid(collectionAlbums)}</>
            : <>{isLibraryView && groups.length > 0 && collectionsSection}{query && <div className="acp-search-summary"><div><IconSparkleAI /><span>“{query}”</span><span>{filtered.length} 个匹配相册</span></div><button className="acp-text-button" onClick={saveSearch}><IconStar /> 保存为智能相册集</button></div>}
              {section(view === 'unfiled' ? '未归类' : view === 'recent' ? '最近更新' : query ? '搜索结果' : '全部相册', view === 'recent' ? filtered.slice(0, 6) : filtered, 'results')}</>}
        </div>
        <span className="acp-section-spotlight" aria-hidden="true" />
      </main>
    </div>
    {currentGroup && <AlbumActionBar label="相册集底部操作" selecting={selectingAlbums} selectedCount={selectedAlbums.length}
      onSelect={() => { setSelectingAlbums(value => !value); setSelectedAlbumIds([]); setCollectionToolsOpen(false); }}
      onFunctions={() => setCollectionToolsOpen(true)} functionsOpen={collectionToolsOpen}
      primaryLabel={currentGroup.kind === 'smart' ? '智能相册集按规则收录' : canCreateAlbum ? '在当前相册集新建相册' : '新建相册不可用'}
      primaryHint="新建" primaryDisabled={!canCreateAlbum || !manualCollection}
      primaryProps={{ onClick: () => setCreatingInGroup({ id: currentGroup.id, name: currentGroup.name }) }} />}
    {currentGroup && selectingAlbums && createPortal(<div className="collection-selection-toolbar" role="toolbar" aria-label="所选相册操作">
      <Button disabled={!collectionAlbums.length} onClick={() => setSelectedAlbumIds(selectedAlbums.length === collectionAlbums.length ? [] : collectionAlbums.map(album => album.id))}>
        {collectionAlbums.length > 0 && selectedAlbums.length === collectionAlbums.length ? '取消全选' : '全选'}</Button>
      <Button icon={<IconStar />} disabled={!selectedAlbums.length} onClick={() => {
        const keys = selectedAlbums.map(album => `album:${album.id}`);
        setPins(old => keys.every(key => old.includes(key)) ? old.filter(key => !keys.includes(key)) : [...new Set([...old, ...keys])]);
      }}>{selectedAlbums.length > 0 && selectedAlbums.every(album => pins.includes(`album:${album.id}`)) ? '取消置顶' : '置顶'}</Button>
      {canEditAlbum && <Button icon={<IconEditStroked />} disabled={selectedAlbums.length !== 1} onClick={() => setEditingAlbum(selectedAlbums[0])}>编辑</Button>}
      {canOrganize && manualCollection && <Button icon={<IconClose />} disabled={!selectedAlbums.length} onClick={() => setRemovingAlbums(true)}>移出</Button>}
    </div>, document.body)}
    <MotionModal title={currentGroup?.name || '相册集功能'} visible={Boolean(currentGroup && collectionToolsOpen)} onCancel={() => setCollectionToolsOpen(false)}
      width={430} className="collection-tools-modal" footer={null}>
      <div className="collection-tools-list">
        {canCreateAlbum && manualCollection && <button onClick={() => { setCollectionToolsOpen(false); setCreatingInGroup({ id: currentGroup.id, name: currentGroup.name }); }}><IconPlus /><span>新建相册</span><IconChevronRight /></button>}
        {canOrganize && manualCollection && <button onClick={openAddAlbums}><IconSimilarStack /><span>添加已有相册</span><IconChevronRight /></button>}
        {canEditAlbum && <button disabled={selectedAlbums.length !== 1} onClick={() => { setCollectionToolsOpen(false); setEditingAlbum(selectedAlbums[0]); }}><IconEditStroked /><span>编辑所选相册</span><small>{selectedAlbums.length === 1 ? '' : '选择一个相册'}</small></button>}
        {canOrganize && <button onClick={editCollection}><IconListView /><span>编辑相册集</span><IconChevronRight /></button>}
        <button onClick={() => { setCollectionToolsOpen(false); editAppearance(currentGroup); }}><IconSliders /><span>我的外观</span><IconChevronRight /></button>
        <button onClick={() => { togglePin(`group:${currentGroup.id}`); setCollectionToolsOpen(false); }}><IconStar /><span>{pins.includes(`group:${currentGroup?.id}`) ? '取消置顶相册集' : '置顶相册集'}</span><IconChevronRight /></button>
      </div>
    </MotionModal>
    {creatingInGroup && <React.Suspense fallback={null}><CreateAlbumModal visible onClose={() => setCreatingInGroup(null)} createProject={createInCollection}
      onCreated={created => {
        if (!created?.id) return;
        setAlbums(old => old.map(album => album.id === Number(created.id) ? { ...album,
          name: created.projectName || created.name || created.title || album.name,
          count: Number(created.photoCount ?? created.photos?.length ?? album.count),
          image: resolveAssetUrl(created.coverThumbUrl || created.photos?.[0]?.thumbUrl || album.image) } : album));
      }} /></React.Suspense>}
    {editingAlbum && <React.Suspense fallback={null}><EditAlbumModal key={editingAlbum.id} album={editingAlbum} headers={scopeHeaders}
      onClose={() => setEditingAlbum(null)} onSaved={updated => {
        setAlbums(old => old.map(album => album.id === updated.id ? { ...album, name: updated.name, title: updated.title,
          description: updated.description, eventDate: updated.eventDate, year: updated.year, updatedAt: updated.updatedAt } : album));
        setEditingAlbum(null); setNotice('相册已保存');
      }} /></React.Suspense>}
    <MotionModal title={`添加到「${currentGroup?.name || ''}」`} visible={Boolean(addingAlbums && manualCollection)} onCancel={() => setAddingAlbums(false)} width={560} footer={null}>
      <div className="collection-add-albums">
        <label className="acp-search"><IconSearch /><input aria-label="查找已有相册" placeholder="搜索相册" value={addQuery} onChange={event => { setAddQuery(event.target.value); setAddLimit(60); }} /></label>
        <div className="collection-album-picker">{availableToAdd.slice(0, addLimit).map(album => <label key={album.id}>
          <input type="checkbox" aria-label={`添加相册 ${album.name}`} checked={addAlbumIds.includes(album.id)} onChange={() => setAddAlbumIds(old => old.includes(album.id) ? old.filter(id => id !== album.id) : [...old, album.id])} />
          {album.image ? <img src={album.image} alt="" loading="lazy" decoding="async" /> : <IconSimilarStack />}
          <span><strong>{album.name}</strong><small>{album.groups.length ? groups.filter(group => album.groups.includes(group.id)).map(group => group.name).join('、') : '未归类'}</small></span>
        </label>)}{!availableToAdd.length && <p className="acp-empty">没有可添加的相册</p>}
          {availableToAdd.length > addLimit && <Button onClick={() => setAddLimit(value => value + 60)}>加载更多</Button>}</div>
        <div className="acp-drop-confirm-actions"><Button onClick={() => setAddingAlbums(false)}>取消</Button><Button type="primary" theme="neu" disabled={!addAlbumIds.length} onClick={addExistingAlbums}>确认加入 {addAlbumIds.length || ''}</Button></div>
      </div>
    </MotionModal>
    <MotionModal title="移出相册集" visible={Boolean(removingAlbums && manualCollection)} onCancel={() => setRemovingAlbums(false)} width={460} footer={null}>
      <div className="acp-form"><p>将所选 {selectedAlbums.length} 个相册移出「{currentGroup?.name}」？相册、照片和其他归属都会保留。</p>
        <div className="acp-drop-confirm-actions"><Button onClick={() => setRemovingAlbums(false)}>取消</Button><Button type="primary" theme="neu" disabled={!selectedAlbums.length} onClick={removeSelectedAlbums}>确认移出</Button></div></div>
    </MotionModal>
    {notice && <div className="acp-toast" role="status">{notice}</div>}
    <MotionModal title="相册目录" visible={directoryOpen} onCancel={() => setDirectoryOpen(false)} width={320} className="acp-directory-modal" footer={null}>{directory}{suggestionPanel}</MotionModal>
    <MotionModal title={alreadyInTarget ? '已在此相册集中' : '确认加入相册集'} visible={Boolean(dropAlbum && dropGroup)} onCancel={() => setPendingDrop(null)} width={520} className="acp-drop-modal" footer={null}>
      {dropAlbum && dropGroup && <div className="acp-drop-confirm">
        <div className="acp-drop-summary"><img src={dropAlbum.image} alt="" /><div><span>相册</span><strong>{dropAlbum.name}</strong><small>{dropAlbum.count} 张照片</small></div></div>
        <div className="acp-drop-destination"><GroupSymbol group={dropGroup} /><div><span>{alreadyInTarget ? '所在相册集' : '加入相册集'}</span><strong>{dropGroup.name}</strong></div></div>
        {alreadyInTarget ? <p>这个相册已经在「{dropGroup.name}」中，无需重复添加。</p>
          : otherDropGroups.length > 0 ? <div className="acp-drop-warning" role="note"><strong>已在其他相册集中</strong><ul>{otherDropGroups.map((group) => <li key={group.id}>{group.name}</li>)}</ul>
            <p>确认后保留以上归属，同时加入「{dropGroup.name}」。不会复制或移动照片。</p></div>
            : <p>确认后将此相册加入「{dropGroup.name}」，不会复制或移动照片。</p>}
        <div className="acp-drop-confirm-actions"><Button onClick={() => setPendingDrop(null)}>{alreadyInTarget ? '我知道了' : '取消'}</Button>
          {!alreadyInTarget && <Button type="primary" theme="neu" onClick={confirmDrop}>确认加入</Button>}</div>
      </div>}
    </MotionModal>
    <MotionModal title={editingGroup ? '编辑相册集' : '新建相册集'} visible={newGroup} onCancel={() => setNewGroup(false)} footer={null} width={460}>
      <form className="acp-form" onSubmit={(event) => { event.preventDefault(); createGroup(); }}><label>名称<input autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="例如：2026 迎新季" maxLength={30} /></label><Button type="primary" theme="neu" onClick={createGroup} disabled={!groupName.trim()}>{editingGroup ? '保存名称' : '创建相册集'}</Button>{editingGroup && <Button onClick={()=>{setNewGroup(false);setDeletingGroup(editingGroup)}}>删除相册集</Button>}</form>
    </MotionModal>
    <MotionModal title="删除相册集" visible={Boolean(deletingGroup)} onCancel={()=>setDeletingGroup(null)} width={460} footer={null}>
      <div className="acp-form"><p>删除「{deletingGroup?.name}」仅移除归类，不会删除相册或照片。</p><Button type="primary" theme="neu" onClick={()=>{
        const id=deletingGroup.id;setGroups(old=>old.filter(g=>g.id!==id));setAlbums(old=>old.map(a=>({...a,groups:a.groups.filter(g=>g!==id)})));
        setPins(old=>old.filter(key=>key!==`group:${id}`));if(selected===id)selectGroup('all');setDeletingGroup(null);setEditingGroup(null);
      }}>确认删除相册集</Button></div>
    </MotionModal>
    <MotionModal title="整理到相册集" visible={Boolean(organizing)} onCancel={() => setOrganizing(null)} width={460} footer={null}>
      <div className="acp-form"><strong>{organizing?.name}</strong><div className="acp-checks">{groups.filter((group) => group.kind !== 'smart').map((group) => <label key={group.id}><input type="checkbox" checked={checked.includes(group.id)} onChange={(event) => setChecked((old) => event.target.checked ? [...old, group.id] : old.filter((id) => id !== group.id))} /><span>{group.name}</span></label>)}</div>
        <Button type="primary" theme="neu" onClick={() => { setAlbums((old) => old.map((album) => album.id === organizing.id ? { ...album, groups: checked } : album)); setOrganizing(null); setNotice('已更新相册归类'); }}>保存</Button></div>
    </MotionModal>
    <MotionModal title="我的置顶" visible={pinsModal} onCancel={() => setPinsModal(false)} width={580} footer={null}>
      <div className="acp-personal-pins"><div className="acp-pins-order">{pins.map((key, index) => <div key={key}><IconStar /><strong>{pinOptions.find((item) => item.key === key)?.name}</strong>
        <button className="acp-icon" title="向前移动" aria-label={`向前移动 ${index + 1}`} disabled={index === 0} onClick={() => setPins((old) => { const next = [...old]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><IconChevronLeft /></button>
        <button className="acp-icon" title="向后移动" aria-label={`向后移动 ${index + 1}`} disabled={index === pins.length - 1} onClick={() => setPins((old) => { const next = [...old]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}><IconChevronRight /></button><button className="acp-icon" title="取消置顶" aria-label={`取消置顶项目 ${index + 1}`} onClick={() => togglePin(key)}><IconClose /></button></div>)}</div>
        <div className="acp-checks">{pinOptions.filter((item) => !pins.includes(item.key)).map((item) => <label key={item.key}><input type="checkbox" checked={false} onChange={() => togglePin(item.key)} /><span>{item.name}</span><small>{item.type}</small></label>)}</div></div>
    </MotionModal>
    <MotionModal title={`调整${orderNames[orderModal] || ''}顺序`} visible={Boolean(orderModal)} onCancel={() => setOrderModal(null)} width={480} className="acp-order-modal" footer={null}>
      {orderModal && <div className="acp-pins-order">{orderLists[orderModal].map((item, index, items) => {
        const name = orderModal === 'collections' ? item.name : albums.find((album) => album.id === item.id)?.name;
        return <div key={item.id}><strong>{name}</strong>
          <button className="acp-icon" title="向前移动" aria-label={`向前移动 ${name}`} disabled={index === 0} onClick={() => moveOne(orderModal, String(item.id), -1)}><IconChevronLeft /></button>
          <button className="acp-icon" title="向后移动" aria-label={`向后移动 ${name}`} disabled={index === items.length - 1} onClick={() => moveOne(orderModal, String(item.id), 1)}><IconChevronRight /></button></div>;
      })}</div>}
    </MotionModal>
    <MotionModal title="我的相册集外观" visible={Boolean(appearanceGroup)} onCancel={() => setAppearance(null)} width={540} footer={null}>
      {appearanceGroup && <div className="acp-appearance-form"><div className="acp-appearance-heading"><strong>{appearanceGroup.name}</strong><span>仅自己可见</span></div>
        <div className="acp-appearance-colors"><div className="acp-color-options" role="radiogroup" aria-label="容器底色">{COLLECTION_COLORS.map((color) => <button key={color.color} role="radio" aria-checked={appearance.color === color.color} aria-label={color.name} title={color.name} style={{ background: color.color }} onClick={() => setAppearance((old) => ({ ...old, color: color.color }))} />)}</div>
          <label className="acp-custom-color"><input type="color" aria-label="自定义底色" value={appearance.color} onChange={(event) => setAppearance((old) => ({ ...old, color: event.target.value }))} /><span>自定义</span></label></div>
        <div className="acp-appearance-preview"><CollectionCard group={appearanceGroup} albums={albums} surfaceColor={appearance.color} preview /></div>
        <div className="acp-appearance-actions"><Button onClick={() => setAppearance((old) => ({ ...old, color: DEFAULT_COLLECTION_COLOR }))} disabled={appearance.color === DEFAULT_COLLECTION_COLOR}>恢复默认</Button><Button type="primary" theme="neu" onClick={saveAppearance}>保存外观</Button></div></div>}
    </MotionModal>
    <MotionModal title="整理建议" visible={review} onCancel={() => setReview(false)} width={650} footer={null}>
      <div className="acp-suggestion-review">{suggestions.map((item) => { const album = albums.find((entry) => entry.id === item.id), group = groups.find((entry) => entry.id === item.group); return <label className="acp-suggestion-row" key={item.id}><input type="checkbox" checked={accepted.includes(item.id)} onChange={(event) => setAccepted((old) => event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))} />
        <img src={album.image} alt="" /><span><strong>建议将「{album.name}」相册加入「{group.name}」相册集</strong><small>{item.reason}</small></span></label>; })}
        <div className="acp-review-actions"><Button onClick={() => { setDismissed((old) => [...old, ...suggestions.map((item) => item.id)]); setReview(false); }}>暂时跳过</Button><Button type="primary" theme="neu" disabled={!accepted.length} onClick={() => {
          setAlbums((old) => old.map((album) => { const suggestion = suggestions.find((item) => item.id === album.id && accepted.includes(item.id)); return suggestion ? { ...album, groups: [...new Set([...album.groups, suggestion.group])] } : album; }));
          setReview(false); setNotice('已确认归类，置顶顺序保持不变'); }}>确认归类 {accepted.filter((id) => suggestions.some((item) => item.id === id)).length} 个</Button></div></div>
    </MotionModal>
  </div>;
}

export default function AlbumDesktop({ currentUser, workspaceInfo, onOpen, sort, dateFilter, toolbar, projectPreviews = [], importStatuses = {} }) {
  const [initial, setInitial] = React.useState(null);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let active=true;setInitial(null);setError('');
    loadAlbumDesktop().then(data=>{if(active)setInitial(data)}).catch(err=>{if(active)setError(err?.message || '桌面加载失败')});
    return()=>{active=false};
  },[currentUser?.id,workspaceInfo?.activeUnitId,reload]);
  if(error)return <div className="desktop-load-state" role="alert"><p>{error}</p><Button onClick={()=>setReload(n=>n+1)}>重新加载</Button></div>;
  if(!initial)return <div className="desktop-load-state" role="status">正在加载我的桌面…</div>;
  const workspaceName=workspaceInfo?.units?.find(unit=>Number(unit.id)===Number(workspaceInfo.activeUnitId))?.name || '历史相册';
  return <DesktopContent key={`${currentUser.id}-${workspaceInfo?.activeUnitId || 'legacy'}-${reload}`} initial={initial} userId={String(currentUser.id)} workspaceName={workspaceName}
    organizationName={currentUser.organizationName || currentUser.organization_name || '当前组织'} onOpen={onOpen} onReload={()=>setReload(n=>n+1)} sort={sort} dateFilter={dateFilter} toolbar={toolbar} projectPreviews={projectPreviews} importStatuses={importStatuses} />;
}

