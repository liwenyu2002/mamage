const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), babel = require('@babel/core'), vm = require('node:vm');
const code = babel.transformFileSync(path.join(__dirname, '../src/utils/photoFocus.js'), { presets: [require.resolve('@babel/preset-env')] }).code;
const mod = { exports: {} }; new Function('module', 'exports', code)(mod, mod.exports);
const { buildPhotoFocusUrl, readPhotoFocusIntent } = mod.exports;
test('person album links carry the exact photo without opening a viewer or carrying credentials', () => {
  assert.equal(buildPhotoFocusUrl(83, 120), '/?projectId=83&focusPhotoId=120');
  assert.deepEqual(readPhotoFocusIntent('http://school/?projectId=83&focusPhotoId=120'), { projectId: '83', photoId: '120' });
  assert.equal(buildPhotoFocusUrl(83, null), '/?projectId=83');
  for (const bad of ['0', '-1', '1e2', '123abc', '999999999999999999999', '1"]']) {
    assert.equal(buildPhotoFocusUrl(bad, 1), null);
    assert.equal(readPhotoFocusIntent('http://school/?projectId=83&focusPhotoId=' + encodeURIComponent(bad)), null);
  }
});

test('consuming an intent removes only its own parameter and cannot consume a newer request', () => {
  let href = 'http://school/?projectId=83&focusPhotoId=120&photoId=120&keep=1';
  const sandbox = { module: { exports: {} }, URL, URLSearchParams, window: { location: { get href() { return href; } },
    history: { replaceState: (_, __, url) => { href = url.href; } } } };
  sandbox.exports = sandbox.module.exports; vm.createContext(sandbox); vm.runInContext(code, sandbox);
  sandbox.exports.consumePhotoFocusIntent(83, 121); assert.ok(href.includes('focusPhotoId=120'));
  sandbox.exports.consumePhotoFocusIntent(83, 120);
  assert.equal(href, 'http://school/?projectId=83&photoId=120&keep=1');
});

test('manual scrolling stops corrective jumps, and cleanup removes every timer, observer and marker', () => {
  const frames = new Map(), timers = new Map(), listeners = new Map(), loads = new Map(), classes = new Set();
  let serial = 0, jumps = 0, disconnects = 0, finished = 0, observed;
  const card = { scrollIntoView: () => jumps++, focus() {}, classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const container = { querySelector: () => card, addEventListener: (name, fn) => loads.set(name, fn), removeEventListener: name => loads.delete(name) };
  const sandbox = { module: { exports: {} }, URL, URLSearchParams,
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(fn) { observed = fn; } observe() {} disconnect() { disconnects++; } },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) } };
  sandbox.exports = sandbox.module.exports; vm.createContext(sandbox); vm.runInContext(code, sandbox);
  const cleanup = sandbox.exports.focusPhotoCard(container, 120, () => finished++);
  const [frame, callback] = [...frames][0]; frames.delete(frame); callback();
  assert.equal(jumps, 1); assert.ok(classes.has('is-photo-focused'));
  listeners.get('wheel')(); observed(); assert.equal(frames.size, 0);
  cleanup(); cleanup();
  assert.equal(jumps, 1); assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(loads.size, 0);
  assert.equal(classes.size, 0); assert.ok(disconnects > 0); assert.equal(finished, 0);
});
