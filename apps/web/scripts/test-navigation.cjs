const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const code = babel.transformFileSync(path.join(__dirname, '../src/utils/navigation.js'), { presets: [require.resolve('@babel/preset-env')] }).code;

function setup(initial = '/', externalHistory = false) {
  const events = new Map();
  const entries = externalHistory ? [{ url: 'https://outside.example/', state: null }] : [];
  entries.push({ url: new URL(initial, 'http://school').href, state: { unrelated: 'preserve' } });
  let index = entries.length - 1;
  const win = {
    get location() { return new URL(entries[index].url); }, scrollX: 0, scrollY: 0,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
    emit(name) { events.get(name)?.forEach(fn => fn()); },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state, _, url) { entries[index] = { state, url: new URL(url, win.location.href).href }; },
      pushState(state, _, url) { entries.splice(index + 1); entries.push({ state, url: new URL(url, win.location.href).href }); index++; },
      go(delta) { const next = index + delta; if (next < 0 || next >= entries.length) return;
        index = next; queueMicrotask(() => win.emit('popstate')); },
      back() { this.go(-1); }, forward() { this.go(1); },
    },
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'window', code)(mod, mod.exports, win);
  const api = mod.exports, nav = api.getNavigation();
  return { win, nav, api, entries };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('nested folders push distinct entries; Back and Forward publish their own URL', async () => {
  const { nav, win } = setup();
  nav.navigate('/?folder=one'); nav.navigate('/?folder=two');
  nav.back('/'); await tick(); assert.equal(nav.getSnapshot().url, '/?folder=one');
  nav.back('/'); await tick(); assert.equal(nav.getSnapshot().url, '/');
  win.history.forward(); await tick(); assert.equal(nav.getSnapshot().url, '/?folder=one');
});

test('in-app Back on a deep link replaces a known fallback, never a previous external website', () => {
  const { nav, win } = setup('/?projectId=8', true);
  nav.back('/?folder=campus');
  assert.equal(win.location.href, 'http://school/?folder=campus');
  assert.equal(win.history.length, 2);
});

test('duplicates do not add history, and route cleanup preserves foreign state', () => {
  const { nav, win } = setup('/?folder=one&variant=glass');
  nav.navigate('/?folder=one', { replace: true });
  assert.equal(win.history.state.unrelated, 'preserve');
  assert.equal(nav.navigate('/?folder=one'), false);
  assert.equal(win.history.length, 1);
  assert.throws(() => nav.navigate('https://outside.example/'), /stay on this site/);
});

test('query, folder, scroll and pagination are restored together', async () => {
  const { nav, win } = setup('/?folder=one&q=speaker');
  win.scrollY = 740; win.emit('scroll'); nav.setView('desktopPage', 3);
  nav.navigate('/?folder=one&projectId=8');
  nav.back('/'); await tick();
  assert.equal(nav.getSnapshot().url, '/?folder=one&q=speaker');
  assert.equal(nav.getSnapshot().entry.scroll.y, 740);
  assert.equal(nav.getSnapshot().entry.views.desktopPage, 3);
});

test('viewer changes replace the current photo; closing uses Back without a new album entry', async () => {
  const { nav, win, api } = setup('/?projectId=8');
  nav.setView('galleryLimit', 160); win.scrollY = 950;
  api.openMediaRoute(10); api.openMediaRoute(11);
  assert.equal(win.history.length, 2);
  assert.equal(nav.getSnapshot().entry.views.galleryLimit, 160);
  api.closeMediaRoute(); await tick();
  assert.equal(nav.getSnapshot().url, '/?projectId=8');
  assert.equal(nav.getSnapshot().entry.scroll.y, 950);
  win.history.forward(); await tick(); assert.equal(nav.getSnapshot().url, '/?projectId=8&photoId=11');
});

test('photo deep links create exactly one underlying album entry and preserve scope', async () => {
  const { nav, win, api } = setup('/?folder=one&projectId=8&photoId=10');
  api.openMediaRoute(10); api.openMediaRoute(10);
  assert.equal(win.history.length, 2);
  api.closeMediaRoute(); await tick(); assert.equal(nav.getSnapshot().url, '/?folder=one&projectId=8');
});

test('search previews retain their query and close back to results', async () => {
  const { nav, api } = setup('/?q=speaker');
  api.openMediaRoute(10, 'previewId'); api.closeMediaRoute('previewId'); await tick();
  assert.equal(nav.getSnapshot().url, '/?q=speaker');
});

test('unsaved edits can reject pushes, closes and browser Back without losing forward history', async () => {
  const { nav, win, api } = setup('/?projectId=8');
  api.openMediaRoute(10);
  const unblock = nav.block(() => false);
  assert.equal(nav.navigate('/about'), false);
  assert.equal(api.openMediaRoute(11), false);
  api.closeMediaRoute(); await tick();
  assert.equal(nav.getSnapshot().url, '/?projectId=8&photoId=10');
  assert.equal(win.location.search, '?projectId=8&photoId=10');
  win.history.back(); await tick(); assert.equal(win.location.search, '?projectId=8&photoId=10');
  unblock(); api.closeMediaRoute(); await tick(); assert.equal(nav.getSnapshot().url, '/?projectId=8');
});

test('native browser Back and Forward retain scroll without writing history on every scroll event', async () => {
  const { nav, win } = setup();
  nav.navigate('/?projectId=8');
  let writes = 0;
  const replace = win.history.replaceState;
  win.history.replaceState = (...args) => { writes++; replace(...args); };
  for (let y = 1; y <= 200; y++) { win.scrollY = y; win.emit('scroll'); }
  assert.equal(writes, 0);
  win.history.back(); await tick(); win.history.forward(); await tick();
  assert.equal(nav.getSnapshot().entry.scroll.y, 200);
});

test('navigation recovers metadata removed by legacy authentication cleanup', () => {
  const { nav, win } = setup();
  win.history.replaceState({}, '', '/');
  nav.setView('mediaFilter', 'video');
  nav.navigate('/about');
  assert.equal(nav.getSnapshot().url, '/about');
  assert.ok(nav.getSnapshot().entry.previous.key);
});
