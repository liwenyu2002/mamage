const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const mysql = require('mysql2/promise');
const { iamConfig } = require('../lib/iam_config');
const { createIamDirectory } = require('../lib/iam_directory');
const guard = require('../lib/iam_account_guard');

// Opt-in and deliberately fixed to the existing local sandbox, never DB_HOST / production.
test('IAM migration, retries, rollback, account binding and revocation on isolated MySQL',
  { skip: !process.env.MAMAGE_IAM_MYSQL_PRIVATE && 'set MAMAGE_IAM_MYSQL_PRIVATE to the local sandbox credential file' }, async () => {
    const credentials = JSON.parse(fs.readFileSync(process.env.MAMAGE_IAM_MYSQL_PRIVATE, 'utf8'));
    const root = await mysql.createConnection({ host: '127.0.0.1', port: 13362, user: 'root', password: credentials.rootPassword });
    const name = 'mamage_iam_test_' + crypto.randomBytes(8).toString('hex');
    let db, created = false;
    const previous = process.env.IAM_ACCOUNT_GUARD; process.env.IAM_ACCOUNT_GUARD = '1';
    try {
      await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`); created = true;
      db = mysql.createPool({ host: '127.0.0.1', port: 13362, user: 'root', password: credentials.rootPassword,
        database: name, multipleStatements: true, connectionLimit: 4 });
      await db.query(`CREATE TABLE users(id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT, student_no VARCHAR(32) UNIQUE NOT NULL,
        name VARCHAR(50), email VARCHAR(255), role VARCHAR(30), organization_id INT UNSIGNED NOT NULL) ENGINE=InnoDB;
        INSERT INTO users VALUES(7,'local-owner','Owner','owner@example.edu','admin',2)`);
      const migration = fs.readFileSync(path.resolve(__dirname, 'migrations/20261028_001_iam_integration.sql'), 'utf8');
      await db.query(migration); await db.query(migration);
      await db.query(fs.readFileSync(path.resolve(__dirname, 'migrations/20261029_001_iam_login_links.sql'), 'utf8'));
      const cfg = iamConfig({ IAM_BASE_URL:'https://iam.example.edu', MAMAGE_PUBLIC_URL:'https://photos.example.edu',
        IAM_CLIENT_ID:'test-client', IAM_CLIENT_SECRET:'synthetic-secret', IAM_ORGANIZATION_ID:'2' });
      const directory = createIamDirectory(db), initial = Date.now() - 10000;
      const account = patch => ({ appId:cfg.appId,externalId:'owner',principalId:'owner',status:0,syncType:0,eventTimestamp:initial,
        deptNums:[],attributes:{name:'Owner',email:'owner@example.edu'},...patch });
      const push = entries => ({ entries, requestKey:crypto.randomBytes(32).toString('hex'), payloadHash:crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),sign:'A'.repeat(32) });
      const p = push([account()]);
      const duplicate = await Promise.all([directory.applyPush(cfg,'2',p),directory.applyPush(cfg,'2',p)]);
      assert.deepEqual(duplicate.map(x=>x.code),[1000,1000]);
      const partial = await directory.applyPush(cfg,'2',push([account({externalId:'good'}),account({externalId:'bad',deptNums:'invalid'})]));
      assert.equal(partial.code,9001);
      const [[counts]] = await db.query('SELECT COUNT(*) n FROM iam_accounts'); assert.equal(counts.n,2);
      await directory.bindUser(cfg,'owner',7); assert.equal((await directory.resolveUser(cfg,'owner')).role,'admin');
      await directory.applyPush(cfg,'2',push([account({status:1,eventTimestamp:initial+1})]));
      await assert.rejects(guard.issueToken({id:7},'synthetic-signing-secret',db),/ACCOUNT_SESSION_REVOKED/);
      await directory.applyPush(cfg,'2',push([account({status:0,eventTimestamp:initial+2})]));
      assert.equal((await guard.accountState(7,db)).session_version,1);
      assert.equal(await guard.allowMedia(7,initial,db),false);
      const [[owner]] = await db.query('SELECT id,role FROM users WHERE id=7'); assert.deepEqual(owner,{id:7,role:'admin'});
      const fresh = id => account({externalId:id,attributes:{name:'New',email:'same@example.edu'}});
      await directory.applyPush(cfg,'2',push([fresh('fresh-one'),fresh('fresh-two')]));
      const results = await Promise.allSettled(['fresh-one','fresh-two'].map(id=>directory.resolveUser({...cfg,autoProvision:true},id)));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1,'concurrent provisioning cannot create duplicate email owners');
      const [[freshCount]] = await db.query("SELECT COUNT(*) n FROM users WHERE email='same@example.edu'"); assert.equal(freshCount.n,1);
      const {resolveProfile}=require('../lib/iam_profile_links');
      assert.equal((await resolveProfile(db,cfg,{attributes:{name:'Owner',email:'owner@example.edu'}},'oauth-owner')).id,7);
      const profileResults = await Promise.allSettled(['profile-one','profile-two'].map(id =>
        resolveProfile(db,{...cfg,autoProvision:true},{attributes:{name:'New profile',email:'profile@example.edu'}},id)));
      assert.equal(profileResults.filter(result=>result.status==='fulfilled').length,1,'one account cannot bind two OAuth subjects');
      const [[profileCount]] = await db.query("SELECT COUNT(*) n FROM users WHERE email='profile@example.edu'");
      assert.equal(profileCount.n,1);
      const [[profileUser]] = await db.query("SELECT role FROM users WHERE email='profile@example.edu'");
      assert.equal(profileUser.role,'visitor');
    } finally {
      if (previous === undefined) delete process.env.IAM_ACCOUNT_GUARD; else process.env.IAM_ACCOUNT_GUARD = previous;
      if (db) await db.end();
      try { if (created) await root.query(`DROP DATABASE \`${name}\``); } finally { await root.end(); }
    }
  });
