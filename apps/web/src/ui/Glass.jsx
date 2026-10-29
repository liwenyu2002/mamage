import React from 'react';
import { IconSliders } from './icons';

export function GlassReveal({ open, children, className = '' }) {
  return <div className={`glass-reveal ${className}`} data-open={Boolean(open)} aria-hidden={!open} inert={!open ? '' : undefined}>
    {children}
  </div>;
}

export function GlassAccountMenu({ label, triggerContent, children }) {
  const [open, setOpen] = React.useState(false);
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
  return <div className="mamage-user-menu" data-open={open} ref={root} style={{ '--account-head-height': `${headHeight}px` }}>
    <div className="mamage-account-surface" data-glass="clear">
      <button type="button" className="mamage-user-chip" ref={trigger} aria-label={label}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{triggerContent}</button>
      <div className="glass-unfold-body" id={id} aria-hidden={!open} inert={!open ? '' : undefined}>
        <div><div className="mamage-user-menu-panel" onClick={event => {
          if (event.target.closest('button')) setOpen(false);
        }}>{children}</div></div>
      </div>
    </div>
  </div>;
}

const VIEWER_APPEARANCE_KEY = 'mamage-viewer-appearance';
export function useViewerAppearance() {
  const [appearance, setAppearance] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEWER_APPEARANCE_KEY));
      return { dark: saved?.dark === true, blur: Number.isFinite(saved?.blur) ? Math.max(9, Math.min(28, saved.blur)) : 20 };
    } catch { return { dark: false, blur: 20 }; }
  });
  React.useEffect(() => {
    const sync = event => {
      if (event.type === 'storage' && event.key !== VIEWER_APPEARANCE_KEY) return;
      try {
        const saved = JSON.parse(localStorage.getItem(VIEWER_APPEARANCE_KEY));
        setAppearance({ dark: saved?.dark === true, blur: Number.isFinite(saved?.blur) ? Math.max(9, Math.min(28, saved.blur)) : 20 });
      } catch { /* Ignore unavailable storage. */ }
    };
    window.addEventListener('storage', sync);
    window.addEventListener('mamage-appearance-change', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('mamage-appearance-change', sync); };
  }, []);
  const update = patch => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    try { localStorage.setItem(VIEWER_APPEARANCE_KEY, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
    window.dispatchEvent(new Event('mamage-appearance-change'));
  };
  return { appearance, update, surfaceProps: { 'data-glass-theme': appearance.dark ? 'dark' : 'light', style: { '--glass-blur': `${appearance.blur}px` } } };
}

export function ViewerDisplaySettings({ appearance, onChange, darkLabel = '深色外观' }) {
  const [open, setOpen] = React.useState(false);
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
  return <div className={`glass-settings-slot${open ? ' is-open' : ''}`} ref={root}>
    <div className={`glass-settings${open ? ' is-open' : ''}`} data-glass="clear">
      <div className="glass-settings-head">
        <strong aria-hidden={!open}>{open ? '显示设置' : ''}</strong>
        <button type="button" ref={trigger} className="glass-settings-trigger" aria-label="显示设置" title="显示设置" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><IconSliders /></button>
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
