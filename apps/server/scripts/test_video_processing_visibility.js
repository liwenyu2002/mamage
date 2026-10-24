const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const assert = require('node:assert/strict'), { test } = require('node:test');

async function albumSnapshot() {
  const photos = [
    { id: 11, projectId: 9, type: 'video', url: '/raw-new.mov', thumbUrl: null, playbackUrl: null },
    { id: 12, projectId: 9, type: 'video', url: '/legacy.mp4', thumbUrl: null, playbackUrl: null },
    { id: 13, projectId: 9, type: 'video', url: '/ready.mov', playbackUrl: '/ready.mp4' },
    { id: 14, projectId: 9, type: 'video', url: '/failed.mov', playbackUrl: null },
  ];
  const tasks = [{ dedupe_key: '11', status: 'running' }, { dedupe_key: '14', status: 'failed' }];
  let handler, body, status = 200;
  const pool = { query: async (sql, params) => {
    if (sql.includes('FROM projects p')) return [[{ id: 9, organization_id: 2, unit_id: 1, meta: {} }]];
    if (sql.includes('FROM photos ph')) return [photos.map(p => ({ ...p }))];
    if (sql.includes('runtime_tasks')) return [tasks];
    throw Error('Unexpected read query: ' + sql);
  } };
  const source = fs.readFileSync(path.join(__dirname, '../routes/projects.js'), 'utf8');
  const helperPath = path.join(__dirname, '../lib/video_processing_state.js');
  const stateHelpers = fs.existsSync(helperPath) ? require(helperPath) : {};
  const readState = stateHelpers.attachVideoProcessingState;
  const globals = { console, pool, ...stateHelpers,
    attachVideoProcessingState: (items, options) => readState(items, { ...options, enabled: true }),
    router: { get: (_path, callback) => { handler = callback; } },
    populateReqUserFromAuthIfPresent: async () => {}, getScopedOrgIdFromReq: () => 2,
    parseMeta: value => value, parseTags: value => value, parsePhotoAdjustments: value => value,
    attachTimelineToProject: async () => {}, mediaUrl: (_req, value) => value,
    resolveWorkspace: async () => ({ enabled: true, userId: 7, orgId: 2, unitId: 1 }),
    requireProjectAccess: async () => ({ id: 9, organization_id: 2, unit_id: 1 }),
    canAccessProject: async () => true, metadataEditScope: () => 'organization', hasInternalShare: async () => false,
    chooseCoverFromPhotos: () => ({}),
  };
  vm.runInNewContext(source.slice(source.indexOf("router.get('/:id', async"), source.indexOf('// 4. 创建项目')), globals);
  await handler({ params: { id: '9' }, query: { includeFaces: '0' }, user: { id: 7, organization_id: 2 } }, {
    status: value => { status = value; return { json: value => { body = value; } }; },
    json: value => { body = JSON.parse(JSON.stringify(value)); },
  });
  assert.equal(status, 200);
  return body;
}

test('refresh keeps an uploaded video visible as transcoding until the durable task finishes', async () => {
  const album = await albumSnapshot();
  assert.deepEqual(album.photos.map(photo => photo.id), [11, 12, 13, 14]);
  assert.equal(album.photos.find(photo => photo.id === 11).processingStatus, 'transcoding', 'Fresh GET must restore the durable processing state, not just an optimistic upload badge');
});

test('a failed processing task stays visible, but missing playback alone does not mark legacy videos pending', async () => {
  const album = await albumSnapshot();
  assert.equal(album.photos.find(photo => photo.id === 14).processingStatus, 'failed');
  assert.ok(!album.photos.find(photo => photo.id === 12).processingStatus);
  assert.ok(!album.photos.find(photo => photo.id === 13).processingStatus);
});
