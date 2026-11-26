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
const { splitStatements } = require('./run_migrations');
const { createCollegeWindow } = require('../routes/college_window');
const { candidateWhere } = require('../lib/queries/college_window');
const { readConfig, consumerAllowed, selectRequest, automaticTags, DELIVERY_PATH } = require('../lib/college_window_policy');

const photoPath = id => 'uploads/college-window-test/' + id + '.png';
const schema = `
  CREATE DATABASE mamage_college_window_test CHARACTER SET utf8mb4;
  USE mamage_college_window_test;
  CREATE TABLE organization_units(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, archived_at DATETIME NULL);
  CREATE TABLE projects(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, unit_id INT UNSIGNED, name VARCHAR(200),
    restricted_to_user_id INT UNSIGNED, tags TEXT);
  CREATE TABLE photos(id INT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED NOT NULL, unit_id INT UNSIGNED,
    project_id INT UNSIGNED, photographer_id INT UNSIGNED, url VARCHAR(255), thumb_url VARCHAR(255), tags JSON,
    adjustments JSON, type VARCHAR(50) NOT NULL, source_attribution JSON, ai_status VARCHAR(30), description TEXT,
    detailed_description TEXT, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL);
  CREATE TABLE photo_faces(id BIGINT UNSIGNED PRIMARY KEY, photo_id INT UNSIGNED, person_id BIGINT UNSIGNED,
    organization_id INT UNSIGNED, status VARCHAR(20));
  CREATE TABLE face_persons(id BIGINT UNSIGNED PRIMARY KEY, organization_id INT UNSIGNED, name VARCHAR(120));
  CREATE TABLE face_identity_feedback(id INT UNSIGNED PRIMARY KEY, face_id BIGINT UNSIGNED, person_id BIGINT UNSIGNED,
    organization_id INT UNSIGNED, photo_id INT UNSIGNED, sample_kind VARCHAR(16));
  INSERT INTO organization_units VALUES (1,2,NULL),(2,2,NULL);
  INSERT INTO projects VALUES (10,2,1,'校园活动',NULL,NULL),(11,2,1,'私有相册',7,NULL),
    (12,2,2,'别的小组',NULL,NULL),(13,2,1,'内部资料',NULL,'["禁止外发"]'),
    (14,2,1,'同组另一册',NULL,NULL);
  INSERT INTO face_persons VALUES (100,2,'已确认姓名'),(101,2,'未确认姓名');
  INSERT INTO photo_faces VALUES (201,1,100,2,'confirmed'),(202,1,101,2,'confirmed'),(203,9,100,2,'confirmed');
  INSERT INTO face_identity_feedback VALUES (301,201,100,2,1,'explicit'),(302,203,100,2,9,'explicit');
`;

