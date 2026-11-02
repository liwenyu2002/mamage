const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');

const base = process.env.MAMAGE_ALBUM_FORM_URL || 'http://127.0.0.1:5201';
const output = path.resolve(__dirname, '../test-results/album-form');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const width of [320, 390, 430, 1440]) {
      for (const dark of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        const errors = [], blocked = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) {
            blocked.push(url.pathname); return route.abort();
          }
          return route.continue();
        });
        await page.goto(`${base}/__prototype/album-form`);
        if (dark) await page.evaluate(() => document.documentElement.dataset.glassTheme = 'dark');
        const dock = page.getByRole('navigation', { name: '相册底部操作' });
        let plus = dock.getByRole('button', { name: '新建相册' });
        const idle = await plus.boundingBox();
        const selectionPill = await dock.getByRole('button', { name: '选择', exact: true }).boundingBox();
        assert(Math.abs(idle.height - selectionPill.height) < 1 && Math.abs(idle.y - selectionPill.y) < 1, 'Idle circle and selection capsule have equal height and alignment');
        assert.equal(await dock.getByRole('button').count(), 2, 'No unused functions action');
        assert.equal(await page.getByRole('button', { name: '新建相册' }).count(), 1);
        const node = await plus.elementHandle();
        if (width === 390 && !dark) await page.screenshot({ path: path.join(output, 'adaptive-idle-detail.png'), clip: { x: 0, y: 708, width, height: 136 } });
        await dock.getByRole('button', { name: '选择', exact: true }).click();
        const middle = await dock.evaluate(el => {
          const animations = el.getAnimations({ subtree: true });
          animations.forEach(animation => { animation.pause(); animation.currentTime = 230; });
          const circle = el.querySelector('.detail-bottom-upload').getBoundingClientRect();
          const result = { width: el.getBoundingClientRect().width, x: circle.x, d: getComputedStyle(el.querySelector('.album-dock-outline')).d, count: animations.length };
          animations.forEach(animation => animation.play());
          return result;
        });
        assert(middle.count >= 6, 'Geometry and the notch animate together');
        await page.waitForTimeout(700);
        const expanded = await plus.boundingBox();
        assert(expanded.y < idle.y && Math.abs(expanded.x + expanded.width / 2 - width / 2) < 1, 'Circle rises and moves to center');
        assert(middle.x > idle.x && middle.x < expanded.x + 3, 'Circle has intermediate motion');
        assert(await plus.evaluate((element, original) => element === original, node), 'Primary action is not remounted');
        await dock.getByRole('button', { name: '完成选择', exact: true }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: /打开相册/ }).click();
        await page.waitForTimeout(700);
        plus = dock.getByRole('button', { name: '上传照片或视频' });
        assert.equal(await dock.getByRole('button').count(), 3, 'Album retains its functions action');
        const albumIdle = await plus.boundingBox();
        if (width === 390 && !dark) await page.screenshot({ path: path.join(output, 'album-idle-detail.png'), clip: { x: 0, y: 708, width, height: 136 } });
        await dock.getByRole('button', { name: '打开功能' }).click();
        await page.getByRole('button', { name: '视频', exact: true }).click();
        assert.equal(await page.locator('.afp-media').count(), 0, 'Functions filter is connected');
        await page.getByRole('button', { name: '全部', exact: true }).click();
        assert.equal(await page.locator('.afp-media').count(), 1);
        await dock.getByRole('button', { name: '选择', exact: true }).click();
        await page.waitForTimeout(700);
        assert.deepEqual(await plus.boundingBox(), albumIdle, 'Album notch and circle stay fixed during selection');
        assert.equal(await page.locator('.afp-functions').count(), 0);
        assert(await dock.getByRole('button', { name: '删除所选内容' }).isDisabled(), 'No deletion without selection');
        assert.equal(await dock.locator('.detail-bottom-nav-item--select').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'No white selected pill');
        await page.getByRole('checkbox', { name: '选择文件 MaMage.png' }).check();
        assert(await dock.getByRole('button', { name: '删除所选内容' }).isEnabled());
        assert(await dock.getByRole('button', { name: '完成选择，已选 1 项' }).isVisible());
        await assertDockLayout(dock, width);
        await page.screenshot({ path: path.join(output, `adaptive-${width}${dark ? '-dark' : ''}.png`) });
        if (width === 390 && !dark) await page.screenshot({ path: path.join(output, 'adaptive-selected-detail.png'), clip: { x: 0, y: 708, width, height: 136 } });
        await dock.getByRole('button', { name: '删除所选内容' }).click();
        await page.getByRole('dialog', { name: '删除文件' }).waitFor();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.afp-media').count(), 1, 'Cancel retains the file');
        await page.waitForTimeout(300);
        await dock.getByRole('button', { name: '删除所选内容' }).click();
        await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.afp-media').count(), 0, 'Confirmed delete affects only local state');
        await page.waitForTimeout(300);
        await dock.getByRole('button', { name: '完成选择', exact: true }).click();
        await page.waitForTimeout(700);
        await plus.click();
        await page.getByRole('dialog', { name: '上传照片或视频' }).waitFor();
        await page.getByLabel('选择照片和视频', { exact: true }).setInputFiles([
          { name: 'one.png', mimeType: 'image/png', buffer: fs.readFileSync(path.resolve(__dirname, '../public/favicon.png')) },
          { name: 'two.png', mimeType: 'image/png', buffer: fs.readFileSync(path.resolve(__dirname, '../public/favicon.png')) },
        ]);
        await page.getByRole('button', { name: '添加到相册', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.afp-media').count(), 2, 'Local upload preview is functional');
        await page.waitForTimeout(300);
        await dock.getByRole('button', { name: '选择', exact: true }).click();
        await page.getByRole('checkbox', { name: '选择文件 one.png' }).check();
        await page.getByRole('checkbox', { name: '选择文件 two.png' }).check();
        assert(await dock.getByRole('button', { name: '完成选择，已选 2 项' }).isVisible());
        // Rapid reversal should not leave a duplicate surface or stale selection.
        await dock.getByRole('button', { name: /完成选择/ }).click();
        await dock.getByRole('button', { name: '选择', exact: true }).click();
        await dock.getByRole('button', { name: '完成选择', exact: true }).click();
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.album-dock-morph-surface').count(), 1);
        assert.equal(await dock.getByRole('button').count(), 3);
        assert.equal(await page.getByRole('checkbox').count(), 0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await dock.getByRole('button', { name: '选择', exact: true }).click();
        assert.equal(await dock.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
        await assertDockLayout(dock, width);
        await page.getByRole('button', { name: '小组空间', exact: true }).click();
        assert(await page.getByRole('button', { name: '新建相册', exact: true }).isVisible());
        assert.equal(await dock.getByRole('button').count(), 2, 'Workspace also removes functions');
        assert.deepEqual(blocked, [], 'No API or remote data was accessed');
        assert.deepEqual(errors, []);
        results.push({ width, dark, middle, idle, expanded });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'adaptive-results.json'), JSON.stringify(results, null, 2));
  console.log(`Passed ${results.length} responsive/theme cases, animation, local upload, selection, delete confirmation and reduced motion.`);
}

async function assertDockLayout(dock, width) {
  const result = await dock.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom, viewportHeight: window.innerHeight,
      buttons: [...el.querySelectorAll('button')].filter(button => getComputedStyle(button).visibility !== 'hidden').map(button => {
        const r = button.getBoundingClientRect();
        return { width: r.width, height: r.height, clickable: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
  });
  assert(result.left >= 0 && result.right <= width && result.bottom <= result.viewportHeight, 'Dock stays within viewport');
  assert(result.buttons.every(button => button.width >= 44 && button.height >= 44 && button.clickable), 'All actions are large enough and unobstructed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
