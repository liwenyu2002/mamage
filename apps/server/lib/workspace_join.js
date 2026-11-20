const validId = value => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const text = value => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.trim().length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw fail('INVALID_JOIN_TEXT', '说明不能超过 300 字');
  }
  return value.trim();
};

function createWorkspaceJoin(db) {
  async function actor(connection, userId, lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const [[user]] = await connection.query('SELECT id, organization_id, role, active_unit_id FROM users WHERE id = ?' + suffix, [userId]);
    if (!user || !validId(user.organization_id)) throw fail('USER_NOT_FOUND', '账号不可用', 401);
    const [grants] = await connection.query('SELECT organization_id FROM organization_admin_grants WHERE user_id = ?' + suffix, [userId]);
    const collegeAdmin = grants.some(g => Number(g.organization_id) === Number(user.organization_id));
    const global = user.role === 'superadmin' && collegeAdmin;
    const [managed] = await connection.query(`SELECT ou.id, ou.name, ou.organization_id FROM organization_units ou
      JOIN organization_unit_memberships m ON m.unit_id = ou.id
      WHERE m.user_id = ? AND m.role = 'manager' AND m.removed_at IS NULL
        AND ou.organization_id = ? AND ou.archived_at IS NULL` + suffix, [userId, user.organization_id]);
    return { user, collegeAdmin, global, managed, canReview: global || collegeAdmin || managed.length > 0 };
  }

  function scope(policy, alias = 'r') {
    if (policy.global) return { sql: '1 = 1', values: [] };
    if (policy.collegeAdmin) return { sql: `${alias}.organization_id = ?`, values: [policy.user.organization_id] };
    if (!policy.managed.length) return { sql: '1 = 0', values: [] };
    return { sql: `${alias}.organization_id = ? AND ${alias}.unit_id IN (${policy.managed.map(() => '?').join(',')})`,
      values: [policy.user.organization_id, ...policy.managed.map(unit => unit.id)] };
  }

  async function transaction(run) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await run(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  async function audit(connection, policy, action, request, details = {}) {
    await connection.query(`INSERT INTO organization_access_audit
      (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [request.organization_id, request.unit_id, policy.user.id, action,
      'join_request', request.id, JSON.stringify({ applicantId: request.user_id, ...details })]);
  }

  async function dismiss(connection, userId) {
    const [[existing]] = await connection.query('SELECT user_id FROM organization_join_preferences WHERE user_id = ?', [userId]);
    if (!existing) await connection.query('INSERT INTO organization_join_preferences (user_id, dismissed_at) VALUES (?, CURRENT_TIMESTAMP)', [userId]);
  }

  async function summary(userId) {
    const policy = await actor(db, userId), where = scope(policy);
    const [[pending]] = await db.query(`SELECT COUNT(*) AS count FROM organization_join_requests r
      JOIN organization_units ou ON ou.id = r.unit_id AND ou.archived_at IS NULL
      WHERE r.status = 'pending' AND ${where.sql}`, where.values);
    const [[unread]] = await db.query(`SELECT COUNT(*) AS count FROM organization_join_requests
      WHERE user_id = ? AND status IN ('approved', 'rejected') AND read_at IS NULL`, [userId]);
    const [[membership]] = await db.query(`SELECT m.unit_id FROM organization_unit_memberships m
      JOIN organization_units ou ON ou.id = m.unit_id AND ou.archived_at IS NULL
      WHERE m.user_id = ? AND m.removed_at IS NULL AND ou.organization_id = ? LIMIT 1`, [userId, policy.user.organization_id]);
    return { canReview: policy.canReview, pendingCount: Number(pending.count), unreadCount: Number(unread.count),
      hasMembership: Boolean(membership || policy.collegeAdmin), total: Number(pending.count) + Number(unread.count) };
  }

  async function mine(userId) {
    const policy = await actor(db, userId);
    const [units] = await db.query('SELECT id, name FROM organization_units WHERE organization_id = ? AND archived_at IS NULL ORDER BY name, id', [policy.user.organization_id]);
    const [requests] = await db.query(`SELECT r.id, r.unit_id AS unitId, ou.name AS unitName, r.status, r.reason,
      r.review_note AS reviewNote, r.created_at AS createdAt, r.reviewed_at AS reviewedAt, r.read_at AS readAt, r.review_revision AS reviewRevision,
      ou.archived_at AS archivedAt FROM organization_join_requests r JOIN organization_units ou ON ou.id = r.unit_id
      WHERE r.user_id = ? ORDER BY r.updated_at DESC, r.id DESC LIMIT 100`, [userId]);
    const [[preference]] = await db.query('SELECT dismissed_at FROM organization_join_preferences WHERE user_id = ?', [userId]);
    const state = await summary(userId);
    return { units, requests, ...state, needsChoice: !state.hasMembership && !preference && !requests.length };
  }

  async function skip(userId) {
    return transaction(async connection => {
      await actor(connection, userId, true);
      await dismiss(connection, userId);
      return { ok: true };
    });
  }

  async function apply(userId, input) {
    const unitId = validId(input?.unitId), reason = text(input?.reason);
    if (!unitId || Object.keys(input || {}).some(key => !['unitId', 'reason'].includes(key))) throw fail('INVALID_JOIN_REQUEST', '入组申请无效');
    return transaction(async connection => {
      const policy = await actor(connection, userId, true);
      const [[unit]] = await connection.query('SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL FOR UPDATE', [unitId, policy.user.organization_id]);
      if (!unit) throw fail('UNIT_NOT_FOUND', '组织不存在或已停用', 404);
      const [[member]] = await connection.query('SELECT role FROM organization_unit_memberships WHERE unit_id = ? AND user_id = ? AND removed_at IS NULL', [unitId, userId]);
      if (member || policy.collegeAdmin) throw fail('ALREADY_A_MEMBER', '你已经是该组织的成员', 409);
      const [[previous]] = await connection.query('SELECT * FROM organization_join_requests WHERE unit_id = ? AND user_id = ? FOR UPDATE', [unitId, userId]);
      if (previous?.status === 'pending') return { id: Number(previous.id), status: 'pending', created: false };
      const [[pending]] = await connection.query("SELECT COUNT(*) AS count FROM organization_join_requests WHERE user_id = ? AND status = 'pending'", [userId]);
      if (Number(pending.count) >= 5) throw fail('JOIN_REQUEST_LIMIT', '最多同时申请 5 个组织', 429);
      let requestId = previous?.id;
      if (previous) await connection.query(`UPDATE organization_join_requests SET status = 'pending', reason = ?, review_note = '',
        reviewed_by = NULL, reviewed_at = NULL, read_at = NULL, created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [reason, requestId]);
      else {
        const [result] = await connection.query('INSERT INTO organization_join_requests (organization_id, unit_id, user_id, reason) VALUES (?, ?, ?, ?)', [policy.user.organization_id, unitId, userId, reason]);
        requestId = result.insertId;
      }
      await dismiss(connection, userId);
      await audit(connection, policy, 'workspace.join.requested', { id: requestId, user_id: userId, unit_id: unitId, organization_id: policy.user.organization_id });
      return { id: Number(requestId), status: 'pending', created: true };
    });
  }

  async function withdraw(userId, requestId) {
    requestId = validId(requestId);
    if (!requestId) throw fail('INVALID_JOIN_REQUEST', '申请编号无效');
    return transaction(async connection => {
      const policy = await actor(connection, userId, true);
      const [[request]] = await connection.query('SELECT * FROM organization_join_requests WHERE id = ? AND user_id = ? FOR UPDATE', [requestId, userId]);
      if (!request) throw fail('JOIN_REQUEST_NOT_FOUND', '申请不存在', 404);
      if (request.status !== 'pending') throw fail('JOIN_REQUEST_CHANGED', '申请已处理，请刷新', 409);
      await connection.query("UPDATE organization_join_requests SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
      await audit(connection, policy, 'workspace.join.withdrawn', request);
      return { ok: true };
    });
  }

  async function inbox(userId, input = {}) {
    const policy = await actor(db, userId);
    if (!policy.canReview) throw fail('JOIN_REVIEW_FORBIDDEN', '没有审批组织申请的权限', 403);
    const where = scope(policy), history = input.status === 'history';
    const unitId = input.unitId == null || input.unitId === '' ? null : validId(input.unitId);
    if (input.unitId && !unitId) throw fail('INVALID_UNIT', '组织编号无效');
    const values = [...where.values, ...(unitId ? [unitId] : [])];
    const predicate = `${where.sql} ${unitId ? 'AND r.unit_id = ?' : ''} AND ${history ? "r.status IN ('approved', 'rejected')" : "r.status = 'pending' AND ou.archived_at IS NULL"}`;
    const [[count]] = await db.query(`SELECT COUNT(*) AS count FROM organization_join_requests r JOIN organization_units ou ON ou.id = r.unit_id WHERE ${predicate}`, values);
    const [requests] = await db.query(`SELECT r.id, r.unit_id AS unitId, ou.name AS unitName, r.user_id AS userId,
      u.name, u.email, u.student_no AS studentNo, r.status, r.reason, r.review_note AS reviewNote,
      r.created_at AS createdAt, r.reviewed_at AS reviewedAt FROM organization_join_requests r
      JOIN organization_units ou ON ou.id = r.unit_id JOIN users u ON u.id = r.user_id
      WHERE ${predicate} ORDER BY r.updated_at DESC, r.id DESC LIMIT 100`, values);
    return { requests: requests.map(r => ({ ...r, studentNo: /^(iam_|auto)/.test(r.studentNo || '') ? null : r.studentNo })), total: Number(count.count) };
  }

  async function review(userId, requestId, input) {
    requestId = validId(requestId);
    if (!requestId || !['approve', 'reject'].includes(input?.decision)
      || Object.keys(input).some(key => !['decision', 'note'].includes(key))) throw fail('INVALID_JOIN_REVIEW', '审批操作无效');
    const note = text(input.note);
    return transaction(async connection => {
      const policy = await actor(connection, userId, true), where = scope(policy);
      if (!policy.canReview) throw fail('JOIN_REVIEW_FORBIDDEN', '没有审批组织申请的权限', 403);
      const [[request]] = await connection.query(`SELECT r.* FROM organization_join_requests r WHERE r.id = ? AND ${where.sql} FOR UPDATE`, [requestId, ...where.values]);
      if (!request) throw fail('JOIN_REQUEST_NOT_FOUND', '申请不存在或不属于你管理的组织', 404);
      if (Number(request.user_id) === Number(userId)) throw fail('SELF_JOIN_REVIEW', '不能审批自己的申请', 403);
      if (request.status !== 'pending') throw fail('JOIN_REQUEST_CHANGED', '申请已被处理，请刷新', 409);
      const [[unit]] = await connection.query('SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL FOR UPDATE', [request.unit_id, request.organization_id]);
      const [[target]] = await connection.query('SELECT id, role, active_unit_id FROM users WHERE id = ? AND organization_id = ? FOR UPDATE', [request.user_id, request.organization_id]);
      if (!unit || !target) throw fail('JOIN_TARGET_CHANGED', '组织或申请人状态已变更，不能审批', 409);
      let grantedRole = null;
      if (input.decision === 'approve') {
        try { await require('./iam_account_guard').assertSession(target.id, null, connection); }
        catch (error) {
          if (error.code === 'ACCOUNT_SESSION_REVOKED') throw fail('JOIN_TARGET_DISABLED', '申请人账号已停用，不能通过申请', 409);
          throw error;
        }
        const [[member]] = await connection.query('SELECT role, removed_at FROM organization_unit_memberships WHERE unit_id = ? AND user_id = ? FOR UPDATE', [request.unit_id, request.user_id]);
        grantedRole = member && !member.removed_at ? member.role : 'editor';
        if (!member) await connection.query("INSERT INTO organization_unit_memberships (unit_id, user_id, role) VALUES (?, ?, 'editor')", [request.unit_id, request.user_id]);
        else if (member.removed_at) await connection.query("UPDATE organization_unit_memberships SET role = 'editor', removed_at = NULL WHERE unit_id = ? AND user_id = ?", [request.unit_id, request.user_id]);
        await connection.query(`UPDATE users SET role = CASE WHEN role = 'visitor' THEN 'photographer' ELSE role END,
          active_unit_id = CASE WHEN active_unit_id IS NULL THEN ? ELSE active_unit_id END WHERE id = ?`, [request.unit_id, request.user_id]);
      }
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      await connection.query(`UPDATE organization_join_requests SET status = ?, review_note = ?, reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, review_revision = review_revision + 1, read_at = NULL WHERE id = ?`, [status, note, userId, requestId]);
      await audit(connection, policy, 'workspace.join.' + status, request, { grantedRole });
      return { ok: true, status };
    });
  }

  async function markRead(userId, notifications) {
    if (!Array.isArray(notifications) || notifications.length > 100 || notifications.some(item => !validId(item?.id) || !validId(item?.revision))) throw fail('INVALID_JOIN_REQUEST', '通知编号无效');
    for (const item of notifications) await db.query(`UPDATE organization_join_requests SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND status IN ('approved', 'rejected') AND id = ? AND review_revision = ?`, [userId, Number(item.id), Number(item.revision)]);
    return { ok: true };
  }

  return { mine, skip, apply, withdraw, inbox, summary, review, markRead };
}

