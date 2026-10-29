const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { fixture } = require('./fixtures/iam_test_db');
const { iamConfig } = require('../lib/iam_config');
const { readPush, pushSignature, cipherOptions, normalizeEntry } = require('../lib/iam_protocol');
const { createIamDirectory } = require('../lib/iam_directory');
const { createIamPushRouter } = require('../routes/iam_push');
const { createIamAuthRouter, returnPath } = require('../routes/auth_iam');
const { createSharedStore } = require('../lib/shared_runtime_state');
const guard = require('../lib/iam_account_guard');
const env = { IAM_ENABLED:'1', IAM_PUSH_ENABLED:'1', MAMAGE_PUBLIC_URL:'https://photos.example.edu', IAM_BASE_URL:'https://iam.example.edu',
  IAM_CLIENT_ID:'test-client', IAM_CLIENT_SECRET:'synthetic-iam-secret', IAM_ORGANIZATION_ID:'2', IAM_PUSH_SOURCE_ADDRESSES:'127.0.0.1' };
const cfg = iamConfig(env), secret = 'synthetic-test-local-signing-secret';
process.env.IAM_ACCOUNT_GUARD = '1';
const account = (patch = {}) => ({ appId:cfg.appId, externalId:'identity-1', principalId:'school-user', status:0, syncType:0,
  eventTimestamp:Date.now()-10000, deptNums:['department-1'], attributes:{name:'School name',email:'existing@example.edu'}, ...patch });
let salt = 0;
function push(entries, type = '2', options = {}) {
  const { algorithm, key, encoding } = cipherOptions(cfg), cipher = crypto.createCipheriv(algorithm,key,null);
  const data = Buffer.concat([cipher.update(JSON.stringify(entries),'utf8'),cipher.final()]).toString(encoding);
  const path = `/api/integrations/iam/${type==='1'?'departments':'accounts'}`;
  const form = {dataType:type,timestamp:String(Date.now()),salt:String(++salt),data,...options};
  form.sign = pushSignature(cfg,form,path);
  return {form, parsed:readPush(cfg,form,path),path};
}
async function serve(app, callback) {
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  try {return await callback(`http://127.0.0.1:${server.address().port}`);} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}

test('IAM stays closed without configuration, requires HTTPS and never leaks credentials in readiness',()=>{
  assert.equal(iamConfig({}).loginReady,false);assert.equal(iamConfig({}).pushReady,false);
  assert.equal(cfg.loginReady,true);assert.equal(cfg.pushReady,true);
  assert.equal(iamConfig({...env,IAM_BASE_URL:env.IAM_BASE_URL+'/'}).sourceKey,cfg.sourceKey);
  for(const change of [{IAM_BASE_URL:'http://iam.example.edu'},{MAMAGE_PUBLIC_URL:'http://10.1.131.37'}, {IAM_CLIENT_SECRET:''}, {IAM_PROFILE_ID_PATH:'attributes.__proto__.externalId'}])
    assert.equal(iamConfig({...env,...change}).loginReady,false);
  assert.equal(iamConfig({...env,IAM_PUSH_SOURCE_ADDRESSES:''}).pushReady,false);
  assert.equal(iamConfig({...env,IAM_PUSH_CIPHER:'aes-raw',IAM_PUSH_APP_SECRET:'short'}).pushReady,false);
  assert.equal(returnPath('//evil.example','https://photos.example.edu'),'/');
  assert.equal(returnPath('/?projectId=102&upload=1','https://photos.example.edu'),'/?projectId=102&upload=1');
});