async function verify(db) {
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
  const fixture = [
    [1, 10, 1, 7, 'normal', null, null], [2, 10, 1, 7, 'normal', '["禁止外发"]', null],
    [3, 11, 1, 7, 'normal', null, null], [4, 10, 1, 7, 'video', null, null],
    [5, 12, 2, 7, 'normal', null, null], [6, 10, 1, 7, 'normal', null, '{"sourceUnitId":2}'],
    [7, 10, 1, 8, 'normal', null, null], [8, 13, 1, 7, 'normal', null, null],
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
  const store = {
    keyFromUrlOrPath: key => key, isSafeKey: () => true,
    getObject: async key => { assert.ok(objects.has(key), 'Only test objects are accessible'); return { Body: Readable.from([objects.get(key)]) }; },
    uploadBuffer: async (key, data, options) => {
      assert.equal(options.cacheControl, 'private, no-store');
      objects.set(key, data);
    },
    deleteObjects: async keys => keys.forEach(key => objects.delete(key)),
  };
  const app = express();
  app.use(express.json());
  const { manage, delivery } = createCollegeWindow({
    config, db, store, rate: { take: async () => ({ allowed: true }) },
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
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    async function call(url, status, { token, user, unit, method = 'GET', body } = {}) {
      const res = await fetch(base + url, { method, body: body ? JSON.stringify(body) : undefined, headers: {
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
      photos: photos.map(({ photoId, review }) => ({ photoId, review })),
    } }).then(res => res.json());
    const select = (user, exclude = [], query = '选 20 张校园活动', page = 1) => call('/manage/candidates', 200, { user, method: 'POST',
      body: { mode: 'ai', query, exclude, page } }).then(res => res.json());
    const station = (user, photoIds, status = 200) => call('/manage/candidates/from-station', status,
      { user, method: 'POST', body: { photoIds } }).then(res => res.ok ? res.json() : res.text());

    await call('/manage/published', 403, { user: 99 });
    await call('/manage/published', 403, { user: 7, unit: 2 });
    await call(DELIVERY_PATH + '/photos', 401, { user: 7 });
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
    assert.equal(cropped.width, 90);
    assert.deepEqual(cropped.peopleNames, []);
    assert.equal(cropped.description, null);
    assert.equal((await preview(7)).description, null);
    await publish([one], 409, 8);
    await db.query("UPDATE photos SET description = '更新后的校园活动' WHERE id = 1");
    await publish([one], 409);
    const reviewed = await preview(1);
    const first = (await publish([reviewed, cropped])).photos.find(photo => photo.photoId === 1);
    assert.deepEqual(await station(7, [1]), { photos: [], skipped: 1 });
    const before = await list('?limit=1');
    assert.equal(before.photos.length, 1);
    assert.ok(before.nextCursor);
    assert.equal((await list('?limit=1&after=' + before.nextCursor)).photos.length, 1);
    const imagePath = DELIVERY_PATH + '/photos/' + first.id + '/image';
    const actual = await call(imagePath, 200, { token });
    assert.equal(actual.headers.get('content-type'), 'image/jpeg');
    assert.match(actual.headers.get('cache-control'), /no-store/);
    const image = Buffer.from(await actual.arrayBuffer());
    assert.deepEqual(image, Buffer.from(reviewed.jpeg, 'base64'));
    assert.equal((await sharp(image).metadata()).exif, undefined);
    const { photos } = await list();
    assert.equal(photos.find(photo => photo.id === first.id).description, '更新后的校园活动');
    assert.ok(photos.every(photo => !('photoId' in photo) && !('objectKey' in photo) && !('url' in photo)));
    await db.query("UPDATE photos SET description = '发布后的文字变更' WHERE id = 1");
    assert.equal((await list()).photos.find(photo => photo.id === first.id).description, '更新后的校园活动');
    await db.query("UPDATE photos SET source_attribution = JSON_OBJECT('type','external_import','provider','alltuu') WHERE id = 1");
    assert.ok((await list()).photos.some(photo => photo.id === first.id), 'Recording a supported direct import does not revoke a release');

    // Restriction can be set and cleared between consumer polls; old publications must stay withdrawn.
    await db.query('UPDATE photos SET tags = ? WHERE id = 1', ['["禁止外发"]']);
    await db.query('UPDATE photos SET tags = NULL WHERE id = 1');
    await call(imagePath, 404, { token });
    assert.equal((await list()).photos.length, 1);
    const second = (await publish([await preview(1)])).photos[0];
    assert.notEqual(second.id, first.id);
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
    const anonymized = await preview(1);
    assert.deepEqual(anonymized.peopleNames, []);
    assert.equal(anonymized.description, null);
    const fifth = (await publish([anonymized])).photos[0];
    await db.query('DELETE FROM projects WHERE id = 14');
    await call(DELIVERY_PATH + '/photos/' + fifth.id + '/image', 404, { token });
    const remaining = (await list()).photos[0];
    await call('/manage/published/' + remaining.id, 204, { user: 7, method: 'DELETE' });
    await call(remaining.imagePath, 404, { token });
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
  } finally { await new Promise(resolve => server.close(resolve)); }
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
    const migrations = ['20261126_001_college_window.sql', '20261126_002_college_window_direct_imports.sql']
      .map(filename => fs.readFileSync(path.join(__dirname, 'migrations', filename), 'utf8'));
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const migration of migrations) {
        for (const stmt of splitStatements(migration)) await connection.query(stmt);
      }
    }
    db = mysql.createPool({ socketPath, user: 'root', database: 'mamage_college_window_test', connectionLimit: 4 });
    await verify(db);
    console.log('College Window: policy, preview, confirmed metadata, publish, pagination and durable withdrawal passed on isolated MySQL.');
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
