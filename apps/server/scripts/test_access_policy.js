const assert = require('node:assert/strict');
const { test } = require('node:test');
const { workspacePolicy, workspacePermission, userAccessProfile, unitRoleAllows } = require('../lib/access_policy');
const student = { enabled: true, userId: 7, userRole: 'admin', orgId: 2, unitId: 1, role: 'editor', collegeAdmin: false };

test('one policy produces exactly four public identities; admin labels cannot elevate students', () => {
  for (const [workspace, role, scope] of [[student, 'contributor', 'own'],
    [{ ...student, role: 'manager' }, 'manager', 'unit'],
    [{ ...student, collegeAdmin: true }, 'organization_admin', 'organization'],
    [{ ...student, role: 'viewer' }, 'viewer', 'none']]) {
    const policy = workspacePolicy(workspace);
    assert.equal(policy.role, role); assert.equal(policy.deleteScope, scope); assert.equal(policy.metadataScope, scope);
  }
  assert.equal(workspacePermission(student, 'projects.delete', true), false);
  assert.equal(workspacePermission(student, 'users.view_all', true), false);
  assert.equal(workspacePolicy(student).canGrantFaces, false);
});

test('legacy storage uses the same public model without moving business data', () => {
  assert.equal(workspacePolicy({ ...student, enabled: false, role: null }).role, 'organization_admin');
  assert.equal(workspacePolicy({ ...student, enabled: false, role: null, userRole: 'visitor' }).role, 'viewer');
  assert.equal(workspacePolicy({ ...student, enabled: false, role: null, userRole: 'photographer' }).role, 'contributor');
});

test('viewers cannot upload, organize, edit, delete or generate even with the old admin field', () => {
  const viewer = { ...student, role: 'viewer' };
  assert.equal(unitRoleAllows('viewer', 'read'), true);
  for (const permission of ['upload.photo', 'projects.create', 'projects.update', 'projects.delete', 'photos.edit', 'photos.delete', 'ai.generate']) {
    assert.equal(workspacePermission(viewer, permission, true), false, permission);
  }
});

test('new human-readable permission projection separates person search from maintenance', () => {
  const base = ['photos.view', 'photos.zip', 'projects.delete', 'users.invitations.create', 'faces.merge'];
  const search = userAccessProfile(student, base, { search: true, manage: false });
  assert.equal(search.accessRoleLabel, '协作者'); assert.ok(search.permissions.includes('faces.view'));
  for (const p of ['faces.merge', 'faces.label', 'faces.detect', 'faces.config', 'projects.delete', 'users.invitations.create']) assert.ok(!search.permissions.includes(p), p);
  const manage = userAccessProfile(student, base, { search: true, manage: true });
  assert.ok(manage.permissions.includes('faces.merge')); assert.equal(manage.photoDeleteScope, 'own');
  assert.equal(userAccessProfile(student, base, { search: false, manage: true }).facePermissions.manage, false);
});

test('absent users or missing current groups fail closed for writes', () => {
  for (const w of [{ ...student, userId: null }, { ...student, orgId: null }, { ...student, unitId: null },
    { ...student, enabled: false, orgId: null }]) {
    assert.equal(workspacePermission(w, 'upload.photo', true), false);
    assert.equal(workspacePermission(w, 'photos.delete', true), false);
    assert.equal(workspacePolicy(w).canGrantFaces, false);
  }
});
