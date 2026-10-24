const ROLE_LABELS = Object.freeze({
  organization_admin: '学院管理员', manager: '小组管理员', contributor: '协作者', viewer: '访客',
});
const SCOPED_PERMISSIONS = ['projects.create', 'projects.update', 'projects.delete', 'upload.photo',
  'photos.edit', 'photos.delete', 'ai.generate', 'faces.view', 'faces.detect', 'faces.label', 'faces.merge', 'faces.config'];

function unitRoleAllows(role, action) {
  const contributor = ['editor', 'member', 'contributor'].includes(role);
  if (action === 'read') return role === 'viewer' || role === 'manager' || contributor;
  if (['upload', 'edit', 'create', 'delete'].includes(action)) return role === 'manager' || contributor;
  if (['manage', 'share-auto'].includes(action)) return role === 'manager';
  return false;
}

function workspacePolicy(workspace) {
  const validUser = Number.isSafeInteger(workspace.userId) && workspace.userId > 0
    && Number.isSafeInteger(workspace.orgId) && workspace.orgId > 0;
  const legacy = !workspace.enabled;
  const organizationAdmin = validUser && (workspace.collegeAdmin
    || (legacy && ['admin', 'superadmin'].includes(workspace.userRole)));
  const role = organizationAdmin ? 'organization_admin'
    : workspace.role === 'manager' ? 'manager'
      : (legacy ? ['photographer', 'editor'].includes(workspace.userRole)
        : ['editor', 'member', 'contributor'].includes(workspace.role)) ? 'contributor' : 'viewer';
  const hasSpace = validUser && (legacy || Boolean(workspace.unitId));
  const scope = !validUser ? 'none' : organizationAdmin ? 'organization'
    : !hasSpace ? 'none' : role === 'manager' ? 'unit' : role === 'contributor' ? 'own' : 'none';
  const canContribute = hasSpace && role !== 'viewer';
  const canManage = validUser && (organizationAdmin || (hasSpace && role === 'manager'));
  return {
    role, label: ROLE_LABELS[role], metadataScope: scope, deleteScope: scope,
    canUpload: canContribute, canCreate: canContribute, canOrganize: canContribute,
    canDeleteContainers: canManage, canManageMembers: canManage,
    canShare: canContribute, canPublishAutomatically: canManage,
    canGrantFaces: Boolean(organizationAdmin),
    canManageAccounts: validUser && workspace.userRole === 'superadmin' && (legacy || organizationAdmin),
  };
}

function workspacePermission(workspace, permission, baseAllowed) {
  const policy = workspacePolicy(workspace);
  const actions = {
    'projects.create': policy.canCreate, 'projects.update': policy.metadataScope !== 'none',
    'projects.delete': policy.canDeleteContainers, 'upload.photo': policy.canUpload,
    'photos.edit': policy.metadataScope !== 'none', 'photos.delete': policy.deleteScope !== 'none',
    'ai.generate': policy.canCreate || (policy.role === 'organization_admin'),
  };
  if (Object.hasOwn(actions, permission)) return actions[permission];
  if (permission === 'users.view_all' || permission === 'users.manage_roles') return Boolean(baseAllowed && policy.canManageAccounts);
  if (permission === 'users.invitations.create') return Boolean(baseAllowed && policy.role === 'organization_admin');
  return Boolean(baseAllowed);
}

function userAccessProfile(workspace, basePermissions, facePermissions = { search: false, manage: false }) {
  const access = workspacePolicy(workspace);
  const permissions = new Set(basePermissions || []);
  SCOPED_PERMISSIONS.forEach(permission => permissions.delete(permission));
  for (const permission of SCOPED_PERMISSIONS.filter(p => !p.startsWith('faces.'))) {
    if (workspacePermission(workspace, permission, false)) permissions.add(permission);
  }
  for (const permission of [...permissions].filter(p => p.startsWith('users.'))) {
    if (!workspacePermission(workspace, permission, true)) permissions.delete(permission);
  }
  if (facePermissions.search) permissions.add('faces.view');
  if (facePermissions.manage && facePermissions.search) {
    ['faces.detect', 'faces.label', 'faces.merge', 'faces.config'].forEach(permission => permissions.add(permission));
  }
  return { access, accessRole: access.role, accessRoleLabel: access.label,
    facePermissions: { search: Boolean(facePermissions.search), manage: Boolean(facePermissions.search && facePermissions.manage) },
    faceSearchAllowed: Boolean(facePermissions.search), photoDeleteScope: access.deleteScope,
    metadataEditScope: access.metadataScope, permissions: [...permissions] };
}

module.exports = { ROLE_LABELS, unitRoleAllows, workspacePolicy, workspacePermission, userAccessProfile };
