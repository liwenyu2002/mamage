const express = require('express');
const router = express.Router();
const orgDao = require('../lib/queries/organizations');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { positiveId } = require('../lib/workspace_access');

// GET /api/organizations
// Optional query: q (search by name), limit
router.get('/', requirePermission('photos.view'), async (req, res) => {
  try {
    const organizationId = positiveId(req.user?.organization_id);
    if (!organizationId) return res.json([]);
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 200) limit = 50;

    res.json(await orgDao.listOrganizationsForMember(pool, { organizationId, query, limit }));
  } catch (err) {
    console.error('GET /api/organizations error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
