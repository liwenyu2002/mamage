const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'isolated-upload-session-test';
const sessions = require('../lib/photo_upload_session');
const user = { id: 7, organization_id: 2 };
const data = { userId: 7, orgId: 2, originalKey: 'uploads/units/1/a.jpg', thumbKey: 'uploads/units/1/thumb_a.jpg' };
const token = sessions.createSession(data, 60);
assert.equal(sessions.readSession(token, user).originalKey, data.originalKey);
assert.throws(() => sessions.readSession(token, { ...user, id: 8 }), /INVALID_UPLOAD_SESSION/);
assert.throws(() => sessions.readSession(token, { ...user, organization_id: 3 }), /INVALID_UPLOAD_SESSION/);
assert.throws(() => sessions.readSession(`${token}x`, user), /INVALID_UPLOAD_SESSION/);
assert.throws(() => sessions.readSession(sessions.createSession(data, -1), user), /INVALID_UPLOAD_SESSION/);
(async () => {
  const calls = [];
  const conn = { async query(sql, params) {
    calls.push(sql);
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    assert.deepEqual(params, [`/${data.originalKey}`, `/${data.thumbKey}`, `/${data.originalKey}`, `/${data.thumbKey}`]);
    return [[{ id: 77 }]];
  }, release() { calls.push('release'); } };
  const committed = await sessions.withSessionLock({ getConnection: async () => conn }, data,
    db => sessions.findCommittedPhoto(db, data));
  assert.equal(committed.id, 77);
  assert.equal(calls.at(-2), 'SELECT RELEASE_LOCK(?)');
  assert.equal(calls.at(-1), 'release');
  const fs = require('node:fs');
  const vm = require('node:vm');
  const handlers = {}, photos = [], objects = new Set([data.originalKey, data.thumbKey]);
  let acquired = false;
  const connection = { async query(sql) {
    if(sql.includes('GET_LOCK')) { if(acquired)return [[{acquired:0}]];acquired=true;return [[{acquired:1}]]; }
    if(sql.includes('RELEASE_LOCK')) { acquired=false;return [[{}]]; }
    if(sql.includes('FROM photos'))return [photos];
    throw new Error(sql);
  }, release(){} };
  const ctx = { console, setImmediate:()=>{}, photoUploadSessions:sessions,
    pool:{getConnection:async()=>connection},router:{post:(route,...args)=>{handlers[route]=args.at(-1);}},
    requirePermission:()=>()=>{},ensureProjectInScope:async()=>{},
    cosStorage:{headObject:async()=>({ContentLength:10}),deleteObjects:async keys=>{keys.forEach(key=>objects.delete(key));return{deleted:keys};}},
    getOrgId:req=>req.user.organization_id,
    createPhotoRecordWithRetry:async payload=>{photos.push({id:77,photographer_id:7,organization_id:2,project_id:1,url:payload.relPath,thumb_url:payload.thumbRel});return 77;},
    getPhotographerName:async()=>'Tester',enqueuePostUploadJobs:()=>{},enqueuePublicDownloadDerivative:()=>{},
    buildPublicDownloadKeyFromOriginalKey:()=> 'uploads/public/a.jpg',makeResponsePayload:payload=>({id:payload.insertedId}),
  };
  vm.createContext(ctx);
  const source=fs.readFileSync(require.resolve('../routes/upload'),'utf8');
  vm.runInContext(source.slice(source.indexOf("router.post('/photo/direct/complete'"),source.indexOf('// 视频直传：')),ctx);
  const sessionToken=sessions.createSession({...data,metadata:{projectId:1},fileSize:10},60);
  const req={user,body:{sessionToken}};
  const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
  const complete=response();await handlers['/photo/direct/complete'](req,complete);
  assert.equal(complete.statusCode,200);assert.equal(complete.body.id,77);
  const retry=response();await handlers['/photo/direct/complete'](req,retry);
  assert.equal(retry.body.id,77);assert.equal(photos.length,1,'completion retries must be idempotent');
  const abort=response();await handlers['/photo/direct/abort'](req,abort);
  assert.equal(abort.body.committed,true);assert.equal(objects.size,2,'lost completion response must not delete committed files');
  const foreign=response();await handlers['/photo/direct/abort']({...req,user:{id:8,organization_id:2}},foreign);
  assert.equal(foreign.statusCode,403);assert.equal(objects.size,2);
  const arbitrary=response();await handlers['/photo/direct/abort']({user,body:{originalKey:data.originalKey,thumbKey:data.thumbKey}},arbitrary);
  assert.equal(arbitrary.statusCode,403);assert.equal(objects.size,2);
  console.log('PASS: signed photo sessions, owner/organization checks, expiration and cross-process locking');
  console.log('PASS: real direct routes reject arbitrary abort and preserve/idempotently complete committed photos');
})().catch(error => { console.error(error); process.exitCode = 1; });
