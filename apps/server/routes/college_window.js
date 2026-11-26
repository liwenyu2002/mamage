const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace } = require('../lib/workspace_access');
const { getFacePermissions } = require('../lib/face_access');
const { createRateLimit } = require('../lib/shared_rate_limit');
const { searchPhotos } = require('../lib/photo_search');
const storage = require('../lib/cos_storage');
const repository = require('../lib/queries/college_window');
const media = require('../lib/college_window_media');
const { canManage, consumerAllowed, readConfig, publicationText, reviewDigest, selectRequest,
  id, UUID, DIGEST, MAX_PUBLISH } = require('../lib/college_window_policy');
const MAX_STATION_PHOTOS = 1000;

class WindowError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const notFound = () => new WindowError(404, 'COLLEGE_WINDOW_NOT_FOUND');
const changed = () => new WindowError(409, 'COLLEGE_WINDOW_REVIEW_CHANGED');

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof WindowError) return res.status(error.status).json({ error: error.code });
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: changed().code });
      console.error('[college-window]', error.code || error.name);
      return res.status(503).json({ error: 'COLLEGE_WINDOW_UNAVAILABLE' });
    }
  };
}

function noStore(req, res, next) {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  next();
}

function paging(req) {
  const after = String(req.query.after || '');
  if (after && !UUID.test(after)) throw new WindowError(400, 'COLLEGE_WINDOW_CURSOR_INVALID');
  return { after, limit: Math.min(200, id(req.query.limit) || 50) };
}

function reviewItems(body) {
  if (!Array.isArray(body?.photos) || !body.photos.length || body.photos.length > MAX_PUBLISH) {
    throw new WindowError(400, 'COLLEGE_WINDOW_REVIEWS_REQUIRED');
  }
  const result = new Map();
  for (const item of body.photos) {
    const photoId = id(item?.photoId);
    if (!photoId || result.has(photoId) || !DIGEST.test(item?.review || '')) {
      throw new WindowError(400, 'COLLEGE_WINDOW_REVIEWS_REQUIRED');
    }
    result.set(photoId, item.review);
  }
  return result;
}

