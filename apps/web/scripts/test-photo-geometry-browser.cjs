const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const tone = require('../../server/lib/photo_tone/engine.mjs');
const geometry = require('../../server/lib/photo_tone/geometry.mjs');
const { createTonePreview } = require('./serve-photo-tone.cjs');

(async () => {
  const width = 1500, height = 1000, pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    pixels[i] = x * 240 / width; pixels[i + 1] = y * 240 / height; pixels[i + 2] = 60;
  }
  const sourceBuffer = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const fixture = await createTonePreview({ sourceBuffer });
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch();
  const output = path.resolve(__dirname, '../../../.local/tone-qa'); fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
      fixture.photos[0].adjustments = null;
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 700 });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(base + '/?projectId=9001&photoId=11');
        await page.getByRole('button', { name: '调色', exact: true }).click();
        const panel = page.getByRole('region', { name: '照片调色', exact: true });
        const canvas = page.locator('.viewer-slide.is-active .viewer-adjusted-canvas');
        await page.waitForFunction(() => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey);
        assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [width, height], 'Editing starts from the full original, not a preview');
        await panel.getByRole('spinbutton', { name: '曝光数值' }).fill('0.4');
        await panel.getByRole('spinbutton', { name: '曝光数值' }).blur();
        await page.waitForFunction(key => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey === key,
          tone.getToneAdjustmentKey({ ...tone.DEFAULT_PHOTO_ADJUSTMENTS, exposure: 0.4 }));
        await panel.getByRole('tab', { name: '裁切与旋转' }).click();
        await panel.getByRole('button', { name: '向右旋转 90 度' }).click();
        await page.waitForFunction(() => document.querySelector('.viewer-adjusted-canvas')?.width === 1000);
        await panel.getByRole('button', { name: '1:1', exact: true }).click();
        const selection = page.locator('.ReactCrop__crop-selection');
        await selection.waitFor();
        const start = await selection.boundingBox();
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down(); await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 15, { steps: 4 }); await page.mouse.up();
        assert.equal(await page.locator('.viewer-slide.is-active img[alt="viewer-0"]').count(), 1, 'Crop drags must not change photo');
        const angle = panel.getByRole('spinbutton', { name: '旋转角度数值' });
        await angle.fill('12.5'); await angle.blur();
        await panel.getByRole('button', { name: '4:3', exact: true }).click();
        await page.screenshot({ path: path.join(output, `crop-${viewport.width}.png`), animations: 'disabled' });
        const bounds = await canvas.boundingBox(), panelBounds = await panel.boundingBox();
        assert.ok(bounds.width > 20 && bounds.height > 20 && bounds.x >= -1 && bounds.y >= -1);
        if (viewport.width < 700) assert.ok(bounds.y + bounds.height <= panelBounds.y + 1, 'Crop canvas never hides under the editor');
        await panel.getByRole('button', { name: '保存', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.tone-editor-head span')?.textContent === '已保存');
        const saved = fixture.photos[0].adjustments;
        assert.equal(saved.rotation, 12.5); assert.equal(saved.exposure, 0.4);
        const rotated = geometry.rotatedSize(width, height, 12.5);
        const expected = geometry.cropPixels(rotated.width, rotated.height, saved.crop);
        const meta = await sharp(fixture.objects.get(saved.baked.url)).metadata();
        assert.equal(meta.width, expected.width); assert.equal(meta.height, expected.height); assert.ok(meta.icc);
        assert.ok(Math.abs(meta.width / meta.height - 4 / 3) < 0.002);
        await panel.getByRole('tab', { name: '调色', exact: true }).click();
        assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [expected.width, expected.height]);
        await panel.getByRole('button', { name: '关闭调色', exact: true }).click();
        await page.waitForFunction(size => [...document.querySelectorAll('.viewer-slide.is-active img')].some(el => el.naturalWidth === size[0] && el.naturalHeight === size[1]), [expected.width, expected.height]);
        await page.getByRole('button', { name: '调色', exact: true }).click();
        await panel.getByText(`原图 ${width} × ${height}`, { exact: false }).waitFor();
        await panel.getByRole('tab', { name: '裁切与旋转' }).click();
        await angle.fill('0'); await angle.blur();
        await panel.getByRole('button', { name: '自由', exact: true }).click();
        await panel.getByRole('button', { name: '还原裁切', exact: true }).click();
        await panel.getByRole('tab', { name: '调色', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.viewer-adjusted-canvas')?.width === 1500);
        assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [width, height], 'Re-editing recovers pixels outside the previous crop');
        assert.equal(fixture.original.equals(sourceBuffer), true);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ viewport, original: [width, height], saved: [meta.width, meta.height], reeditRecovered: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => fixture.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
