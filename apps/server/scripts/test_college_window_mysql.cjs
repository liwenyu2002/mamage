const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const express = require('express');
const mysql = require('mysql2/promise');
const sharp = require('sharp');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.UPLOAD_BASE_URL = 'http://127.0.0.1:1/api/image';
process.env.MAMAGE_DISTRIBUTED_RUNTIME = '1';
const { splitStatements } = require('./run_migrations');
const { createCoordinator } = require('../lib/distributed_runtime');
const { createCollegeWindow } = require('../routes/college_window');
const { candidateWhere } = require('../lib/queries/college_window');
const { searchPhotos } = require('../lib/photo_search');
const { pool: applicationPool } = require('../db');
const { readConfig, consumerAllowed, selectRequest, automaticTags, deliveryTags, DELIVERY_PATH,
  PUBLIC_IMAGE_PATH, ORIGINAL_MODE } = require('../lib/college_window_policy');

const photoPath = id => 'uploads/college-window-test/' + id + '.png';
const legacyId = 'aabaa099-0000-0000-0000-000000000000';
const legacyKey = 'integrations/college-window/' + legacyId + '.jpg';
const schema = `
  CREATE DATABASE mamage_college_window_test CHARACTER SET utf8mb4;
  USE mamage_college_window_test;
  CREATE TABLE users(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, role VARCHAR(32));
  CREATE TABLE role_permissions(role VARCHAR(32), permission VARCHAR(50));
  CREATE TABLE organization_units(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, archived_at DATETIME NULL);
  CREATE TABLE projects(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, unit_id INT UNSIGNED, name VARCHAR(200),
    restricted_to_user_id INT UNSIGNED, tags TEXT);
  CREATE TABLE photos(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED NOT NULL, unit_id INT UNSIGNED,
    project_id INT UNSIGNED, photographer_id INT UNSIGNED, timeline_section_id INT UNSIGNED,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, url VARCHAR(255), thumb_url VARCHAR(255), tags JSON,
    adjustments JSON, type VARCHAR(50) NOT NULL, source_attribution JSON, ai_status VARCHAR(30), ai_score INT, description TEXT,
    detailed_description TEXT, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL);
  CREATE TABLE project_timeline_sections(id INT UNSIGNED PRIMARY KEY);
  CREATE TABLE photo_faces(id BIGINT UNSIGNED PRIMARY KEY, photo_id INT UNSIGNED, person_id BIGINT UNSIGNED,
    organization_id INT UNSIGNED, status VARCHAR(20));
  CREATE TABLE face_persons(id BIGINT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, name VARCHAR(120));
  CREATE TABLE face_identity_feedback(id INT UNSIGNED PRIMARY KEY, face_id BIGINT UNSIGNED, person_id BIGINT UNSIGNED,
    organization_id INT UNSIGNED, photo_id INT UNSIGNED, sample_kind VARCHAR(16));
  INSERT INTO users VALUES (7,2,'operator'),(8,2,'member');
  INSERT INTO role_permissions VALUES ('operator','photos.view'),('member','photos.view');
  INSERT INTO organization_units VALUES (1,2,NULL),(2,2,NULL);
  INSERT INTO projects VALUES (10,2,1,'校园活动',NULL,NULL),(11,2,1,'私有相册',7,NULL),
    (12,2,2,'别的小组',NULL,NULL),(13,2,1,'内部资料',NULL,'["禁止外发"]'),
    (14,2,1,'同组另一册',NULL,NULL);
  INSERT INTO face_persons VALUES (100,2,'已确认姓名'),(101,2,'未确认姓名');
  INSERT INTO photo_faces VALUES (201,1,100,2,'confirmed'),(202,1,101,2,'confirmed'),(203,9,100,2,'confirmed');
  INSERT INTO face_identity_feedback VALUES (301,201,100,2,1,'explicit'),(302,203,100,2,9,'explicit');
`;

