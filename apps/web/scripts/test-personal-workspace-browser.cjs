const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const JSZip = require('jszip');
const { createPersonalPreview } = require('./serve-personal-workspace.cjs');

async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function download(page, button, directory, name) {
  const waiting = page.waitForEvent('download'); await button.click();
  const result = await waiting; const destination = path.join(directory, name || result.suggestedFilename());
  await result.saveAs(destination); assert.equal(await result.failure(), null); return destination;
}

(async () => {
  const directory = path.resolve(__dirname, '../../../.local/personal-workspace-qa'); fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const preview = await createPersonalPreview(), contexts = [];
      const errors = [], leaked = [];
      try {
        const pages = [];
        for (let role = 0; role < 3; role++) {
          const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 1000 }, hasTouch: width < 700 }); contexts.push(context);
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (['blob:', 'data:'].includes(url.protocol) || preview.urls.includes(url.origin)) return route.continue();
            leaked.push(url.origin + url.pathname); return route.abort();
          });
          const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); pages.push(page);
        }
        const [student, manager, root] = pages;
        await manager.goto(preview.urls[1] + '/account');
        await manager.getByRole('heading', { name: '入组申请', exact: true }).waitFor();
        await manager.getByText('没有待审批的申请', { exact: true }).waitFor();
        await student.bringToFront();
        await student.goto(preview.urls[0] + '/personal');
        const chooser = student.getByRole('dialog', { name: '加入组织' });
        await chooser.waitFor();
        await chooser.getByRole('button', { name: '暂不加入，使用个人工具', exact: true }).click();
        await chooser.waitFor({ state: 'hidden' });
        await student.reload();
        await student.getByRole('heading', { name: '个人工具', exact: true }).waitFor();
        assert.equal(await student.getByRole('dialog', { name: '加入组织' }).count(), 0, 'Declining persists without forcing another prompt');
        await student.getByRole('button', { name: '组织申请', exact: true }).click();
        await choose(student, '申请加入', '学工与融媒体');
        await student.getByPlaceholder('所在班级、团队或参与的工作').fill('本地测试申请');
        await student.getByRole('button', { name: '提交申请', exact: true }).click();
        await chooser.waitFor({ state: 'hidden' });
        assert.equal(preview.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=2').get().n, 0);

        await manager.bringToFront();
        await manager.evaluate(() => window.dispatchEvent(new Event('focus')));
        await manager.getByRole('heading', { name: '入组申请', exact: true }).waitFor();
        await manager.locator('.mamage-account-group.has-membership-notification').waitFor();
        assert.equal(await manager.locator('.mamage-user-chip').evaluate(element => getComputedStyle(element, '::after').backgroundColor), 'rgb(227, 76, 83)');
        await manager.getByText('测试同学', { exact: true }).waitFor();
        assert.equal(await manager.getByRole('region', { name: '用户与权限', exact: true }).count(), 0, 'Ordinary managers never receive the account privilege editor');
        await manager.getByRole('button', { name: '通过', exact: true }).click();
        await manager.getByRole('button', { name: '确认通过', exact: true }).click();
        await manager.getByText('没有待审批的申请', { exact: true }).waitFor();
        await manager.waitForFunction(() => !document.querySelector('.mamage-account-group.has-membership-notification'));
        assert.equal(preview.sql.prepare('SELECT role FROM organization_unit_memberships WHERE user_id=2').get().role, 'editor');
        await student.bringToFront();
        await student.locator('.mamage-account-group.has-membership-notification').waitFor();
        await student.getByRole('button', { name: /组织申请/ }).first().click();
        await student.getByText('已通过', { exact: true }).waitFor();
        await student.getByRole('button', { name: '完成', exact: true }).click();

        await root.goto(preview.urls[2] + '/account');
        await root.getByRole('region', { name: '用户与权限', exact: true }).waitFor();
        await root.getByRole('tab', { name: '已处理', exact: true }).click();
        await root.getByText('已通过', { exact: true }).waitFor();
        await root.screenshot({ path: path.join(directory, `approvals-${width}.png`), fullPage: true });

        await student.bringToFront();
        const red = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: '#d93737' } }).png().toBuffer();
        const noise = Buffer.alloc(1200 * 1600 * 3); let seed = 7;
        for (let index = 0; index < noise.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; noise[index] = seed >>> 24; }
        const blue = await sharp(noise, { raw: { width: 1200, height: 1600, channels: 3 } }).png().toBuffer();
        await student.getByLabel('选择本地图片', { exact: true }).setInputFiles([{ name: 'figure.png', mimeType: 'image/png', buffer: red }]);
        const canvas = student.locator('.personal-preview .viewer-adjusted-canvas');
        await student.waitForFunction(() => document.querySelector('.personal-preview .viewer-adjusted-canvas')?.dataset.toneKey);
        assert.deepEqual(await canvas.evaluate(element => [element.width, element.height]), [1500, 1000]);
        await student.getByRole('tab', { name: '裁切与旋转', exact: true }).click();
        await student.getByRole('button', { name: '向右旋转 90 度', exact: true }).click();
        await student.getByRole('button', { name: '1:1', exact: true }).click();
        const edited = await download(student, student.getByRole('button', { name: '下载图片', exact: true }), directory, `edited-${width}.png`);
        const editedMeta = await sharp(edited).metadata();
        assert.deepEqual([editedMeta.width, editedMeta.height], [1000, 1000]);
        await student.screenshot({ path: path.join(directory, `editor-${width}.png`), fullPage: true });
        await student.getByLabel('选择本地图片', { exact: true }).setInputFiles([{ name: 'figure.png', mimeType: 'image/png', buffer: blue }]);
        await student.getByRole('tab', { name: '压缩转图', exact: true }).click();
        await student.getByLabel('每张体积上限（KB）', { exact: true }).fill('20');
        const zipped = await download(student, student.getByRole('button', { name: '批量下载 ZIP', exact: true }), directory, `converted-${width}.zip`);
        const zip = await JSZip.loadAsync(fs.readFileSync(zipped)); const files = Object.values(zip.files).filter(file => !file.dir);
        assert.equal(files.length, 2); assert.notEqual(files[0].name, files[1].name);
        for (const file of files) { const buffer = await file.async('nodebuffer'); assert.ok(buffer.length <= 20000); assert.equal((await sharp(buffer).metadata()).format, 'jpeg'); }
        await choose(student, '导出格式', 'PNG');
        await student.getByLabel('每张体积上限（KB）', { exact: true }).fill('1');
        await student.getByRole('checkbox', { name: '超限时允许缩小尺寸', exact: true }).uncheck();
        await student.getByRole('button', { name: '批量下载 ZIP', exact: true }).click();
        await student.getByText('无法在当前限制下导出，请提高体积上限或允许缩小尺寸', { exact: true }).waitFor();
        await student.getByRole('tab', { name: '组图拼版', exact: true }).click();
        await student.waitForFunction(() => document.querySelector('.personal-collage-canvas')?.width === 2400 && !document.querySelector('.personal-canvas-progress'));
        const collage = await download(student, student.getByRole('button', { name: '下载组图', exact: true }), directory, `collage-${width}.png`);
        const collageMeta = await sharp(collage).metadata(); assert.equal(collageMeta.width, 2400); assert.ok(collageMeta.height > 800);
        await student.screenshot({ path: path.join(directory, `collage-${width}.png`), fullPage: true });
        await student.getByRole('tab', { name: '尺寸检查', exact: true }).click();
        await student.getByLabel('打印参考 DPI', { exact: true }).fill('300');
        await student.getByText('84.7 × 84.7 mm', { exact: true }).waitFor();
        assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
        const uploads = preview.stats.requests.filter(request => !['GET', 'HEAD'].includes(request.method) && !request.path.startsWith('/api/users/workspace-join/'));
        assert.deepEqual(uploads, [], 'Temporary images never upload to a backend');
        assert.deepEqual(errors, []); assert.deepEqual(leaked, []);
        console.log(JSON.stringify({ width, organizationApproved: true, privilegeEditorIsolated: true, originalPixels: [1500, 1000], editedPixels: [1000, 1000], zipImages: 2, byteLimitVerified: true, impossibleLimitRejected: true, collage: [collageMeta.width, collageMeta.height], externalRequests: 0, imageUploads: 0 }));
      } catch (error) {
        for (const [index, context] of contexts.entries()) {
          const page = context.pages()[0];
          if (page) { await page.screenshot({ path: path.join(directory, `failure-${width}-${index}.png`), fullPage: true }).catch(() => {}); }
        }
        console.error(JSON.stringify({ errors, leaked, lastRequests: preview.stats.requests.slice(-12) }));
        throw error;
      } finally { for (const context of contexts) await context.close(); await preview.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
