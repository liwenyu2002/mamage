const { DatabaseSync } = require('node:sqlite');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, student_no TEXT UNIQUE, name TEXT, email TEXT, role TEXT, organization_id INTEGER);
    CREATE TABLE photos(id INTEGER PRIMARY KEY, photographer_id INTEGER);
    CREATE TABLE organization_unit_memberships(unit_id INTEGER,user_id INTEGER,role TEXT);
    CREATE TABLE iam_departments(source_key TEXT, external_id TEXT, name TEXT, parent_id TEXT, status INTEGER DEFAULT 0,
      event_ms INTEGER DEFAULT 0,payload_hash TEXT DEFAULT '',PRIMARY KEY(source_key,external_id));
    CREATE TABLE iam_accounts(source_key TEXT,external_id TEXT,user_id INTEGER,organization_id INTEGER,principal_id TEXT,
      name TEXT DEFAULT '',email TEXT DEFAULT '',student_no TEXT DEFAULT '',departments TEXT,status INTEGER DEFAULT 0,
      event_ms INTEGER DEFAULT 0,payload_hash TEXT DEFAULT '',PRIMARY KEY(source_key,external_id),UNIQUE(source_key,user_id));
    CREATE TABLE iam_user_state(user_id INTEGER PRIMARY KEY,disabled INTEGER DEFAULT 0,session_version INTEGER DEFAULT 0,media_revoked_before INTEGER DEFAULT 0);
    CREATE TABLE iam_push_receipts(source_key TEXT,request_key TEXT,payload_hash TEXT,response TEXT,PRIMARY KEY(source_key,request_key));
    CREATE TABLE iam_identity_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,source_key TEXT,identity_hash TEXT,user_id INTEGER,action TEXT);
    CREATE TABLE iam_login_identities(source_key TEXT,subject_id TEXT,user_id INTEGER,PRIMARY KEY(source_key,subject_id),UNIQUE(source_key,user_id));
    CREATE TABLE iam_login_pending(source_key TEXT,subject_id TEXT,claims TEXT,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_key,subject_id));
    INSERT INTO users VALUES(7,'student-7','Original owner','existing@example.edu','admin',2);
    INSERT INTO users VALUES(8,'student-8','Other org','foreign@example.edu','admin',3);
    INSERT INTO photos VALUES(1,7); INSERT INTO organization_unit_memberships VALUES(1,7,'manager');`);
  const query = async (source, values = []) => {
    const params = [];
    let index = 0;
    const text = source.replace(/\s+FOR UPDATE/g, '').replace(/INSERT IGNORE/g, 'INSERT OR IGNORE').replace(/\?/g, () => {
      const value = values[index++];
      if (Array.isArray(value)) { params.push(...value); return value.map(() => '?').join(','); }
      params.push(typeof value === 'boolean' ? Number(value) : value ?? null); return '?';
    });
    const statement = sql.prepare(text);
    if (/^\s*SELECT/i.test(text)) return [statement.all(...params)];
    const result = statement.run(...params); return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
  };
  let previous = Promise.resolve();
  const pool = { query, async getConnection() {
    const before = previous; let done;
    previous = new Promise(resolve => { done = resolve; }); await before;
    return { query, beginTransaction: async () => sql.exec('BEGIN'), commit: async () => sql.exec('COMMIT'),
      rollback: async () => { if (sql.isTransaction) sql.exec('ROLLBACK'); }, release: done };
  } };
  return { pool, sql, close: () => sql.close() };
}
module.exports = { fixture };