test('a fixed OpenSSL AES vector verifies SDK key derivation instead of only round-trip encryption', () => {
  const config = {...cfg,appSecret:'sdk-vector-secret'}, path='/api/integrations/iam/accounts';
  const form={dataType:'2',timestamp:String(Date.now()),salt:'known-vector',data:'K43fTnsDECvauYPF/4ZW8A=='};
  form.sign=pushSignature(config,form,path);
  assert.deepEqual(readPush(config,form,path).entries,[]);
  assert.throws(()=>readPush({...config,cipher:'aes-raw'},form,path),/IAM_CIPHER_NOT_CONFIGURED/);
  if(crypto.getCiphers().includes('sm4-ecb')) {
    const sm4={...cfg,cipher:'sdk-sm4'}, options=cipherOptions(sm4),cipher=crypto.createCipheriv(options.algorithm,options.key,null);
    const data=Buffer.concat([cipher.update('[]','utf8'),cipher.final()]).toString('hex');
    const national={...form,data};national.sign=pushSignature(sm4,national,path);
    assert.deepEqual(readPush(sm4,national,path).entries,[]);
    assert.throws(()=>readPush(sm4,{...national,data:'not-hex'},path),/IAM_INVALID_CIPHERTEXT/);
  }
});

test('vendor push signatures, cipher encoding, replay window, endpoint type and safe attributes are validated',()=>{
  const item=account(), p=push([item]);assert.equal(p.parsed.entries[0].externalId,item.externalId);
  assert.throws(()=>readPush(cfg,{...p.form,data:'bad-cipher'},p.path),/IAM_INVALID_CIPHERTEXT/);
  assert.throws(()=>readPush(cfg,{...p.form,sign:'0'.repeat(32)},p.path),/IAM_INVALID_SIGNATURE/);
  assert.throws(()=>readPush(cfg,p.form,p.path,Date.now()+600000),/IAM_EXPIRED_PUSH/);
  assert.throws(()=>normalizeEntry({...item,appId:'other'},'2',cfg),/IAM_WRONG_APPLICATION/);
  assert.throws(()=>normalizeEntry({...item,deptNums:'department-1'},'2',cfg),/IAM_INVALID_DEPARTMENTS/);
  assert.throws(()=>normalizeEntry({...item,eventTimestamp:Date.now()+600000},'2',cfg),/IAM_FUTURE_EVENT/);
  const normalized=normalizeEntry({...item,password:'DO_NOT_STORE',appRoles:['admin'],appPermissions:['users.manage_roles']},'2',cfg);
  assert.ok(!JSON.stringify(normalized).includes('DO_NOT_STORE'));assert.ok(!Object.hasOwn(normalized,'appRoles'));
  assert.equal(cipherOptions(cfg).key.toString(),crypto.createHash('md5').update(cfg.appSecret).digest('hex'));
});

test('repeat/older/full batches preserve accounts and partial failures can be retried without duplicate effects',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool);try{
    const first=account(),p=push([first]);assert.equal((await directory.applyPush(cfg,'2',p.parsed)).code,1000);
    assert.equal((await directory.applyPush(cfg,'2',p.parsed)).code,1000);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_accounts').get().n,1);
    await assert.rejects(directory.applyPush(cfg,'2',{...p.parsed,payloadHash:'different'}),/IAM_REPLAY_CONFLICT/);
    await directory.applyPush(cfg,'2',push([account({status:1,eventTimestamp:first.eventTimestamp+100})]).parsed);
    await directory.applyPush(cfg,'2',push([first]).parsed);
    assert.equal(f.sql.prepare('SELECT status FROM iam_accounts').get().status,1);
    const clash=await directory.applyPush(cfg,'2',push([account({status:0,eventTimestamp:first.eventTimestamp+100})]).parsed);
    assert.equal(clash.code,9001);
    const partial=await directory.applyPush(cfg,'2',push([account({externalId:'identity-2'}),account({externalId:'identity-3',deptNums:'invalid'})]).parsed);
    assert.equal(partial.code,9001);assert.match(partial.data,/identity-3/);
    await directory.applyPush(cfg,'2',push([account({externalId:'identity-3',syncType:4})]).parsed);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_accounts').get().n,3,'a full batch never deletes missing records');
  }finally{f.close();}
});

