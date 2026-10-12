const crypto = require('node:crypto');

function failure(message, status = 403) {
  return Object.assign(new Error(message), { status });
}

function secret() {
  const value = process.env.UPLOAD_SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) throw failure('UPLOAD_SESSION_SECRET_REQUIRED', 503);
  return value;
}

function createSession(data, expiresSeconds) {
  const payload = Buffer.from(JSON.stringify({ ...data, v: 1,
    expiresAt: Date.now() + expiresSeconds * 1000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}

function readSession(token, user) {
  if (typeof token !== 'string' || token.length > 32768) throw failure('INVALID_UPLOAD_SESSION');
  const parts = token.split('.');
  if (parts.length !== 2) throw failure('INVALID_UPLOAD_SESSION');
  const expected = crypto.createHmac('sha256', secret()).update(parts[0]).digest();
  const signature = Buffer.from(parts[1], 'base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) throw failure('INVALID_UPLOAD_SESSION');
  let session;
  try { session = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); }
  catch (_) { throw failure('INVALID_UPLOAD_SESSION'); }
  if (session.v !== 1 || !Number.isFinite(session.expiresAt) || session.expiresAt < Date.now()
    || Number(session.userId) !== Number(user?.id)
    || Number(session.orgId) !== Number(user?.organization_id)) throw failure('INVALID_UPLOAD_SESSION');
  return session;
}

// Named locks survive transactions and serialize completion/abort across server processes.
async function withSessionLock(pool, session, run) {
  const conn = await pool.getConnection();
  const name = crypto.createHash('sha256').update(`photo-upload:${session.originalKey}`).digest('hex');
  let locked = false;
  try {
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    locked = Number(row?.acquired) === 1;
    if (!locked) throw failure('UPLOAD_SESSION_BUSY', 409);
    return await run(conn);
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => null);
    conn.release();
  }
}

async function findCommittedPhoto(db, session) {
  const paths = [`/${session.originalKey}`, `/${session.thumbKey}`];
  const [rows] = await db.query(
    'SELECT id, project_id, photographer_id, organization_id, url, thumb_url FROM photos WHERE url IN (?, ?) OR thumb_url IN (?, ?) LIMIT 1',
    [...paths, ...paths]);
  return rows[0] || null;
}

module.exports = { createSession, readSession, withSessionLock, findCommittedPhoto };
