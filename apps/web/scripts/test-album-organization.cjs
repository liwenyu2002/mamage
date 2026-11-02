const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const desktop = read('src/AlbumDesktop.jsx');
const prototype = read('src/prototypes/AlbumCollectionsPrototype.jsx');

test('retired organization suggestions have no UI, state, algorithm or styles', () => {
  for (const source of [desktop, prototype]) {
    assert.doesNotMatch(source, /整理建议|查看建议|确认归类|suggestCollections|DEMO_SUGGESTIONS|suggestionPanel|\b(?:suggestions|accepted|dismissed|review|setReview|setAccepted|setDismissed)\b/);
    babel.transformSync(source, { presets: [require.resolve('@babel/preset-react')] });
    assert.match(source, /function groupAlbums/);
    assert.match(source, /const confirmDrop/);
    assert.match(source, /const organize/);
  }
  for (const file of ['src/AlbumDesktop.css', 'src/prototypes/albumCollectionsSidebar.css']) {
    assert.doesNotMatch(read(file), /acp-suggestion|acp-review-actions/);
    assert.match(read(file), /acp-sidebar-directory/);
  }
});

test('activity sorting is stable, non-mutating, and keeps absent or invalid dates last in both directions', () => {
  const ast = babel.parseSync(desktop, { parserOpts: { plugins: ['jsx'] } });
  const functions = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && ['eventTime', 'sortByEventTime'].includes(node.id.name));
  const code = babel.transformFromAstSync({ ...ast, program: { ...ast.program, body: functions } }, null).code;
  const { sortByEventTime, eventTime } = new Function(`${code}; return { sortByEventTime, eventTime };`)();
  const albums = [
    { id: 'empty', eventDate: '', createdAt: '2099-01-01' },
    { id: 'new', eventDate: '2026-10-10' },
    { id: 'old', eventDate: '2025-01-01' },
    { id: 'tie', eventDate: '2026-10-10' },
    { id: 'invalid', eventDate: 'not-a-date' },
    { id: 'null', eventDate: null },
    { id: 'missing' },
    { id: 'epoch', eventDate: '1970-01-01' },
  ];
  const before = structuredClone(albums);
  const ids = rows => rows.map(row => row.id);
  assert.deepEqual(ids(sortByEventTime(albums, 'desc')), ['new', 'tie', 'old', 'epoch', 'empty', 'invalid', 'null', 'missing']);
  assert.deepEqual(ids(sortByEventTime(albums, 'asc')), ['epoch', 'old', 'new', 'tie', 'empty', 'invalid', 'null', 'missing']);
  assert.equal(sortByEventTime(albums, 'default'), albums);
  assert.deepEqual(albums, before);
  assert.equal(eventTime(albums[0]), null, 'activity sorting must not silently fall back to creation dates');
  assert.equal(eventTime(albums.at(-1)), 0);
  assert.deepEqual(sortByEventTime([], 'asc'), []);
});

test('legacy suggestion preferences are ignored without mount writes; normal preferences and membership still save', async () => {
  const source = babel.transformFileSync(path.join(root, 'src/services/albumDesktopService.js'), {
    presets: [require.resolve('@babel/preset-env')],
  }).code;
  const initial = { groups: [{ id: 'folder', projectIds: [1] }], preferences: {
    pins: [], recentItems: [{ id: 1, visitedAt: 1 }], colors: { folder: '#abcdef' }, dismissed: [1],
  }, workspaceRevision: 1, userRevision: 1, scope: { userId: 7, unitId: 1 } };
  const calls = [], errors = [], mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => ({ request: async (url, options) => {
    if (url === '/api/album-desktop') return structuredClone(initial);
    calls.push(options.data);
    return { workspaceRevision: 2, userRevision: 2 };
  } }), mod, mod.exports);
  const clean = { pins: [], recentItems: [{ id: 1, visitedAt: 1 }], colors: { folder: '#abcdef' } };
  assert.deepEqual((await mod.exports.loadAlbumDesktop()).preferences, clean);
  const saver = mod.exports.createDesktopSaver(initial, error => errors.push(error));
  await saver.save({ groups: initial.groups, preferences: clean });
  assert.deepEqual(calls, [], 'ignoring a retired field must not cause a save');
  await saver.save({ groups: initial.groups, preferences: { ...initial.preferences, dismissed: [2] } });
  assert.deepEqual(calls, [], 'retired-field-only changes must not cause a save');
  await saver.save({ groups: initial.groups, preferences: { ...initial.preferences, pins: ['album:1'] } });
  assert.deepEqual(calls[0].preferences, { ...clean, pins: ['album:1'] });
  assert.equal(calls[0].groups, undefined);
  assert.equal(calls[0].sharedReferencesVersion, 1);
  const moved = [{ id: 'folder', projectIds: [] }];
  await saver.save({ groups: moved, preferences: { ...clean, pins: ['album:1'] } });
  assert.deepEqual(calls[1].groups, moved);
  assert.equal(calls[1].preferences, undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(initial.preferences.dismissed, [1], 'source data must remain untouched');
});

test('deleting selected folders lifts descendants to the nearest surviving parent without mutating membership', () => {
  const ast = babel.parseSync(desktop, { parserOpts: { plugins: ['jsx'] } });
  const body = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === 'removeDesktopFolders');
  const code = babel.transformFromAstSync({ ...ast, program: { ...ast.program, body } }, null).code;
  const removeDesktopFolders = new Function(`${code}; return removeDesktopFolders;`)();
  const groups = [{ id: 'a', parentId: null, projectIds: [1] }, { id: 'b', parentId: 'a', projectIds: [2] },
    { id: 'c', parentId: 'b', projectIds: [3] }, { id: 'd', parentId: 'c', projectIds: [4] }];
  const before = structuredClone(groups);
  assert.deepEqual(removeDesktopFolders(groups, ['a', 'b']).map(group => [group.id, group.parentId, group.projectIds]), [['c', null, [3]], ['d', 'c', [4]]]);
  assert.deepEqual(removeDesktopFolders(groups, ['b', 'c']).map(group => [group.id, group.parentId, group.projectIds]), [['a', null, [1]], ['d', 'a', [4]]]);
  assert.deepEqual(groups, before);
});

test('repeated creation notifications update one album without closing or resetting the upload form', () => {
  let callback;
  babel.transformSync(desktop, { parserOpts: { plugins: ['jsx'] }, plugins: [() => ({ visitor: {
    JSXOpeningElement(nodePath) {
      if (nodePath.node.name.name !== 'CreateAlbumModal') return;
      callback = nodePath.node.attributes.find(attribute => attribute.name?.name === 'onCreated').value.expression;
    },
  } })] });
  assert.ok(callback);
  const code = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'script',
    body: [{ type: 'ExpressionStatement', expression: callback }] } }).code;
  let albums = [{ id: 102, name: 'Nested Album', count: 0, groups: ['root'] }];
  // Only metadata updates are exposed; a close/reset/navigation side effect fails here.
  const onCreated = new Function('setAlbums', 'resolveAssetUrl', `return (${code.replace(/;\s*$/, '')});`)(update => { albums = update(albums); }, value => value);
  const created = { id: 102, name: 'Nested Album', photoCount: 1, coverThumbUrl: '/fixture.png' };
  onCreated(created); onCreated(created);
  assert.deepEqual(albums, [{ id: 102, name: 'Nested Album', count: 1, groups: ['root'], image: '/fixture.png' }]);
});