test('explicit binding keeps user IDs, ownership, local roles and grants; JIT never merges by email or grants privileges',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool);try{
    await directory.applyPush(cfg,'2',push([account()]).parsed);
    await assert.rejects(directory.resolveUser(cfg,'identity-1'),/IAM_ACCOUNT_LINK_REQUIRED/);
    await assert.rejects(directory.resolveUser({...cfg,autoProvision:true},'identity-1'),/IAM_ACCOUNT_LINK_REQUIRED/);
    await assert.rejects(directory.bindUser(cfg,'identity-1',8),/IAM_ACCOUNT_LINK_INVALID/);
    await directory.bindUser(cfg,'identity-1',7);
    const u=await directory.resolveUser(cfg,'identity-1');assert.equal(u.id,7);assert.equal(u.role,'admin');
    assert.equal(f.sql.prepare('SELECT photographer_id FROM photos').get().photographer_id,7);
    assert.equal(f.sql.prepare('SELECT role FROM organization_unit_memberships').get().role,'manager');
    await directory.applyPush(cfg,'2',push([account({externalId:'new-user',attributes:{name:'New user',email:'new@example.edu'},appRoles:['superadmin']})]).parsed);
    const fresh=await directory.resolveUser({...cfg,autoProvision:true},'new-user');assert.equal(fresh.role,'visitor');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=?').get(fresh.id).n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,1);
  }finally{f.close();}
});

test('disable revokes old JWTs and private media even after re-enable, and blocks password token issuance',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool);try{
    const initial=account();await directory.applyPush(cfg,'2',push([initial]).parsed);await directory.bindUser(cfg,'identity-1',7);
    const token=await guard.issueToken({id:7,role:'admin'},secret,f.pool),payload=jwt.verify(token,secret),issued=Date.now()-1000;
    await directory.applyPush(cfg,'2',push([account({status:1,eventTimestamp:initial.eventTimestamp+1})]).parsed);
    await assert.rejects(guard.assertSession(7,payload,f.pool),/ACCOUNT_SESSION_REVOKED/);
    await assert.rejects(guard.issueToken({id:7},secret,f.pool),/ACCOUNT_SESSION_REVOKED/);
    assert.equal(await guard.allowMedia(7,issued,f.pool),false);
    await directory.applyPush(cfg,'2',push([account({status:0,eventTimestamp:initial.eventTimestamp+2})]).parsed);
    await assert.rejects(guard.assertSession(7,payload,f.pool),/ACCOUNT_SESSION_REVOKED/);
    assert.equal(await guard.allowMedia(7,issued,f.pool),false);
    assert.equal(await guard.allowMedia(7,Date.now()+1,f.pool),true);
    const renewed=jwt.verify(await guard.issueToken({id:7},secret,f.pool),secret);assert.equal(renewed.iav,1);
    await guard.assertSession(7,renewed,f.pool);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,1);
  }finally{f.close();}
});

test('push HTTP routes enforce source, form encoding, signature path and endpoint data type',async()=>{
  const f=fixture();let config=cfg;const app=express();app.use('/api/integrations/iam',createIamPushRouter({db:f.pool,config:()=>config}));
  try{await serve(app,async base=>{
    const p=push([account()]),url=base+p.path,send=(form,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(form)});
    assert.equal((await (await send(p.form)).json()).code,1000);
    assert.equal((await send({...p.form,dataType:'1'})).status,400);
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
    config={...cfg,sourceAddresses:['10.9.0.5']};assert.equal((await send(p.form,{'X-Forwarded-For':'10.9.0.5'})).status,403);
    config={...config,trustedProxyAddresses:['127.0.0.1']};assert.equal((await send(p.form,{'X-Forwarded-For':'10.9.0.5'})).status,200);
    assert.equal((await send(p.form,{'X-Forwarded-For':'10.9.0.5, 10.9.0.6'})).status,403);
    config={...cfg,pushReady:false};assert.equal((await send(p.form)).status,404);
  });}finally{f.close();}
});

