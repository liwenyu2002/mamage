const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_ACCESS_ADMIN_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const cases = [];
  try {
    for (const width of [1440, 390]) for (const canManage of [true, false]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const errors = [], writes = [], unexpected = [];
      const currentUser = { id: 1, name: '测试管理员', role: canManage ? 'superadmin' : 'admin', organization_id: 2,
        email: 'admin@example.invalid', workspaceEnabled: true, activeUnitId: 1, unitRole: 'manager', collegeAdmin: canManage,
        canManageUserAccess: canManage, permissions: ['projects.view', 'photos.view', ...(canManage ? ['users.manage_roles'] : [])], iamManaged: true, campusStudentNo: 'T001',
        facePermissions: { search: true, manage: true } };
      let rejectNext = false, rejectList = false;
      let teacher = { id: 3, name: '新教师', email: 'teacher@example.invalid', student_no: 'T003', role: 'visitor', iamLinked: true,
        memberships: [], collegeAdmin: false, facePermissions: { search: false, manage: false }, revision: 'a'.repeat(64) };
      const roots = [1, 2].map(id => ({ ...teacher, id, name: id === 1 ? '测试管理员' : '第二超管', role: 'superadmin', collegeAdmin: true }));
      const base = `http://127.0.0.1:${server.address().port}`;
      let page;
      try {
        await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'isolated-access-admin-fixture'));
        await context.route('**/api/**', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          const send = json => route.fulfill({ json });
          if (p === '/api/users/3/access' && req.method() === 'PUT') {
            const body = req.postDataJSON(); writes.push(body);
            if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, json: { error: 'ACCESS_CHANGED', message: '权限已被其他操作更新，请重新加载后再保存' } }); }
            teacher = { ...teacher, ...body, revision: 'b'.repeat(64) };
            return send({ ok: true, revision: teacher.revision });
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { unexpected.push(`${req.method()} ${p}`); return route.abort(); }
          if (p === '/api/users/me') return send(currentUser);
          if (p === '/api/users/all') return send({ users: [...roots, teacher] });
          if (p === '/api/users/access') {
            assert.ok(canManage, 'Ordinary managers must not fetch the account list');
            if (rejectList) { rejectList = false; return route.fulfill({ status: 503, json: { error: 'UNAVAILABLE', message: '用户列表暂时不可用' } }); }
            let users = [...roots, teacher];
            if (url.searchParams.get('status') === 'pending' && teacher.memberships.length) users = [];
            if (url.searchParams.get('q') && !teacher.name.includes(url.searchParams.get('q'))) users = [];
            return send({ organizations: [{ id: 2, name: '测试学院' }], organizationId: 2,
              units: [{ id: 1, name: '测试小组' }, { id: 2, name: '第二小组' }], users, total: users.length, page: 1, pageSize: 50 });
          }
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, collegeAdmin: canManage,
            units: [{ id: 1, name: '测试小组', role: 'manager' }], shareTargets: [] });
          if (p === '/api/album-desktop') return send({ albums: [], groups: [], sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], colors: {} }, scope: { userId: 1, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/list') return send({ list: [], total: 0, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          return send([]);
        });
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(base);
        await page.locator('.mamage-user-chip').click();
        assert.equal(await page.getByRole('button', { name: '用户与权限', exact: true }).count(), canManage ? 1 : 0);
        await page.getByRole('button', { name: canManage ? '用户与权限' : '账户信息', exact: true }).click();
        await page.getByText('姓名：', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '中转站', exact: true }).count(), 0);
        const panel = page.getByRole('region', { name: '用户与权限', exact: true });
        if (canManage) {
          await panel.getByText('新教师', { exact: true }).waitFor();
          assert.equal(await panel.getByRole('button', { name: '当前账号', exact: true }).isDisabled(), true);
          assert.equal(await panel.getByRole('button', { name: '超级管理员', exact: true }).isDisabled(), true);
          await page.locator('summary').filter({ hasText: '兼容角色设置' }).click();
          const legacy = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '兼容角色设置' }) });
          await legacy.getByText('新教师', { exact: true }).waitFor();
          const selects = legacy.locator('select');
          assert.equal(await selects.count(), 3);
          assert.equal(await selects.nth(0).isDisabled(), true);
          assert.equal(await selects.nth(1).isDisabled(), true);
          assert.equal(await selects.nth(2).locator('option[value="superadmin"]').count(), 0);
          await page.locator('summary').filter({ hasText: '兼容角色设置' }).click();
          await panel.getByRole('button', { name: '配置', exact: true }).click();
          const editor = panel.getByLabel('新教师的权限', { exact: true });
          await editor.getByRole('checkbox', { name: '测试小组', exact: true }).check();
          const manage = editor.getByRole('checkbox', { name: '人物档案维护', exact: true });
          assert.equal(await manage.isDisabled(), true);
          await editor.getByRole('checkbox', { name: '人物检索', exact: true }).check();
          await manage.check();
          await editor.getByRole('button', { name: '保存配置', exact: true }).click();
          assert.equal(writes.length, 0, 'Confirmation must not write before approval');
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `admin-confirm-${width}.png`), fullPage: true });
          await editor.getByRole('button', { name: '确认保存', exact: true }).click();
          await panel.getByText('权限已保存', { exact: true }).waitFor();
          assert.deepEqual(writes[0], { revision: 'a'.repeat(64), memberships: [{ unitId: 1, role: 'editor' }], collegeAdmin: false, facePermissions: { search: true, manage: true } });
          await panel.getByRole('button', { name: '配置', exact: true }).click();
          await editor.getByRole('checkbox', { name: '人物检索', exact: true }).uncheck();
          assert.equal(await manage.isChecked(), false); assert.equal(await manage.isDisabled(), true);
          rejectNext = true;
          await editor.getByRole('button', { name: '保存配置', exact: true }).click();
          await editor.getByRole('button', { name: '确认保存', exact: true }).click();
          await panel.getByRole('alert').waitFor();
          assert.ok((await panel.getByRole('alert').innerText()).includes('权限已被其他操作更新'));
          assert.equal(teacher.facePermissions.search, true, 'Rejected update must preserve saved access');
          await panel.getByRole('button', { name: '重新加载', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('.user-access-users')?.getAttribute('aria-busy') === 'false');
          rejectList = true;
          await panel.getByRole('button', { name: '刷新', exact: true }).click();
          await panel.getByRole('alert').waitFor();
          assert.equal(await panel.getByRole('button', { name: '配置', exact: true }).count(), 0, 'Failed list reload must not leave stale accounts editable');
          await panel.getByRole('button', { name: '重新加载', exact: true }).click();
          await panel.getByRole('button', { name: '配置', exact: true }).waitFor();
          await panel.getByRole('textbox', { name: '搜索用户' }).fill('不存在的用户');
          await panel.getByText('没有符合条件的用户', { exact: true }).waitFor();
        } else assert.equal(await panel.count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        cases.push({ width, canManage, passed: true });
      } catch (error) {
        if (page && artifacts) await page.screenshot({ path: path.join(artifacts, `failure-${width}-${canManage}.png`), fullPage: true });
        throw error;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
