const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const fs = require('node:fs');
const vm = require('node:vm');
const { accountAccess, accessAdministrator, saveAccountAccess, registerUserAccessAdmin } = require('../lib/user_access_admin');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT, student_no TEXT, department TEXT, role TEXT, organization_id INTEGER, active_unit_id INTEGER, created_at TEXT);
    CREATE TABLE organizations(id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE organization_units(id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, archived_at TEXT);
    CREATE TABLE organization_unit_memberships(unit_id INTEGER, user_id INTEGER, role TEXT, removed_at TEXT, PRIMARY KEY(unit_id,user_id));
    CREATE TABLE organization_admin_grants(organization_id INTEGER, user_id INTEGER, granted_by INTEGER, PRIMARY KEY(organization_id,user_id));
    CREATE TABLE face_search_grants(organization_id INTEGER,user_id INTEGER,college_wide INTEGER,can_manage INTEGER,granted_by INTEGER);
    CREATE TABLE iam_login_identities(user_id INTEGER,subject_id TEXT);
    CREATE TABLE role_permissions(role TEXT,permission TEXT);
    INSERT INTO role_permissions VALUES('visitor','photos.view'),('photographer','photos.view'),('admin','photos.view'),('superadmin','users.manage_roles');
    CREATE TABLE organization_access_audit(id INTEGER PRIMARY KEY,organization_id INTEGER,unit_id INTEGER,user_id INTEGER,action TEXT,resource_type TEXT,resource_id INTEGER,details TEXT);
    INSERT INTO organizations VALUES(2,'School'),(3,'Other school');
    INSERT INTO organization_units VALUES(1,2,'Media',NULL),(2,2,'Business',NULL),(3,3,'Other',NULL),(4,2,'Archived','2020');
    INSERT INTO users VALUES(1,'Root','root@example.edu','root-no',NULL,'superadmin',2,1,'2026'),
      (2,'Second root','second@example.edu','second-no',NULL,'superadmin',2,1,'2026'),
      (3,'New teacher','new@example.edu','new-no',NULL,'visitor',2,NULL,'2026'),
      (4,'Other teacher','other@example.edu','other-no',NULL,'visitor',3,NULL,'2026'),
      (5,'Manager','manager@example.edu','manager-no',NULL,'admin',2,1,'2026');
    INSERT INTO organization_admin_grants VALUES(2,1,1),(2,2,1);
    INSERT INTO organization_unit_memberships VALUES(1,2,'manager',NULL),(1,5,'manager',NULL);
    INSERT INTO iam_login_identities VALUES(3,'stable-new');`);
  const query = async (text, values = []) => {
    const statement = sql.prepare(text.replace(/\s+FOR UPDATE/g, ''));
    if (/^\s*SELECT/i.test(text)) return [statement.all(...values)];
    const result = statement.run(...values);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
  };
  const db = { query, async getConnection() { return { query, beginTransaction: async () => sql.exec('BEGIN'), commit: async () => sql.exec('COMMIT'),
    rollback: async () => { if (sql.isTransaction) sql.exec('ROLLBACK'); }, release() {} }; } };
  const body = async (userId = 3) => ({ revision: (await accountAccess(db,userId)).revision, memberships: [{unitId:1,role:'editor'},{unitId:2,role:'manager'}],collegeAdmin:false,facePermissions:{search:true,manage:true} });
  return {sql,db,body,close:()=>sql.close()};
}

test('second superadministrator can assign groups and independent face permissions with an audit', async () => {
  const f=fixture();try {
    assert.deepEqual(await accessAdministrator(f.db,2),{allowed:true,global:true,organizationId:2});
    await saveAccountAccess(f.db,2,3,await f.body());
    const after=await accountAccess(f.db,3);
    assert.equal(after.snapshot.user.active_unit_id,1);assert.equal(after.snapshot.user.role,'admin');
    assert.deepEqual(after.memberships.map(m=>({...m})),[{unitId:1,role:'editor'},{unitId:2,role:'manager'}]);
    assert.deepEqual(after.facePermissions,{search:true,manage:true});
    assert.equal(f.sql.prepare('SELECT subject_id FROM iam_login_identities WHERE user_id=3').get().subject_id,'stable-new');
    assert.equal(f.sql.prepare('SELECT user_id FROM organization_access_audit').get().user_id,2);
    const clear={revision:after.revision,memberships:[],collegeAdmin:false,facePermissions:{search:false,manage:false}};
    await saveAccountAccess(f.db,2,3,clear);
    const cleared=await accountAccess(f.db,3);assert.equal(cleared.memberships.length,0);assert.equal(cleared.snapshot.user.active_unit_id,null);
    assert.equal(cleared.snapshot.user.role,'visitor');assert.deepEqual(cleared.facePermissions,{search:false,manage:false});
  }finally{f.close();}
});

test('assignment IDs reject coercible booleans, arrays and non-decimal strings', async () => {
  const f = fixture();
  try {
    for (const unitId of [true, [1], '1e0', '0x1']) {
      await assert.rejects(saveAccountAccess(f.db, 2, 3, { ...await f.body(), memberships: [{ unitId, role: 'manager' }] }),
        error => error.code === 'INVALID_MEMBERSHIPS');
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_access_audit').get().n, 0);
  } finally { f.close(); }
});

function legacyRoleApp(f) {
  const router = express.Router(), app = express();
  const source = fs.readFileSync(require.resolve('../routes/users'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf("router.get('/all',"), source.indexOf('module.exports = router;')), {
    router, pool: f.db, console: { error() {} },
    require: name => {
      assert.ok(['../lib/user_access_admin', '../lib/account_merge'].includes(name), `Unexpected route dependency: ${name}`);
      return require(name);
    },
    authMiddleware: (req, _res, next) => { req.user = { id: Number(req.get('x-test-user')), role: 'superadmin' }; next(); },
    // Simulate a permission precheck that passed before a concurrent revocation.
    requirePermission: () => (_req, _res, next) => next(),
  });
  app.use(express.json()); app.use('/users', router);
  return app;
}

async function withLegacyRoles(f, callback) {
  const server = legacyRoleApp(f).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await callback(async (target, role, actor = 1) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/users/${target}/role`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-test-user': String(actor) }, body: JSON.stringify({ role }),
      });
      return { status: response.status, body: await response.json() };
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('legacy role HTTP cannot promote account 147 or modify an existing superadministrator', async () => {
  const f = fixture();
  try {
    f.sql.exec("INSERT INTO users(id,name,role,organization_id) VALUES(147,'Restricted promotion','admin',2)");
    await withLegacyRoles(f, async patch => {
      assert.equal((await patch(147, 'superadmin')).status, 403);
      assert.equal((await patch(2, 'visitor')).status, 403);
      assert.equal((await patch(1, 'visitor')).status, 400);
      assert.equal((await patch('3junk', 'admin')).status, 400);
    });
    assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=147').get().role, 'admin');
    assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=2').get().role, 'superadmin');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_access_audit').get().n, 0);
  } finally { f.close(); }
});

