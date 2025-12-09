import React from 'react';
import { Card, Input, Button, Toast, Typography, Select, Divider } from '@douyinfe/semi-ui';
import * as authService from './services/authService';

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

  // admin invite management states
  const [invites, setInvites] = React.useState([]);
  const [invLoading, setInvLoading] = React.useState(false);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createRole, setCreateRole] = React.useState('photographer');
  const [expiresDays, setExpiresDays] = React.useState(30);
  const [lastCreated, setLastCreated] = React.useState(null);

  const fetchInvites = React.useCallback(async () => {
    setInvLoading(true);
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const res = await fetch('/api/users/invitations', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) {
        setInvites([]);
        return;
      }
      const data = await res.json().catch(() => ([]));
      setInvites(Array.isArray(data) ? data : (data.list || []));
    } catch (err) {
      console.error('fetchInvites failed', err);
      setInvites([]);
    } finally {
      setInvLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (currentUser?.role === 'admin') {
      fetchInvites();
    }
  }, [currentUser, fetchInvites]);

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
    if (newPassword.length < 6) {
      setPwdMessage('新密码长度不能少于 6 位');
      return;
    }
    setPwdLoading(true);
    setPwdMessage('');
    try {
      const token = localStorage.getItem('mamage_jwt_token');
      const body = currentPassword.trim()
        ? { currentPassword: currentPassword.trim(), newPassword: newPassword.trim() }
        : { newPassword: newPassword.trim() };
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
          const msg = data.error || data.message || '密码格式不符合要求';
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
      <Card title="账户信息" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><Text strong>姓名：</Text> {currentUser?.name}</div>
          <div><Text strong>邮箱：</Text> {currentUser?.email || '未填写'}</div>
          <div><Text strong>角色：</Text> {currentUser?.role || 'visitor'}</div>
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
              value={currentPassword}
              onChange={(v) => { setCurrentPassword(v); setPwdMessage(''); }}
              style={{ marginTop: 6 }}
            />
          </div>
          <div>
            <Text>新密码（至少 6 位）：</Text>
            <Input
              type="password"
              mode="password"
              placeholder="输入新密码"
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

      <Card title="使用邀请码升级为摄影师" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="在此输入邀请码" value={inviteCode} onChange={(v) => { setInviteCode(v); setMessage(''); }} />
          <Button theme="solid" type="primary" loading={loading} onClick={handleApplyInvite}>提交</Button>
        </div>
        {message && <div style={{ marginTop: 8, color: '#e53935' }}>{message}</div>}
      </Card>

      {currentUser?.role === 'admin' && (
        <Card title="管理员：管理邀请码" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div><Text>生成角色：</Text></div>
              <Select size="small" value={createRole} onChange={(v) => setCreateRole(v)} style={{ minWidth: 160 }}>
                <Select.Option value="photographer">photographer</Select.Option>
                <Select.Option value="admin">admin</Select.Option>
              </Select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            {invLoading ? (
              <div>加载中…</div>
            ) : invites.length === 0 ? (
              <div>暂无邀请码</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {invites.map((it) => (
                  <div key={it.id || it._id || it.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#fafafa', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace' }}>{it.code || it.invite_code}</div>
                      <div style={{ color: '#666' }}>{it.role}</div>
                      <div style={{ color: '#999' }}>{it.expiresAt ? new Date(it.expiresAt).toLocaleString() : (it.expires_in_days ? `有效期 ${it.expires_in_days} 天` : '')}</div>
                    </div>
                    <div>
                      <Button size="small" onClick={() => { navigator.clipboard?.writeText(it.code || it.invite_code || ''); Toast.success('已复制邀请码'); }}>复制</Button>
                      <Button size="small" theme="borderless" onClick={() => handleRevoke(it.id || it._id)} style={{ marginLeft: 8 }}>撤销</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