test('OAuth uses one-time browser-bound state, server-side form exchange, stable identity and one-time session handoff',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool),calls=[];await directory.applyPush(cfg,'2',push([account()]).parsed);await directory.bindUser(cfg,'identity-1',7);
  const store=createSharedStore('iam-test',{enabled:false});
  const app=express();app.use('/api/auth/iam',createIamAuthRouter({db:f.pool,config:()=>cfg,store,secret:()=>secret,
    rate:{take:async()=>({allowed:true})},request:async(url,options)=>{calls.push({url,options});
      return calls.length%2 ? {access_token:'private-provider-token'} : {id:'untrusted-display-login',attributes:{externalId:'identity-1'}};} }));
  try{await serve(app,async base=>{
    const login=await fetch(base+'/api/auth/iam/login?returnTo='+encodeURIComponent('/?projectId=102&upload=1'),{redirect:'manual'});
    const authorization=new URL(login.headers.get('location')),cookie=login.headers.get('set-cookie').split(';')[0],state=authorization.searchParams.get('state');
    assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.match(login.headers.get('set-cookie'),/HttpOnly.*Secure|Secure.*HttpOnly/);
    const callback=base+'/api/auth/iam/callback?code=private-authorization-code&state='+state;
    const wrong=await fetch(callback,{redirect:'manual',headers:{cookie:cookie+'wrong'}});assert.match(wrong.headers.get('location'),/iam_error/);assert.equal(calls.length,0);
    const completed=await fetch(callback,{redirect:'manual',headers:{cookie}});const redirect=completed.headers.get('location');assert.match(redirect,/^\/login#iam_code=/);assert.ok(!redirect.includes('private-provider-token'));
    const form=new URLSearchParams(calls[0].options.body);assert.equal(form.get('grant_type'),'authorization_code');assert.ok(form.get('code_verifier'));assert.equal(form.get('client_secret'),cfg.clientSecret);
    assert.equal(new URL(calls[1].url).searchParams.get('access_token'),'private-provider-token');
    const replay=await fetch(callback,{redirect:'manual',headers:{cookie}});assert.match(replay.headers.get('location'),/iam_error/);assert.equal(calls.length,2);
    const handoff=redirect.split('iam_code=')[1];const exchange=()=>fetch(base+'/api/auth/iam/session',{method:'POST',headers:{cookie,origin:cfg.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:handoff})});
    const session=await exchange();assert.equal(session.status,200);const result=await session.json();assert.equal(jwt.verify(result.token,secret).id,7);assert.equal(result.returnTo,'/?projectId=102&upload=1');
    assert.equal((await exchange()).status,401);
  });}finally{f.close();}
});

test('OAuth fails closed for expired state, missing stable identity, wrong origin, concurrent callbacks and disabled handoffs',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool),initial=account();
  await directory.applyPush(cfg,'2',push([initial]).parsed);await directory.bindUser(cfg,'identity-1',7);
  const store=createSharedStore('iam-failure-test',{enabled:false});let validProfile=false,upstreamCalls=0;
  const app=express();app.use('/api/auth/iam',createIamAuthRouter({db:f.pool,config:()=>cfg,store,secret:()=>secret,
    rate:{take:async()=>({allowed:true})},request:async(url)=>{upstreamCalls++;
      if(url===cfg.tokenUrl) return {access_token:'private-provider-token'};
      return validProfile ? {attributes:{externalId:'identity-1'}} : {id:'identity-1',email:'existing@example.edu'};} }));
  try{await serve(app,async base=>{
    const login=async()=>{
      const r=await fetch(base+'/api/auth/iam/login',{redirect:'manual'});
      return {cookie:r.headers.get('set-cookie').split(';')[0],state:new URL(r.headers.get('location')).searchParams.get('state')};
    };
    const callback=s=>fetch(base+'/api/auth/iam/callback?code=private-code&state='+s.state,{redirect:'manual',headers:{cookie:s.cookie}});
    const missing=await callback(await login());assert.match(missing.headers.get('location'),/IAM_PROFILE_ID_MISSING/);
    const expired=await login(),{sha256}=require('../lib/iam_protocol');
    const item=await store.get(sha256(expired.state));await store.set(sha256(expired.state),{...item,expiresAt:Date.now()-1});
    const before=upstreamCalls;assert.match((await callback(expired)).headers.get('location'),/IAM_LOGIN_EXPIRED/);assert.equal(upstreamCalls,before);
    validProfile=true;
    const session=await login(),responses=await Promise.all([callback(session),callback(session)]);
    assert.equal(responses.filter(r=>r.headers.get('location').includes('iam_code=')).length,1);
    const handoff=responses.find(r=>r.headers.get('location').includes('iam_code=')).headers.get('location').split('iam_code=')[1];
    const redeem=origin=>fetch(base+'/api/auth/iam/session',{method:'POST',headers:{cookie:session.cookie,origin,'Content-Type':'application/json'},body:JSON.stringify({code:handoff})});
    assert.equal((await redeem('https://evil.example')).status,403);
    await directory.applyPush(cfg,'2',push([account({status:1,eventTimestamp:initial.eventTimestamp+1})]).parsed);
    assert.equal((await redeem(cfg.publicOrigin)).status,401);
    await store.pruneExpired();assert.equal(await store.get(sha256(expired.state)),undefined);
  });}finally{f.close();}
});

