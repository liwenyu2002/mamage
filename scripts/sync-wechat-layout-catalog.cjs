const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createRequire } = Module;
const root = path.resolve(__dirname, '..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const babel = webRequire('@babel/core');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const instance = new Module(file, module);
  cache.set(file, instance);
  instance.filename = file;
  instance.paths = Module._nodeModulePaths(path.dirname(file));
  instance.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name.endsWith('.js') ? name : `${name}.js`)) : webRequire(name);
  instance._compile(babel.transformSync(fs.readFileSync(file, 'utf8'), { filename: file,
    presets: [[webRequire.resolve('@babel/preset-env'), { targets: { node: 'current' } }]] }).code, file);
  return instance.exports;
}
function catalog() {
  const { BUILTIN_BLOCKS } = load(path.join(root, 'apps/web/src/wechat/builtinBlocks.js'));
  const { WECHAT_THEMES, THEME_PRESETS } = load(path.join(root, 'apps/web/src/wechat/themes.js'));
  return { version: 1,
    styles: BUILTIN_BLOCKS.map(({ id, type, name }) => ({ id, type, name })),
    templates: WECHAT_THEMES.map(theme => ({ ...theme, blockConfig: { ...THEME_PRESETS[theme.key],
      bodyStyleId: theme.key === 'formal' ? 'builtin-body-indent' : 'builtin-body-plain', signoff: null } })),
  };
}
const target = path.join(root, 'apps/server/lib/wechat_layout_catalog.json');
const serialized = JSON.stringify(catalog(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== serialized) throw Error('WeChat layout catalog is stale; run node scripts/sync-wechat-layout-catalog.cjs');
  console.log('WeChat layout catalog matches the rendering library');
} else { fs.writeFileSync(target, serialized); console.log('Updated', target); }
