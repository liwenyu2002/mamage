const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');

const base = process.env.MAMAGE_ALBUM_FORM_URL || 'http://127.0.0.1:5201';
const output = path.resolve(__dirname, '../test-results/album-form');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.MAMAGE_WEBVIEW_EXECUTABLE || undefined });
  const results = [];
  try {
    const sizes = process.env.MAMAGE_ALBUM_FORM_QUICK ? [{ width: 390, height: 844 }, { width: 1440, height: 900 }]
      : [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1440, height: 900 }];
    for (const size of sizes) {
      for (const noBackdrop of [false, true]) {
        const label = `${size.width}x${size.height}${noBackdrop ? '-no-backdrop' : ''}`;
        const context = await browser.newContext({ viewport: size, isMobile: size.width < 640, hasTouch: size.width < 900 });
        const page = await context.newPage();
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) {
            requests.push(url.pathname);
            return route.abort();
          }
          return route.continue();
        });
        await page.goto(`${base}/__prototype/album-form`);
        await page.getByRole('button', { name: '新建相册', exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0, 'Default preview starts closed');
        assert.equal(await page.getByRole('button', { name: '新建相册', exact: true }).count(), 1, 'Only one create entry');
        if (noBackdrop) await page.addStyleTag({ content: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
        await page.screenshot({ path: path.join(output, `dock-closed-${label}.png`) });
        await page.getByRole('button', { name: '选择', exact: true }).click();
        await page.getByRole('checkbox', { name: /选择相册/ }).check();
        await page.getByRole('button', { name: '完成选择，已选 1 项', exact: true }).click();
        assert.equal(await page.getByRole('checkbox', { name: /选择相册/ }).count(), 0, 'Selecting is functional');
        await page.waitForTimeout(700);
        const circle = await page.getByRole('button', { name: '新建相册', exact: true }).boundingBox();
        await page.getByRole('button', { name: '新建相册', exact: true }).click();
        await page.getByRole('dialog', { name: '新建相册', exact: true }).waitFor();
        const origin = await page.locator('.mamage-modal-content').evaluate(el => {
          if (getComputedStyle(el).animationName !== 'album-dock-expand') throw new Error('Unexpected stacked modal animation');
          const animation = el.getAnimations().find(item => item.animationName === 'album-dock-expand');
          animation.pause(); animation.currentTime = 0;
          const rect = el.getBoundingClientRect().toJSON();
          animation.play();
          return rect;
        });
        assert(Math.abs(origin.width - circle.width) < 2 && Math.abs(origin.height - circle.height) < 2, 'Panel begins at the primary circle size');
        assert(Math.abs(origin.x - circle.x) < 2 && Math.abs(origin.y - circle.y) < 2, 'Panel grows from primary circle position');
        await page.waitForTimeout(700);
        const metrics = await checkLayout(page, size);
        await page.screenshot({ path: path.join(output, `create-${label}.png`) });

        await page.getByLabel('相册名称', { exact: false }).fill('劳动实践与美育活动');
        await page.getByRole('button', { name: '补充信息', exact: true }).click();
        await page.getByLabel('相册描述', { exact: false }).fill('本地交互测试，不上传文件或创建线上相册。');
        await page.getByLabel('相册标签', { exact: false }).fill('校园活动');
        await page.getByLabel('相册标签', { exact: false }).press('Enter');
        assert.equal(await page.locator('.album-tag').count(), 1);
        await page.getByRole('button', { name: '删除标签 校园活动' }).click();
        assert.equal(await page.locator('.album-tag').count(), 0);
        await page.getByRole('button', { name: '选择活动日期' }).click();
        const calendar = page.locator('.album-form-calendar');
        await calendar.waitFor();
        await page.waitForTimeout(650);
        assert.equal(await calendar.evaluate(el => !!el.closest('[inert]')), false, 'Calendar portal is outside inert root');
        const cr = await calendar.boundingBox();
        assert(cr.x >= 0 && cr.y >= 0 && cr.x + cr.width <= size.width + 1 && cr.y + cr.height <= size.height + 1, `${label}: calendar fits`);
        assert(await calendar.evaluate(el => {
          const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number);
          return parts.length === 3 || parts[3] >= .9;
        }), 'Calendar is readable');
        await calendar.getByRole('button', { name: '15', exact: true }).click();
        assert.equal(await calendar.count(), 0);
        assert(await page.locator('.album-details-fields .mamage-dtp-value').textContent());

        await page.getByRole('button', { name: '时间轴', exact: true }).click();
        await page.getByRole('checkbox').check();
        await page.getByPlaceholder('环节 1', { exact: true }).fill('开场');
        await page.getByRole('button', { name: '添加环节', exact: true }).click();
        await page.getByPlaceholder('环节 2', { exact: true }).fill('实践');
        if (size.width < 768) {
          await page.getByRole('button', { name: '上移环节' }).nth(1).click();
          assert.equal(await page.locator('.cam-timeline-name').first().inputValue(), '实践');
        }
        await page.getByRole('button', { name: '删除环节', exact: true }).last().click();
        assert.equal(await page.locator('.cam-timeline-row').count(), 1);
        await page.getByRole('button', { name: '链接导入', exact: true }).click();
        await page.getByLabel('相册链接', { exact: true }).fill('https://example.com/album');
        await page.getByRole('button', { name: '链接导入', exact: true }).click();
        await page.getByRole('button', { name: '链接导入', exact: true }).click();
        assert.equal(await page.getByLabel('相册链接', { exact: true }).inputValue(), 'https://example.com/album');
        await page.getByLabel('相册链接', { exact: true }).fill('');
        const png = fs.readFileSync(path.resolve(__dirname, '../public/favicon.png'));
        await page.locator('input[type=file]').setInputFiles([{ name: 'local-photo.png', mimeType: 'image/png', buffer: png }, { name: 'local-video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('local fixture') }]);
        assert.equal(await page.locator('.cam-preview-item').count(), 2);
        assert.equal(await page.locator('.cam-preview-video-badge').count(), 1);
        const controlsOverlap = await page.locator('.cam-preview-video-badge').evaluate(badge => {
          const rect = badge.getBoundingClientRect();
          return [...badge.parentElement.querySelectorAll('button, select')].some(control => {
            const other = control.getBoundingClientRect();
            return rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top;
          });
        });
        assert.equal(controlsOverlap, false, 'Video badge leaves removal and section controls clear');
        await page.locator('.cam-preview-section').first().selectOption('');
        await page.getByRole('button', { name: '移除媒体' }).first().click();
        await page.getByRole('button', { name: '移除媒体' }).first().click();
        await page.locator('.mamage-modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
        const expanded = await checkLayout(page, size);
        assert(expanded.body.scrollTop > 0, 'Expanded form scrolls independently');
        await page.screenshot({ path: path.join(output, `expanded-${label}.png`) });
        assert.equal(await page.evaluate(() => window.scrollY), 0, 'Background page stays still');
        await page.getByRole('button', { name: '创建', exact: true }).click();
        assert.equal(await page.locator('#root').evaluate(el => !!el.inert), true, 'Page remains inert during exit');
        await page.locator('#root').evaluate(el => { window.backgroundClicks = 0; el.addEventListener('click', () => { window.backgroundClicks += 1; }); });
        await page.mouse.click(30, 30);
        await page.getByRole('dialog', { name: '新建相册', exact: true }).waitFor({ state: 'detached' });
        await page.waitForFunction(() => !document.getElementById('root').inert);
        assert.equal(await page.evaluate(() => window.backgroundClicks), 0, 'No click-through during exit');
        assert.equal(await page.locator('#root').evaluate(el => !!el.inert), false);
        assert.equal(await page.locator('body').evaluate(el => el.style.overflow), '');
        assert.equal(requests.length, 0, 'Preview never calls an API or external host');

        await page.getByRole('button', { name: '相册功能', exact: true }).click();
        await page.locator('.afp-functions').getByRole('button', { name: '编辑相册', exact: true }).click();
        await page.waitForTimeout(700);
        await checkLayout(page, size);
        assert.equal(await page.getByLabel('相册名称', { exact: false }).inputValue(), '劳动实践与美育活动', 'Edit receives latest created album');
        await page.screenshot({ path: path.join(output, `edit-${label}.png`) });
        await page.getByLabel('相册名称', { exact: false }).fill('本地编辑草稿');
        await page.getByRole('button', { name: '保存相册', exact: true }).click();
        await page.getByRole('dialog', { name: '编辑相册', exact: true }).waitFor({ state: 'detached' });
        await page.getByRole('button', { name: '卡片编辑相册', exact: true }).click();
        await page.waitForTimeout(700);
        await checkLayout(page, size);
        await page.getByLabel('相册名称', { exact: false }).fill('卡片编辑已保存');
        await page.getByRole('button', { name: '保存相册', exact: true }).click();
        await page.getByRole('dialog', { name: '编辑相册', exact: true }).waitFor({ state: 'detached' });
        assert.equal(await page.locator('.afp-album strong').textContent(), '卡片编辑已保存');
        await page.waitForFunction(() => !document.getElementById('root').inert);
        await page.getByRole('button', { name: '相册功能', exact: true }).click();
        await page.locator('.afp-functions').getByRole('button', { name: '编辑相册', exact: true }).click();
        await page.waitForTimeout(700);
        assert.equal(await page.getByLabel('相册名称', { exact: false }).inputValue(), '卡片编辑已保存', 'Reopening edit reads latest card edit');
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.deepEqual(errors, []);
        assert.deepEqual(requests, []);
        results.push({ label, initial: metrics, expanded });
        await context.close();
      }
    }
    // A smaller visual viewport models the space left above an on-screen keyboard.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/__prototype/album-form`);
    await page.getByRole('button', { name: '新建相册', exact: true }).click();
    await page.getByRole('dialog', { name: '新建相册', exact: true }).waitFor();
    await page.getByRole('button', { name: '补充信息', exact: true }).click();
    await page.getByLabel('相册描述', { exact: false }).focus();
    await page.setViewportSize({ width: 390, height: 400 });
    await page.waitForTimeout(700);
    await checkLayout(page, { width: 390, height: 400 });
    await page.screenshot({ path: path.join(output, 'keyboard-short-viewport.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '新建相册', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.mamage-modal-content').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.mamage-modal-close').evaluate(el => document.activeElement === el), true, 'Keyboard reaches close control');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    console.log(JSON.stringify({ browser: browser.version(), passed: results.length, cases: results.map(result => result.label), shortViewport: 'passed' }, null, 2));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: browser.version(), passed: results.length, results }, null, 2));
  } finally { await browser.close(); }
}

async function checkLayout(page, viewport) {
  const metrics = await page.locator('.album-form-modal:visible').evaluate(el => {
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const body = el.querySelector('.mamage-modal-body');
    const footer = el.querySelector('.mamage-modal-footer');
    return {
      surface: getComputedStyle(el.querySelector('.mamage-modal-content')).backgroundColor,
      outline: getComputedStyle(el).outlineStyle,
      dialog: rect(el), header: rect(el.querySelector('.mamage-modal-header')), footer: rect(footer),
      body: { ...rect(body), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, scrollTop: body.scrollTop, scrollHeight: body.scrollHeight },
      pageWidth: document.documentElement.scrollWidth,
      footerClickable: [...footer.querySelectorAll('button')].every(button => {
        const r = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
    };
  });
  const parts = metrics.surface.match(/[\d.]+/g)?.map(Number) || [];
  assert(parts.length === 3 || parts[3] >= .9, 'Album form needs a readable surface without backdrop-filter');
  assert.equal(metrics.outline, 'none', 'Dialog container has no programmatic focus outline');
  assert(metrics.dialog.x >= -1 && metrics.dialog.right <= viewport.width + 1, 'Dialog fits horizontally');
  assert(metrics.dialog.y >= -1 && metrics.dialog.bottom <= viewport.height + 1, 'Dialog fits vertically');
  assert(metrics.pageWidth <= viewport.width + 1 && metrics.body.scrollWidth <= metrics.body.clientWidth + 1, 'No horizontal overflow');
  assert(metrics.header.bottom <= metrics.body.y + 1, 'Header does not cover form');
  assert(metrics.body.bottom <= metrics.footer.y + 1, 'Footer does not cover form');
  assert(metrics.footerClickable, 'Footer actions are reachable');
  return metrics;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