test('source restrictions include IPv6 and preflight emits only safe configuration details',async()=>{
  const {inAddresses}=require('../lib/iam_network'),{check}=require('./check_iam_integration');
  assert.equal(inAddresses('::ffff:10.2.3.4',['10.2.0.0/16']),true);
  assert.equal(inAddresses('2001:db8::123',['2001:db8::/32']),true);
  assert.equal(inAddresses('2001:db9::123',['2001:db8::/32']),false);
  assert.equal(inAddresses('10.2.3.4',['invalid']),false);
  const readiness=await check({env,db:{query:async()=>[[{name:'iam_accounts'}]]}});
  assert.equal(readiness.realLoginVerified,false);assert.ok(readiness.database.missingTables.includes('iam_user_state'));
  assert.ok(!JSON.stringify(readiness).includes(env.IAM_CLIENT_SECRET));
});

test('default-off mode preserves local login and performs no IAM database reads',async()=>{
  const keys=['IAM_ENABLED','IAM_PUSH_ENABLED','IAM_ACCOUNT_GUARD'],previous=keys.map(key=>process.env[key]);
  keys.forEach(key=>delete process.env[key]);
  try {
    const db={query:()=>{throw Error('Unexpected IAM query');}};
    await guard.assertSession(7,null,db);assert.equal(await guard.allowMedia(7,null,db),true);
    const token=await guard.issueToken({id:7},secret,db,{expiresIn:'20m'}),payload=jwt.verify(token,secret);
    assert.equal(payload.id,7);assert.equal(payload.exp-payload.iat,1200);assert.equal(payload.iav,undefined);
  } finally { keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}); }
});

test('LAN HTTP requires explicit exact private origin, keeps IAM HTTPS, and accepts only same-origin root callbacks',()=>{
  const lan={...env,MAMAGE_PUBLIC_URL:'http://10.2.3.4',IAM_ALLOW_INSECURE_HTTP_ORIGIN:'http://10.2.3.4',IAM_REDIRECT_URI:'http://10.2.3.4/'};
  assert.equal(iamConfig(lan).loginReady,true);assert.equal(iamConfig(lan).insecureHttp,true);
  for(const patch of [{IAM_ALLOW_INSECURE_HTTP_ORIGIN:''},{IAM_ALLOW_INSECURE_HTTP_ORIGIN:'http://10.2.3.4:8000'},
    {IAM_BASE_URL:'http://iam.example.edu'},{IAM_REDIRECT_URI:'http://evil.example/'},{IAM_REDIRECT_URI:'http://10.2.3.4/?code=x'},
    {MAMAGE_PUBLIC_URL:'http://example.edu',IAM_ALLOW_INSECURE_HTTP_ORIGIN:'http://example.edu'},
    {MAMAGE_PUBLIC_URL:'http://8.8.8.8',IAM_ALLOW_INSECURE_HTTP_ORIGIN:'http://8.8.8.8'}]) assert.equal(iamConfig({...lan,...patch}).loginReady,false);
});

