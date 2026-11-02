import React from 'react';
import { MotionModal } from './ui';
import './AlbumDetailsFields.css';

let pageLocks = 0;
let restorePage;

function lockPage() {
  if (pageLocks === 0) {
    const root = document.getElementById('root');
    const overflow = document.body.style.overflow;
    const inert = root?.inert;
    const focus = document.activeElement;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
    restorePage = () => {
      document.body.style.overflow = overflow;
      if (root) root.inert = inert;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }
  pageLocks += 1;
  return () => {
    pageLocks -= 1;
    if (pageLocks === 0) { restorePage?.(); restorePage = undefined; }
  };
}

export default function AlbumFormModal({ visible, className = '', presentation, originRef, ...props }) {
  const maskRef = React.useRef(null);
  const attachMask = React.useCallback(node => {
    maskRef.current = node;
    if (!node || presentation !== 'dock') return;
    const dialog = node.querySelector('[role="dialog"]');
    if (!dialog) return;
    const origin = originRef?.current?.getBoundingClientRect();
    const target = dialog.getBoundingClientRect();
    const size = origin?.width || 64;
    // Match the collapsed primary circle before the shared spring expands it.
    dialog.style.setProperty('--album-dock-scale-x', size / dialog.offsetWidth);
    dialog.style.setProperty('--album-dock-scale-y', size / dialog.offsetHeight);
    dialog.style.setProperty('--album-dock-offset-y', `${origin ? origin.bottom - target.bottom : 0}px`);
    dialog.style.setProperty('--album-dock-offset-x', `${origin ? origin.x + origin.width / 2 - (target.x + target.width / 2) : 0}px`);
  }, [presentation, originRef]);
  const [viewport, setViewport] = React.useState(null);
  const [present, setPresent] = React.useState(visible);

  React.useEffect(() => {
    if (visible) { setPresent(true); return undefined; }
    // Keep the page locked until MotionModal's 200ms exit has finished.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => setPresent(false), reduced ? 0 : 220);
    return () => clearTimeout(timer);
  }, [visible]);

  React.useEffect(() => {
    if (!present) return undefined;
    const unlock = lockPage();
    const frame = requestAnimationFrame(() => {
      const dialog = maskRef.current?.querySelector('[role="dialog"]');
      if (dialog) { dialog.tabIndex = -1; dialog.focus({ preventScroll: true }); }
    });
    const updateViewport = () => {
      const current = window.visualViewport;
      setViewport({ height: current?.height || window.innerHeight, top: current?.offsetTop || 0 });
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    return () => {
      cancelAnimationFrame(frame);
      unlock();
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, [present]);

  return <MotionModal {...props} visible={visible}
    className={`album-form-modal${presentation === 'dock' ? ' album-form-modal--dock' : ''} ${className}`}
    maskRef={attachMask} maskClassName={`album-form-mask${presentation === 'dock' ? ' album-form-mask--dock' : ''}`}
    maskStyle={viewport ? { height: viewport.height, top: viewport.top, bottom: 'auto', '--album-viewport-height': `${viewport.height}px` } : undefined} />;
}
