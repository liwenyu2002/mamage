const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const code = babel.transformFileSync(path.join(__dirname, '../src/ui/glassCompatibility.js'), {
  presets: [require.resolve('@babel/preset-env')],
}).code;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { needsGlassFallback, applyGlassCompatibility } = mod.exports;
const appearanceMod = { exports: {} };
new Function('module', 'exports', babel.transformFileSync(path.join(__dirname, '../src/ui/glassAppearance.js'), {
  presets: [require.resolve('@babel/preset-env')],
}).code)(appearanceMod, appearanceMod.exports);
const { readGlassAppearance, applyGlassAppearance, saveGlassAppearance, normalizeGlassAppearance } = appearanceMod.exports;

test('site appearance migrates the existing preference and applies before mount', () => {
  const styles = {};
  const target = { document: { documentElement: { dataset: { glassFallback: 'true' }, style: {
    setProperty: (key, value) => { styles[key] = value; },
  } } }, localStorage: { getItem: key => key === 'mamage-viewer-appearance' ? '{"dark":true,"blur":25}' : null } };
  applyGlassAppearance(readGlassAppearance(target), target);
  assert.equal(target.document.documentElement.dataset.glassTheme, 'dark');
  assert.equal(target.document.documentElement.dataset.glassFallback, 'true');
  assert.equal(styles['--glass-blur'], '25px');
  applyGlassAppearance({ dark: false }, target);
  assert.equal(target.document.documentElement.dataset.glassTheme, 'light');
  assert.deepEqual(normalizeGlassAppearance({ dark: 'true', blur: 500 }), { dark: false, blur: 28 });
});

test('appearance switches and notifies even when local storage is unavailable', () => {
  let event;
  const target = { document: { documentElement: { dataset: {}, style: { setProperty() {} } } },
    get localStorage() { throw new Error('Storage unavailable'); }, dispatchEvent: value => { event = value; } };
  assert.deepEqual(readGlassAppearance(target), { dark: false, blur: 20 });
  assert.deepEqual(saveGlassAppearance({ dark: true, blur: 15 }, target), { dark: true, blur: 15 });
  assert.equal(target.document.documentElement.dataset.glassTheme, 'dark');
  assert.deepEqual(event.detail, { dark: true, blur: 15 });
  // A newly mounted viewer must keep the in-memory theme when storage is blocked.
  assert.deepEqual(readGlassAppearance(target), { dark: true, blur: 15 });
});

test('mobile DingTalk uses a readable material even when blur syntax is supported', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 14; V2339A) AppleWebKit/537.36 Chrome/104.0.0.0 Mobile Safari/537.36 DingTalk/7.6.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 DingTalk/7.6.0',
    'Mozilla/5.0 (iPad) AppleWebKit/605.1.15 DingTalk/7.6.0',
  ]) assert.equal(needsGlassFallback({ userAgent, supportsBackdrop: true }), true);
});

test('ordinary browsers and desktop DingTalk retain their existing glass material', () => {
  for (const userAgent of ['Mozilla/5.0 Chrome/145 Safari/537.36',
    'Mozilla/5.0 Android 14 Mobile Chrome/145 Safari/537.36',
    'Mozilla/5.0 iPhone AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 Macintosh AppleWebKit/537.36 DingTalk/7.6.0']) {
    assert.equal(needsGlassFallback({ userAgent, supportsBackdrop: true }), false);
    assert.equal(needsGlassFallback({ userAgent, supportsBackdrop: false }), true);
  }
});

test('initialization handles absent CSS APIs and prefixed WebKit support without stored preferences', () => {
  const document = { documentElement: { dataset: {} } };
  applyGlassCompatibility({ document, navigator: { userAgent: 'Safari' } });
  assert.equal(document.documentElement.dataset.glassFallback, 'true');
  applyGlassCompatibility({ document, navigator: { userAgent: 'Safari' }, CSS: {} });
  assert.equal(document.documentElement.dataset.glassFallback, 'true');
  applyGlassCompatibility({ document, navigator: { userAgent: 'Safari' },
    CSS: { supports: prop => prop === '-webkit-backdrop-filter' } });
  assert.equal(document.documentElement.dataset.glassFallback, undefined);
});