test('approved HTTP cookie remains browser-bound and callback exchange sends exactly the registered root URI',async()=>{
  const f=fixture(),directory=createIamDirectory(f.pool),calls=[];
  await directory.applyPush(cfg,'2',push([account()]).parsed);await directory.bindUser(cfg,'identity-1',7);
  const config=iamConfig({...env,MAMAGE_PUBLIC_URL:'http://10.2.3.4',IAM_ALLOW_INSECURE_HTTP_ORIGIN:'http://10.2.3.4',IAM_REDIRECT_URI:'http://10.2.3.4/'});
  const app=express();app.use('/api/auth/iam',createIamAuthRouter({db:f.pool,config:()=>config,store:createSharedStore('lan',{enabled:false}),secret:()=>secret,
    rate:{take:async()=>({allowed:true})},request:async(url,options)=>{calls.push({url,options});return calls.length%2?{access_token:'private'}:{attributes:{externalId:'identity-1'}};}}));
  try{await serve(app,async base=>{
    assert.equal((await fetch(base+'/api/auth/iam/login')).status,403);
    const send=(path,headers={})=>new Promise((resolve,reject)=>{const request=require('node:http').get(base+path,{headers:{host:'10.2.3.4',...headers}},res=>{res.resume();res.on('end',()=>resolve(res));});request.on('error',reject);});
    const login=await send('/api/auth/iam/login');assert.equal(login.statusCode,302);
    const setCookie=login.headers['set-cookie'][0],cookie=setCookie.split(';')[0],url=new URL(login.headers.location);
    assert.ok(cookie.startsWith('mamage_iam_lan='));assert.ok(!setCookie.includes('Secure'));assert.ok(setCookie.includes('HttpOnly'));
    assert.equal(url.searchParams.get('redirect_uri'),'http://10.2.3.4/');
    const callback=await send('/api/auth/iam/callback?code=code&state='+url.searchParams.get('state'),{cookie});
    assert.match(callback.headers.location,/iam_code=/);assert.equal(new URLSearchParams(calls[0].options.body).get('redirect_uri'),'http://10.2.3.4/');
  });}finally{f.close();}
});

test('verified profile binds unique existing accounts without an allowlist; names alone and conflicting identifiers never bind',async()=>{
  const {auditExisting,resolveProfile}=require('../lib/iam_profile_links'),f=fixture();
  try {
    const report=await auditExisting(f.pool,cfg,['Original owner','Other org','Missing']);
    assert.deepEqual(report.map(r=>r.status),['candidate','not_found','not_found']);
    await assert.rejects(resolveProfile(f.pool,cfg,{attributes:{name:'Original owner'}},'name-only'),/IAM_ACCOUNT_LINK_REQUIRED/);
    await assert.rejects(resolveProfile(f.pool,cfg,{attributes:{name:'Impostor',email:'existing@example.edu'}},'impostor'),/IAM_ACCOUNT_MATCH_CONFLICT/);
    await assert.rejects(resolveProfile(f.pool,cfg,{attributes:{name:'Original owner',email:'foreign@example.edu'}},'foreign'),/IAM_ACCOUNT_LINK_REQUIRED/);
    const user=await resolveProfile(f.pool,cfg,{attributes:{name:'Original owner',email:'existing@example.edu'}},'oauth-subject');
    assert.equal(user.id,7);assert.equal(user.role,'admin');
    assert.equal((await resolveProfile(f.pool,cfg,{},'oauth-subject')).id,7,'bound subject is independent of subsequent display-name edits');
    assert.equal(f.sql.prepare('SELECT photographer_id FROM photos').get().photographer_id,7);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_identities').get().n,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_pending').get().n,3);
    f.sql.exec("INSERT INTO users VALUES(9,'different-student','Original owner','existing@example.edu','visitor',2)");
    await assert.rejects(resolveProfile(f.pool,cfg,{attributes:{name:'Original owner',email:'existing@example.edu'}},'duplicate-email'),/IAM_ACCOUNT_MATCH_CONFLICT/);
  }finally{f.close();}
});

test('new IAM-authorized users can provision without a local list but never gain manager or face grants',async()=>{
  const {resolveProfile}=require('../lib/iam_profile_links'),f=fixture();
  try {
    const fresh=await resolveProfile(f.pool,{...cfg,autoProvision:true},{attributes:{name:'New student',email:'new@example.edu',roles:['superadmin']}},'fresh-student');
    assert.equal(fresh.role,'visitor');assert.equal(fresh.organization_id,2);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=?').get(fresh.id).n,0);
    await assert.rejects(resolveProfile(f.pool,{...cfg,autoProvision:true},{attributes:{name:'Original owner'}},'same-name-unproven'),/IAM_ACCOUNT_LINK_REQUIRED/);
    const own=await resolveProfile(f.pool,{...cfg,profileIdPath:'id',subjectEmailDomain:'example.edu'}, {id:'existing@example.edu'},'managed-email-subject');
    assert.equal(own.id,7);
  }finally{f.close();}
});

