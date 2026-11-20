import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button } from './ui';
import { request } from './services/request';

export const membershipRoles = [
  { value: 'viewer', label: '只读成员' },
  { value: 'editor', label: '协作者' },
  { value: 'manager', label: '小组管理员' },
];
export const membershipRoleLabel = role => membershipRoles.find(item => item.value === role)?.label || '协作者';

const initialAccess = user => ({
  revision: user.revision,
  memberships: user.memberships.map(m => ({ unitId: Number(m.unitId), role: m.role === 'member' ? 'editor' : m.role })),
  collegeAdmin: user.collegeAdmin,
  viewOrganizationPhotos: user.viewOrganizationPhotos === true,
  facePermissions: { ...user.facePermissions },
});

export default function UserAccessEditor({ user, units, onClose, onSaved, onReload }) {
  const dialog = React.useRef(null);
  const headingId = React.useId();
  const [original] = React.useState(() => initialAccess(user));
  const [draft, setDraft] = React.useState(original);
  const [decision, setDecision] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const stale = error?.status === 409;
  const originalRoles = new Map(original.memberships.map(member => [member.unitId, member.role]));
  const selectedRoles = new Map(draft.memberships.map(member => [member.unitId, member.role]));
  const changes = [...new Set([...originalRoles.keys(), ...selectedRoles.keys()])]
    .filter(id => originalRoles.get(id) !== selectedRoles.get(id)).length
    + Number(draft.viewOrganizationPhotos !== original.viewOrganizationPhotos)
    + Number(draft.collegeAdmin !== original.collegeAdmin)
    + Number(draft.facePermissions.search !== original.facePermissions.search)
    + Number(draft.facePermissions.manage !== original.facePermissions.manage);
  const inactiveUnits = original.memberships.filter(member => !units.some(unit => Number(unit.id) === member.unitId));
  const disabled = saving || stale || decision === 'discard';

  React.useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);

  const update = next => {
    setDraft(next);
    setDecision('');
    setError(null);
  };
  const selectRole = (unitId, role) => {
    const memberships = role
      ? selectedRoles.has(unitId)
        ? draft.memberships.map(member => member.unitId === unitId ? { unitId, role } : member)
        : [...draft.memberships, { unitId, role }]
      : draft.memberships.filter(member => member.unitId !== unitId);
    update({ ...draft, memberships });
  };
  const close = () => {
    if (saving) return;
    if (changes) setDecision('discard');
    else onClose();
  };
  const save = async () => {
    if (disabled || !changes) return;
    if (draft.collegeAdmin && !original.collegeAdmin && decision !== 'grant') {
      setDecision('grant'); return;
    }
    setSaving(true); setError(null);
    try {
      const { revision } = await request(`/api/users/${user.id}/access`, { method: 'PUT', data: draft });
      onSaved(user, { ...draft, revision });
    } catch (e) {
      setError(e);
      setDecision('');
    } finally { setSaving(false); }
  };

  return createPortal(<dialog className="user-access-dialog" ref={dialog} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <form className="user-access-editor" onSubmit={event => { event.preventDefault(); save(); }} aria-busy={saving}>
      <header className="user-access-editor-head">
        <div>
          <h3 id={headingId}>{user.name}的权限</h3>
          <small>{[user.email, user.student_no].filter(Boolean).join(' · ') || (user.iamLinked ? '校园 IAM' : '本地账号')}</small>
        </div>
        <Button icon={<X />} size="small" disabled={saving} aria-label="关闭权限编辑" title="关闭" onClick={close} />
      </header>
      <div className="user-access-editor-body">
        <fieldset disabled={disabled} className="user-access-photo-scope">
          <legend>照片可见范围</legend>
          <div className="user-access-scope-options">
            <label><input type="radio" name="photo-scope" checked={!draft.viewOrganizationPhotos}
              onChange={() => update({ ...draft, viewOrganizationPhotos: false })} />仅本人上传</label>
            <label><input type="radio" name="photo-scope" checked={draft.viewOrganizationPhotos}
              onChange={() => update({ ...draft, viewOrganizationPhotos: true })} />组织内所有照片</label>
          </div>
        </fieldset>
        <div className="user-access-editor-columns">
          <fieldset disabled={disabled} className="user-access-editor-groups">
            <legend>小组角色 <span>{draft.memberships.length} 个</span></legend>
            {units.map(unit => <label className="user-access-unit" key={unit.id}>
              <span>{unit.name}</span>
              <span className="user-access-role-control">
                <select aria-label={`${unit.name}的角色`} value={selectedRoles.get(Number(unit.id)) || ''}
                  onChange={event => selectRole(Number(unit.id), event.target.value)}>
                  <option value="">未加入</option>
                  {membershipRoles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </span>
            </label>)}
            {inactiveUnits.filter(member => selectedRoles.has(member.unitId)).map(member =>
              <div className="user-access-unit" key={member.unitId}>
                <span>已归档小组</span>
                <Button size="small" disabled={disabled} onClick={() => selectRole(member.unitId, '')}>移除</Button>
              </div>)}
            {!units.length && !draft.memberships.length ? <p className="user-access-editor-muted">该学院暂无小组</p> : null}
          </fieldset>
          <fieldset disabled={disabled} className="user-access-editor-grants">
            <legend>学院权限</legend>
            <label><input type="checkbox" checked={draft.collegeAdmin}
              onChange={event => update({ ...draft, collegeAdmin: event.target.checked })} />学院管理员</label>
            <label><input type="checkbox" disabled={!draft.viewOrganizationPhotos}
              checked={draft.viewOrganizationPhotos && draft.facePermissions.search}
              onChange={event => update({ ...draft, facePermissions: {
                search: event.target.checked, manage: event.target.checked && draft.facePermissions.manage,
              } })} />人物检索</label>
            <label><input type="checkbox" disabled={!draft.viewOrganizationPhotos || !draft.facePermissions.search}
              checked={draft.viewOrganizationPhotos && draft.facePermissions.manage}
              onChange={event => update({ ...draft, facePermissions: { ...draft.facePermissions, manage: event.target.checked } })} />人物档案维护</label>
            {!draft.viewOrganizationPhotos ? <small className="user-access-editor-muted">仅本人上传时，人物权限不生效</small> : null}
          </fieldset>
        </div>
      </div>
      <footer className="user-access-editor-footer">
        {error ? <p className="user-access-error" role="alert">{error.message}</p> : null}
        {decision === 'grant' ? <p className="user-access-editor-warning" role="status">确认授予「{user.name}」学院管理员权限？</p> : null}
        <div className="user-access-editor-actions">
          <span className="user-access-editor-muted" aria-live="polite">
            {decision === 'discard' ? '放弃未保存的修改？' : changes ? `${changes} 项未保存` : '没有修改'}
          </span>
          {decision === 'discard' ? <>
            <Button size="small" onClick={() => setDecision('')}>继续编辑</Button>
            <Button size="small" type="danger" onClick={onClose}>放弃修改</Button>
          </> : <>
            <Button size="small" disabled={saving} onClick={decision === 'grant' ? () => setDecision('') : close}>
              {decision === 'grant' ? '返回编辑' : '取消'}</Button>
            {stale ? <Button size="small" type="primary" theme="solid" onClick={onReload}>关闭并刷新列表</Button>
              : <button type="submit" className="mamage-button mamage-button-primary mamage-button-solid mamage-button-small"
                data-glass-button="" disabled={disabled || !changes}>
                <span className="mamage-button-icon" aria-hidden="true"><Check size={16} /></span>
                <span className="mamage-button-content">{saving ? '保存中…' : decision === 'grant' ? '确认授予并保存' : '保存权限'}</span>
              </button>}
          </>}
        </div>
      </footer>
    </form>
  </dialog>, document.body);
}
