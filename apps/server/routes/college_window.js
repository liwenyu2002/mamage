const express = require('express');
const { randomUUID } = require('node:crypto');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace } = require('../lib/workspace_access');
const { getFacePermissions } = require('../lib/face_access');
const { accountState } = require('../lib/iam_account_guard');
const { createRateLimit } = require('../lib/shared_rate_limit');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { createCollegeWindowBatches, batchScope } = require('../lib/college_window_batch');
const { searchPhotos } = require('../lib/photo_search');
const { buildMediaUrl } = require('../lib/media_access');
const { editableSourceUrl } = require('../lib/photo_tone/artifacts.cjs');
const storage = require('../lib/cos_storage');
const repository = require('../lib/queries/college_window');
const media = require('../lib/college_window_media');
const { canManage, consumerAllowed, readConfig, publicationText, reviewDigest, selectRequest,
  id, UUID, DIGEST, WindowError, MAX_PUBLISH, MAX_BATCH, ORIGINAL_MODE, PUBLIC_IMAGE_PATH } = require('../lib/college_window_policy');
const MAX_STATION_PHOTOS = 1000;
const SEARCH_TTL = 60 * 60_000;
const notFound = () => new WindowError(404, 'COLLEGE_WINDOW_NOT_FOUND');
const changed = () => new WindowError(409, 'COLLEGE_WINDOW_REVIEW_CHANGED');
const searchExpired = () => new WindowError(409, 'COLLEGE_WINDOW_SEARCH_EXPIRED');
const batchAccessChanged = () => new WindowError(403, 'COLLEGE_WINDOW_BATCH_ACCESS_CHANGED');

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

function batchIds(value) {
  if (!Array.isArray(value) || value.length > MAX_BATCH) throw new WindowError(400, 'COLLEGE_WINDOW_BATCH_IDS_INVALID');
  const ids = [...new Set(value.map(id))];
  if (ids.includes(null)) throw new WindowError(400, 'COLLEGE_WINDOW_BATCH_IDS_INVALID');
  return ids;
}

function requireOriginalConfirmation(body) {
  if (body?.publicationMode !== ORIGINAL_MODE) {
    throw new WindowError(409, 'COLLEGE_WINDOW_ORIGINAL_CONFIRMATION_REQUIRED');
  }
}

