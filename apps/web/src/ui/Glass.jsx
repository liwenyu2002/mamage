import React from 'react';
import { IconSliders } from './icons';
import { GLASS_APPEARANCE_KEY, GLASS_APPEARANCE_EVENT, readGlassAppearance, normalizeGlassAppearance,
  applyGlassAppearance, saveGlassAppearance } from './glassAppearance';

export function GlassReveal({ open, children, className = '' }) {
  return <div className={`glass-reveal ${className}`} data-open={Boolean(open)} aria-hidden={!open} inert={!open ? '' : undefined}>
    {children}
  </div>;
}

export function GlassAccountMenu({ label, triggerContent, compactContent, open: controlledOpen, onOpenChange, children }) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = value => { const next = typeof value === 'function' ? value(open) : value; setLocalOpen(next); onOpenChange?.(next); };
  const compact = compactContent != null;
  React.useEffect(() => setLocalOpen(false), [compact]);
  const [headHeight, setHeadHeight] = React.useState(46);
  const root = React.useRef(null);
  const trigger = React.useRef(null);
  const id = React.useId();
  React.useLayoutEffect(() => {
    // Reserve only the trigger's height; unfolding must not push the page down.
    const measure = () => setHeadHeight(trigger.current?.offsetHeight || 46);
    const observer = new ResizeObserver(measure);
    observer.observe(trigger.current);
    measure();
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const panel = <div className="glass-unfold-body" id={id} aria-hidden={!open} inert={!open ? '' : undefined}>
    <div><div className="mamage-user-menu-panel" data-glass={compact ? 'readable' : undefined} onClick={event => {
      if (event.target.closest('button')) setOpen(false);
    }}>
      {compact ? <div className="mamage-account-summary">{triggerContent}</div> : null}
      {children}
    </div></div>
  </div>;
  return <div className="mamage-user-menu" data-open={open} data-compact={compact} ref={root} style={{ '--account-head-height': `${headHeight}px` }}>
    <div className="mamage-account-surface" data-glass={open && !compact ? 'readable' : 'clear'}>
      <button type="button" className="mamage-user-chip" ref={trigger} aria-label={label}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{compact ? compactContent : triggerContent}</button>
      {!compact ? panel : null}
    </div>
    {compact ? panel : null}
  </div>;
}

export function useViewerAppearance() {
  const [appearance, setAppearance] = React.useState(() => readGlassAppearance());
  React.useEffect(() => {
    const sync = event => {
      if (event.type === 'storage' && event.key !== GLASS_APPEARANCE_KEY && event.key !== null) return;
      const next = event.type === GLASS_APPEARANCE_EVENT ? normalizeGlassAppearance(event.detail) : readGlassAppearance();
      applyGlassAppearance(next);
      setAppearance(next);
    };
    window.addEventListener('storage', sync);
    window.addEventListener(GLASS_APPEARANCE_EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(GLASS_APPEARANCE_EVENT, sync); };
  }, []);
  const update = patch => {
    setAppearance(saveGlassAppearance({ ...appearance, ...patch }));
  };
  return { appearance, update, surfaceProps: { 'data-glass-theme': appearance.dark ? 'dark' : 'light', style: { '--glass-blur': `${appearance.blur}px` } } };
}

export function ViewerDisplaySettings({ appearance, onChange, darkLabel = '深色外观', compact = false, open: controlledOpen, onOpenChange }) {
  const [localOpen, setLocalOpen] = React.useState(false);
  React.useEffect(() => setLocalOpen(false), [compact]);
  const open = controlledOpen ?? localOpen;
  const setOpen = value => { const next = typeof value === 'function' ? value(open) : value; setLocalOpen(next); onOpenChange?.(next); };
  const root = React.useRef(null);
  const trigger = React.useRef(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const button = <button type="button" ref={trigger} className="glass-settings-trigger" data-glass={compact ? 'clear' : undefined}
    aria-label="显示设置" title="显示设置" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><IconSliders /></button>;
  return <div className={`glass-settings-slot${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`} ref={root}>
    {compact ? button : null}
    <div className={`glass-settings${open ? ' is-open' : ''}`} data-glass={open ? 'readable' : 'clear'}>
      <div className="glass-settings-head">
        <strong aria-hidden={!open}>{open ? '显示设置' : ''}</strong>
        {!compact ? button : null}
      </div>
      <div className="glass-settings-body" id={id} aria-hidden={!open} inert={!open ? '' : undefined}>
        <div><div className="glass-settings-fields">
          <label>{darkLabel}<input type="checkbox" checked={appearance.dark} onChange={event => onChange({ dark: event.target.checked })} /></label>
          <label htmlFor={`${id}-blur`}>玻璃模糊<output>{appearance.blur}px</output></label>
          <input id={`${id}-blur`} type="range" min="9" max="28" value={appearance.blur} onChange={event => onChange({ blur: Number(event.target.value) })} />
        </div></div>
      </div>
    </div>
  </div>;
}
