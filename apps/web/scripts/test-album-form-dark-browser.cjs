const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');

const base = process.env.MAMAGE_ALBUM_FORM_URL || 'http://127.0.0.1:5201';
const output = path.resolve(__dirname, '../test-results/album-form');

async function main() {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const noBackdrop of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { errors.push('Unexpected API request'); return route.abort(); });
      await page.goto(`${base}/__prototype/album-form`);
      await page.getByRole('button', { name: '新建相册', exact: true }).waitFor();
      await page.evaluate(() => document.documentElement.setAttribute('data-glass-theme', 'dark'));
      // Only the fixture canvas is darkened; all tested controls use shipped CSS.
      await page.addStyleTag({ content: '.afp-page, .afp-page .mamage-dynamic-backdrop { background: #1a1c1f; color: var(--glass-ink); }' });
      if (noBackdrop) await page.addStyleTag({ content: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
      const suffix = noBackdrop ? '-no-backdrop' : '';
      assert.equal(await page.locator('.detail-bottom-upload svg').evaluate(el => getComputedStyle(el).color), 'rgb(243, 243, 244)');
      await page.locator('.detail-bottom-nav').screenshot({ path: path.join(output, `notched-dark-390${suffix}.png`) });
      await page.getByRole('button', { name: '新建相册', exact: true }).click();
      await page.waitForTimeout(700);
      await page.getByLabel('相册名称', { exact: false }).fill('秋日校园活动');
      await page.getByRole('button', { name: '补充信息', exact: true }).click();
      await page.getByLabel('相册标签', { exact: false }).fill('校园活动');
      await page.getByLabel('相册标签', { exact: false }).press('Enter');
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.album-tag').evaluate(el => getComputedStyle(el).opacity), '1');
      const tagParts = await page.locator('.album-tag').evaluate(el => [...el.querySelectorAll('span, button, svg')].map(child => ({
        color: getComputedStyle(child).color, opacity: getComputedStyle(child).opacity,
      })));
      for (const part of tagParts) assert.deepEqual(part, { color: 'rgb(243, 243, 244)', opacity: '1' });
      const contrast = await page.locator('.album-form-modal').evaluate(modal => {
        const rgb = value => value.match(/[\d.]+/g).map(Number);
        const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
        const background = element => {
          const values = [];
          for (let el = element; el; el = el.parentElement) values.push(rgb(getComputedStyle(el).backgroundColor));
          return values.reverse().reduce((back, front) => blend(front, back), [26, 28, 31]);
        };
        const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        return ['.mamage-modal-title', '.album-field-label', '.album-field-optional', '.album-field input', '.album-tag > span', '.album-tag button', '.cam-timeline-toggle', '.cam-media-add'].map(selector => {
          const el = modal.querySelector(selector);
          if (!el) throw new Error(`Missing contrast target: ${selector}`);
          const bg = background(el), fg = blend(rgb(getComputedStyle(el).color), bg);
          const a = luminance(fg), b = luminance(bg);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
      });
      for (const result of contrast) assert(result.ratio >= 4.5, `${result.selector}: ${result.ratio}`);
      await page.screenshot({ path: path.join(output, `form-dark-390${suffix}.png`) });
      await page.getByRole('button', { name: '选择活动日期' }).click();
      const calendar = page.locator('.album-form-calendar');
      await calendar.waitFor();
      assert.equal(await calendar.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(26, 28, 31)');
      assert.equal(await calendar.evaluate(el => getComputedStyle(el).color), 'rgb(243, 243, 244)');
      await page.screenshot({ path: path.join(output, `calendar-dark-390${suffix}.png`) });
      await calendar.getByRole('button', { name: '15', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      results.push({ noBackdrop, contrast });
      await page.close();
    }
    fs.writeFileSync(path.join(output, 'dark-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.length, minimumContrast: Math.min(...results.flatMap(result => result.contrast.map(item => item.ratio))) }, null, 2));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