const campusProfile = (patch = {}) => ({ id:'synthetic-mobile', attributes:{
  userId:'stable-campus-user', mainAccount:{name:'Original owner'},
  appAccount:{attributes:{realName:'Original owner',orgemail:'existing@example.edu',employeeNum:'student-7',jobnumber:'other-number',...patch}}
} });
const campusConfig = () => iamConfig({...env,IAM_AUTO_PROVISION:'1',IAM_PROFILE_LOGIN_MATCHING:'1',
  IAM_PROFILE_ID_PATH:'attributes.userId',IAM_PROFILE_NAME_PATH:'attributes.mainAccount.name',
  IAM_PROFILE_EMAIL_PATH:'attributes.appAccount.attributes.orgemail',
  IAM_PROFILE_STUDENT_PATH:'attributes.appAccount.attributes.employeeNum'});

test('school nested profile fields bind by verified identifiers, not display name or a mobile subject',async()=>{
  const {resolveProfile,claimsFromProfile}=require('../lib/iam_profile_links'),{profileId}=require('../routes/auth_iam'),f=fixture(),config=campusConfig();
  try {
    const profile=campusProfile();
    assert.deepEqual(claimsFromProfile(profile,config),{name:'Original owner',email:'existing@example.edu',studentNo:'student-7'});
    assert.equal(profileId(profile,config.profileIdPath),'stable-campus-user');
    const user=await resolveProfile(f.pool,config,profile,profileId(profile,config.profileIdPath));
    assert.equal(user.id,7);assert.equal(user.role,'admin');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM users').get().n,2);
    assert.equal(f.sql.prepare('SELECT photographer_id FROM photos').get().photographer_id,7);
    assert.equal(f.sql.prepare('SELECT role FROM organization_unit_memberships').get().role,'manager');
    const changed={id:'changed-mobile',attributes:{userId:'stable-campus-user',mainAccount:{name:'Changed display name'}}};
    assert.equal((await resolveProfile(f.pool,config,changed,profileId(changed,config.profileIdPath))).id,7);
    assert.equal(f.sql.prepare('SELECT subject_id FROM iam_login_identities').get().subject_id,'stable-campus-user');
    await assert.rejects(resolveProfile(f.pool,config,profile,'different-campus-user'),/IAM_ACCOUNT_MATCH_CONFLICT/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_identities').get().n,1);
  }finally{f.close();}
});

test('configured identity paths do not guess email or account numbers from unrelated profile fields',()=>{
  const {claimsFromProfile}=require('../lib/iam_profile_links'),config=campusConfig();
  const profile={...campusProfile(),email:'decoy@example.edu',name:'Decoy',studentNo:'decoy'};
  assert.equal(claimsFromProfile(profile,config).email,'existing@example.edu');
  assert.equal(claimsFromProfile(profile,config).studentNo,'student-7');
  assert.equal(claimsFromProfile(campusProfile({orgemail:'  Existing@Example.EDU  '}),config).email,'existing@example.edu');
  assert.equal(claimsFromProfile(campusProfile({orgemail:undefined}),config).email,'');
  assert.throws(()=>claimsFromProfile(campusProfile({orgemail:['one@example.edu','two@example.edu']}),config),/IAM_PROFILE_CLAIMS_CONFLICT/);
  assert.throws(()=>claimsFromProfile(campusProfile({orgemail:{value:'existing@example.edu'}}),config),/IAM_PROFILE_CLAIMS_CONFLICT/);
});

test('missing school profile fields never create a nameless visitor or bind a same-name account',async()=>{
  const {resolveProfile}=require('../lib/iam_profile_links'),f=fixture(),config=campusConfig();
  try {
    for(const profile of [{id:'mobile',attributes:{userId:'stable-id'}},campusProfile({orgemail:'',employeeNum:''})]) {
      await assert.rejects(resolveProfile(f.pool,config,profile,'unproven'),/IAM_PROFILE_INCOMPLETE|IAM_ACCOUNT_LINK_REQUIRED/);
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM users').get().n,2);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_identities').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_pending').get().n,1);
    const fresh=campusProfile({orgemail:'new@example.edu',employeeNum:'new-number'});
    fresh.attributes.mainAccount.name='New student';
    assert.equal((await resolveProfile(f.pool,config,fresh,'new-stable-user')).role,'visitor');
  }finally{f.close();}
});

test('nested school identifiers conflicting across accounts or missing stable ID fail closed',async()=>{
  const {resolveProfile}=require('../lib/iam_profile_links'),{profileId}=require('../routes/auth_iam'),f=fixture(),config=campusConfig();
  try {
    f.sql.exec("INSERT INTO users VALUES(9,'other-student','Original owner','other@example.edu','visitor',2)");
    await assert.rejects(resolveProfile(f.pool,config,campusProfile({employeeNum:'other-student'}),'conflict'),/IAM_ACCOUNT_MATCH_CONFLICT/);
    assert.throws(()=>profileId({id:'synthetic-mobile',attributes:{}},config.profileIdPath),/IAM_PROFILE_ID_MISSING/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM iam_login_identities').get().n,0);
  }finally{f.close();}
});

test('two people with the same name and distinct verified school identifiers never inherit each other\'s permissions',async()=>{
  const {resolveProfile}=require('../lib/iam_profile_links'),f=fixture(),config=campusConfig();
  try {
    const fresh=await resolveProfile(f.pool,config,campusProfile({orgemail:'different@example.edu',employeeNum:'different-student'}),'different-stable-id');
    assert.notEqual(fresh.id,7);assert.equal(fresh.role,'visitor');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=?').get(fresh.id).n,0);
    assert.equal((await resolveProfile(f.pool,config,campusProfile(),'original-stable-id')).id,7);
    assert.equal(f.sql.prepare('SELECT photographer_id FROM photos').get().photographer_id,7);
  }finally{f.close();}
});

test('OAuth callback reads the actual nested profile shape and issues a session for the existing account',async()=>{
  const f=fixture(),config=campusConfig(),app=express();
  app.use('/api/auth/iam',createIamAuthRouter({db:f.pool,config:()=>config,store:createSharedStore('nested-profile',{enabled:false}),
    secret:()=>secret,rate:{take:async()=>({allowed:true})},request:async url=>url===config.tokenUrl?{access_token:'private-token'}:campusProfile()}));
  try{await serve(app,async base=>{
    const login=await fetch(base+'/api/auth/iam/login',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
    const state=new URL(login.headers.get('location')).searchParams.get('state');
    const callback=await fetch(base+'/api/auth/iam/callback?code=test-code&state='+state,{redirect:'manual',headers:{cookie}});
    const location=callback.headers.get('location');assert.match(location,/^\/login#iam_code=/);
    const response=await fetch(base+'/api/auth/iam/session',{method:'POST',headers:{cookie,origin:config.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:location.split('iam_code=')[1]})});
    assert.equal(response.status,200);
    const payload=jwt.verify((await response.json()).token,secret);assert.equal(payload.id,7);assert.equal(payload.role,'admin');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM users').get().n,2);
  });}finally{f.close();}
});

test('invalid identity field mappings disable login and mapping changes invalidate old OAuth states',()=>{
  const baseline=campusConfig();
  assert.equal(baseline.loginReady,true);
  assert.notEqual(baseline.flowKey,iamConfig({...env,IAM_PROFILE_ID_PATH:'attributes.userId'}).flowKey);
  for(const field of ['IAM_PROFILE_NAME_PATH','IAM_PROFILE_EMAIL_PATH','IAM_PROFILE_STUDENT_PATH']) {
    for(const value of ['attributes.__proto__.email','attributes.constructor','attributes..name'])
      assert.equal(iamConfig({...env,[field]:value}).loginReady,false);
  }
});
