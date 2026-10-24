const express = require('express');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { createOperationsStatus } = require('../lib/operations_status');
const { evaluatePhotoSearch } = require('../lib/photo_search_evaluation');

const router = express.Router();
const status = createOperationsStatus({ pool });
router.get('/status', requirePermission('users.view_all'), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await status.collect()); }
  catch (error) {
    console.error('[operations.status]', error.code || 'STATUS_FAILED');
    res.status(503).json({ error: 'OPERATIONS_STATUS_UNAVAILABLE', message: '运行状态暂时不可用' });
  }
});

router.post('/evaluations', requirePermission('users.view_all'), async (req, res) => {
  const { dataset, runs } = req.body || {};
  if (!dataset || !Array.isArray(runs) || !Array.isArray(dataset.queries) || !Array.isArray(dataset.corpusPhotoIds)
    || dataset.queries.length > 50 || dataset.corpusPhotoIds.length > 2000 || runs.length > 200
    || Buffer.byteLength(JSON.stringify(req.body)) > 1024 * 1024) {
    return res.status(400).json({ error: 'INVALID_EVALUATION', message: '评测文件格式或体积不符合要求' });
  }
  try {
    const report = evaluatePhotoSearch(dataset, runs);
    const saved = { source: 'imported-judgments', createdAt: new Date().toISOString(),
      queryCount: dataset.queries.length, corpusSize: dataset.corpusPhotoIds.length, summary: report.summary,
      expiresAt: Date.now() + 366 * 86400000 };
    await pool.query(`INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES ('operations','evaluation:latest',?,?)
      ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`, [JSON.stringify(saved), saved.expiresAt]);
    res.json(saved);
  } catch (error) {
    if (error.code) {
      console.error('[operations.evaluation]', error.code);
      return res.status(503).json({ error: 'EVALUATION_SAVE_FAILED', message: '评测结果暂时无法保存' });
    }
    res.status(400).json({ error: 'INVALID_EVALUATION', message: '请检查标注完整性、照片编号和查询编号' });
  }
});

module.exports = router;
module.exports.status = status;