function registerWorkspaceJoin(router, { db, auth }) {
  const join = createWorkspaceJoin(db);
  const route = run => async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await run(req)); }
    catch (error) {
      if (!error.status) console.error('[workspace-join]', error.code || error.name);
      res.status(error.status || 500).json({ error: error.status ? error.code : 'INTERNAL_ERROR', message: error.status ? error.message : '申请处理失败，请稍后重试' });
    }
  };
  router.get('/workspace-join/me', auth, route(req => join.mine(req.user.id)));
  router.get('/workspace-join/summary', auth, route(req => join.summary(req.user.id)));
  router.get('/workspace-join/inbox', auth, route(req => join.inbox(req.user.id, req.query)));
  router.post('/workspace-join/skip', auth, route(req => join.skip(req.user.id)));
  router.post('/workspace-join/requests', auth, route(req => join.apply(req.user.id, req.body)));
  router.post('/workspace-join/requests/:id/withdraw', auth, route(req => join.withdraw(req.user.id, req.params.id)));
  router.post('/workspace-join/requests/:id/review', auth, route(req => join.review(req.user.id, req.params.id, req.body)));
  router.post('/workspace-join/read', auth, route(req => join.markRead(req.user.id, req.body?.notifications)));
}

module.exports = { createWorkspaceJoin, registerWorkspaceJoin };
