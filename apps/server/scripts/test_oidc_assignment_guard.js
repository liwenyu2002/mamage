const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createOidcAssignmentGuard, isOidcAssignmentPending } = require('../lib/oidc_assignment_guard');

const secret = 'isolated-assignment-test-secret';
const config = () => ({ issuer: 'https://idp.example.edu', clientId: 'test', sourceKey: 'research-source' });
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, organization_id INTEGER);
    CREATE TABLE iam_login_identities(source_key TEXT, user_id INTEGER);
    CREATE TABLE organization_unit_memberships(user_id INTEGER, unit_id INTEGER, removed_at TEXT);
    CREATE TABLE organization_admin_grants(user_id INTEGER, organization_id INTEGER);
    INSERT INTO users VALUES(1,'visitor',2),(2,'visitor',2),(3,'admin',2);
    INSERT INTO iam_login_identities VALUES('research-source',1),('campus-source',2),('research-source',3);`);
  const db = { query: async (statement, values) => [sql.prepare(statement).all(...values)] };
  return { sql, db, close: () => sql.close() };
}

test('新建且未分组的研究院账号只能访问自己的资料，分组后即时生效', async () => {
  const f = fixture();
  const app = express();
  app.use('/api', createOidcAssignmentGuard({ db:f.db, secret, config }));
  app.get(['/api/users/me', '/api/workspaces', '/api/projects/list', '/api/share/:code'], (_req, res) => res.json({ ok:true }));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,id=1)=>fetch(base+path,{headers:{authorization:'Bearer '+jwt.sign({id,role:'admin'},secret)}});
  try {
    assert.equal(await isOidcAssignmentPending(1,{db:f.db,config}),true);
    assert.equal((await request('/api/users/me')).status,200);
    assert.equal((await request('/api/workspaces')).status,403);
    assert.equal((await request('/api/share/abcdefghijklmnopqrstuvwx')).status,200,'已有公开分享链接仍可访问');
    const blocked=await request('/api/projects/list');
    assert.equal(blocked.status,403);
    assert.equal((await blocked.json()).error,'WORKSPACE_ASSIGNMENT_REQUIRED');
    assert.equal((await request('/api/projects/list',2)).status,200,'旧 IAM 用户不受研究院新账号限制');
    assert.equal((await request('/api/projects/list',3)).status,200,'管理员不受限制');
    f.sql.exec('INSERT INTO organization_unit_memberships VALUES(1,9,NULL)');
    assert.equal(await isOidcAssignmentPending(1,{db:f.db,config}),false);
    assert.equal((await request('/api/projects/list')).status,200,'已有令牌在分组后可继续使用');
    f.sql.exec("UPDATE organization_unit_memberships SET removed_at='2026-01-01' WHERE user_id=1");
    assert.equal((await request('/api/projects/list')).status,403,'撤销分组立即生效');
    f.sql.exec('INSERT INTO organization_admin_grants VALUES(1,2)');
    assert.equal((await request('/api/projects/list')).status,200,'被授权的学院管理员不受限制');
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close(); }
});

test('权限查询失败时拒绝访问，不放开素材接口', async () => {
  const app=express(), db={query:async()=>{throw Error('db down');}};
  app.use('/api',createOidcAssignmentGuard({db,secret,config}));
  app.get('/api/projects/list',(_req,res)=>res.json({ok:true}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/list`,
      {headers:{authorization:'Bearer '+jwt.sign({id:1},secret)}});
    assert.equal(response.status,503);
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});
