import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Clapperboard, FileText } from 'lucide-react';
import './MediaStudioNav.css';

function menuPosition(trigger) {
  const rect = trigger?.getBoundingClientRect();
  if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return null;
  const width = Math.min(222, window.innerWidth - 16);
  const below = window.innerHeight - rect.bottom - 14;
  const above = rect.top - 14;
  const flip = below < 285 && above > below;
  return {
    width,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    top: flip ? undefined : rect.bottom + 6,
    bottom: flip ? window.innerHeight - rect.top + 6 : undefined,
    maxHeight: Math.max(0, flip ? above : below),
  };
}

export default function MediaStudioNav({ platforms, active, onSelect, onPreload }) {
  const [position, setPosition] = React.useState(null);
  const button = React.useRef(null);
  const menu = React.useRef(null);
  const initialFocus = React.useRef('current');
  const menuId = React.useId();
  const labelId = React.useId();
  const open = Boolean(position);
  const options = () => [...(menu.current?.querySelectorAll('[role="menuitemradio"]') || [])];

  const close = React.useCallback((restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) button.current?.focus({ preventScroll: true });
  }, []);

  const show = (focus = 'current') => {
    initialFocus.current = focus;
    setPosition(menuPosition(button.current));
  };

  React.useLayoutEffect(() => {
    if (!open) return;
    const items = options();
    const selected = items.find(item => item.getAttribute('aria-checked') === 'true');
    const target = initialFocus.current === 'first' ? items[0]
      : initialFocus.current === 'last' ? items.at(-1) : selected || items[0];
    target?.focus({ preventScroll: true });
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!button.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    let frame = 0;
    const reposition = (event) => {
      if (frame || (event.target instanceof Node && menu.current?.contains(event.target))) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPosition(menuPosition(button.current));
      });
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      cancelAnimationFrame(frame);
    };
  }, [open, close]);

  React.useEffect(() => { close(); }, [active.key, close]);

  const navigateMenu = (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close(true);
      return;
    }
    const items = options();
    const current = items.indexOf(document.activeElement);
    const next = { ArrowDown: (current + 1) % items.length,
      ArrowUp: (current - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };
  const option = (platform) => {
    const Icon = platform.editor === 'video' ? Clapperboard : FileText;
    return <button type="button" role="menuitemradio" key={platform.key} tabIndex={-1}
      aria-checked={platform.key === active.key} className="media-studio-option"
      onPointerEnter={() => onPreload?.(platform)} onFocus={() => onPreload?.(platform)}
      onClick={() => { close(true); onSelect(platform); }}>
      <Icon aria-hidden="true" />
      <span>{platform.label}</span>
      <Check className="media-studio-option-check" aria-hidden="true" />
    </button>;
  };
  const Icon = active.editor === 'video' ? Clapperboard : FileText;
  return <nav className="media-studio-nav" aria-label="媒体平台">
    <div className="media-studio-nav-title">全媒体编辑台</div>
    <button ref={button} type="button" className="media-studio-trigger"
      aria-label={`切换编辑类型，当前${active.label}`} aria-haspopup="menu" aria-controls={menuId} aria-expanded={open}
      onClick={() => { if (open) close(true); else show(); }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        show(event.key === 'ArrowDown' ? 'first' : 'last');
      }}>
      <Icon aria-hidden="true" />
      <span>{active.label}</span>
      <ChevronDown className="media-studio-trigger-caret" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="media-studio-menu"
      role="menu" aria-label="切换编辑类型" style={position} onKeyDown={navigateMenu}>
      <div role="group" aria-labelledby={labelId}>
        <div id={labelId} className="media-studio-menu-label">文本内容</div>
        {platforms.filter(item => item.editor !== 'video').map(option)}
      </div>
      <div className="media-studio-menu-video" role="group" aria-label="视频">
        {platforms.filter(item => item.editor === 'video').map(option)}
      </div>
    </div>, document.body)}
  </nav>;
}
