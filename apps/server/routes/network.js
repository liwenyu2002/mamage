const express = require('express');
const { requirePermission } = require('../lib/permissions');
const router = express.Router();

function retiredEntry(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.status(410).json({ ok: false, mode: 'intranet-only', error: 'ENTRY_SWITCH_RETIRED' });
}

// Old clients must not discover the retired Mac gateway or probe external IP services.
router.get('/lan', retiredEntry);
router.get('/lan/manual', requirePermission('photos.view'), retiredEntry);

module.exports = router;
