import React from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconMoreStroked, IconTrash } from './ui/icons';
import './AlbumActionBar.css';

const notchPath = 'M30 0H118C128 0 130 9 134 18C140 32 154 38 170 38C186 38 200 32 206 18C210 9 212 0 222 0H310A30 30 0 0 1 340 30A30 30 0 0 1 310 60H30A30 30 0 0 1 0 30A30 30 0 0 1 30 0Z';
const notchMask = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 60" preserveAspectRatio="none"><path fill="white" d="${notchPath}"/></svg>`)}")`;

// Matching path commands let the capsule become a notch without swapping surfaces.
function adaptiveOutline(expanded) {
  const r = expanded ? 30 / 340 : 26 / 128;
  const depth = expanded ? 1 : 0;
  return `M${r} 0H.347 C.376 0 .382 ${.15 * depth} .394 ${.3 * depth} C.412 ${.533 * depth} .453 ${.633 * depth} .5 ${.633 * depth} C.547 ${.633 * depth} .588 ${.533 * depth} .606 ${.3 * depth} C.618 ${.15 * depth} .624 0 .653 0 H${1 - r} A${r} .5 0 0 1 1 .5 A${r} .5 0 0 1 ${1 - r} 1 H${r} A${r} .5 0 0 1 0 .5 A${r} .5 0 0 1 ${r} 0Z`;
}

export default function AlbumActionBar({
  label = '相册底部操作', selecting, selectedCount = 0, onSelect, onFunctions, functionsOpen,
  primaryLabel, primaryHint, primaryDisabled = false, primaryProps = {}, dragActive = false, hovered = false,
  variant = 'joined', inactive = false, onDelete, deleteDisabled = false,
}) {
  const clipId = `album-dock-${React.useId().replace(/:/g, '')}`;
  const albumDock = variant === 'adaptive-album';
  const adaptive = variant === 'adaptive' || albumDock;
  const expanded = adaptive && (selecting || albumDock);
  const previousSelection = React.useRef(selecting);
  const [morphing, setMorphing] = React.useState(false);
  React.useEffect(() => {
    const changed = previousSelection.current !== selecting;
    previousSelection.current = selecting;
    if (variant !== 'adaptive' || !changed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMorphing(false); return undefined;
    }
    setMorphing(true);
    const timer = setTimeout(() => setMorphing(false), 640);
    return () => clearTimeout(timer);
  }, [variant, selecting]);
  const outline = adaptiveOutline(expanded);
  return createPortal(<nav className={`detail-bottom-nav${variant === 'notched' ? ' detail-bottom-nav--notched' : ''}${adaptive ? ' detail-bottom-nav--adaptive' : ''}${expanded ? ' is-expanded' : ''}${morphing ? ' is-morphing' : ''}${adaptive && selecting ? ' is-selecting' : ''}${dragActive ? ' is-drag-active' : ''}`}
    aria-label={label} inert={inactive ? '' : undefined} aria-hidden={inactive || undefined}
    style={{ visibility: inactive ? 'hidden' : undefined, '--album-dock-mask': variant === 'notched' ? notchMask : undefined,
      '--album-dock-clip': adaptive ? `url(#${clipId})` : undefined, '--album-dock-outline': adaptive ? `path('${outline}')` : undefined }}>
    {adaptive && <>
      <svg className="album-dock-defs" aria-hidden="true"><defs><clipPath id={clipId} clipPathUnits="objectBoundingBox"><path className="album-dock-outline" d={outline} /></clipPath></defs></svg>
      <span className="album-dock-morph-surface" aria-hidden="true">
        <svg className="album-dock-shadow" viewBox="0 0 1 1" preserveAspectRatio="none"><path className="album-dock-outline" d={outline} vectorEffect="non-scaling-stroke" /></svg>
        <svg className="album-dock-rim" viewBox="0 0 1 1" preserveAspectRatio="none"><path className="album-dock-outline" d={outline} vectorEffect="non-scaling-stroke" /><path className="album-dock-outline album-dock-glint" d={outline} vectorEffect="non-scaling-stroke" /></svg>
      </span>
    </>}
    {variant === 'notched' && <span className="detail-bottom-nav-surface" aria-hidden="true">
      <svg viewBox="0 0 340 60" preserveAspectRatio="none"><path d={notchPath} vectorEffect="non-scaling-stroke" /></svg>
    </span>}
    <button type="button" className={`detail-bottom-nav-item detail-bottom-nav-item--select${selecting ? ' is-active' : ''}`}
      onClick={onSelect} aria-pressed={Boolean(selecting)} aria-label={adaptive && selecting ? `完成选择${selectedCount ? `，已选 ${selectedCount} 项` : ''}` : undefined}>
      <span className="detail-bottom-nav-icon detail-bottom-nav-icon--select" aria-hidden="true">{selecting ? '\u2713' : ''}</span>
      <span>{selecting ? (adaptive ? '完成' : (selectedCount ? `已选 ${selectedCount}` : '完成')) : '选择'}</span>
      {adaptive && selecting && selectedCount > 0 && <span className="album-dock-count">{selectedCount}</span>}
    </button>
    <button {...primaryProps} type="button" disabled={primaryDisabled} aria-label={primaryLabel}
      data-glass={adaptive ? 'floating' : undefined}
      title={primaryProps.title || primaryLabel}
      className={`detail-bottom-upload${primaryDisabled ? ' is-disabled' : ''}${dragActive ? ' is-drag-active' : ''}${hovered ? ' is-hovered' : ''}`}>
      <IconPlus /><span className="detail-bottom-upload-hint">{primaryHint}</span>
    </button>
    {adaptive ? <button type="button" className="detail-bottom-nav-item detail-bottom-nav-item--delete"
      onClick={onDelete} disabled={!selecting || !selectedCount || deleteDisabled || !onDelete}
      tabIndex={selecting ? undefined : -1} aria-hidden={!selecting || undefined} aria-label="删除所选内容"
      title={selectedCount ? '删除所选内容' : '请先选择内容'}>
      <span className="detail-bottom-nav-icon" aria-hidden="true"><IconTrash /></span><span>删除</span>
    </button> : <button type="button" className={`detail-bottom-nav-item detail-bottom-nav-item--actions${functionsOpen ? ' is-active' : ''}`}
      onClick={onFunctions} aria-expanded={Boolean(functionsOpen)} aria-label="打开功能">
      <span className="detail-bottom-nav-icon" aria-hidden="true"><IconMoreStroked /></span><span>功能</span>
    </button>}
    {albumDock && <button type="button" className={`detail-bottom-nav-item detail-bottom-nav-item--functions${functionsOpen ? ' is-active' : ''}`}
      onClick={onFunctions} aria-expanded={Boolean(functionsOpen)} aria-label="打开功能"
      tabIndex={selecting ? -1 : undefined} aria-hidden={selecting || undefined} disabled={selecting}>
      <span className="detail-bottom-nav-icon" aria-hidden="true"><IconMoreStroked /></span><span>功能</span>
    </button>}
  </nav>, document.body);
}