async function verify(db, legacyBytes) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const config = readConfig({ MAMAGE_COLLEGE_WINDOW_ORG_ID: 2, MAMAGE_COLLEGE_WINDOW_UNIT_ID: 1,
    MAMAGE_COLLEGE_WINDOW_MANAGER_IDS: '7,8', MAMAGE_COLLEGE_WINDOW_CONSUMER_TOKEN_SHA256: hash,
    MAMAGE_COLLEGE_WINDOW_CONSUMER_PEERS: '127.0.0.1,10.20.30.0/24' });
  assert.ok(consumerAllowed(config, '::ffff:10.20.30.50', 'Bearer ' + token));
  assert.ok(!consumerAllowed(config, '10.20.29.50', 'Bearer ' + token));
  assert.deepEqual(selectRequest({ query: '帮我选 16 张秋景照片', mode: 'ai' }),
    { query: '秋景', ai: true, limit: 16, exclude: [] });
  assert.deepEqual(selectRequest({ query: '校园秋景，不要出现人脸', mode: 'ai' }),
    { query: '校园秋景', contentFilter: 'no-faces', ai: true, limit: 24, exclude: [] });
  assert.equal(selectRequest({ query: '无人机照片', mode: 'ai' }).contentFilter, undefined);
  assert.equal(selectRequest({ query: '不要无人脸照片', mode: 'ai' }).contentFilter, undefined);
  assert.deepEqual(deliveryTags(null), []);
  assert.deepEqual(deliveryTags('{"tags":["室内"]}'), []);
  assert.deepEqual(deliveryTags('室内,室外'), []);
  const fixtureTags = ['室内', '　全景 ', '室内', '教学楼', 'AI recommended', '待审核',
    '姓名示例', '联系方式 13800138000', { value: '室内' }, ['室外'], '<script>'];
  assert.deepEqual(deliveryTags(JSON.stringify(fixtureTags)), ['室内', '全景', '教学楼']);
  const fixture = [
    [1, 10, 1, 7, 'normal', null, null], [2, 10, 1, 7, 'normal', '["禁止外发"]', null],
    [3, 11, 1, 7, 'normal', null, null], [4, 10, 1, 7, 'video', null, null],
    [5, 12, 2, 7, 'normal', null, null], [6, 10, 1, 7, 'normal', null, '{"sourceUnitId":2}'],
    [7, 10, 1, 8, 'normal', JSON.stringify(fixtureTags), null], [8, 13, 1, 7, 'normal', null, null],
    [9, null, 1, 7, 'normal', null, null],
    [10, 10, null, 7, 'cover', null, '{"type":"external_import","provider":"photoplus"}'],
    [11, 10, 2, 7, 'normal', null, null],
    [12, 10, 1, 7, 'normal', null, '{"type":"external_import","provider":"photoplus","shareId":30}'],
    [13, 10, 1, 7, 'normal', null, '{"type":"unknown","provider":"alltuu"}'],
  ];
  await db.query(`INSERT INTO photos (id,organization_id,project_id,unit_id,photographer_id,type,tags,source_attribution,
    url,ai_status,description) VALUES ?`, [fixture.map(([id, ...other]) => [id, 2, ...other, photoPath(id), 'done',
    id === 7 ? '报名咨询电话 138-0013-8000' : '校园活动现场'])]);
  await db.query('UPDATE photos SET adjustments = ? WHERE id = 9',
    [JSON.stringify({ version: 3, crop: { x: 0, y: 0, width: 0.5, height: 1 } })]);
  const tagUpdate = automaticTags('["AI重新打标"]');
  await db.query('UPDATE photos SET tags = ' + tagUpdate.sql + ' WHERE id = 2', tagUpdate.params);
  const [[tagged]] = await db.query('SELECT tags FROM photos WHERE id=2');
  assert.deepEqual(tagged.tags, ['AI重新打标', '禁止外发']);
  const input = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#317d6b' } })
    .withMetadata({ exif: { IFD0: { Artist: 'Private test metadata' } } }).png().toBuffer();
  const objects = new Map(fixture.map(([id]) => [photoPath(id), input]));
  let dispatchAllowed = true;
  let renderedReads = 0, signedReads = 0;
  const store = {
    keyFromUrlOrPath: key => key, isSafeKey: () => true,
    getObject: async key => {
      assert.equal(key, legacyKey, 'Only legacy previews may read image bodies in MaMage');
      renderedReads++;
      return { Body: Readable.from([legacyBytes]) };
    },
    headObject: async () => assert.fail('Publication must not request object metadata'),
    uploadBuffer: async () => assert.fail('Publication must not upload a copy'),
    deleteObjects: async () => assert.fail('Publication must not delete an object'),
    signedGetUrl: async (key, options) => {
      assert.ok(objects.has(key), 'Only existing fixture originals may be signed');
      assert.equal(options.expires, 60);
      assert.equal(options.contentType, 'image/png');
      assert.equal(options.cacheControl, 'private, no-store');
      signedReads++;
      const query = new URLSearchParams({ key, ...(options.downloadName ? { filename: options.downloadName } : {}) });
      return { signedUrl: 'http://127.0.0.1:' + server.address().port + '/fixture-original?' + query.toString() };
    },
  };
  const app = express();
  app.use(express.json());
  app.get('/fixture-original', (req, res) => {
    const bytes = objects.get(req.query.key);
    if (!bytes) return res.sendStatus(404);
    if (req.query.filename) res.attachment(req.query.filename);
    res.type('png').send(bytes);
  });
  const runner = createCoordinator({ db, intervalMs: 100, maxActive: 1, canDispatch: () => dispatchAllowed,
    onLost: error => { throw error; } });
  const { manage, delivery, publicImages } = createCollegeWindow({
    config, db, store, batchRunner: runner, rate: { take: async () => ({ allowed: true }) },
    userGuard: (req, res, next) => {
      const id = Number(req.get('x-test-user'));
      if (!id) return res.sendStatus(401);
      req.user = { id };
      next();
    },
    workspaceFor: async req => ({ userId: req.user.id, enabled: true, orgId: 2,
      unitId: Number(req.get('x-mamage-unit-id')) || 1, role: 'manager', ownPhotosOnly: req.user.id === 8 }),
    facesFor: async ws => ({ search: !ws.ownPhotosOnly }),
    search: async options => {
      if (options.collegeWindow.capture) {
        const query = applicationPool.query;
        applicationPool.query = db.query.bind(db);
        try { return await searchPhotos({ ...options, faceSearchAllowed: false }); }
        finally { applicationPool.query = query; }
      }
      const { scope, workspace, excluded, contentFilter } = options.collegeWindow;
      const filter = candidateWhere(scope, workspace, excluded, contentFilter);
      const page = options.page || 1;
      const from = ' FROM photos p LEFT JOIN projects pr ON pr.id=p.project_id WHERE ' + filter.sql;
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total' + from, filter.params);
      const [list] = await db.query('SELECT p.id' + from + ' ORDER BY p.id LIMIT ? OFFSET ?',
        [...filter.params, options.pageSize, (page - 1) * options.pageSize]);
      return { list, total, hasMore: page * options.pageSize < total, search: { aiUsed: options.enableAi } };
    },
  });
  app.use('/manage', manage);
  app.use(DELIVERY_PATH, delivery);
  app.use(PUBLIC_IMAGE_PATH, publicImages);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    async function call(url, status, { token, user, unit, method = 'GET', body } = {}) {
      const res = await fetch(base + url, { method, redirect: 'manual', body: body ? JSON.stringify(body) : undefined, headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(user ? { 'x-test-user': String(user) } : {}),
        ...(unit ? { 'x-mamage-unit-id': String(unit) } : {}),
        'Content-Type': 'application/json', 'X-Forwarded-For': '10.20.29.50',
      } });
      assert.equal(res.status, status, method + ' ' + url + ' ' + (res.status === status ? '' : await res.text()));
      return res;
    }
    const list = (suffix = '') => call(DELIVERY_PATH + '/photos' + suffix, 200, { token }).then(res => res.json());
    const preview = (id, user = 7) => call('/manage/candidates/' + id + '/preview', 200, { user }).then(res => res.json());
    const publish = (photos, status = 201, user = 7) => call('/manage/publish', status, { user, method: 'POST', body: {
      publicationMode: ORIGINAL_MODE, photos: photos.map(({ photoId, review }) => ({ photoId, review })),
    } }).then(res => res.json());
    const select = (user, exclude = [], query = '选 20 张校园活动', page = 1, extra = {}) => call('/manage/candidates', 200, { user, method: 'POST',
      body: { mode: 'ai', query, exclude, page, ...extra } }).then(res => res.json());
    const station = (user, photoIds, status = 200) => call('/manage/candidates/from-station', status,
      { user, method: 'POST', body: { photoIds } }).then(res => res.ok ? res.json() : res.text());

    await call('/manage/published', 403, { user: 99 });
    await call('/manage/published', 403, { user: 7, unit: 2 });
    await call(DELIVERY_PATH + '/photos', 401, { user: 7 });
    const [legacy] = (await list()).photos;
    assert.equal(legacy.id, legacyId);
    assert.deepEqual(legacy.tags, ['室内', '全景', '教学楼'], 'Historical photos include only allowed tags');
    assert.ok(!legacy.publicImagePath);
    const historical = await call(legacy.imagePath, 200, { token });
    assert.deepEqual(Buffer.from(await historical.arrayBuffer()), legacyBytes);
    await call(PUBLIC_IMAGE_PATH + '/' + legacyId, 404);
    await call('/manage/published/' + legacyId, 204, { user: 7, method: 'DELETE' });
    assert.equal(renderedReads, 1);
    assert.deepEqual((await list()).photos, []);
    assert.deepEqual((await select(7, [10])).photos.map(item => item.photoId), [1, 7, 9]);
    assert.deepEqual((await select(8)).photos.map(item => item.photoId), [7]);
    await station(99, [1], 403);
    await station(7, ['not-a-photo-id'], 400);
    const stationBatch = await station(7, [7, 2, 3, 4, 5, 6, 8, 11, 1, 7]);
    assert.deepEqual(stationBatch.photos.map(item => item.photoId), [7, 1],
      'Only eligible scoped photos can be imported, in station order, without duplicates');
    assert.equal(stationBatch.skipped, 7);
    assert.deepEqual((await station(8, [1, 7])).photos.map(item => item.photoId), [7]);
    assert.deepEqual((await station(7, [12, 10, 13])).photos.map(item => item.photoId), [10],
      'A direct album import is eligible, but share copies and unknown origins are not');

    await db.query("UPDATE photos SET tags = CASE id WHEN 7 THEN JSON_ARRAY('无人') WHEN 9 THEN NULL " +
      "ELSE JSON_ARRAY('无人') END WHERE id IN (1,7,9,10)");
    await db.query("UPDATE photos SET ai_status = 'pending' WHERE id = 10");
    const noFaces = await select(7, [], '选出所有无人脸照片');
    assert.deepEqual(noFaces.photos.map(item => item.photoId), [7],
      'Known faces, unanalysed photos and missing tags are not evidence of a face-free shot');
    assert.equal(noFaces.contentFilter, 'no-faces');
    assert.deepEqual((await select(7, [7], '不含人脸的照片')).photos, []);
    await db.query("UPDATE photos SET tags = JSON_ARRAY('无人脸','单人','背影'), ai_status = 'done' WHERE id = 10");
    assert.deepEqual((await select(7, [], '不露脸的照片')).photos.map(item => item.photoId), [7, 10]);
    const firstPage = await select(7, [], '选 1 张不露脸的照片');
    assert.equal(firstPage.total, 2, 'Report the full scoped match count, not the page length');
    assert.equal(firstPage.nextPage, 2);
    assert.deepEqual(firstPage.photos.map(item => item.photoId), [7]);
    const secondPage = await select(7, [], '选 1 张不露脸的照片', firstPage.nextPage);
    assert.equal(secondPage.total, 2);
    assert.equal(secondPage.nextPage, null);
    assert.deepEqual(secondPage.photos.map(item => item.photoId), [10]);
    assert.deepEqual((await select(7, [], '无人照片')).photos.map(item => item.photoId), [7]);
    await db.query("UPDATE photos SET tags = JSON_ARRAY('无人脸','侧脸') WHERE id = 10");
    assert.deepEqual((await select(7, [], '无人脸照')).photos.map(item => item.photoId), [7]);
    await db.query("UPDATE photos SET tags = NULL, ai_status = 'done' WHERE id IN (1,7,9,10)");

    await call('/manage/candidates/1/preview', 404, { user: 8 });
    const one = await preview(1);
    const cropped = await preview(9);
    assert.deepEqual(one.peopleNames, ['已确认姓名']);
    assert.match(cropped.imageUrl, /[?&]original=1/);
    assert.ok(!cropped.jpeg);
    assert.deepEqual(cropped.peopleNames, ['已确认姓名']);
    assert.equal((await preview(7)).description, null);
    await call('/manage/publish', 409, { user: 7, method: 'POST', body: { photos: [{ photoId: 1, review: one.review }] } });
    await publish([one], 409, 8);
    await db.query("UPDATE photos SET description = '更新后的校园活动', tags = JSON_ARRAY('全景','校园建筑','AI medium') WHERE id = 1");
    await publish([one], 409);
    const reviewed = await preview(1);
    const releases = (await publish([reviewed, cropped])).photos;
    const first = releases.find(photo => photo.photoId === 1);
    assert.equal(renderedReads, 1);
    assert.equal(signedReads, 0, 'Do not contact the storage signer while publishing');
    assert.deepEqual(await station(7, [1]), { photos: [], skipped: 1 });
    const before = await list('?limit=1');
    assert.equal(before.photos.length, 1);
    assert.ok(before.nextCursor);
    assert.equal((await list('?limit=1&after=' + before.nextCursor)).photos.length, 1);
    const imagePath = DELIVERY_PATH + '/photos/' + first.id + '/image';
    const actual = await call(imagePath, 302, { token });
    assert.match(actual.headers.get('cache-control'), /no-store/);
    const shared = await call(first.publicImagePath, 302);
    assert.match(shared.headers.get('x-robots-tag'), /noindex/);
    assert.equal(shared.headers.get('location'), actual.headers.get('location'));
    assert.deepEqual(Buffer.from(await (await fetch(shared.headers.get('location'))).arrayBuffer()), input);
    const croppedOriginal = await call(releases.find(photo => photo.photoId === 9).publicImagePath + '?download=1', 302);
    const originalFile = await fetch(croppedOriginal.headers.get('location'));
    assert.match(originalFile.headers.get('content-disposition'), /attachment/);
    const originalBytes = Buffer.from(await originalFile.arrayBuffer());
    assert.deepEqual(originalBytes, input, 'Bytes are unchanged even when the MaMage photo has saved crop settings');
    assert.equal((await sharp(originalBytes).metadata()).width, 180);
    assert.ok((await sharp(originalBytes).metadata()).exif);
    const { photos } = await list();
    const firstPhoto = photos.find(photo => photo.id === first.id);
    assert.equal(firstPhoto.description, '更新后的校园活动');
    assert.deepEqual(firstPhoto.tags, ['全景', '校园建筑']);
    assert.deepEqual(photos.find(photo => photo.id !== first.id).tags, []);
    assert.ok(photos.every(photo => !('photoId' in photo) && !('objectKey' in photo) && !('originalUrl' in photo)
      && photo.width === null && photo.sha256 === null));
    await db.query("UPDATE photos SET description = '发布后的文字变更', tags = JSON_ARRAY('夜景','室外','待审核') WHERE id = 1");
    const updated = (await list()).photos.find(photo => photo.id === first.id);
    assert.equal(updated.description, '更新后的校园活动');
    assert.deepEqual(updated.tags, ['夜景', '室外'], 'Safe tags follow the source without republishing');
    await db.query("UPDATE photos SET source_attribution = JSON_OBJECT('type','external_import','provider','alltuu') WHERE id = 1");
    assert.ok((await list()).photos.some(photo => photo.id === first.id), 'Recording a supported direct import does not revoke a release');

    // Restriction can be set and cleared between consumer polls; old publications must stay withdrawn.
    await db.query('UPDATE photos SET tags = ? WHERE id = 1', ['["禁止外发"]']);
    await db.query('UPDATE photos SET tags = NULL WHERE id = 1');
    await call(imagePath, 404, { token });
    await call(first.publicImagePath, 404);
    assert.equal((await list()).photos.length, 1);
    const second = (await publish([await preview(1)])).photos[0];
    assert.notEqual(second.id, first.id);
    await db.query('UPDATE photos SET url = ? WHERE id = 1', [photoPath(7)]);
    await db.query('UPDATE photos SET url = ? WHERE id = 1', [photoPath(1)]);
    await call(second.publicImagePath, 404);
    await publish([await preview(1)]);
    await db.query('UPDATE projects SET restricted_to_user_id = 7 WHERE id = 10');
    await db.query('UPDATE projects SET restricted_to_user_id = NULL WHERE id = 10');
    assert.equal((await list()).photos.length, 1);
    const third = (await publish([await preview(1)])).photos[0];
    await db.query('UPDATE photos SET project_id = 14 WHERE id = 1');
    assert.ok((await list()).photos.some(item => item.id === third.id), 'Moves within the same eligible unit retain the reviewed version');
    await db.query('UPDATE photos SET project_id = 12 WHERE id = 1');
    await db.query('UPDATE photos SET project_id = 14 WHERE id = 1');
    await call(DELIVERY_PATH + '/photos/' + third.id + '/image', 404, { token });
    const fourth = (await publish([await preview(1)])).photos[0];
    await db.query('UPDATE photos SET tags = ? WHERE id = 1', ['["已脱敏"]']);
    await call(DELIVERY_PATH + '/photos/' + fourth.id + '/image', 404, { token });
    await db.query('UPDATE photos SET tags = ' + tagUpdate.sql + ' WHERE id = 1', tagUpdate.params);
    await call('/manage/candidates/1/preview', 404, { user: 7 });
    assert.deepEqual(await station(7, [1]), { photos: [], skipped: 1 });
    await db.query('UPDATE photos SET tags = NULL WHERE id = 1');
    const fifth = (await publish([await preview(1)])).photos[0];
    await db.query('DELETE FROM projects WHERE id = 14');
    await call(DELIVERY_PATH + '/photos/' + fifth.id + '/image', 404, { token });
    const remaining = (await list()).photos[0];
    await call('/manage/published/' + remaining.id, 204, { user: 7, method: 'DELETE' });
    await call(remaining.imagePath, 404, { token });
    await call(remaining.publicImagePath, 404);
    assert.equal((await list()).photos.length, 0);
    const again = (await publish([await preview(1), await preview(10)])).photos;
    await db.query('DELETE FROM photos WHERE id = 1');
    await call(DELIVERY_PATH + '/photos/' + again[0].id + '/image', 404, { token });
    await db.query("UPDATE photos SET source_attribution = JSON_SET(source_attribution,'$.shareId',30) WHERE id = 10");
    await db.query("UPDATE photos SET source_attribution = JSON_REMOVE(source_attribution,'$.shareId') WHERE id = 10");
    await call(DELIVERY_PATH + '/photos/' + again[1].id + '/image', 404, { token });
    await publish([await preview(10)]);
    await db.query('UPDATE organization_units SET archived_at = NOW() WHERE id=1');
    await db.query('UPDATE organization_units SET archived_at = NULL WHERE id=1');
    assert.deepEqual((await list()).photos, []);

    async function addBatchPhotos(ids) {
      await db.query(`INSERT INTO photos (id, organization_id, unit_id, project_id, photographer_id, url, type, tags, ai_status)
        VALUES ?`, [ids.map(id => [id, 2, 1, 10, 7, photoPath(id), 'normal', '["无人"]', 'done'])]);
      ids.forEach(id => objects.set(photoPath(id), input));
    }
    const prepareBatch = (body, user = 7, code = 200) => call('/manage/bulk/prepare', code, { user, method: 'POST', body }).then(res => res.json());
    const startBatch = (planId, user = 7, code = 202) => call('/manage/bulk', code,
      { user, method: 'POST', body: { planId, publicationMode: ORIGINAL_MODE } }).then(res => res.json());
    const jobStatus = (user = 7) => call('/manage/bulk', 200, { user }).then(res => res.json()).then(result => result.job);
    async function waitBatch(status, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const job = await jobStatus();
        if (job?.status === status) return job;
        if (job?.status === 'failed') throw new Error('Unexpected batch failure: ' + job.error);
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      throw new Error('Timed out waiting for batch: ' + status);
    }
    await addBatchPhotos(Array.from({ length: 30 }, (_, index) => 101 + index));
    const round = await select(7, [], '选 3 张无人脸照片', 1, { capture: true });
    assert.equal(round.total, 30);
    assert.deepEqual(round.photos.map(item => item.photoId), [130, 129, 128]);
    assert.ok(round.searchId);
    await addBatchPhotos([131, 132]);
    const following = await select(7, [], '', round.nextPage, { searchId: round.searchId });
    assert.deepEqual(following.photos.map(item => item.photoId), [127, 126, 125]);
    assert.equal(following.total, 30, 'New records do not enter an existing selection');
    const selection = { mode: 'matches', searchId: round.searchId, excluded: [129] };
    await prepareBatch(selection, 8, 409);
    const plan = await prepareBatch(selection);
    assert.equal(plan.count, 29);
    assert.equal(plan.contentFilter, 'no-faces');
    assert.equal((await list()).photos.length, 0, 'Preparing a batch does not publish anything');
    await call('/manage/bulk', 409, { user: 7, method: 'POST', body: { planId: plan.id } });
    await startBatch(plan.id, 8, 409);
    await db.query(`UPDATE photos SET tags = CASE id WHEN 125 THEN JSON_ARRAY('侧脸') ELSE JSON_ARRAY('禁止外发') END
      WHERE id IN (125,127)`);
    await db.query("UPDATE photos SET url = 'uploads/college-window-test/not-an-image.html' WHERE id = 130");
    const signaturesBefore = signedReads;
    assert.equal((await startBatch(plan.id)).status, 'queued');
    assert.equal((await startBatch(plan.id)).id, plan.id, 'Submitting twice does not create a second job');
    assert.equal(await jobStatus(8), null, 'Status is isolated by operator');
    runner.start();
    const done = await waitBatch('done');
    assert.deepEqual([done.processed, done.published, done.skipped, done.failed], [29, 26, 2, 1]);
    assert.equal(signedReads, signaturesBefore);
    assert.equal(renderedReads, 1);
    const reserve = await call('/manage/published?limit=100', 200, { user: 7 }).then(res => res.json());
    assert.equal(reserve.photos.length, 26);
    for (const rejected of [125, 127, 129, 130, 131, 132]) assert.ok(!reserve.photos.some(item => item.photoId === rejected));

    dispatchAllowed = false;
    const cancelledPlan = await prepareBatch({ mode: 'candidates', photoIds: [131, 132, 132, 2, 4, 5] });
    assert.equal(cancelledPlan.count, 2, 'Batch preparation excludes denied sources and duplicates');
    await startBatch(cancelledPlan.id);
    await call('/manage/bulk/' + cancelledPlan.id + '/cancel', 200, { user: 7, method: 'POST' });
    assert.equal((await jobStatus()).status, 'cancelled');
    assert.equal((await list()).photos.length, 26);
    await startBatch(plan.id, 7, 409);

    const legacyPlan = await prepareBatch({ mode: 'candidates', photoIds: [131, 132] });
    await startBatch(legacyPlan.id);
    await db.query("UPDATE runtime_tasks SET payload = JSON_REMOVE(payload,'$.publicationMode') WHERE dedupe_key = ?", [legacyPlan.id]);
    dispatchAllowed = true;
    const legacyJob = await waitBatch('failed');
    assert.equal(legacyJob.error, 'COLLEGE_WINDOW_BATCH_MODE_CHANGED');
    assert.equal(legacyJob.published, 0, 'An old batch never silently becomes an original link');

    dispatchAllowed = false;
    const deniedPlan = await prepareBatch({ mode: 'candidates', photoIds: [131, 132] });
    await startBatch(deniedPlan.id);
    await db.query("DELETE FROM role_permissions WHERE role = 'operator'");
    dispatchAllowed = true;
    const denied = await waitBatch('failed');
    assert.equal(denied.error, 'COLLEGE_WINDOW_BATCH_ACCESS_CHANGED');
    assert.equal(denied.published, 0);
    assert.equal((await list()).photos.length, 26);

    await db.query("INSERT INTO role_permissions VALUES ('operator', 'photos.view')");
    const largeIds = Array.from({ length: 675 }, (_, index) => 1000 + index);
    await addBatchPhotos(largeIds);
    const largePlan = await prepareBatch({ mode: 'candidates', photoIds: largeIds });
    assert.equal(largePlan.count, 675);
    const startedAt = Date.now();
    await startBatch(largePlan.id);
    const large = await waitBatch('done', 30000);
    assert.equal(large.published, 675);
    assert.equal(renderedReads, 1);
    assert.equal(signedReads, signaturesBefore);
    console.log('675 original links registered in ' + ((Date.now() - startedAt) / 1000).toFixed(2) + 's with no object-storage requests.');
  } finally { await runner.stop(); await new Promise(resolve => server.close(resolve)); }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-qa-'));
  const data = path.join(root, 'data');
  const socketPath = path.join(root, 'db.sock');
  const mysqld = process.env.MAMAGE_TEST_MYSQLD || '/opt/homebrew/bin/mysqld';
  assert.ok(path.isAbsolute(mysqld));
  fs.mkdirSync(data);
  let server, startupError, connection, db;
  try {
    execFileSync(mysqld, ['--no-defaults', '--initialize-insecure', '--datadir=' + data], { stdio: 'ignore', timeout: 90000 });
    server = spawn(mysqld, ['--no-defaults', '--datadir=' + data, '--socket=' + socketPath,
      '--skip-networking', '--mysqlx=OFF', '--skip-log-bin'], { stdio: 'ignore' });
    server.on('error', error => { startupError = error; });
    for (let i = 0; i < 100; i++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw Error('Disposable MySQL failed to start');
      try { connection = await mysql.createConnection({ socketPath, user: 'root', multipleStatements: true, connectTimeout: 1000 }); break; }
      catch (_) { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    assert.ok(connection, 'Disposable MySQL is required');
    await connection.query(schema);
    const migrations = ['20261013_003_shared_runtime.sql', '20261017_001_runtime_task_failures.sql',
      '20261126_001_college_window.sql', '20261126_002_college_window_direct_imports.sql']
      .map(filename => fs.readFileSync(path.join(__dirname, 'migrations', filename), 'utf8'));
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const migration of migrations) {
        for (const stmt of splitStatements(migration)) await connection.query(stmt);
      }
    }
    const legacyBytes = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#a6c0c3' } }).jpeg().toBuffer();
    await connection.query(`INSERT INTO college_window_photos
      (id, organization_id, unit_id, photo_id, object_key, metadata, width, height, sha256, published_by)
      VALUES (?,2,1,7,?,'{}',180,120,?,7)`, [legacyId, legacyKey, createHash('sha256').update(legacyBytes).digest('hex')]);
    const originalMigration = fs.readFileSync(path.join(__dirname, 'migrations/20261126_003_college_window_original_links.sql'), 'utf8');
    for (const stmt of splitStatements(originalMigration)) await connection.query(stmt);
    db = mysql.createPool({ socketPath, user: 'root', database: 'mamage_college_window_test', connectionLimit: 4 });
    await verify(db, legacyBytes);
    console.log('College Window: original links without storage I/O, legacy renditions, exclusions, cancellation and revocation passed on isolated MySQL.');
  } finally {
    await db?.end();
    await connection?.end();
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
