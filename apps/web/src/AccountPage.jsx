import React from 'react';
import { Card, Input, Button, Toast, Typography, Select, Divider } from './ui';
import * as authService from './services/authService';
import { accessRoleLabel } from './utils/accessRoles';
const OperationsPanel = React.lazy(() => import('./OperationsPanel'));

const { Text } = Typography;

export default function AccountPage({ currentUser, onUpdated }) {
  const [inviteCode, setInviteCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');

  // password change states
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [pwdLoading, setPwdLoading] = React.useState(false);
  const [pwdMessage, setPwdMessage] = React.useState('');

  // superadmin user management states
  const isSuperAdmin = Boolean(currentUser?.permissions?.includes('users.manage_roles'));
  const canManageInvites = Boolean(currentUser?.permissions?.includes('users.invitations.create'));
  const [allUsers, setAllUsers] = React.useState([]);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [roleDraft, setRoleDraft] = React.useState({});
  const [roleSaving, setRoleSaving] = React.useState({});
  const ROLE_OPTIONS = ['visitor', 'photographer', 'admin', 'superadmin'];

  const fetchAllUsers = React.useCallback(async () => {
    setUsersLoading(true);
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch('/api/users/all', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) { setAllUsers([]); return; }
      const data = await res.json().catch(() => ({}));
      setAllUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      console.error('fetchAllUsers failed', err);
      setAllUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isSuperAdmin) fetchAllUsers();
  }, [isSuperAdmin, fetchAllUsers]);

  const saveUserRole = React.useCallback(async (userId) => {
    const role = roleDraft[userId];
    if (!role) return;
    setRoleSaving((prev) => ({ ...prev, [userId]: true }));
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Toast.error(data.message || (data.error === 'LAST_SUPERADMIN' ? '至少保留一名超级管理员' : '修改失败'));
        return;
      }
      Toast.success('角色已更新');
      setAllUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      setRoleDraft((prev) => { const next = { ...prev }; delete next[userId]; return next; });
    } catch (err) {
      console.error('saveUserRole failed', err);
      Toast.error('修改失败，请稍后重试');
    } finally {
      setRoleSaving((prev) => ({ ...prev, [userId]: false }));
    }
  }, [roleDraft]);

  // admin invite management states
  const [invites, setInvites] = React.useState([]);
  const [invLoading, setInvLoading] = React.useState(false);
  const [invError, setInvError] = React.useState('');
  const [invCursor, setInvCursor] = React.useState(null);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createRole, setCreateRole] = React.useState('photographer');
  const [expiresDays, setExpiresDays] = React.useState(30);
  const [lastCreated, setLastCreated] = React.useState(null);

  const fetchInvites = React.useCallback(async (before = null) => {
    setInvLoading(true);
    setInvError('');
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch('/api/users/invitations' + (before ? `?before=${before}` : ''), { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) {
        setInvError('邀请码列表暂时不可用，请重试');
        return;
      }
      const data = await res.json().catch(() => ([]));
      const list = Array.isArray(data) ? data : (data.list || []);
      setInvites(previous => before ? [...previous, ...list] : list);
      setInvCursor(data.nextCursor || null);
    } catch (err) {
      console.error('fetchInvites failed', err);
      setInvError('邀请码列表暂时不可用，请重试');
    } finally {
      setInvLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (canManageInvites) {
      fetchInvites();
    }
  }, [canManageInvites, fetchInvites]);

  const handleApplyInvite = async () => {
    if (!inviteCode || inviteCode.trim().length === 0) {
      setMessage('请输入邀请码');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch('/api/users/me/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.message || '兑换失败');
        return;
      }
      Toast.success('邀请码应用成功，权限已更新');
      const updated = await authService.me();
      if (typeof onUpdated === 'function') onUpdated(updated);
      setMessage('已升级，请刷新查看权限');
    } catch (err) {
      console.error('apply invite failed', err);
      setMessage('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    setCreateLoading(true);
    setLastCreated(null);
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch('/api/users/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ role: createRole, expiresInDays: Number(expiresDays || 0) || 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Toast.error(data.message || '创建邀请码失败');
        return;
      }
      setLastCreated(data);
      Toast.success('邀请码已创建');
      fetchInvites();
    } catch (err) {
      console.error('create invite failed', err);
      Toast.error('网络错误，请重试');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRevoke = async (id) => {
    if (!id) return;
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch(`/api/users/invitations/${id}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) {
        Toast.error('撤销失败');
        return;
      }
      Toast.success('已撤销');
      fetchInvites();
    } catch (err) {
      console.error('revoke invite failed', err);
      Toast.error('网络错误');
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.trim().length === 0) {
      setPwdMessage('请输入新密码');
      return;
    }
    if (!/^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,16}$/.test(newPassword)) {
      setPwdMessage('新密码须为 8–16 位，需同时包含字母和数字，不含空格或特殊符号');
      return;
    }
    setPwdLoading(true);
    setPwdMessage('');
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const body = currentPassword
        ? { currentPassword, newPassword }
        : { newPassword };
      const res = await fetch('/api/users/me/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && (data.error === 'INVALID_CURRENT_PASSWORD' || data.message?.includes('INVALID_CURRENT_PASSWORD'))) {
          setPwdMessage('当前密码错误，请重新输入');
        } else if (res.status === 400) {
          const msg = data.error === 'MISSING_CURRENT_PASSWORD'
            ? '请输入当前密码'
            : data.message || '密码格式不符合要求，请使用 8–16 位字母和数字组合';
          setPwdMessage(msg);
        } else {
          setPwdMessage(data.message || '修改失败，请稍后重试');
        }
        return;
      }
      Toast.success('密码修改成功');
      setCurrentPassword('');
      setNewPassword('');
      setPwdMessage('密码已更新，下次登录请使用新密码');
    } catch (err) {
      console.error('change password failed', err);
      setPwdMessage('网络错误，请重试');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      {currentUser?.permissions?.includes('users.view_all') ? <React.Suspense fallback={null}><OperationsPanel /></React.Suspense> : null}
      <Card title="账户信息" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><Text strong>姓名：</Text> {currentUser?.name}</div>
          <div><Text strong>邮箱：</Text> {currentUser?.email || '未填写'}</div>
          <div><Text strong>身份：</Text> {accessRoleLabel(currentUser)}</div>
          <div><Text strong>人物检索：</Text> {currentUser?.facePermissions?.search ? '已授权' : '未授权'}</div>
          <div><Text strong>人物档案维护：</Text> {currentUser?.facePermissions?.manage ? '已授权' : '未授权'}</div>
        </div>
      </Card>

      <Card title="修改密码" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text>当前密码（如首次设置密码可留空）：</Text>
            <Input
              type="password"
              mode="password"
              placeholder="输入当前密码"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(v) => { setCurrentPassword(v); setPwdMessage(''); }}
              style={{ marginTop: 6 }}
            />
          </div>
          <div>
            <Text>新密码（8–16 位，需同时包含字母和数字）：</Text>
            <Input
              type="password"
              mode="password"
              placeholder="输入 8–16 位字母和数字组合"
              autoComplete="new-password"
              value={newPassword}
              onChange={(v) => { setNewPassword(v); setPwdMessage(''); }}
              style={{ marginTop: 6 }}
            />
          </div>
          <div>
            <Button theme="solid" type="primary" loading={pwdLoading} onClick={handleChangePassword}>确认修改</Button>
          </div>
          {pwdMessage && <div style={{ color: pwdMessage.includes('成功') || pwdMessage.includes('已更新') ? '#4caf50' : '#e53935' }}>{pwdMessage}</div>}
        </div>
      </Card>

      {!currentUser?.workspaceEnabled && <Card title="兑换访问授权" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="在此输入邀请码" value={inviteCode} onChange={(v) => { setInviteCode(v); setMessage(''); }} />
          <Button theme="solid" type="primary" loading={loading} onClick={handleApplyInvite}>提交</Button>
        </div>
        {message && <div style={{ marginTop: 8, color: '#e53935' }}>{message}</div>}
      </Card>}

      {canManageInvites && (
        <Card title="管理员：管理邀请码" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <div><Text>生成角色：</Text></div>
              <Select size="small" value={createRole} onChange={(v) => setCreateRole(v)} style={{ minWidth: 160 }}>
                <Select.Option value="photographer">协作者</Select.Option>
                <Select.Option value="admin">学院管理员</Select.Option>
              </Select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <div><Text>有效期（天）：</Text></div>
              <Input size="small" value={String(expiresDays)} onChange={(v) => setExpiresDays(v)} style={{ width: 100 }} />
            </div>
            <Button theme="solid" type="primary" loading={createLoading} onClick={handleCreateInvite}>生成邀请码</Button>
          </div>

          {lastCreated && (
            <div style={{ marginBottom: 12 }}>
              <div><Text strong>最新邀请码：</Text></div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ padding: '6px 10px', background: '#f6f6f6', borderRadius: 4, fontFamily: 'monospace' }}>{lastCreated.code || lastCreated.invite_code || lastCreated.token || JSON.stringify(lastCreated)}</div>
                <Button onClick={() => { navigator.clipboard?.writeText(lastCreated.code || lastCreated.invite_code || ''); Toast.success('已复制邀请码'); }}>复制</Button>
              </div>
            </div>
          )}

          <Divider style={{ margin: '12px 0' }} />

          <div>
            <div style={{ marginBottom: 8 }}><Text strong>历史邀请码</Text></div>
            {invError ? <div role="alert" style={{ color: '#b42318', marginBottom: 8 }}>{invError} <Button size="small" onClick={() => fetchInvites()}>重试</Button></div> : null}
            {invLoading && !invites.length ? (
              <div>加载中…</div>
            ) : invites.length === 0 ? (
              <div>暂无邀请码</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {invites.map((it) => (
                  <div key={it.id || it._id || it.code} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#fafafa', borderRadius: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', minWidth: 0 }}>
                      <div style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{it.code || it.invite_code}</div>
                      <div style={{ color: '#666' }}>{accessRoleLabel({ role: it.role })}</div>
                      <div style={{ color: '#999' }}>{it.expiresAt ? new Date(it.expiresAt).toLocaleString() : (it.expires_in_days ? `有效期 ${it.expires_in_days} 天` : '')}</div>
                    </div>
                    <div>
                      <Button size="small" onClick={() => { navigator.clipboard?.writeText(it.code || it.invite_code || ''); Toast.success('已复制邀请码'); }}>复制</Button>
                      <Button size="small" theme="borderless" disabled={Boolean(it.revoked)} onClick={() => handleRevoke(it.id || it._id)} style={{ marginLeft: 8 }}>{it.revoked ? '已撤销' : '撤销'}</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {invCursor ? <Button size="small" loading={invLoading} onClick={() => fetchInvites(invCursor)}>加载更多</Button> : null}
          </div>
        </Card>
      )}

      {isSuperAdmin && (
        <Card title="系统管理：兼容角色（高级）" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text type="tertiary" size="small">共 {allUsers.length} 名用户 · 可查看信息与调整角色（不含密码）</Text>
            <Button size="small" loading={usersLoading} onClick={fetchAllUsers}>刷新</Button>
          </div>
          {usersLoading && !allUsers.length ? (
            <div style={{ padding: 12 }}><Text type="tertiary">加载中…</Text></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allUsers.map((u) => {
                const draft = roleDraft[u.id] ?? u.role;
                const dirty = draft !== u.role;
                const isSelf = Number(u.id) === Number(currentUser?.id);
                return (
                  <div key={u.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: 12 }}>
                    <div style={{ minWidth: 130 }}>
                      <div style={{ fontWeight: 700 }}>{u.name || '（未命名）'}{isSelf ? '（我）' : ''}</div>
                      <Text type="tertiary" size="small">{u.email || u.student_no || `#${u.id}`}</Text>
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <Text type="tertiary" size="small">{u.organizationName || '无组织'}</Text>
                    </div>
                    <div style={{ minWidth: 150 }}>
                      <Text type="tertiary" size="small">注册 {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</Text>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                      <Select
                        size="small"
                        value={draft}
                        disabled={isSelf}
                        onChange={(v) => setRoleDraft((prev) => ({ ...prev, [u.id]: v }))}
                        style={{ minWidth: 140 }}
                      >
                        {ROLE_OPTIONS.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
                      </Select>
                      <Button
                        size="small"
                        type="primary"
                        disabled={!dirty || isSelf || roleSaving[u.id]}
                        loading={!!roleSaving[u.id]}
                        onClick={() => saveUserRole(u.id)}
                      >保存</Button>
                    </div>
                  </div>
                );
              })}
              {!allUsers.length ? <Text type="tertiary">暂无用户数据</Text> : null}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
