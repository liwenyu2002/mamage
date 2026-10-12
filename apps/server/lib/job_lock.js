const crypto = require('node:crypto');

async function acquireJobLock(pool, resource) {
  const connection = await pool.getConnection();
  const name = crypto.createHash('sha256').update(resource).digest('hex');
  try {
    const [[row]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    if (Number(row?.acquired) !== 1) { connection.release(); return null; }
  } catch (error) { connection.release(); throw error; }
  return {
    connection,
    async assertOwned() {
      const [[row]] = await connection.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', [name]);
      if (Number(row?.owned) !== 1) throw Object.assign(new Error('JOB_LOCK_LOST'), { code: 'JOB_LOCK_LOST' });
    },
    async release() {
      await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => null);
      connection.release();
    },
  };
}

module.exports = { acquireJobLock };