function createCollegeWindow({
  config = readConfig(), db = pool, repo = repository, store = storage, images = media, search = searchPhotos,
  userGuard = requirePermission('photos.view'), workspaceFor = resolveWorkspace, facesFor = getFacePermissions,
  rate = createRateLimit('college-window-selection'), batchRunner,
} = {}) {
  const manage = express.Router();
  const delivery = express.Router();
  const publicImages = express.Router();
  const snapshots = createSharedStore('college-window-searches', { db });
  const batches = createCollegeWindowBatches({ db, publishPhoto: publishBatchPhoto, runner: batchRunner });

  async function loadSnapshot(ws, searchId) {
    if (!UUID.test(searchId || '')) throw searchExpired();
    const snapshot = await snapshots.get(batchScope(ws));
    if (snapshot?.id !== searchId || snapshot.expiresAt <= Date.now()) throw searchExpired();
    if (snapshot.requiresFaceSearch && !(await facesFor(ws, db)).search) throw searchExpired();
    return snapshot;
  }

  async function snapshotPage(ws, snapshot, page) {
    const offset = (page - 1) * snapshot.limit;
    const ids = snapshot.ids.slice(offset, offset + snapshot.limit);
    const photos = await repo.shortlist(config, ws, ids, db, snapshot.contentFilter);
    return { photos, total: snapshot.ids.length, searchId: snapshot.id,
      nextPage: offset + snapshot.limit < snapshot.ids.length ? page + 1 : null,
      contentFilter: snapshot.contentFilter || null, aiUsed: snapshot.aiUsed, selectionLimited: false };
  }

  function requireOriginal(sourceUrl) {
    const original = images.originalObject(sourceUrl, config.unitId, store);
    if (!original) throw new WindowError(422, 'COLLEGE_WINDOW_ORIGINAL_UNAVAILABLE');
    return original;
  }

  async function insertOriginals(conn, ids, workspaceAtCommit, { contentFilter, reviews } = {}) {
    const [units] = await conn.query('SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL FOR UPDATE',
      [config.unitId, config.orgId]);
    if (!units.length) throw changed();
    const current = await workspaceAtCommit(conn);
    if (!canManage(config, current)) throw changed();
    const fresh = await repo.readSources(config, current, ids, conn, { lock: true, contentFilter });
    if (fresh.length !== ids.length) throw changed();
    const names = (await facesFor(current, conn)).search ? await repo.confirmedNames(config, ids, conn, { lock: true }) : new Map();
    const releases = fresh.map(row => {
      const photoId = Number(row.id);
      requireOriginal(row.sourceKey);
      const metadata = publicationText(row, names.get(photoId));
      if (reviews && reviewDigest(row, current, metadata) !== reviews.get(photoId)) throw changed();
      return { id: randomUUID(), photoId, originalUrl: row.sourceKey, metadata };
    });
    await repo.insertPublished(config, current, releases, conn);
    return releases;
  }

  async function batchWorkspace(job, connection) {
    const [[user]] = await connection.query(`SELECT u.id, u.organization_id, u.role FROM users u
      WHERE u.id = ? AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = u.role AND rp.permission = 'photos.view')`,
    [job.userId]);
    if (!user || !config || (await accountState(job.userId, connection)).disabled) throw batchAccessChanged();
    let ws;
    try { ws = await workspaceFor({ user, get: name => name === 'x-mamage-unit-id' ? String(config.unitId) : undefined }, connection); }
    catch (error) { if (error.status === 401 || error.status === 403) throw batchAccessChanged(); throw error; }
    if (!canManage(config, ws) || batchScope(ws) !== job.key) throw batchAccessChanged();
    if (job.requiresFaceSearch && !(await facesFor(ws, connection)).search) throw batchAccessChanged();
    return ws;
  }

  async function publishBatchPhoto(job, photoId, save) {
    if (job.publicationMode !== ORIGINAL_MODE) throw new WindowError(412, 'COLLEGE_WINDOW_BATCH_MODE_CHANGED');
    return save(conn => insertOriginals(conn, [photoId], conn => batchWorkspace(job, conn), { contentFilter: job.contentFilter }));
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
  publicImages.use(noStore, (req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
    return config ? next() : res.sendStatus(404);
  });

  manage.post('/candidates', wrap(async (req, res) => {
    const page = req.body?.page === undefined ? 1 : id(req.body.page);
    if (!page) throw new WindowError(400, 'COLLEGE_WINDOW_PAGE_INVALID');
    const ws = req.collegeWindowWorkspace;
    if (req.body?.searchId) {
      const snapshot = await loadSnapshot(ws, req.body.searchId);
      return res.json(await snapshotPage(ws, snapshot, page));
    }
    const options = selectRequest(req.body);
    if (!options) throw new WindowError(400, 'COLLEGE_WINDOW_QUERY_REQUIRED');
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
      collegeWindow: { scope: config, workspace: ws, excluded: options.exclude, contentFilter: options.contentFilter,
        capture: page === 1 && req.body?.capture === true ? MAX_BATCH : 0 },
    });
    if (result.matchIds?.length) {
      const snapshot = { id: randomUUID(), ids: result.matchIds, limit: options.limit, aiUsed: Boolean(result.search?.aiUsed),
        requiresFaceSearch: Boolean(faceSearch && options.query), contentFilter: options.contentFilter, expiresAt: Date.now() + SEARCH_TTL };
      await snapshots.set(batchScope(ws), snapshot);
      return res.json(await snapshotPage(ws, snapshot, page));
    }
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
    requireOriginal(source.sourceKey);
    const names = (await facesFor(ws, db)).search
      ? (await repo.confirmedNames(config, [photoId], db)).get(photoId) : [];
    const metadata = publicationText(source, names);
    const imageUrl = editableSourceUrl(buildMediaUrl(source.sourceKey, { userId: ws.userId, photoId }));
    res.json({ ...metadata, photoId, imageUrl, review: reviewDigest(source, ws, metadata) });
  }));

  manage.post('/bulk/prepare', wrap(async (req, res) => {
    const ws = req.collegeWindowWorkspace;
    const mode = req.body?.mode;
    const excluded = new Set(batchIds(req.body?.excluded ?? []));
    let ids, contentFilter, requiresFaceSearch;
    if (mode === 'matches') {
      const snapshot = await loadSnapshot(ws, req.body?.searchId);
      ({ ids, contentFilter, requiresFaceSearch } = snapshot);
    } else if (mode === 'candidates') {
      ids = batchIds(req.body?.photoIds);
    } else throw new WindowError(400, 'COLLEGE_WINDOW_BATCH_IDS_INVALID');
    const eligible = await repo.eligibleIds(config, ws, ids.filter(id => !excluded.has(id)), db, contentFilter);
    if (!eligible.length) throw new WindowError(409, 'COLLEGE_WINDOW_BATCH_EMPTY');
    res.json(await batches.prepare(ws, { ids: eligible, mode, contentFilter, requiresFaceSearch }));
  }));

  manage.post('/bulk', wrap(async (req, res) => {
    requireOriginalConfirmation(req.body);
    const planId = req.body?.planId;
    if (typeof planId !== 'string' || !UUID.test(planId)) throw new WindowError(400, 'COLLEGE_WINDOW_BATCH_IDS_INVALID');
    res.status(202).json(await batches.start(req.collegeWindowWorkspace, planId));
  }));

  manage.get('/bulk', wrap(async (req, res) => res.json({ job: await batches.status(req.collegeWindowWorkspace) })));
  manage.post('/bulk/:id/cancel', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw notFound();
    res.json({ job: await batches.cancel(req.collegeWindowWorkspace, req.params.id) });
  }));

  manage.post('/publish', wrap(async (req, res) => {
    requireOriginalConfirmation(req.body);
    const reviews = reviewItems(req.body);
    const ids = [...reviews.keys()].sort((a, b) => a - b);
    const conn = await db.getConnection();
    let releases;
    try {
      await conn.beginTransaction();
      releases = await insertOriginals(conn, ids, db => {
        delete req.workspace;
        return workspaceFor(req, db);
      }, { reviews });
      await conn.commit();
    } catch (error) { await conn.rollback().catch(() => {}); throw error; }
    finally { conn.release(); }
    res.status(201).json({ photos: releases.map(({ id, photoId }) => ({ id, photoId, publicImagePath: `${PUBLIC_IMAGE_PATH}/${id}` })) });
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
  publicImages.get('/:id', imageRoute(() => null, true));

  function imageRoute(workspace, originalOnly = false) {
    return wrap(async (req, res) => {
      const { id } = req.params;
      if (!UUID.test(id)) throw notFound();
      const ws = workspace(req);
      const row = await repo.getPublished(config, ws, id, db);
      if (!row) throw notFound();
      if (row.originalUrl) {
        const original = requireOriginal(row.originalUrl);
        const signed = await store.signedGetUrl(original.key, { expires: 60, contentType: original.contentType,
          cacheControl: 'private, no-store',
          ...(req.query.download === '1' ? { downloadName: id + original.extension } : {}) });
        if (!await repo.getPublished(config, ws, id, db)) throw notFound();
        return res.redirect(302, signed.signedUrl);
      }
      if (originalOnly) throw notFound();
      const bytes = await images.load(row.objectKey, row.sha256, store);
      if (!await repo.getPublished(config, ws, id, db)) throw notFound();
      res.type('jpeg').set('Content-Disposition', `inline; filename="${id}.jpg"`).send(bytes);
    });
  }
  return { manage, delivery, publicImages };
}

module.exports = { createCollegeWindow };
