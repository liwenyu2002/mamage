function positiveId(value) {
  const text = String(value ?? '').trim();
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

export function buildPhotoFocusUrl(projectId, photoId) {
  const project = positiveId(projectId), photo = positiveId(photoId);
  if (!project) return null;
  const query = new URLSearchParams({ projectId: project });
  if (photo) query.set('focusPhotoId', photo);
  return '/?' + query.toString();
}

export function readPhotoFocusIntent(href) {
  try {
    const query = new URL(href, 'http://local').searchParams;
    const projectId = positiveId(query.get('projectId')), photoId = positiveId(query.get('focusPhotoId'));
    return projectId && photoId ? { projectId, photoId } : null;
  } catch { return null; }
}

export function consumePhotoFocusIntent(projectId, photoId) {
  const intent = readPhotoFocusIntent(window.location.href);
  if (intent?.projectId !== String(projectId) || intent.photoId !== String(photoId)) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('focusPhotoId');
  window.history.replaceState({}, '', url);
}

export function focusPhotoCard(container, photoId, onFinished, onHighlight) {
  const id = positiveId(photoId);
  if (!container || !id) return () => {};
  let stopped = false, interrupted = false, frame = 0, observer, settleTimer, finishTimer, started = false;
  const marked = new Set();
  const locate = () => {
    frame = 0;
    if (stopped || interrupted) return;
    const card = container.querySelector(`[data-photo-id="${id}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    card.focus({ preventScroll: true });
    if (!marked.has(card)) { marked.add(card); card.classList.add('is-photo-focused'); }
    onHighlight?.(id);
    if (!started) {
      started = true;
      clearTimeout(finishTimer);
      settleTimer = setTimeout(stopSettling, 1600);
      finishTimer = setTimeout(() => { cleanup(); onFinished?.(); }, 2400);
    }
  };
  const schedule = () => { if (!frame && !stopped && !interrupted) frame = requestAnimationFrame(locate); };
  const stopSettling = () => {
    observer?.disconnect();
    container.removeEventListener('load', schedule, true);
  };
  const interrupt = () => { interrupted = true; stopSettling(); if (frame) cancelAnimationFrame(frame); frame = 0; };
  // A late thumbnail can reflow masonry columns; settle briefly, but never fight user scrolling.
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
  }
  container.addEventListener('load', schedule, true);
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  events.forEach(event => window.addEventListener(event, interrupt, { passive: true, capture: true }));
  schedule();
  const cleanup = () => {
    stopped = true;
    stopSettling();
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(settleTimer); clearTimeout(finishTimer);
    events.forEach(event => window.removeEventListener(event, interrupt, true));
    marked.forEach(card => card.classList.remove('is-photo-focused'));
    onHighlight?.(null);
  };
  finishTimer = setTimeout(() => { cleanup(); onFinished?.(); }, 8000);
  return cleanup;
}