function createCollegeWindow({
  config = readConfig(), db = pool, repo = repository, store = storage, images = media, search = searchPhotos,
  userGuard = requirePermission('photos.view'), workspaceFor = resolveWorkspace, facesFor = getFacePermissions,
  rate = createRateLimit('college-window-selection'),
} = {}) {
  const manage = express.Router();
  const delivery = express.Router();
  let rendersInFlight = 0;

  async function render(source) {
    if (rendersInFlight >= 3) throw new WindowError(429, 'COLLEGE_WINDOW_BUSY');
    rendersInFlight += 1;
    try { return await images.render(source, store); }
    catch { throw new WindowError(422, 'COLLEGE_WINDOW_IMAGE_UNAVAILABLE'); }
    finally { rendersInFlight -= 1; }
  }

  manage.use(noStore, (req, res, next) => config ? next() : res.sendStatus(404), userGuard);
  manage.use(async (req, res, next) => {
    try {
      const ws = await workspaceFor(req, db);
      if (!canManage(config, ws)) return res.sendStatus(403);
      req.collegeWindowWorkspace = ws;
      next();
    } catch (error) { res.sendStatus(error.status || 503); }
  });
  delivery.use(noStore, (req, res, next) => {
    if (!config?.tokenHash || !config.peers) return res.sendStatus(404);
    if (consumerAllowed(config, req.socket.remoteAddress, req.get('Authorization'))) return next();
    res.set('WWW-Authenticate', 'Bearer realm="college-window"').sendStatus(401);
  });

  manage.post('/candidates', wrap(async (req, res) => {
    const options = selectRequest(req.body);
    if (!options) throw new WindowError(400, 'COLLEGE_WINDOW_QUERY_REQUIRED');
    const page = req.body?.page === undefined ? 1 : id(req.body.page);
    if (!page) throw new WindowError(400, 'COLLEGE_WINDOW_PAGE_INVALID');
    const ws = req.collegeWindowWorkspace;
    const budget = await rate.take(ws.userId, options.ai ? 12 : 36, 60_000);
    if (!budget.allowed) {
      res.set('Retry-After', String(budget.retryAfterSec));
      throw new WindowError(429, 'COLLEGE_WINDOW_BUSY');
    }
    const faceSearch = (await facesFor(ws, db)).search;
    const result = await search({ q: options.query, page, pageSize: options.limit,
      orgId: config.orgId, unitId: config.unitId, workspaceEnabled: true, userId: ws.userId,
      ownPhotosOnly: ws.ownPhotosOnly, collegeAdmin: ws.collegeAdmin, faceSearchAllowed: faceSearch,
      enableAi: options.ai, sort: options.query ? 'relevance' : 'newest',
      collegeWindow: { scope: config, workspace: ws, excluded: options.exclude, contentFilter: options.contentFilter },
    });
    const photos = await repo.shortlist(config, ws, result.list.map(row => Number(row.id)), db, options.contentFilter);
    res.json({ photos, total: result.total, nextPage: result.hasMore ? page + 1 : null,
      contentFilter: options.contentFilter || null, aiUsed: Boolean(result.search?.aiUsed),
      selectionLimited: options.ai && Boolean(result.search?.degraded) });
  }));

  manage.post('/candidates/from-station', wrap(async (req, res) => {
    const values = req.body?.photoIds;
    if (!Array.isArray(values) || !values.length || values.length > MAX_STATION_PHOTOS) {
      throw new WindowError(400, 'COLLEGE_WINDOW_PHOTO_IDS_INVALID');
    }
    const ids = [...new Set(values.map(id))];
    if (ids.includes(null)) throw new WindowError(400, 'COLLEGE_WINDOW_PHOTO_IDS_INVALID');
    const photos = await repo.shortlist(config, req.collegeWindowWorkspace, ids, db);
    res.json({ photos, skipped: ids.length - photos.length });
  }));

  manage.get('/candidates/:photoId/preview', wrap(async (req, res) => {
    const ws = req.collegeWindowWorkspace;
    const photoId = id(req.params.photoId);
    const [source] = photoId ? await repo.readSources(config, ws, [photoId], db) : [];
    if (!source) throw notFound();
    const hidePeople = images.hidesIdentity(source);
    const names = (await facesFor(ws, db)).search && !hidePeople
      ? (await repo.confirmedNames(config, [photoId], db)).get(photoId) : [];
    const metadata = publicationText(source, names, hidePeople);
    const result = await render(source);
    res.json({ ...metadata, photoId, width: result.width, height: result.height, jpeg: result.data.toString('base64'),
      review: reviewDigest(source, ws, metadata, result.sha256) });
  }));

  manage.post('/publish', wrap(async (req, res) => {
    const ws = req.collegeWindowWorkspace;
    const reviews = reviewItems(req.body);
    const ids = [...reviews.keys()].sort((a, b) => a - b);
    const rows = await repo.readSources(config, ws, ids, db);
    if (rows.length !== ids.length) throw changed();
    const canSeeNames = (await facesFor(ws, db)).search;
    const names = canSeeNames ? await repo.confirmedNames(config, ids, db) : new Map();
    const releases = [];
    let committing = false;
    try {
      for (const row of rows) {
        const photoId = Number(row.id);
        const metadata = publicationText(row, names.get(photoId), images.hidesIdentity(row));
        const { data, ...result } = await render(row);
        if (reviewDigest(row, ws, metadata, result.sha256) !== reviews.get(photoId)) throw changed();
        const objectKey = `${media.OBJECT_PREFIX}${randomUUID()}.jpg`;
        releases.push({ ...result, id: randomUUID(), objectKey, photoId, metadata });
        await store.uploadBuffer(objectKey, data, { contentType: 'image/jpeg', cacheControl: 'private, no-store' });
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [units] = await conn.query('SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL FOR UPDATE',
          [config.unitId, config.orgId]);
        if (!units.length) throw changed();
        delete req.workspace;
        const current = await workspaceFor(req, conn);
        if (!canManage(config, current)) throw changed();
        const fresh = await repo.readSources(config, current, ids, conn, { lock: true });
        if (fresh.length !== ids.length) throw changed();
        const freshNames = (await facesFor(current, conn)).search
          ? await repo.confirmedNames(config, ids, conn, { lock: true }) : new Map();
        for (const release of releases) {
          const row = fresh.find(source => Number(source.id) === release.photoId);
          const metadata = publicationText(row, freshNames.get(release.photoId), images.hidesIdentity(row));
          if (reviewDigest(row, current, metadata, release.sha256) !== reviews.get(release.photoId)) throw changed();
        }
        await repo.insertPublished(config, current, releases, conn);
        committing = true;
        await conn.commit();
      } catch (error) { await conn.rollback().catch(() => {}); throw error; }
      finally { conn.release(); }
    } catch (error) {
      // A connection loss during COMMIT does not prove that the transaction rolled back.
      if (!committing && releases.length) await store.deleteObjects(releases.map(item => item.objectKey)).catch(() => {});
      throw error;
    }
    res.status(201).json({ photos: releases.map(({ id, photoId }) => ({ id, photoId })) });
  }));

  manage.get('/published', wrap(async (req, res) => {
    res.json(await repo.listPublished(config, req.collegeWindowWorkspace, paging(req), db));
  }));
  manage.get('/published/:id/image', imageRoute(req => req.collegeWindowWorkspace));
  manage.delete('/published/:id', wrap(async (req, res) => {
    if (!UUID.test(req.params.id) || !await repo.withdraw(config, req.collegeWindowWorkspace, req.params.id, db)) throw notFound();
    res.status(204).end();
  }));

  delivery.get('/photos', wrap(async (req, res) => {
    res.json(await repo.listPublished(config, null, paging(req), db));
  }));
  delivery.get('/photos/:id/image', imageRoute(() => null));

  function imageRoute(workspace) {
    return wrap(async (req, res) => {
      const { id } = req.params;
      if (!UUID.test(id)) throw notFound();
      const ws = workspace(req);
      const row = await repo.getPublished(config, ws, id, db);
      if (!row) throw notFound();
      const bytes = await images.load(row.objectKey, row.sha256, store);
      if (!await repo.getPublished(config, ws, id, db)) throw notFound();
      res.type('jpeg').set('Content-Disposition', `inline; filename="${id}.jpg"`).send(bytes);
    });
  }
  return { manage, delivery };
}

module.exports = { createCollegeWindow };
