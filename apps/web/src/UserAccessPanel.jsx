import React from 'react';
import { Button, GlassSelect, Input } from './ui';
import { IconChevronLeft, IconChevronRight, IconSearch, IconSliders } from './ui/icons';
import { request } from './services/request';
import './UserAccessPanel.css';
import MembershipRequestsPanel from './MembershipRequestsPanel';
import UserAccessEditor, { membershipRoleLabel } from './UserAccessEditor';

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
  const [mergeSource, setMergeSource] = React.useState(null);
  const [mergeUsers, setMergeUsers] = React.useState([]);
  const [mergeTargetId, setMergeTargetId] = React.useState('');
  const [mergePreview, setMergePreview] = React.useState(null);
  const [mergeConfirm, setMergeConfirm] = React.useState('');
  const [mergeBusy, setMergeBusy] = React.useState(false);
  const [mergeError, setMergeError] = React.useState('');
  React.useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/api/users/access', { data: { organizationId, q: search, status, page }, signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
        if (page > lastPage) setPage(lastPage);
        else setData(value);
      })
      .catch(e => { if (!controller.signal.aborted) { setData(null); setError(e.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, search, status, page, reload]);
  const open = user => {
    setEditing({ user, units: data.units }); setNotice('');
  };
  const refresh = () => { setLoading(true); setReload(value => value + 1); };
  const openMerge = async user => {
    setMergeSource(user); setMergeTargetId(''); setMergePreview(null); setMergeConfirm(''); setMergeError(''); setNotice('');
    try {
      const list = await request('/api/users/all');
      setMergeUsers((list.users || []).filter(item => Number(item.id) !== Number(user.id) && item.role !== 'superadmin'));
    } catch (e) { setMergeError(e.message); }
  };
  const closeMerge = () => { setMergeSource(null); setMergePreview(null); setMergeConfirm(''); setMergeError(''); };
  const chooseTarget = async value => {
    setMergeTargetId(value); setMergePreview(null); setMergeConfirm(''); setMergeError('');
    if (!value) return;
    try {
      setMergePreview(await request(`/api/users/merge/preview?sourceId=${mergeSource.id}&targetId=${value}`));
    } catch (e) { setMergeError(e.message); }
  };
  const runMerge = async () => {
    setMergeBusy(true); setMergeError('');
    try {
      const result = await request('/api/users/merge', { method: 'POST', data: {
        sourceId: mergeSource.id, targetId: Number(mergeTargetId), confirmName: mergeConfirm } });
      closeMerge(); setNotice(`已把「${result.source.name}」合并到「${result.target.name}」`); setReload(value => value + 1);
    } catch (e) { setMergeError(e.message); }
    finally { setMergeBusy(false); }
  };
  const saved = (user, access) => {
    const leavesPending = status === 'pending' && (access.collegeAdmin || access.memberships.length > 0);
    setData(value => value && ({
      ...value,
      total: leavesPending ? Math.max(0, value.total - 1) : value.total,
      users: leavesPending ? value.users.filter(item => item.id !== user.id)
        : value.users.map(item => item.id === user.id ? { ...item, ...access } : item),
    }));
    setEditing(null);
    setNotice(`${user.name}的权限已保存`);
    if (leavesPending || loading) refresh();
  };
  const iamPending = !loading && status === 'all' && Number(organizationId) === data?.organizationId
    && search === query.trim() ? data.iamPending || [] : [];
  return <section className="user-access-panel" aria-label="用户与权限" id="user-access-panel">
    <MembershipRequestsPanel onUpdated={refresh} />
    <header className="user-access-heading"><div><h2>用户与权限</h2><span>{data?.total ?? 0} 位用户</span></div>
      <Button size="small" loading={loading} onClick={refresh}>刷新</Button></header>
    <div className="user-access-filters">
      <GlassSelect label="学院" value={organizationId} disabled={loading}
        options={(data?.organizations || []).map(o => ({ value: String(o.id), label: o.name }))}
        onChange={value => { setOrganizationId(value); setPage(1); }} />
      <Input aria-label="搜索用户" placeholder="姓名、邮箱或学工号" prefix={<IconSearch />} value={query} onChange={setQuery} />
      <GlassSelect label="分配状态" value={status} disabled={loading}
        options={[{ value: 'all', label: '全部用户' }, { value: 'pending', label: '待分配组织' }]}
        onChange={value => { setStatus(value); setPage(1); }} />
    </div>
    {notice ? <p role="status" className="user-access-notice">{notice}</p> : null}
    {error ? <div role="alert" className="user-access-error">{error} <Button size="small" loading={loading} onClick={refresh}>重新加载</Button></div> : null}
    <div className="user-access-users" aria-busy={loading}>
      {iamPending.length ? <section className="user-access-iam-review" aria-labelledby="user-access-iam-review-title">
        <h3 id="user-access-iam-review-title">校园 IAM 待关联</h3>
        {iamPending.map(({ name, email, studentNo, createdAt }, index) => <article className="user-access-row" key={`${createdAt}:${index}`}>
          <div className="user-access-summary">
            <div className="user-access-identity"><strong>{name || '姓名未提供'}</strong>
              {(email || studentNo) ? <small>{[email, studentNo].filter(Boolean).join(' · ')}</small> : null}</div>
            <div className="user-access-memberships"><span className="is-pending">待核对</span></div>
            {(email || studentNo) ? <div className="user-access-row-actions"><Button size="small" type="tertiary" icon={<IconSearch />}
              aria-label={`查找 ${name || email || studentNo} 的旧账号`} onClick={() => setQuery(email || studentNo)}>查旧账号</Button></div> : null}
          </div>
        </article>)}
      </section> : null}
      {data?.users.map(user => <article className="user-access-row" key={user.id}>
        <div className="user-access-summary">
          <div className="user-access-identity"><strong>{user.name}</strong><span>{user.iamMergeReview ? '校园 IAM · 待合并' : user.iamLinked ? '校园 IAM' : '本地账号'}</span>
            <small>{user.email || '邮箱未提供'}{user.student_no ? ` · ${user.student_no}` : ''}</small></div>
          <div className="user-access-memberships">
            {user.collegeAdmin ? <span>学院管理员</span> : null}
            {user.memberships.map(m => <span key={m.unitId}>{data.units.find(u => Number(u.id) === Number(m.unitId))?.name || '已归档小组'} · {membershipRoleLabel(m.role)}</span>)}
            {!user.memberships.length && !user.collegeAdmin ? <span className="is-pending">待分配组织</span> : null}
            {user.viewOrganizationPhotos === false ? <small>仅看本人上传</small> : null}
            {user.facePermissions.search && user.viewOrganizationPhotos !== false ? <small>人物检索{user.facePermissions.manage ? ' · 档案维护' : ''}</small> : null}
          </div>
          <div className="user-access-row-actions">
            {Number(user.id) === Number(currentUser.id) || user.role === 'superadmin'
              ? <small>{Number(user.id) === Number(currentUser.id) ? '当前账号' : '超级管理员'}</small>
              : <>
                <Button size="small" type="secondary" icon={<IconSliders />} disabled={loading}
                  aria-label={`编辑${user.name}的权限`} onClick={() => open(user)}>权限</Button>
                <Button size="small" type="tertiary" disabled={loading} onClick={() => openMerge(user)}>合并</Button>
              </>}
          </div>
        </div>
      </article>)}
      {!loading && !error && !data?.users.length && !iamPending.length ? <p className="user-access-empty">{status === 'pending' ? '没有待分配的用户' : '没有符合条件的用户'}</p> : null}
      {loading && !data ? <p className="user-access-empty">加载中…</p> : null}
    </div>
    {editing ? <UserAccessEditor key={editing.user.id} {...editing}
      onClose={() => setEditing(null)} onSaved={saved}
      onReload={() => { setEditing(null); refresh(); }} /> : null}
    {mergeSource ? <div className="user-merge-backdrop" role="dialog" aria-modal="true" aria-label="合并账号">
      <div className="user-merge-dialog">
        <header><h3>合并账号</h3><Button size="small" disabled={mergeBusy} onClick={closeMerge}>关闭</Button></header>
        <p className="user-merge-hint">把「被合并账号」上的相册、照片、分享、成员关系与 IAM 身份，全部转到「保留账号」，然后停用被合并账号。</p>
        <div className="user-merge-pick">
          <div className="user-merge-side">
            <span>被合并（会停用）</span>
            <strong>{mergeSource.name}</strong>
            <small>{mergeSource.email || '邮箱未提供'}{mergeSource.student_no ? ` · ${mergeSource.student_no}` : ''}</small>
          </div>
          <div className="user-merge-arrow" aria-hidden="true">→</div>
          <div className="user-merge-side">
            <span>保留账号</span>
            <GlassSelect label="选择保留账号" value={mergeTargetId} disabled={mergeBusy}
              options={[{ value: '', label: '未选择' }, ...mergeUsers.map(item => ({ value: String(item.id),
                label: `${item.name}${item.email ? ' · ' + item.email : ''}${item.student_no ? ' · ' + item.student_no : ''}` }))]}
              onChange={chooseTarget} />
          </div>
        </div>
        {mergePreview ? <div className="user-merge-preview">
          <strong>将转移 {Object.values(mergePreview.moving).reduce((a, b) => a + b, 0)} 条记录</strong>
          <ul>{Object.entries(mergePreview.moving).map(([key, count]) => <li key={key}>{key}：{count}</li>)}</ul>
        </div> : null}
        {mergeError ? <p className="user-access-error" role="alert">{mergeError}</p> : null}
        {mergePreview?.blocked ? <p className="user-access-error" role="alert">{mergePreview.blocked}</p> : null}
        {mergePreview && !mergePreview.blocked ? <label className="user-merge-confirm">输入保留账号姓名「{mergePreview.target.name}」确认
          <Input value={mergeConfirm} disabled={mergeBusy} onChange={setMergeConfirm} placeholder={mergePreview.target.name} /></label> : null}
        <footer>
          <Button disabled={mergeBusy} onClick={closeMerge}>取消</Button>
          <Button type="primary" theme="solid" loading={mergeBusy} disabled={!mergePreview || Boolean(mergePreview.blocked) || mergeConfirm.trim() !== mergePreview.target.name}
            onClick={runMerge}>执行合并</Button>
        </footer>
      </div>
    </div> : null}
    {data && data.total > data.pageSize ? <nav className="user-access-pagination" aria-label="用户分页">
      <Button icon={<IconChevronLeft />} title="上一页" aria-label="上一页" disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)} />
      <span>{page} / {Math.ceil(data.total / data.pageSize)}</span>
      <Button icon={<IconChevronRight />} title="下一页" aria-label="下一页" disabled={loading || page * data.pageSize >= data.total} onClick={() => setPage(n => n + 1)} />
    </nav> : null}
  </section>;
}
