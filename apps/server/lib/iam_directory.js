const { error, sha256, normalizeEntry, identifier } = require('./iam_protocol');

function createIamDirectory(db) {
  async function transaction(fn) {
    const conn = await db.getConnection();
    try { await conn.beginTransaction(); const value = await fn(conn); await conn.commit(); return value; }
    catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  }
  const audit = (conn, cfg, externalId, userId, action) => conn.query(
    'INSERT INTO iam_identity_audit (source_key, identity_hash, user_id, action) VALUES (?, ?, ?, ?)',
    [cfg.sourceKey, sha256(externalId), userId, action]);
  async function updateUserState(conn, userId) {
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    await conn.query('INSERT IGNORE INTO iam_user_state (user_id) VALUES (?)', [userId]);
    const [[state]] = await conn.query('SELECT disabled, session_version, media_revoked_before FROM iam_user_state WHERE user_id = ? FOR UPDATE', [userId]);
    const [[counts]] = await conn.query('SELECT COUNT(*) AS count FROM iam_accounts WHERE user_id = ? AND status = 1', [userId]);
    const disabled = Number(counts.count) > 0;
    if (disabled !== Boolean(state.disabled)) {
      await conn.query('UPDATE iam_user_state SET disabled = ?, session_version = ?, media_revoked_before = ? WHERE user_id = ?',
        [Number(disabled), Number(state.session_version) + (disabled ? 1 : 0), disabled ? Date.now() : state.media_revoked_before || 0, userId]);
    }
  }
  async function applyEntry(conn, cfg, input, type) {
    const event = normalizeEntry(input, type, cfg), table = type === '1' ? 'iam_departments' : 'iam_accounts';
    if (type === '1') {
      await conn.query('INSERT IGNORE INTO iam_departments (source_key, external_id, name) VALUES (?, ?, ?)', [cfg.sourceKey, event.externalId, event.name]);
    } else {
      await conn.query('INSERT IGNORE INTO iam_accounts (source_key, external_id, organization_id, principal_id) VALUES (?, ?, ?, ?)',
        [cfg.sourceKey, event.externalId, cfg.orgId, event.principal]);
    }
    const [[old]] = await conn.query(`SELECT * FROM ${table} WHERE source_key = ? AND external_id = ? FOR UPDATE`, [cfg.sourceKey, event.externalId]);
    if (Number(old.event_ms) > event.eventMs) return;
    if (Number(old.event_ms) === event.eventMs) {
      if (old.payload_hash !== event.payloadHash) throw error('IAM_EVENT_CONFLICT');
      return;
    }
    if (type === '1') {
      await conn.query('UPDATE iam_departments SET name = ?, parent_id = ?, status = ?, event_ms = ?, payload_hash = ? WHERE source_key = ? AND external_id = ?',
        [event.name, event.parent, event.status, event.eventMs, event.payloadHash, cfg.sourceKey, event.externalId]);
    } else {
      await conn.query(`UPDATE iam_accounts SET principal_id = ?, name = ?, email = ?, student_no = ?, departments = ?,
        status = ?, event_ms = ?, payload_hash = ? WHERE source_key = ? AND external_id = ?`,
      [event.principal, event.name, event.email, event.studentNo, JSON.stringify(event.departments), event.status, event.eventMs, event.payloadHash, cfg.sourceKey, event.externalId]);
      let linkedId = Number(old.user_id);
      if (!linkedId && cfg.profileLoginMatching) {
        linkedId = await require('./iam_profile_links').matchUser(conn, cfg, event);
        if (linkedId) await conn.query('UPDATE iam_accounts SET user_id = ? WHERE source_key = ? AND external_id = ?', [linkedId, cfg.sourceKey, event.externalId]);
      }
      if (linkedId) {
        await updateUserState(conn, linkedId);
        if (event.name && !event.status) await conn.query('UPDATE users SET name = ? WHERE id = ? AND organization_id = ?', [event.name, linkedId, cfg.orgId]);
        await audit(conn, cfg, event.externalId, linkedId, event.status ? 'account_disabled' : 'account_updated');
      }
    }
  }
  async function applyPush(cfg, type, push) {
    return transaction(async conn => {
      await conn.query('INSERT IGNORE INTO iam_push_receipts (source_key, request_key, payload_hash) VALUES (?, ?, ?)', [cfg.sourceKey, push.requestKey, push.payloadHash]);
      const [[receipt]] = await conn.query('SELECT payload_hash, response FROM iam_push_receipts WHERE source_key = ? AND request_key = ? FOR UPDATE', [cfg.sourceKey, push.requestKey]);
      if (receipt.payload_hash !== push.payloadHash) throw error('IAM_REPLAY_CONFLICT', 409);
      const cached = typeof receipt.response === 'string' ? JSON.parse(receipt.response) : receipt.response;
      if (cached?.code === 1000) return cached;
      const failures = Object.create(null);
      for (let i = 0; i < push.entries.length; i++) {
        await conn.query('SAVEPOINT iam_entry');
        try { await applyEntry(conn, cfg, push.entries[i], type); }
        catch (e) {
          await conn.query('ROLLBACK TO SAVEPOINT iam_entry');
          const rawId = type === '1' ? push.entries[i]?.depNum : push.entries[i]?.externalId;
          const id = typeof rawId === 'string' && rawId.length <= 191 ? rawId : `entry:${i}`;
          failures[id] = /^IAM_/.test(e.code || '') ? e.code : 'IAM_SYNC_FAILED';
        }
        await conn.query('RELEASE SAVEPOINT iam_entry');
      }
      const result = Object.keys(failures).length ? { code: 9001, msg: '部分失败', data: JSON.stringify(failures) }
        : { code: 1000, msg: '成功', data: push.sign };
      await conn.query('UPDATE iam_push_receipts SET response = ? WHERE source_key = ? AND request_key = ?', [JSON.stringify(result), cfg.sourceKey, push.requestKey]);
      return result;
    });
  }
  async function resolveUser(cfg, externalId) {
    return transaction(async conn => {
      const [[identity]] = await conn.query('SELECT * FROM iam_accounts WHERE source_key = ? AND external_id = ? FOR UPDATE', [cfg.sourceKey, identifier(externalId)]);
      if (!identity || Number(identity.status) !== 0) throw error('IAM_ACCOUNT_NOT_AUTHORIZED', 403);
      let userId = Number(identity.user_id);
      if (!userId) {
        if (!cfg.autoProvision) throw error('IAM_ACCOUNT_LINK_REQUIRED', 403);
        const [existing] = await conn.query('SELECT id FROM users WHERE (email = ? AND email <> ?) OR (student_no = ? AND student_no <> ?) LIMIT 1 FOR UPDATE',
          [identity.email, '', identity.student_no, '']);
        if (existing.length) throw error('IAM_ACCOUNT_LINK_REQUIRED', 403);
        const studentNo = 'iam_' + sha256(`${cfg.sourceKey}\n${externalId}`).slice(0, 28);
        const [insert] = await conn.query("INSERT INTO users (student_no, name, email, role, organization_id) VALUES (?, ?, ?, 'visitor', ?)",
          [studentNo, identity.name || identity.principal_id.slice(0, 50), identity.email || null, cfg.orgId]);
        userId = Number(insert.insertId);
        await conn.query('UPDATE iam_accounts SET user_id = ? WHERE source_key = ? AND external_id = ?', [userId, cfg.sourceKey, externalId]);
        await audit(conn, cfg, externalId, userId, 'account_provisioned');
      }
      const [[user]] = await conn.query('SELECT id, role, organization_id FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!user || Number(user.organization_id) !== cfg.orgId) throw error('IAM_ACCOUNT_LINK_INVALID', 403);
      await updateUserState(conn, userId);
      return user;
    });
  }
  async function bindUser(cfg, externalId, userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw error('IAM_ACCOUNT_LINK_INVALID', 400);
    return transaction(async conn => {
      const [[identity]] = await conn.query('SELECT * FROM iam_accounts WHERE source_key = ? AND external_id = ? FOR UPDATE', [cfg.sourceKey, identifier(externalId)]);
      const [[user]] = await conn.query('SELECT id, organization_id FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!identity || !user || Number(user.organization_id) !== cfg.orgId) throw error('IAM_ACCOUNT_LINK_INVALID', 400);
      if (identity.user_id && Number(identity.user_id) !== Number(userId)) throw error('IAM_ACCOUNT_ALREADY_LINKED', 409);
      await conn.query('UPDATE iam_accounts SET user_id = ? WHERE source_key = ? AND external_id = ?', [userId, cfg.sourceKey, externalId]);
      await updateUserState(conn, userId);
      await audit(conn, cfg, externalId, userId, 'account_linked');
      return { linked: true, userId: Number(userId) };
    });
  }
  return { applyPush, resolveUser, bindUser };
}
module.exports = { createIamDirectory };