test('legacy role HTTP rechecks actor grants in the transaction, audits updates and rolls back on failure', async () => {
  const f = fixture();
  try {
    await withLegacyRoles(f, async patch => {
      assert.equal((await patch(3, 'admin', 5)).status, 403);
      f.sql.exec('DELETE FROM organization_admin_grants WHERE user_id=2');
      assert.equal((await patch(3, 'admin', 2)).status, 403);
      assert.equal((await patch(4, 'photographer')).status, 200);
      const audit = f.sql.prepare('SELECT * FROM organization_access_audit').get();
      assert.equal(audit.user_id, 1); assert.equal(audit.organization_id, 3);
      assert.equal(JSON.parse(audit.details).before.user.role, 'visitor');
      assert.equal(JSON.parse(audit.details).after.user.role, 'photographer');
      f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON organization_access_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
      assert.equal((await patch(3, 'admin')).status, 500);
      assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=3').get().role, 'visitor');
    });
  } finally { f.close(); }
});

test('legacy all-users HTTP rejects non-superadmins and revoked grants despite an earlier permission precheck', async () => {
  const f = fixture();
  const server = legacyRoleApp(f).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const list = actor => fetch(`http://127.0.0.1:${server.address().port}/users/all`, { headers: { 'x-test-user': String(actor) } });
    assert.equal((await list(5)).status, 403);
    f.sql.exec('INSERT INTO organization_admin_grants VALUES(2,5,1)');
    assert.equal((await list(5)).status, 403);
    f.sql.exec('DELETE FROM organization_admin_grants WHERE user_id=2');
    assert.equal((await list(2)).status, 403);
    const response = await list(1);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).users.some(user => user.organizationId === 3));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); f.close(); }
});

test('ordinary manager, self changes, protected root and foreign groups cannot be granted',async()=>{
  const f=fixture();try {
    await assert.rejects(saveAccountAccess(f.db,5,3,await f.body()),e=>e.code==='ACCESS_ADMIN_REQUIRED');
    await assert.rejects(saveAccountAccess(f.db,2,2,await f.body(2)),e=>e.code==='SELF_ACCESS_CHANGE');
    await assert.rejects(saveAccountAccess(f.db,2,1,await f.body(1)),e=>e.code==='PROTECTED_SUPERADMIN');
    for(const unitId of [3,4,999]) await assert.rejects(saveAccountAccess(f.db,2,3,{...await f.body(),memberships:[{unitId,role:'manager'}]}),e=>e.code==='UNIT_OUTSIDE_ORGANIZATION');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_access_audit').get().n,0);
  }finally{f.close();}
});

