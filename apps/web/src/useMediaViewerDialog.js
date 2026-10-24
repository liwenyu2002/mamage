import React from 'react';

export default function useMediaViewerDialog(open, onClose) {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!open) return undefined;
    const dialog = document.querySelector('.viewer-overlay--workspace');
    if (!dialog) return undefined;
    const previous = document.activeElement;
    dialog.querySelector('.viewer-topbar-close')?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close.current?.(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button, a[href], input, textarea, select, video[controls], summary, [tabindex="0"]')]
        .filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', onKey);
    return () => { dialog.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);
}
