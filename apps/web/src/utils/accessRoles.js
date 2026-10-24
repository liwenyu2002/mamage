export const ACCESS_ROLE_LABELS = {
  organization_admin: '学院管理员', manager: '小组管理员', contributor: '协作者', viewer: '访客',
};

export function accessRoleLabel(user) {
  if (user?.accessRole && ACCESS_ROLE_LABELS[user.accessRole]) return ACCESS_ROLE_LABELS[user.accessRole];
  if (user?.collegeAdmin) return ACCESS_ROLE_LABELS.organization_admin;
  if (user?.unitRole === 'manager') return ACCESS_ROLE_LABELS.manager;
  if (['member', 'editor', 'contributor'].includes(user?.unitRole)) return ACCESS_ROLE_LABELS.contributor;
  if (user?.unitRole === 'viewer' || user?.workspaceEnabled) return ACCESS_ROLE_LABELS.viewer;
  return ['admin', 'superadmin'].includes(user?.role) ? ACCESS_ROLE_LABELS.organization_admin
    : ['photographer', 'editor'].includes(user?.role) ? ACCESS_ROLE_LABELS.contributor : ACCESS_ROLE_LABELS.viewer;
}

export function memberRoleLabel(role) {
  return role === 'manager' ? ACCESS_ROLE_LABELS.manager : role === 'viewer' ? ACCESS_ROLE_LABELS.viewer : ACCESS_ROLE_LABELS.contributor;
}