test('college administrator cannot manage accounts; promotion and revocation are checked on each call',async()=>{
  const f=fixture();try {
    f.sql.exec('INSERT INTO organization_admin_grants VALUES(2,5,1)');
    assert.equal((await accessAdministrator(f.db,5)).allowed,false);
    await assert.rejects(saveAccountAccess(f.db,5,3,await f.body()),e=>e.code==='ACCESS_ADMIN_REQUIRED');
    f.sql.exec("UPDATE users SET role='superadmin' WHERE id=5");
    assert.equal((await accessAdministrator(f.db,5)).allowed,true);
    f.sql.exec("UPDATE users SET role='admin' WHERE id=5");
    assert.equal((await accessAdministrator(f.db,5)).allowed,false);
    f.sql.exec('DELETE FROM organization_admin_grants WHERE user_id=2');
    assert.equal((await accessAdministrator(f.db,2)).allowed,false);
  }finally{f.close();}
});

test('superadministrators can configure another school without assigning foreign groups',async()=>{
  const f=fixture();try {
    await saveAccountAccess(f.db,2,4,{...await f.body(4),memberships:[{unitId:3,role:'editor'}]});
    const after=await accountAccess(f.db,4);
    assert.equal(after.snapshot.user.organization_id,3);
    assert.equal(after.snapshot.user.active_unit_id,3);
    assert.equal(after.snapshot.faces[0].organization_id,3);
  }finally{f.close();}
});

test('extra IAM, organization and superadmin fields cannot expand an access assignment', async () => {
  const f = fixture();
  try {
    await saveAccountAccess(f.db, 2, 3, { ...await f.body(), role: 'superadmin', organization_id: 3,
      name: 'Forged identity', student_no: 'forged-no', iamLinked: false });
    const user = f.sql.prepare('SELECT * FROM users WHERE id=3').get();
    assert.equal(user.role, 'admin'); assert.equal(user.organization_id, 2);
    assert.equal(user.name, 'New teacher'); assert.equal(user.student_no, 'new-no');
    assert.equal((await accessAdministrator(f.db, 3)).allowed, false);
    assert.equal(f.sql.prepare('SELECT subject_id FROM iam_login_identities WHERE user_id=3').get().subject_id, 'stable-new');
  } finally { f.close(); }
});

test('stale revisions, invalid role, duplicate groups and face dependency fail without partial updates',async()=>{
  const f=fixture();try {
    const body=await f.body();await saveAccountAccess(f.db,1,3,body);
    await assert.rejects(saveAccountAccess(f.db,2,3,body),e=>e.code==='ACCESS_CHANGED');
    await assert.rejects(saveAccountAccess(f.db,2,3,{...await f.body(),memberships:[{unitId:1,role:'superadmin'}]}),e=>e.code==='INVALID_MEMBERSHIPS');
    await assert.rejects(saveAccountAccess(f.db,2,3,{...await f.body(),memberships:[{unitId:1,role:'editor'},{unitId:1,role:'manager'}]}),e=>e.code==='INVALID_MEMBERSHIPS');
    await assert.rejects(saveAccountAccess(f.db,2,3,{...await f.body(),facePermissions:{search:false,manage:true}}),e=>e.code==='FACE_SEARCH_REQUIRED');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_access_audit').get().n,1);
  }finally{f.close();}
});

test('database failure rolls all grants and user state back',async()=>{
  const f=fixture();try {
    const before=await accountAccess(f.db,3);
    f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON organization_access_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    await assert.rejects(saveAccountAccess(f.db,1,3,await f.body()),/synthetic failure/);
    assert.deepEqual(await accountAccess(f.db,3),before);
  }finally{f.close();}
});

test('HTTP lists pending IAM users across schools and rejects unprivileged reads and writes',async()=>{
  const f=fixture(),app=express();app.use(express.json());
  const router=express.Router();registerUserAccessAdmin(router,{db:f.db,auth:async(req,res,next)=>{req.user={id:Number(req.get('x-test-user')),organization_id:2};next();}});app.use('/users',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/users`;
  try {
    const fetchAs=(path,user,options={})=>fetch(url+path,{...options,headers:{'x-test-user':String(user),'Content-Type':'application/json'}});
    assert.equal((await fetchAs('/access',5)).status,403);
    assert.equal((await fetchAs('/access?organizationId=3',2)).status,200);
    const result=await(await fetchAs('/access?status=pending',2)).json();
    assert.equal(result.users.length,1);assert.equal(result.users[0].name,'New teacher');assert.equal(result.users[0].iamLinked,true);
    assert.equal(result.organizations.length,2);assert.equal(result.units.length,2);
    assert.equal((await(await fetchAs('/access?organizationId=3',1)).json()).users[0].id,4);
    assert.equal((await fetchAs('/3/access',5,{method:'PUT',body:JSON.stringify(await f.body())})).status,403);
    assert.equal((await fetchAs('/3/access',2,{method:'PUT',body:JSON.stringify(await f.body())})).status,200);
    assert.equal((await(await fetchAs('/access?status=pending',2)).json()).users.length,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
