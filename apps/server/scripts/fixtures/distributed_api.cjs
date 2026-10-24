if (process.env.MAMAGE_RUNTIME_TEST !== '1' || !process.env.DB_NAME?.endsWith('_workspace_test')) throw Error('Isolated fixture only');
process.env.MAMAGE_DISTRIBUTED_RUNTIME = '1';
process.env.ORGANIZATION_UNITS_ACTIVE = '1';
process.env.VIDEO_PREVIEW_ENABLED = '0';
process.env.VIDEO_PLAYBACK_ENABLED = '0';
process.env.VIDEO_RENDER_RECOVER_ON_BOOT = '0';
process.env.COS_DIRECT_UPLOAD_ENABLED = '1';
process.env.DIRECT_STORAGE_ALLOWED_HOSTS = '127.0.0.1';
process.env.COS_BUCKET = 'verification';
process.env.COS_SECRET_ID = 'verification';
process.env.COS_SECRET_KEY = 'verification';
process.env.COS_BASE_URL = process.env.MAMAGE_STORAGE_FIXTURE;
const { pool } = require('../../db');
const { coordinator } = require('../../lib/distributed_runtime');
const { createSharedStore } = require('../../lib/shared_runtime_state');
const storagePath = require.resolve('../../lib/cos_storage');
const storage = require(storagePath);
const rpc = async (op, data = {}) => {
  const response = await fetch(process.env.MAMAGE_STORAGE_FIXTURE, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...data }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'STORAGE_FIXTURE_ERROR');
  return result;
};
require.cache[storagePath].exports = { ...storage,
  headObject: key => rpc('head', { key }),
  createMultipartUpload: key => rpc('init', { key }),
  completeMultipartUpload: (key, uploadId, parts) => rpc('complete', { key, uploadId, parts }),
  uploadPart: (key, uploadId, partNumber, body) => rpc('part', { key, uploadId, partNumber, bytes: body.length }),
  abortMultipartUpload: (key, uploadId) => rpc('abort', { key, uploadId }),
  deleteObjects: keys => rpc('delete', { keys }),
  signedPost: async key => ({ postUrl: process.env.MAMAGE_STORAGE_FIXTURE, fields: { key }, expiresIn: 900 }),
  signedUploadPartUrl: async (_key, _uploadId, partNumber) => ({ signedUrl: 'http://fixture.invalid/part', partNumber, expiresIn: 900 }),
};
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/upload', require('../../routes/upload'));
app.use('/api/photos', require('../../routes/photos'));
app.use('/api/video-projects', require('../../routes/video_projects'));
app.use('/api/users', require('../../routes/users'));
const state = createSharedStore('verification-state');
const limiter = require('../../lib/shared_rate_limit').createRateLimit('verification');
app.post('/_fixture/rate', async (_req, res) => { res.json(await limiter.take('same-client', 6, 60000)); });
coordinator.register('verification', 'verification', async () => {});
app.post('/_fixture/enqueue', async (req, res) => {
  await coordinator.enqueue('verification', req.body.key, req.body, { priority: req.body.priority || 0 });
  res.json({ ok: true });
});
app.post('/_fixture/state/:id', async (req, res) => { await state.set(req.params.id, req.body); res.json({ ok: true }); });
app.get('/_fixture/state/:id', async (req, res) => { res.json(await state.get(req.params.id) || null); });
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: error.message }); });
const server = app.listen(0, '127.0.0.1', () => process.send({ type: 'listening', port: server.address().port }));
process.on('SIGTERM', () => { server.close(() => { pool.end().then(() => process.exit(0)); }); });
process.on('disconnect', () => process.exit(1));
