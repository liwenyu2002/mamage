const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { analyzePeople } = require('../lib/person_visual_inference');
const profiles = require('../lib/photo_person_observations');
const { evidenceKey } = require('../lib/person_visual_evidence');
const { readEvidence } = require('../lib/search_visual_index');
const face = { id: 12, photoId: 101, personId: 343, personName: '旧名', faceNo: 1, status: 'confirmed',
  x: 0.2, y: 0.1, w: 0.1, h: 0.1, unit: 'ratio', photoUrl: '/original.jpg', thumbUrl: '/thumb.jpg' };
const observation = { binding: 'clear', visibility: 'clear', colors: ['green'], activities: { speech: 'unknown' },
  observation: '头部与绿色上衣相连', profile: { clothing: { upper: '绿色衬衫', lower: '' },
    actions: ['站立'], heldObjects: ['纸张'], position: '画面左侧', description: '人物穿绿色衬衫，手持纸张。' } };
const image = () => sharp({ create: { width: 500, height: 500, channels: 3, background: '#888' } }).jpeg().toBuffer();

test('profile inference uses face anchors, not names or model-provided person IDs', async () => {
  const second = { ...face, id: 13, x: 0.6, personName: '另一个名字' };
  const result = await analyzePeople(await image(), [face, second], { profile: true, baseUrl: 'http://fixture.invalid',
    fetch: async (_url, options) => {
      const sent = JSON.parse(options.body);
      assert.equal(sent.images.length, 2);
      assert.equal(sent.think, false);
      assert.ok(sent.format.properties.people.items.properties.profile);
      assert.ok(!JSON.stringify(sent).includes('旧名'));
      assert.ok(!JSON.stringify(sent).includes('另一个名字'));
      return Response.json({ done: true, response: JSON.stringify({ people: [
        { ...observation, index: 1, personId: 999 },
        { ...observation, index: 2, colors: ['blue'], profile: { ...observation.profile, clothing: { upper: '蓝色上衣', lower: '' } } },
      ] }) });
    } });
  assert.equal(result.get(12).profile.clothing.upper, '绿色衬衫');
  assert.equal(result.get(13).profile.clothing.upper, '蓝色上衣');
  assert.equal(result.get(12).personId, undefined);
});

test('uncertain binding, malformed profile, duplicate/invented anchors cannot bind body attributes', async () => {
  const buffer = await image();
  for (const people of [
    [{ ...observation, index: 1, binding: 'uncertain' }],
    [{ ...observation, index: 1, profile: 'not-an-object' }],
    [{ ...observation, index: 1 }, { ...observation, index: 1 }],
    [{ ...observation, index: 999 }],
  ]) {
    const result = await analyzePeople(buffer, [face], { profile: true, baseUrl: 'http://fixture.invalid',
      fetch: async () => Response.json({ done: true, response: JSON.stringify({ people }) }) });
    assert.equal(result.get(12).binding, 'uncertain');
    assert.ok(!result.get(12).profile?.clothing.upper);
  }
});

test('review must complete before publishing a profile; free-form identity narratives never enter the result', async () => {
  let calls = 0;
  const values = await analyzePeople(await image(), [face], { profile: true, baseUrl: 'http://fixture.invalid',
    fetch: async (_url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      if (calls === 2) assert.match(request.prompt, /第二遍视觉核验/);
      return Response.json({ done: true, response: JSON.stringify({ people: [{ ...observation, index: 1,
        profile: { ...observation.profile, description: '这是某位主持人，他似乎正在讲话。' } }] }) });
    } });
  assert.equal(calls, 2);
  assert.ok(!values.get(12).profile.description.includes('主持'));
  assert.equal(values.get(12).activities.speech, 'unknown');
  let failures = 0;
  await assert.rejects(analyzePeople(await image(), [face], { profile: true, baseUrl: 'http://fixture.invalid',
    fetch: async () => {
      if (++failures === 2) throw Error('review failed');
      return Response.json({ done: true, response: JSON.stringify({ people: [{ ...observation, index: 1 }] }) });
    } }), error => error.code === 'PERSON_VISUAL_REVIEW_FAILED' && error.stage === 'review');
});

test('visual binding survives identity correction but not changed crop, model, source or face ID', () => {
  const key = profiles.sourceKey(face);
  assert.equal(profiles.sourceKey({ ...face, personId: 77, personName: '修正姓名' }), key);
  for (const changed of [{ id: 99 }, { x: 0.3 }, { thumbUrl: '/replaced.jpg' }]) {
    assert.notEqual(profiles.sourceKey({ ...face, ...changed }), key);
  }
  const previous = process.env.SEARCH_VISUAL_MODEL_REVISION;
  process.env.SEARCH_VISUAL_MODEL_REVISION = 'new-revision';
  try { assert.notEqual(profiles.sourceKey(face), key); }
  finally { if (previous === undefined) delete process.env.SEARCH_VISUAL_MODEL_REVISION; else process.env.SEARCH_VISUAL_MODEL_REVISION = previous; }
});

test('storage writes only observations; presentation resolves the current person and strips unbound attributes', async () => {
  const previous = process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED;
  process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = '1';
  try {
    let stored;
    const db = { query: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        assert.ok(!sql.includes('UPDATE photo_faces'));
        assert.ok(!sql.includes('UPDATE photos'));
        assert.ok(!params[2].includes('旧名'));
        stored = { face_id: params[0], source_key: params[1], observation_json: params[2], analyzed_at: '2026-10-16' };
        return [{ affectedRows: 1 }];
      }
      return [[stored]];
    } };
    await profiles.saveObservation(face, observation, db);
    const renamed = { ...face, personId: 88, personName: '修正后的姓名' };
    const read = await profiles.readObservations([renamed], db);
    const result = profiles.presentPeople([renamed], read)[0];
    assert.equal(result.personId, 88);
    assert.equal(result.personName, '修正后的姓名');
    assert.equal(result.clothing.upper, '绿色衬衫');
    assert.equal((await profiles.readObservations([{ ...face, x: 0.3 }], db)).size, 0);
    await profiles.saveObservation(face, { ...observation, binding: 'uncertain' }, db);
    const uncertain = profiles.presentPeople([face], await profiles.readObservations([face], db))[0];
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(uncertain.clothing.upper, '');
    assert.deepEqual(uncertain.actions, []);
  } finally { if (previous === undefined) delete process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED; else process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = previous; }
});

test('search reuses stored face observations without calling vision; disabled feature needs no new table', async () => {
  const previous = process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED;
  process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = '1';
  try {
    const db = { query: async sql => {
      if (sql.includes('runtime_state')) return [[]];
      assert.ok(sql.includes('photo_person_observations'));
      return [[{ face_id: face.id, source_key: profiles.sourceKey(face),
        observation_json: JSON.stringify({ ...observation, version: profiles.VERSION }) }]];
    } };
    const evidence = await readEvidence([face], { db, durable: true });
    assert.deepEqual(evidence.get(evidenceKey(face)).colors, ['green']);
    process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = '0';
    assert.equal((await profiles.readObservations([face], { query: () => { throw Error('must not query'); } })).size, 0);
  } finally { if (previous === undefined) delete process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED; else process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = previous; }
});

test('migration is additive, deletes observations with faces and never stores mutable identity', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261016_001_photo_person_observations.sql'), 'utf8');
  assert.match(sql, /REFERENCES photo_faces\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /\b(?:person_id|person_name|DROP|TRUNCATE|ALTER)\b/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE)\s+(?:photos|photo_faces|face_persons)\b/i);
});
