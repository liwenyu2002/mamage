const assert = require('node:assert/strict');
const {test} = require('node:test');
const {reviewCandidates,writeEvidence,readEvidence,loadFaces} = require('../lib/search_visual_index');
const {compileVisualConditions,evidenceKey} = require('../lib/person_visual_evidence');
const face = {id:12,photoId:101,personId:343,x:0.1,y:0.1,w:0.1,h:0.1,photoUrl:'/uploads/a.jpg',thumbUrl:'/uploads/t.jpg'};
const evidence = {binding:'clear',visibility:'clear',colors:['green'],activities:{},state:'done'};

test('only explicit anonymous null can load all wearers; malformed named IDs fail closed', async () => {
  for (const id of [undefined,0,-1,NaN,'bad']) assert.deepEqual(await loadFaces([101], id, { query: async () => { throw Error('Invalid identity must not scan all faces'); } }), []);
});

test('anonymous clothes use current bound observations without inference; any excluded wearer rejects the photo', async () => {
  const observations = require('../lib/photo_person_observations');
  process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = '1';
  const faces = [
    { ...face, id: 201, photoId: 101 }, { ...face, id: 202, photoId: 102 },
    { ...face, id: 203, photoId: 103 }, { ...face, id: 204, photoId: 104 },
    { ...face, id: 205, photoId: 105 }, { ...face, id: 206, photoId: 106 },
    { ...face, id: 207, photoId: 106, personId: 344 },
    { ...face, id: 208, photoId: 107 }, { ...face, id: 209, photoId: 107, personId: 344 },
  ];
  const rows = new Map();let writes = 0;
  const db = { query: async (sql, params) => {
    if (sql.startsWith('INSERT INTO photo_person_observations')) { writes++;rows.set(params[0], { face_id: params[0], source_key: params[1], observation_json: params[2], analyzed_at: new Date() });return [{}]; }
    if (sql.includes('FROM photo_faces pf INNER JOIN photos')) { assert.equal(params.length, 1);assert.ok(sql.includes('legacy_blocked'));return [faces]; }
    if (sql.startsWith('SELECT face_id,source_key')) return [[...rows.values()]];
    throw Error('Unexpected query or inference queue write');
  } };
  try {
    for (const f of faces) await observations.saveObservation(f, { ...evidence,
      binding: [203,209].includes(f.id) ? 'uncertain' : 'clear',
      colors: [201,207].includes(f.id) ? ['black'] : f.id === 205 ? ['white','blue'] : ['white'],
      profile: { clothing: { upper: '白色上衣', lower: '' }, actions: [], heldObjects: [], position: '左侧' } }, db);
    rows.get(204).source_key = 'obsolete';
    const before = writes,candidates = Array.from({ length: 8 }, (_, i) => ({ id: i + 101 }));
    const request = compileVisualConditions({ people: [], mustTerms: ['白衣服'], excludeTerms: [] }, [], { anonymous: true });
    const result = await reviewCandidates({ candidates, request, enqueue: true, db });
    assert.deepEqual(result.matchedIds, [102,105,106,107]);
    assert.deepEqual(result.unknownIds, [103,104,108]);
    assert.equal(result.pending, 0);assert.equal(writes, before, 'search must never enqueue or modify persisted evidence');
    const excluded = await reviewCandidates({ candidates, request: { ...request, negative: [{ kind: 'color', value: 'black' }] }, db });
    assert.deepEqual(excluded.matchedIds, [102,105]);
    assert.ok(excluded.unknownIds.includes(107), 'an unseen second wearer is not evidence of non-black clothing');
  } finally { delete process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED; }
});

test('batch evidence stays bound to current source and unknown candidates never satisfy negation',async()=>{
  const db = {query:async(sql,params)=>{
    assert.ok(sql.includes('pf.organization_id=p.organization_id'));
    assert.ok(sql.includes('legacy_blocked'));
    assert.deepEqual(params,[[101,102],343]);
    return [[face,{...face,id:13,photoId:102}]];
  }};
  const request = compileVisualConditions({mustTerms:[],excludeTerms:['黑衣服'],people:['甲老师']},[{id:343,name:'甲老师'}]);
  await writeEvidence(face,evidence,{durable:false,db});
  const result = await reviewCandidates({candidates:[{id:101},{id:102}],request,enqueue:false,db});
  assert.deepEqual(result.matchedIds,[101]);
  assert.deepEqual(result.unknownIds,[102]);
  assert.equal(result.pending,1);
  assert.equal(result.uncertain,0);
  const changed = await readEvidence([{...face,x:0.3}],{durable:false,db});
  assert.equal(changed.has(evidenceKey({...face,x:0.3})),false);
});

test('matching one valid face avoids redundant inference and cannot produce negative uncertain counts',async()=>{
  const db = {query:async()=>[[face,{...face,id:14}]]};
  const request = compileVisualConditions({mustTerms:['绿衣服'],excludeTerms:[],people:['甲老师']},[{id:343,name:'甲老师'}]);
  const result = await reviewCandidates({candidates:[{id:101}],request,enqueue:false,db});
  assert.equal(result.pending,0);
  assert.equal(result.uncertain,0);
});

test('durable cache loads are indexed and require namespace, current fingerprint and unexpired version',async()=>{
  let read;
  const db = {query:async(sql,params)=>{read={sql,params};return [[{state_key:evidenceKey(face),payload:'{"version":"old","expiresAt":9999999999999}'}]];}};
  const values = await readEvidence([face],{db,durable:true});
  assert.equal(values.size,0);
  assert.ok(read.sql.includes('state_key IN (?) AND expires_at > ?'));
  assert.equal(read.params[0],'person-visual-evidence');
  assert.deepEqual(read.params[1],[evidenceKey(face)]);
});
