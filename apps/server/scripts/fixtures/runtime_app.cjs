if (process.env.MAMAGE_RUNTIME_TEST !== '1') throw Error('Test fixture only');
const path = require('node:path');
const express = require('express');
const root = path.resolve(__dirname, '../..');
const mock = (file, exports) => {
  const id = require.resolve(path.join(root, file));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let databaseReady = true;
mock('db.js', { pool: { query: async () => { if (!databaseReady) throw Error('DB_DOWN'); return [[{ ready: 1 }]]; }, end: async () => {} } });
mock('lib/validateEnv.js', { validateEnvironment() {} });
mock('lib/validateAi.js', { validateAll: async () => { throw Error('Optional AI validation must not be called'); } });
mock('lib/search_telemetry.js', { searchRequestLogTarget: req => req.path, startSearchTelemetry() {}, stopSearchTelemetry: async () => {} });
mock('lib/media_access.js', { authorizeMediaKey: async (_key, token) => token === 'fixture-valid' });
mock('lib/cos_storage.js', { keyFromUrlOrPath: value => value.replace(/^\/+/, ''), isSafeKey: value => !value.includes('..') });
for (const name of ['organization_copy_worker', 'external_import_worker', 'ai_job_worker', 'ai_tags_worker', 'face_auto_worker', 'image_similarity']) {
  mock(`lib/${name}.js`, { start() {}, stop: async () => {}, requeueStuckPhotos: async () => {} });
}
for (const name of ['projects', 'photos', 'upload', 'users', 'ai_news', 'ai_video', 'video_projects', 'organizations',
  'workspaces', 'share', 'internal_shares', 'similarity_groups', 'faces', 'image_proxy', 'wx_image_proxy', 'wechat_style',
  'wechat_preview', 'wechat_compositions', 'user_favorites', 'external_imports', 'album_desktop', 'auth_dingtalk', 'network']) {
  const router = express.Router();
  router.stopBackgroundTasks = async () => {};
  if (name === 'projects') router.get('/slow', (req, res) => {
    process.send?.({ type: 'active-request' });
    setTimeout(() => res.json({ complete: true }), 150);
  });
  mock(`routes/${name}.js`, router);
}
process.on('message', message => {
  if (message.type === 'database') { databaseReady = message.ready; process.send?.({ type: 'database-updated' }); }
});
require(path.join(root, 'app.js')).startup().then(server => {
  if (server.listening) process.send?.({ type: 'listening', port: server.address().port });
  else server.once('listening', () => process.send?.({ type: 'listening', port: server.address().port }));
});
