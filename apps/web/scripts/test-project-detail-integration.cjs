const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../../..');
const baseline = '35db60bf47bf28741981687e6fdb611b200552c4';
const detailPath = 'apps/web/src/ProjectDetail.jsx';
const readBase = file => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
const parse = source => babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
const original = parse(readBase(detailPath));
const current = parse(fs.readFileSync(path.join(root, detailPath), 'utf8'));

function declaration(tree, name) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'VariableDeclarator' && tree.id?.name === name) return tree.init;
  for (const value of Object.values(tree)) {
    if (!value || typeof value !== 'object') continue;
    const found = Array.isArray(value) ? value.map(item => declaration(item, name)).find(Boolean) : declaration(value, name);
    if (found) return found;
  }
  return null;
}

function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['start', 'end', 'loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key))
    .map(([key, item]) => [key, semantic(item)]));
}

for (const name of ['canDeleteItem', 'canDeleteSelection', 'canEditItem', 'handleFilesSelected',
  'performUploadGroups', 'confirmUpload', 'saveEdit', 'confirmDelete']) {
  test(`ProjectDetail ${name} retains the pre-integration permission/request contract`, () => {
    const before = declaration(original, name), after = declaration(current, name);
    assert.ok(before && after, `Missing ${name}`);
    assert.deepEqual(semantic(after), semantic(before));
  });
}

for (const file of ['services/projectService.js', 'services/photoService.js', 'utils/photoDeletePermissions.js', 'utils/metadataEditPermissions.js']) {
  test(`${file} has no integration changes`, () => {
    const full = `apps/web/src/${file}`;
    assert.equal(fs.readFileSync(path.join(root, full), 'utf8'), readBase(full));
  });
}
