const { DatabaseSync } = require('node:sqlite');
const { createWorkspaceJoin } = require('../../lib/workspace_join');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT, student_no TEXT, role TEXT, organization_id INTEGER, active_unit_id INTEGER);
    CREATE TABLE organization_units(id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, archived_at TEXT);
    CREATE TABLE organization_unit_memberships(unit_id INTEGER, user_id INTEGER, role TEXT, removed_at TEXT, PRIMARY KEY(unit_id,user_id));
    CREATE TABLE organization_admin_grants(organization_id INTEGER,user_id INTEGER,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE iam_user_state(user_id INTEGER PRIMARY KEY,disabled INTEGER,session_version INTEGER DEFAULT 0,media_revoked_before INTEGER DEFAULT 0);
    CREATE TABLE organization_join_preferences(user_id INTEGER PRIMARY KEY,dismissed_at TEXT);
    CREATE TABLE organization_join_requests(id INTEGER PRIMARY KEY, organization_id INTEGER,unit_id INTEGER,user_id INTEGER,
      status TEXT DEFAULT 'pending',reason TEXT DEFAULT '',review_note TEXT DEFAULT '',reviewed_by INTEGER,review_revision INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,read_at TEXT,UNIQUE(unit_id,user_id));
    CREATE TABLE organization_access_audit(id INTEGER PRIMARY KEY,organization_id INTEGER,unit_id INTEGER,user_id INTEGER,action TEXT,resource_type TEXT,resource_id INTEGER,details TEXT);
    INSERT INTO users VALUES(1,'Super','root@example.edu','root','superadmin',2,1),
      (2,'New student','student@example.edu','260000001','visitor',2,NULL),
      (3,'Unit manager','manager@example.edu','manager','admin',2,1),
      (4,'Other manager','other@example.edu','other','admin',2,2),
      (5,'Other school','foreign@example.edu','foreign','visitor',3,NULL),
      (6,'College admin','college@example.edu','college','admin',2,1),
      (7,'Revoked super','revoked@example.edu','revoked','superadmin',2,NULL);
    INSERT INTO organization_units VALUES(1,2,'Media',NULL),(2,2,'Student union',NULL),(3,3,'Foreign',NULL),(4,2,'Archived','2026');
    INSERT INTO organization_admin_grants VALUES(2,1),(2,6);
    INSERT INTO organization_unit_memberships VALUES(1,3,'manager',NULL),(2,4,'manager',NULL);
    ALTER TABLE users ADD COLUMN view_organization_photos INTEGER NOT NULL DEFAULT 0;
    UPDATE users SET view_organization_photos=1 WHERE id IN (1,3,4,6);`);
  const query = async (text, values = []) => {
    const statement = sql.prepare(text.replace(/\s+FOR UPDATE/g, ''));
    if (/^\s*SELECT/i.test(text)) return [statement.all(...values)];
    const result = statement.run(...values);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
  };
  const db = { query, async getConnection() { return { query, beginTransaction: async () => sql.exec('BEGIN'), commit: async () => sql.exec('COMMIT'),
    rollback: async () => { if (sql.isTransaction) sql.exec('ROLLBACK'); }, release() {} }; } };
  return { db, sql, join: createWorkspaceJoin(db), close: () => sql.close() };
}

module.exports = { fixture };
