const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const connectionContext = new AsyncLocalStorage();
let locksInFlight = 0;

const distributed = () => process.env.MAMAGE_DISTRIBUTED_RUNTIME === '1';
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;

// Memory mode preserves existing standalone installs. Cluster mode fails closed
// on database errors; it must never silently create a second, local session.
function createSharedStore(namespace, { db, enabled = distributed } = {}) {
  const memory = new Map();
  const basePool = () => db || require('../db').pool;
  const pool = () => connectionContext.getStore() || basePool();
  const active = () => typeof enabled === 'function' ? enabled() : enabled;
  const ttl = value => Number(value?.expiresAt) || Date.now() + 7 * 86400000;
  const store = {
    async get(key) {
      if (!active()) return memory.get(String(key));
      const [rows] = await pool().query('SELECT payload FROM runtime_state WHERE namespace = ? AND state_key = ?', [namespace, String(key)]);
      return rows.length ? decode(rows[0].payload) : undefined;
    },
    async set(key, value, { connection } = {}) {
      if (!active()) { memory.set(String(key), value); return; }
      await (connection || pool()).query(`INSERT INTO runtime_state (namespace, state_key, payload, expires_at) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE payload = VALUES(payload), expires_at = VALUES(expires_at)`,
      [namespace, String(key), JSON.stringify(value), ttl(value)]);
    },
    async delete(key) {
      if (!active()) return memory.delete(String(key));
      const [result] = await pool().query('DELETE FROM runtime_state WHERE namespace = ? AND state_key = ?', [namespace, String(key)]);
      return result.affectedRows > 0;
    },
    async pruneExpired(limit = 1000) {
      limit = Math.max(1, Math.min(10000, Math.floor(Number(limit) || 1000)));
      if (!active()) {
        let deleted = 0;
        for (const [key, value] of memory) {
          if (ttl(value) < Date.now()) { memory.delete(key); if (++deleted >= limit) break; }
        }
        return deleted;
      }
      const [result] = await pool().query('DELETE FROM runtime_state WHERE namespace = ? AND expires_at < ? LIMIT ?', [namespace, Date.now(), limit]);
      return result.affectedRows;
    },
    async entries() {
      if (!active()) return [...memory.entries()];
      const [rows] = await pool().query('SELECT state_key, payload FROM runtime_state WHERE namespace = ?', [namespace]);
      return rows.map(row => [row.state_key, decode(row.payload)]);
    },
    async values() { return (await store.entries()).map(([, value]) => value); },
    async withLock(key, callback) {
      if (!active()) {
        // Also serialize the standalone HTTP complete/abort race.
        const previous = pending.get(String(key)) || Promise.resolve();
        const next = previous.catch(() => {}).then(() => callback(null));
        pending.set(String(key), next);
        try { return await next; } finally { if (pending.get(String(key)) === next) pending.delete(String(key)); }
      }
      // Leave pool capacity for ordinary API queries while other callers wait
      // on a long upload-completion lock. State operations reuse its connection.
      const cap = Math.max(1, Math.floor(Number(process.env.DB_CONNECTION_LIMIT || 20) / 4));
      while (locksInFlight >= cap) await new Promise(resolve => setTimeout(resolve, 20));
      locksInFlight += 1;
      let connection;
      try { connection = await basePool().getConnection(); } catch (error) { locksInFlight -= 1; throw error; }
      const lock = crypto.createHash('sha256').update(`runtime:${namespace}:${key}`).digest('hex');
      let acquired = false;
      try {
        const [[row]] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [lock]);
        acquired = Number(row.acquired) === 1;
        if (!acquired) throw Object.assign(new Error('RUNTIME_STATE_BUSY'), { status: 409 });
        return await connectionContext.run(connection, () => callback(connection));
      } finally {
        if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
        connection.release();
        locksInFlight -= 1;
      }
    },
    async consume(key) {
      return store.withLock(key, async () => {
        const value = await store.get(key);
        if (value) await store.delete(key);
        return value;
      });
    },
    async mutate(key, callback) {
      return store.withLock(key, async () => {
        const value = await store.get(key);
        const result = await callback(value);
        if (value) await store.set(key, value);
        return result;
      });
    },
  };
  const pending = new Map();
  return store;
}

module.exports = { createSharedStore, distributed };
