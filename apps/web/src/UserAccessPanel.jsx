import React from 'react';
import { Button, GlassSelect, Input } from './ui';
import { IconChevronLeft, IconChevronRight, IconSearch, IconSliders } from './ui/icons';
import { request } from './services/request';
import './UserAccessPanel.css';

const roles = [{ value: 'viewer', label: '只读成员' }, { value: 'editor', label: '协作者' }, { value: 'manager', label: '小组管理员' }];
const roleLabel = role => roles.find(item => item.value === role)?.label || '协作者';

export default function UserAccessPanel({ currentUser }) {
  const [query, setQuery] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [organizationId, setOrganizationId] = React.useState(String(currentUser.organization_id || ''));
  const [status, setStatus] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [reload, setReload] = React.useState(0);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [editing, setEditing] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/api/users/access', { data: { organizationId, q: search, status, page }, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(e => { if (!controller.signal.aborted) { setData(null); setError(e.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, search, status, page, reload]);
  const change = next => { setDraft(next); setConfirming(false); setError(''); };
  const open = user => {
    setEditing(user.id); setError(''); setNotice(''); setConfirming(false);
    setDraft({ revision: user.revision, memberships: user.memberships.map(m => ({ ...m, role: m.role === 'member' ? 'editor' : m.role })),
      collegeAdmin: user.collegeAdmin, facePermissions: { ...user.facePermissions } });
  };
  const close = () => { setEditing(null); setDraft(null); setConfirming(false); setError(''); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      await request(`/api/users/${editing}/access`, { method: 'PUT', data: draft });
      close(); setNotice('权限已保存'); setReload(value => value + 1);
    } catch (e) { setError(e.message); setConfirming(false); }
    finally { setSaving(false); }
  };
  const busy = Boolean(editing) || loading;
  return <section className="user-access-panel" aria-label="用户与权限" id="user-access-panel">
    <header className="user-access-heading"><div><h2>用户与权限</h2><span>{data?.total ?? 0} 位用户</span></div>
      <Button size="small" disabled={Boolean(editing)} loading={loading} onClick={() => setReload(value => value + 1)}>刷新</Button></header>
    <div className="user-access-filters">
      <GlassSelect label="学院" value={organizationId} disabled={busy}
        options={(data?.organizations || []).map(o => ({ value: String(o.id), label: o.name }))}
        onChange={value => { setOrganizationId(value); setPage(1); }} />
      <Input aria-label="搜索用户" placeholder="姓名、邮箱或学工号" prefix={<IconSearch />} value={query} disabled={Boolean(editing)} onChange={setQuery} />
      <GlassSelect label="分配状态" value={status} disabled={busy}
        options={[{ value: 'all', label: '全部用户' }, { value: 'pending', label: '待分配组织' }]}
        onChange={value => { setStatus(value); setPage(1); }} />
    </div>
    {notice ? <p role="status" className="user-access-notice">{notice}</p> : null}
    {error ? <div role="alert" className="user-access-error">{error} <Button size="small" disabled={saving} onClick={() => { close(); setReload(n => n + 1); }}>重新加载</Button></div> : null}
    <div className="user-access-users" aria-busy={loading}>
      {data?.users.map(user => <article className="user-access-row" key={user.id}>
        <div className="user-access-summary">
          <div className="user-access-identity"><strong>{user.name}</strong><span>{user.iamLinked ? '校园 IAM' : '本地账号'}</span>
            <small>{user.email || '邮箱未提供'}{user.student_no ? ` · ${user.student_no}` : ''}</small></div>
          <div className="user-access-memberships">
            {user.collegeAdmin ? <span>学院管理员</span> : null}
            {user.memberships.map(m => <span key={m.unitId}>{data.units.find(u => Number(u.id) === Number(m.unitId))?.name || '已归档小组'} · {roleLabel(m.role)}</span>)}
            {!user.memberships.length && !user.collegeAdmin ? <span className="is-pending">待分配组织</span> : null}
            {user.facePermissions.search ? <small>人物检索{user.facePermissions.manage ? ' · 档案维护' : ''}</small> : null}
          </div>
          <Button size="small" icon={<IconSliders />} disabled={loading || Boolean(editing) || Number(user.id) === Number(currentUser.id) || user.role === 'superadmin'} onClick={() => open(user)}>
            {Number(user.id) === Number(currentUser.id) ? '当前账号' : user.role === 'superadmin' ? '超级管理员' : '配置'}</Button>
        </div>
        {editing === user.id && draft ? <div className="user-access-editor" aria-label={`${user.name}的权限`}>
          <fieldset disabled={saving}><legend>组织与小组</legend>
            {data.units.length ? data.units.map(unit => {
              const member = draft.memberships.find(m => Number(m.unitId) === Number(unit.id));
              return <div className="user-access-unit" key={unit.id}>
                <label><input type="checkbox" checked={Boolean(member)} onChange={e => change({ ...draft, memberships: e.target.checked
                  ? [...draft.memberships, { unitId: Number(unit.id), role: 'editor' }]
                  : draft.memberships.filter(m => Number(m.unitId) !== Number(unit.id)) })} />{unit.name}</label>
                {member ? <GlassSelect label={`${unit.name}的角色`} value={member.role} options={roles} disabled={saving}
                  onChange={role => change({ ...draft, memberships: draft.memberships.map(m => m.unitId === member.unitId ? { ...m, role } : m) })} /> : null}
              </div>;
            }) : <p>该学院暂无小组</p>}
          </fieldset>
          <fieldset disabled={saving}><legend>学院权限</legend>
            <label><input type="checkbox" checked={draft.collegeAdmin} onChange={e => change({ ...draft, collegeAdmin: e.target.checked })} />学院管理员</label>
            <label><input type="checkbox" checked={draft.facePermissions.search} onChange={e => change({ ...draft, facePermissions: {
              search: e.target.checked, manage: e.target.checked && draft.facePermissions.manage } })} />人物检索</label>
            <label><input type="checkbox" disabled={!draft.facePermissions.search || saving} checked={draft.facePermissions.manage}
              onChange={e => change({ ...draft, facePermissions: { ...draft.facePermissions, manage: e.target.checked } })} />人物档案维护</label>
          </fieldset>
          {confirming ? <div className="user-access-confirm" role="status">
            <strong>确认更新 {user.name} 的权限？</strong>
            <p>{draft.memberships.map(m => `${data.units.find(u => Number(u.id) === m.unitId)?.name}：${roleLabel(m.role)}`).join('；') || '不加入任何小组'}</p>
            <p>{draft.collegeAdmin ? '学院管理员；' : ''}人物检索：{draft.facePermissions.search ? '开启' : '关闭'}；人物维护：{draft.facePermissions.manage ? '开启' : '关闭'}</p>
          </div> : null}
          <footer><Button disabled={saving} onClick={close}>放弃修改</Button>
            <Button type="primary" theme="solid" loading={saving} onClick={confirming ? save : () => setConfirming(true)}>{confirming ? '确认保存' : '保存配置'}</Button></footer>
        </div> : null}
      </article>)}
      {!loading && !error && !data?.users.length ? <p className="user-access-empty">{status === 'pending' ? '没有待分配的用户' : '没有符合条件的用户'}</p> : null}
      {loading && !data ? <p className="user-access-empty">加载中…</p> : null}
    </div>
    {data && data.total > data.pageSize ? <nav className="user-access-pagination" aria-label="用户分页">
      <Button icon={<IconChevronLeft />} title="上一页" aria-label="上一页" disabled={busy || page <= 1} onClick={() => setPage(n => n - 1)} />
      <span>{page} / {Math.ceil(data.total / data.pageSize)}</span>
      <Button icon={<IconChevronRight />} title="下一页" aria-label="下一页" disabled={busy || page * data.pageSize >= data.total} onClick={() => setPage(n => n + 1)} />
    </nav> : null}
  </section>;
}
