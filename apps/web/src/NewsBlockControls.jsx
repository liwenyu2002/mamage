import React from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconChevronRight, IconTrash, IconSparkleAI, IconMoreStroked, IconSimilarStack, IconInfoEdit } from './ui/icons';
import { floatingPosition } from './utils/newsEditorSelection';
import { editorPhotoGroups } from './utils/newsEditorModel';

const formats = [{ value: 'paragraph', symbol: 'T', label: '正文' }, { value: 'h1', symbol: 'H1', label: '一级标题' },
  { value: 'h2', symbol: 'H2', label: '二级标题' }, { value: 'h3', symbol: 'H3', label: '三级标题' }];

export default function NewsBlockControls({ editorRef, revision, onAction, children }) {
  const frame = React.useRef(null), panel = React.useRef(null);
  const [layout, setLayout] = React.useState({ doc: null, blocks: [], end: 0 });
  const [hovered, setHovered] = React.useState(-1), [menu, setMenu] = React.useState(null);
  const [position, setPosition] = React.useState(null);
  const measure = React.useCallback(() => {
    const editor = editorRef.current, canvas = frame.current;
    if (!editor || !canvas) return;
    const rect = canvas.getBoundingClientRect(), scale = rect.width / canvas.offsetWidth || 1;
    const blocks = [];
    const groups = editorPhotoGroups(editor.state.doc);
    editor.state.doc.forEach((node, pos, index) => {
      const dom = editor.nodeDOM(pos); if (!(dom instanceof Element)) return;
      const bounds = dom.getBoundingClientRect();
      const group = groups.find(item => item.items.some(photo => photo.pos === pos));
      const imageIndex = group?.items.findIndex(item => item.pos === pos);
      const header = imageIndex === 0 && dom.previousElementSibling?.classList.contains('news-edit-gallery-header') ? dom.previousElementSibling : null;
      blocks.push({ pos, index, top: (bounds.top - rect.top) / scale, bottom: (bounds.bottom - rect.top) / scale,
        left: (bounds.left - rect.left) / scale, width: bounds.width / scale,
        galleryId: group?.id, groupStart: imageIndex === 0, groupTop: header ? (header.getBoundingClientRect().top - rect.top) / scale : null,
        canSplitBefore: imageIndex > 0, canSplitAfter: imageIndex >= 0 && imageIndex < group.items.length - 1,
        hasCaption: node.type.name === 'photo' && Boolean(node.textContent.trim()),
        style: node.type.name === 'heading' ? `h${node.attrs.depth}` : node.type.name === 'photo' ? 'photo' : 'paragraph' });
    });
    const doc = editor.state.doc;
    setLayout(previous => previous.doc === doc && JSON.stringify(previous.blocks) === JSON.stringify(blocks)
      ? previous : { doc, blocks, end: doc.content.size });
    setMenu(previous => previous && previous.doc !== doc ? null : previous);
  }, [editorRef]);
  React.useLayoutEffect(() => {
    let queued;
    const schedule = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(measure); };
    schedule();
    const observer = new ResizeObserver(schedule); observer.observe(frame.current);
    frame.current.addEventListener('load', schedule, true);
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(queued); observer.disconnect(); frame.current?.removeEventListener('load', schedule, true); window.removeEventListener('resize', schedule); };
  }, [measure]);
  React.useLayoutEffect(() => { measure(); }, [revision, measure]);
  React.useLayoutEffect(() => {
    if (!menu) { setPosition(null); return undefined; }
    const place = () => {
      const viewport = window.visualViewport;
      setPosition(floatingPosition(menu.anchor, { width: 244, height: panel.current?.offsetHeight || 326 }, {
        width: viewport?.width || innerWidth, height: viewport?.height || innerHeight,
        left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      }));
    };
    place();
    const outside = event => {
      if (!panel.current?.contains(event.target) && !frame.current?.querySelector(`[data-news-block-handle="${menu.index}"]`)?.contains(event.target)) setMenu(null);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setMenu(null);
      frame.current?.querySelector(`[data-news-block-handle="${menu.index}"]`)?.focus({ preventScroll: true });
    };
    const scroll = event => {
      if (panel.current?.contains(event.target)) return;
      const bounds = frame.current?.querySelector(`[data-news-block-handle="${menu.index}"]`)?.getBoundingClientRect();
      if (!bounds || bounds.bottom < 0 || bounds.top > innerHeight) { setMenu(null); return; }
      setMenu(previous => previous ? { ...previous, anchor: { x: bounds.left, top: bounds.top, bottom: bounds.bottom } } : null);
    };
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place); };
  }, [menu]);
  const act = (action, value) => { onAction(action, menu, value); setMenu(null); };
  const gaps = layout.blocks.flatMap((block, index) => {
    if (block.style === 'photo' && !block.groupStart) return [];
    const top = block.groupTop ?? block.top;
    const previousBottom = index ? Math.max(...layout.blocks.slice(0, index).map(item => item.bottom)) : top - 24;
    return [{ index, pos: block.pos, top: (previousBottom + top) / 2, height: Math.max(4, Math.min(24, top - previousBottom)) }];
  });
  if (layout.blocks.length) gaps.push({ index: layout.blocks.length, pos: layout.end, top: Math.max(...layout.blocks.map(block => block.bottom)) + 12, height: 20 });
  return <div ref={frame} className="news-edit-canvas" onPointerMove={event => {
    const block = event.target.closest('[data-news-index]');
    if (block && frame.current.contains(block)) setHovered(Number(block.dataset.newsIndex));
  }} onPointerLeave={() => setHovered(-1)}>
    {children}
    {layout.blocks.map(block => <div key={block.index} className={`news-block-gutter${block.style === 'photo' ? ' is-photo' : ''}`}
      style={block.style === 'photo' ? { top: block.top + 4, left: block.left + 4, height: 28 } : { top: block.top, height: Math.max(28, block.bottom - block.top) }}>
      <button type="button" className="news-block-handle" data-news-block-handle={block.index}
        data-visible={hovered === block.index || menu?.index === block.index ? 'true' : undefined}
        aria-label={`编辑第 ${block.index + 1} 个内容块`} title={block.style === 'photo' ? '图片与图题操作' : '段落样式与操作'} aria-haspopup="dialog" aria-expanded={menu?.index === block.index}
        onPointerDown={event => event.preventDefault()} onClick={event => {
          if (menu?.index === block.index) { setMenu(null); return; }
          const bounds = event.currentTarget.getBoundingClientRect();
          const target = { ...block, doc: layout.doc, anchor: { x: bounds.left, top: bounds.top, bottom: bounds.bottom } };
          onAction('menu', target); setMenu(target);
        }}><span>{block.style === 'photo' ? <IconSimilarStack /> : formats.find(format => format.value === block.style)?.symbol || 'T'}</span><IconMoreStroked /></button>
    </div>)}
    {gaps.map(gap => <div key={gap.index} className="news-block-insert" data-news-insert-index={gap.index}
      style={{ top: gap.top - gap.height / 2, height: gap.height }}>
      <button type="button" aria-label={`在第 ${gap.index + 1} 个位置插入段落`} title="插入段落"
        onPointerDown={event => event.preventDefault()} onClick={() => { onAction('insert', { pos: gap.pos, doc: layout.doc }); setMenu(null); }}><IconPlus /></button>
    </div>)}
    {menu ? createPortal(<div ref={panel} className="news-block-menu" role="dialog" aria-label="段落操作"
      style={position || { visibility: 'hidden', position: 'fixed', top: 0, left: 0, width: 244 }}>
      {menu.style !== 'photo' ? <div className="news-block-formats" role="group" aria-label="段落样式">
        {formats.map(format => <button key={format.value} type="button" aria-label={format.label} title={format.label}
          aria-pressed={menu.style === format.value} onClick={() => act('format', format.value)}>{format.symbol}</button>)}
      </div> : null}
      <div className="news-block-menu-actions">
        {menu.style === 'photo' ? <button type="button" onClick={() => act(menu.hasCaption ? 'removeCaption' : 'addCaption')}>
          <IconInfoEdit /><span>{menu.hasCaption ? '移除图题' : '添加图题'}</span></button> : null}
        {menu.style === 'photo' && menu.canSplitBefore ? <button type="button" onClick={() => act('splitBefore')}><IconSimilarStack /><span>从此图开始新组</span></button> : null}
        {menu.style === 'photo' && menu.canSplitAfter ? <button type="button" onClick={() => act('splitAfter')}><IconSimilarStack /><span>在此图后拆分</span></button> : null}
        <button type="button" onClick={() => act('ai')}><IconSparkleAI /><span>AI 辅助</span></button>
        <button type="button" onClick={() => act('insertBefore')}><IconPlus /><span>在上方插入段落</span></button>
        <button type="button" onClick={() => act('insertAfter')}><IconPlus /><span>在下方插入段落</span></button>
        <button type="button" onClick={() => act('photo')}><IconPlus /><span>在下方插入图片</span></button>
      </div>
      <div className="news-block-menu-actions news-block-menu-divider">
        <button type="button" aria-label={`上移内容块 ${menu.index + 1}`} disabled={menu.index === 0} onClick={() => act('move', -1)}>
          <IconChevronRight style={{ transform: 'rotate(-90deg)' }} /><span>上移</span></button>
        <button type="button" aria-label={`下移内容块 ${menu.index + 1}`} disabled={menu.index === layout.blocks.length - 1} onClick={() => act('move', 1)}>
          <IconChevronRight style={{ transform: 'rotate(90deg)' }} /><span>下移</span></button>
        <button type="button" className="news-block-remove" aria-label={`移除内容块 ${menu.index + 1}`} onClick={() => act('delete')}><IconTrash /><span>{menu.style === 'photo' ? '删除图片' : '删除段落'}</span></button>
      </div>
    </div>, document.body) : null}
  </div>;
}
