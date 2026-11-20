const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const mysql = require('mysql2/promise');
const { createWorkspaceJoin } = require('../lib/workspace_join');

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const local = path.join(root, '.local'); fs.mkdirSync(local, { recursive: true });
  const directory = fs.mkdtempSync(path.join(local, 'mysql-join-qa-'));
  fs.chmodSync(directory, 0o700);
  const data = path.join(directory, 'data'), socketPath = path.join(directory, 'db.sock');
  const mysqld = process.env.MAMAGE_TEST_MYSQLD || '/opt/homebrew/bin/mysqld';
  assert.ok(path.isAbsolute(mysqld), 'Use an explicit local mysqld binary');
  fs.mkdirSync(data);
  cp.execFileSync(mysqld, ['--no-defaults', '--initialize-insecure', '--datadir=' + data, '--log-error=' + path.join(directory, 'initialize.log')], { stdio: 'ignore', timeout: 90000 });
  const server = cp.spawn(mysqld, ['--no-defaults', '--datadir=' + data, '--socket=' + socketPath,
    '--pid-file=' + path.join(directory, 'mysqld.pid'), '--skip-networking', '--mysqlx=OFF', '--skip-log-bin',
    '--log-error=' + path.join(directory, 'server.log')], { stdio: 'ignore' });
  let pool, connection, startupError;
  server.on('error', error => { startupError = error; });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw Error('Isolated mysqld exited; inspect ' + directory);
      try { connection = await mysql.createConnection({ socketPath, user: 'root', multipleStatements: true, connectTimeout: 1000 }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(connection, 'Isolated mysqld did not start');
    await connection.query(`CREATE DATABASE mamage_join_workspace_test;
      USE mamage_join_workspace_test;
      CREATE TABLE organizations(id INT UNSIGNED PRIMARY KEY, name VARCHAR(150));
      CREATE TABLE users(id INT UNSIGNED PRIMARY KEY,name VARCHAR(150),email VARCHAR(255),student_no VARCHAR(40),
        role VARCHAR(30),organization_id INT UNSIGNED,active_unit_id INT UNSIGNED NULL);
      CREATE TABLE organization_units(id INT UNSIGNED PRIMARY KEY,organization_id INT UNSIGNED,name VARCHAR(150),archived_at DATETIME NULL);
      CREATE TABLE organization_unit_memberships(unit_id INT UNSIGNED,user_id INT UNSIGNED,role VARCHAR(20),removed_at DATETIME NULL,
        PRIMARY KEY(unit_id,user_id),KEY idx_member_user(user_id,removed_at));
      CREATE TABLE organization_admin_grants(organization_id INT UNSIGNED,user_id INT UNSIGNED,PRIMARY KEY(organization_id,user_id),KEY idx_admin_user(user_id));
      CREATE TABLE iam_user_state(user_id INT UNSIGNED PRIMARY KEY,disabled TINYINT,session_version INT DEFAULT 0,media_revoked_before BIGINT DEFAULT 0);
      CREATE TABLE organization_access_audit(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,organization_id INT UNSIGNED,unit_id INT UNSIGNED,
        user_id INT UNSIGNED,action VARCHAR(80),resource_type VARCHAR(40),resource_id BIGINT UNSIGNED,details JSON);
      INSERT INTO organizations VALUES(2,'Local test school');
      INSERT INTO users VALUES(1,'Root','root@example.invalid','root','superadmin',2,1),(2,'Student','student@example.invalid','student','visitor',2,NULL),
        (3,'Manager','manager@example.invalid','manager','admin',2,1),(4,'Second student','second@example.invalid','second','visitor',2,NULL);
      INSERT INTO organization_units VALUES(1,2,'Media',NULL);
      INSERT INTO organization_admin_grants VALUES(2,1);
      INSERT INTO organization_unit_memberships VALUES(1,3,'manager',NULL);`);
    await connection.query(fs.readFileSync(path.join(__dirname, 'migrations/20261117_001_workspace_join_requests.sql'), 'utf8'));
    await connection.query(fs.readFileSync(path.join(__dirname, 'migrations/20261117_001_workspace_join_requests.sql'), 'utf8'));
    const photoMigration = fs.readFileSync(path.join(__dirname, 'migrations/20261118_001_organization_photo_visibility.sql'), 'utf8');
    await connection.query(photoMigration);
    const [[legacy]] = await connection.query('SELECT view_organization_photos FROM users WHERE id=3');
    assert.equal(legacy.view_organization_photos, 1);
    await connection.query('UPDATE users SET view_organization_photos=0 WHERE id=3');
    await connection.query('INSERT INTO users (id, name, role, organization_id) VALUES (5, ?, ?, 2)', ['New account', 'visitor']);
    await connection.query(photoMigration);
    const [photoScopes] = await connection.query('SELECT view_organization_photos FROM users WHERE id IN (3, 5) ORDER BY id');
    assert.deepEqual(photoScopes.map(row => row.view_organization_photos), [0, 0], 'Retry preserves explicit revocation; new accounts default to own uploads');
    pool = mysql.createPool({ socketPath, user: 'root', database: 'mamage_join_workspace_test', connectionLimit: 8 });
    const join = createWorkspaceJoin(pool);
    const submissions = await Promise.all(Array.from({ length: 4 }, () => join.apply(2, { unitId: 1, reason: 'Concurrent local test' })));
    assert.equal(new Set(submissions.map(request => request.id)).size, 1);
    assert.equal(submissions.filter(request => request.created).length, 1);
    const decisions = await Promise.allSettled([join.review(3, submissions[0].id, { decision: 'approve' }), join.review(1, submissions[0].id, { decision: 'approve' })]);
    assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(decisions.find(result => result.status === 'rejected').reason.code, 'JOIN_REQUEST_CHANGED');
    const [[membership]] = await pool.query('SELECT role FROM organization_unit_memberships WHERE unit_id=1 AND user_id=2');
    assert.equal(membership.role, 'editor');
    const [[audits]] = await pool.query("SELECT COUNT(*) count FROM organization_access_audit WHERE action='workspace.join.approved'");
    assert.equal(Number(audits.count), 1);
    const notification = (await join.mine(2)).requests[0];
    await join.markRead(2, [{ id: notification.id, revision: notification.reviewRevision }]);
    assert.equal((await join.summary(2)).unreadCount, 0);
    const withdrawal = await join.apply(4, { unitId: 1 });
    await join.withdraw(4, withdrawal.id);
    await assert.rejects(join.review(3, withdrawal.id, { decision: 'approve' }), error => error.code === 'JOIN_REQUEST_CHANGED');
    const [[version]] = await pool.query('SELECT VERSION() AS version');
    console.log(JSON.stringify({ passed: true, engine: version.version, isolatedSocket: true, networkingDisabled: true,
      migrationAppliedTwice: true, concurrentApplications: 4, createdApplications: 1, concurrentReviewers: 2,
      committedApprovals: 1, membershipRole: membership.role, notificationReadVerified: true, withdrawalVerified: true,
      photoVisibilityMigrationVerified: true }));
  } finally {
    await pool?.end(); await connection?.end();
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 15000); timer.unref(); })]);
    }
    if (server.exitCode === 0) fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
