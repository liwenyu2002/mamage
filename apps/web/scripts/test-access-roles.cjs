const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const moduleValue = { exports: {} };
const transformed = require('@babel/core').transformFileSync(path.join(__dirname, '../src/utils/accessRoles.js'), {
  presets: [require.resolve('@babel/preset-env')],
}).code;
new Function('module', 'exports', transformed)(moduleValue, moduleValue.exports);
const { accessRoleLabel, memberRoleLabel, ACCESS_ROLE_LABELS } = moduleValue.exports;

test('account labels use the canonical identity before the legacy system role', () => {
  assert.deepEqual(ACCESS_ROLE_LABELS, require('../../server/lib/access_policy').ROLE_LABELS);
  for (const [role, label] of Object.entries(ACCESS_ROLE_LABELS)) {
    assert.equal(accessRoleLabel({ accessRole: role, role: 'admin' }), label);
  }
  assert.equal(accessRoleLabel({ workspaceEnabled: true, role: 'admin', unitRole: 'editor' }), '协作者');
  assert.equal(accessRoleLabel({ workspaceEnabled: true, role: 'admin', unitRole: 'viewer' }), '访客');
  assert.equal(accessRoleLabel({ workspaceEnabled: true, role: 'superadmin' }), '访客');
});

test('compatibility labels remain human-readable without inventing extra roles', () => {
  assert.equal(memberRoleLabel('member'), '协作者');
  assert.equal(memberRoleLabel('editor'), '协作者');
  assert.equal(memberRoleLabel('manager'), '小组管理员');
  assert.equal(memberRoleLabel('viewer'), '访客');
  assert.equal(accessRoleLabel({ role: 'admin' }), '学院管理员');
  assert.equal(accessRoleLabel({ role: 'visitor' }), '访客');
});
