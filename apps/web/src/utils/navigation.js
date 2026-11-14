const STATE_KEY = 'mamageNavigation';

export function createNavigation(win) {
  const listeners = new Set(), blockers = new Set();
  const scrollPositions = new Map();
  let sequence = 0, snapshot, recovering = false, travelling = false;
  const href = () => win.location.pathname + win.location.search + win.location.hash;
  const id = () => `${Date.now().toString(36)}-${++sequence}`;
  const meta = () => win.history.state?.[STATE_KEY];
  const replaceMeta = entry => win.history.replaceState({ ...win.history.state, [STATE_KEY]: entry }, '', href());
  const ensureMeta = () => {
    if (!meta()?.key) replaceMeta({ key: id(), position: 0, previous: null, views: {}, scroll: null });
    return meta();
  };
  const publish = (kind = 'replace') => {
    let entry = ensureMeta();
    if (scrollPositions.has(entry.key)) entry = { ...entry, scroll: scrollPositions.get(entry.key) };
    snapshot = { url: href(), entry, kind };
    listeners.forEach(listener => listener());
  };
  const captureScroll = () => {
    const current = meta();
    if (!current || travelling || current.key !== snapshot?.entry.key) return;
    // Scroll events can exceed WebView history API rate limits; persist only on departure.
    scrollPositions.set(current.key, { x: win.scrollX || 0, y: win.scrollY || 0 });
    if (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value);
  };
  const persistScroll = () => {
    captureScroll();
    const current = meta();
    if (current && scrollPositions.has(current.key)) replaceMeta({ ...current, scroll: scrollPositions.get(current.key) });
  };
  const allowed = (next, kind) => [...blockers].every(block => block(next, kind) !== false);
  const pop = () => {
    travelling = false;
    if (recovering) { recovering = false; return; }
    const next = href();
    if (!allowed(next, 'pop')) {
      const delta = snapshot.entry.position - (meta()?.position ?? snapshot.entry.position);
      if (delta) { recovering = true; win.history.go(delta); return; }
    }
    publish('pop');
  };
  win.history.scrollRestoration = 'manual';
  publish('initial');
  win.addEventListener('popstate', pop);
  win.addEventListener('scroll', captureScroll, { passive: true });
  win.addEventListener('pagehide', persistScroll);

  const navigate = (target, { replace = false, keepScroll = false, skipBlockers = false } = {}) => {
    const url = new URL(target, win.location.href);
    if (url.origin !== win.location.origin) throw new Error('Navigation must stay on this site');
    const next = url.pathname + url.search + url.hash;
    if (next === href()) return false;
    if (travelling || (!skipBlockers && !allowed(next, replace ? 'replace' : 'push'))) return false;
    persistScroll();
    const current = ensureMeta();
    const entry = replace ? current : { key: id(), position: current.position + 1,
      previous: { key: current.key, url: href() }, views: keepScroll ? current.views : {}, scroll: keepScroll ? current.scroll : { x: 0, y: 0 } };
    win.history[replace ? 'replaceState' : 'pushState']({ ...(replace ? win.history.state : {}), [STATE_KEY]: entry }, '', next);
    publish(replace ? 'replace' : 'push');
    return true;
  };
  const back = (fallback = '/', { acceptPrevious = () => true } = {}) => {
    if (travelling) return;
    const previous = meta()?.previous;
    if (previous && acceptPrevious(previous.url)) {
      persistScroll(); travelling = true; win.history.back();
    } else navigate(fallback, { replace: true });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    navigate, back,
    block: callback => { blockers.add(callback); return () => blockers.delete(callback); },
    setView: (name, value) => {
      const current = ensureMeta();
      replaceMeta({ ...current, views: { ...current.views, [name]: value } });
      publish('state');
    },
    dispose: () => { win.removeEventListener('popstate', pop); win.removeEventListener('scroll', captureScroll); win.removeEventListener('pagehide', persistScroll); },
  };
}

let navigation;
export const getNavigation = () => navigation || (navigation = createNavigation(window));
export const navigate = (target, options) => getNavigation().navigate(target, options);
export const goBack = (fallback, options) => getNavigation().back(fallback, options);

export function withoutParams(location, keys) {
  const url = new URL(location, window.location.origin);
  keys.forEach(key => url.searchParams.delete(key));
  return url.pathname + url.search + url.hash;
}

export function openMediaRoute(photoId, parameter = 'photoId') {
  const current = getNavigation().getSnapshot();
  const url = new URL(window.location.href);
  const parent = withoutParams(url, [parameter]);
  if (url.searchParams.has(parameter)) {
    // Deep links need an album/list entry too, so Back first dismisses the viewer.
    if (!current.entry.previous || withoutParams(current.entry.previous.url, [parameter]) !== parent) {
      if (!navigate(parent, { replace: true, keepScroll: true })) return false;
      url.searchParams.set(parameter, String(photoId));
      return navigate(url, { keepScroll: true });
    }
    url.searchParams.set(parameter, String(photoId));
    return url.pathname + url.search + url.hash === current.url || navigate(url, { replace: true, keepScroll: true });
  } else {
    url.searchParams.set(parameter, String(photoId));
    return navigate(url, { keepScroll: true });
  }
}

export function closeMediaRoute(parameter = 'photoId') {
  const parent = withoutParams(window.location.href, [parameter]);
  goBack(parent, { acceptPrevious: previous => previous === parent });
}
