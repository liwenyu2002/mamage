const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const { userAccessProfile } = require('../../server/lib/access_policy');
const dist = process.env.MAMAGE_ACCESS_QA_DIST || path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_ACCESS_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile()
      ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), cases = [];
  try {
    for (const width of [1440, 390]) for (const identity of ['organization_admin', 'manager', 'contributor', 'viewer']) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      const workspace = { userId: 47, orgId: 2, userRole: 'admin', enabled: true, unitId: 1,
        role: identity === 'manager' ? 'manager' : identity === 'viewer' ? 'viewer' : 'editor', collegeAdmin: identity === 'organization_admin' };
      const access = userAccessProfile(workspace, ['projects.view', 'photos.view', 'photos.zip', 'users.invitations.create'],
        { search: identity !== 'viewer', manage: identity === 'organization_admin' });
      const grants = new Map([[20, false], [44, true]]), writes = [], unexpected = [], errors = [];
      let rejectNextGrant = false;
      try {
        await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'isolated-permission-fixture'));
        await context.route('**/api/**', async route => {
          const req = route.request(), p = new URL(req.url()).pathname, method = req.method();
          const send = json => route.fulfill({ json });
          if (p.startsWith('/api/workspaces/face-search/') && method !== 'GET') {
            const id = Number(p.split('/').at(-1));
            writes.push({ method, id, body: req.postDataJSON() });
            if (rejectNextGrant) { rejectNextGrant = false; return route.fulfill({ status: 403, json: { error: 'COLLEGE_ADMIN_REQUIRED' } }); }
            if (method === 'DELETE') grants.delete(id); else grants.set(id, req.postDataJSON().canManage === true);
            return send({ granted: method !== 'DELETE' });
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { unexpected.push(`${method} ${p}`); return route.abort(); }
          if (p === '/api/users/me') return send({ id: 47, name: '测试用户', email: 'test@example.invalid', role: 'admin',
            workspaceEnabled: true, activeUnitId: 1, collegeAdmin: workspace.collegeAdmin, unitRole: workspace.role, ...access });
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, access: access.access,
            collegeAdmin: workspace.collegeAdmin, units: [{ id: 1, name: '测试小组', role: workspace.role }], shareTargets: [] });
          if (p === '/api/album-desktop') return send({ albums: [], groups: [], sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], colors: {} }, scope: { userId: 47, organizationId: 2, unitId: 1 },
            canOrganize: access.access.canOrganize, canDeleteFolders: access.access.canDeleteContainers, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/list') return send({ list: [], total: 0, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/workspaces/face-search/grants') return send([...grants].map(([userId, canManage]) => ({ userId, canManage: Number(canManage), collegeWide: 1 })));
          if (p === '/api/workspaces/1/members') return send([{ id: 20, name: '只检索同学', role: 'editor' },
            { id: 44, name: '维护同学', role: 'manager' }, { id: 46, name: '新同学', role: 'editor' }]);
          if (p === '/api/workspaces/stats/ai') return send({ rows: [] });
          if (p.endsWith('/candidates')) return send([{ id: 46, name: '新同学' }]);
          return send([]);
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(base);
        await page.locator('.mamage-user-menu summary').click();
        await page.getByRole('button', { name: '账户信息', exact: true }).click();
        const account = page.locator('body');
        await page.getByText('身份：', { exact: true }).waitFor();
        assert.ok((await account.innerText()).includes(access.accessRoleLabel));
        assert.equal(await page.getByText('系统管理：兼容角色（高级）', { exact: true }).count(), 0);
        assert.equal(await page.getByText('兑换访问授权', { exact: true }).count(), 0);
        assert.equal(await page.getByText('管理员：管理邀请码', { exact: true }).count(), identity === 'organization_admin' ? 1 : 0);
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `account-${identity}-${width}.png`), fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Account overflow: ${identity}-${width}`);
        await page.locator('.mamage-user-menu summary').click();
        await page.getByRole('button', { name: '工作空间管理', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        assert.equal(await dialog.getByRole('tab', { name: '成员', exact: true }).count(), access.access.canManageMembers ? 1 : 0);
        if (access.access.canManageMembers) {
          await dialog.getByRole('tab', { name: '成员', exact: true }).click();
          await dialog.getByText('新同学', { exact: true }).waitFor();
          assert.ok((await dialog.innerText()).includes('协作者'));
          assert.equal(await dialog.getByRole('checkbox').count(), identity === 'organization_admin' ? 6 : 0);
          if (identity === 'organization_admin') {
            const search = dialog.getByRole('checkbox', { name: '人物检索 新同学', exact: true });
            const manage = dialog.getByRole('checkbox', { name: '人物档案维护 新同学', exact: true });
            await search.check(); await manage.waitFor({ state: 'visible' });
            await page.waitForFunction(() => !document.querySelector('input[aria-label="人物档案维护 新同学"]').disabled);
            assert.equal(await manage.isChecked(), false);
            await manage.check(); await page.waitForFunction(() => !document.querySelector('input[aria-label="人物档案维护 新同学"]').disabled);
            await manage.uncheck(); await page.waitForFunction(() => !document.querySelector('input[aria-label="人物档案维护 新同学"]').disabled);
            assert.equal(await search.isChecked(), true);
            await search.uncheck(); await page.waitForFunction(() => document.querySelector('input[aria-label="人物档案维护 新同学"]').disabled);
            assert.deepEqual(writes.map(w => [w.method, w.id, w.body?.canManage]), [['PUT', 46, false], ['PUT', 46, true], ['PUT', 46, false], ['DELETE', 46, undefined]]);
            assert.equal(await dialog.getByRole('checkbox', { name: '人物档案维护 维护同学', exact: true }).isChecked(), true);
            rejectNextGrant = true;
            await search.check();
            await page.waitForFunction(() => {
              const search = document.querySelector('input[aria-label="人物检索 新同学"]');
              return !search.disabled && !search.checked;
            });
            assert.equal(grants.has(46), false, 'Rejected writes must not remain checked');
            assert.equal(await manage.isDisabled(), true);
            await page.getByText('只有学院管理员可以调整人物权限', { exact: true }).waitFor();
          }
        }
        await page.locator('.mamage-toast').last().waitFor({ state: 'hidden' }).catch(() => {});
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `members-${identity}-${width}.png`), fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Member overflow: ${identity}-${width}`);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        cases.push({ identity, width, passed: true, independentFaceToggles: identity === 'organization_admin' });
      } catch (e) {
        if (artifacts && context.pages()[0]) await context.pages()[0].screenshot({ path: path.join(artifacts, `failure-${identity}-${width}.png`), fullPage: true });
        throw e;
      } finally { await context.close(); }
    }
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ passed: true, cases }, null, 2));
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
