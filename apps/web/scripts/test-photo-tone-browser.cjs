const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const tone = require('../../server/lib/photo_tone/engine.mjs');
const { createTonePreview } = require('./serve-photo-tone.cjs');

(async () => {
  let sourceBuffer;
  if (!process.env.MAMAGE_TONE_TEST_PHOTO) {
    const pixels = Buffer.alloc(900 * 600 * 3);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 900; x++) {
      const i = (y * 900 + x) * 3;
      pixels[i] = x * 255 / 899; pixels[i + 1] = y * 255 / 599; pixels[i + 2] = (x + y) * 255 / 1498;
    }
    sourceBuffer = await sharp(pixels, { raw: { width: 900, height: 600, channels: 3 } }).png().toBuffer();
  }
  // Explicit test geometry, not a new model inference or production face record.
  const faces = [{ left: 0.43, top: 0.34, width: 0.23, height: 0.18, normalized: true, score: 0.99 }];
  const fixture = await createTonePreview({ sourcePath: process.env.MAMAGE_TONE_TEST_PHOTO, sourceBuffer, faces, faceDelay: 100 });
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch();
  const output = path.resolve(__dirname, '../../../.local/tone-qa'); fs.mkdirSync(output, { recursive: true });
  const results = [];
  try {
    for (const [width, height, dark] of [[1440, 960, false], [390, 844, true], [320, 640, false]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700, acceptDownloads: true });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        await context.addInitScript(dark => localStorage.setItem('mamage-viewer-appearance', JSON.stringify({ dark, blur: 20 })), dark);
        fixture.photos[0].adjustments = null;
        const before = { ...fixture.stats }, errors = [], page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=9001&photoId=11');
        await page.locator('.viewer-overlay.is-open').waitFor();
        await page.getByRole('button', { name: '调色', exact: true }).click();
        const panel = page.getByRole('region', { name: '照片调色', exact: true });
        const canvas = page.locator('.viewer-slide.is-active canvas');
        const waitTone = async values => {
          const key = tone.getToneAdjustmentKey({ ...tone.DEFAULT_PHOTO_ADJUSTMENTS, ...values });
          await page.waitForFunction(key => document.querySelector('.viewer-slide.is-active canvas')?.dataset.toneKey === key, key);
        };
        const waitView = mode => page.waitForFunction(mode => document.querySelector('.viewer-slide.is-active canvas')?.dataset.toneView === mode, mode);
        await waitTone({});
        await panel.getByText('人脸优先 · 1 人', { exact: true }).waitFor();
        await panel.getByRole('spinbutton', { name: '曝光数值' }).focus();
        await panel.getByRole('spinbutton', { name: '曝光数值' }).blur();
        assert.equal(await panel.getByRole('button', { name: '撤销调色' }).isDisabled(), true, 'Focus alone does not consume an undo entry');
        const readPixels = () => canvas.evaluate(el => Array.from(el.getContext('2d').getImageData(0, 0, el.width, el.height).data).filter((_, i) => i % 1009 === 0));
        const neutral = await readPixels();
        const values = { exposure: 0.7, highlights: -35, shadows: 40, temperature: 15, vibrance: 20, skinSaturation: -25, skinBrightness: 30 };
        for (const [label, value] of [['曝光', 0.7], ['高光', -35], ['阴影', 40], ['色温', 15], ['自然饱和度', 20], ['肤色饱和度', -25], ['肤色亮度', 30]]) {
          await panel.getByRole('spinbutton', { name: label + '数值', exact: true }).fill(String(value));
          await panel.getByRole('spinbutton', { name: label + '数值', exact: true }).blur();
        }
        await waitTone(values);
        assert.equal(fixture.stats.sourceRequests - before.sourceRequests, 1, 'Slider changes reuse one source');
        assert.equal(fixture.stats.renders - before.renders, 0, 'Sliders never call server-rendered previews');
        const decoded = await sharp(fixture.working.buffer).ensureAlpha().raw().toBuffer();
        const expected = Array.from(tone.processTonePixels(decoded, { ...tone.DEFAULT_PHOTO_ADJUSTMENTS, ...values })).filter((_, i) => i % 1009 === 0);
        const actual = await readPixels();
        assert.equal(actual.length, expected.length);
        const maxPixelError = Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
        assert.ok(maxPixelError <= 1, `Browser/server RGB mismatch: ${maxPixelError}`);
        const renderMs = Number(await canvas.getAttribute('data-tone-duration'));
        assert.ok(renderMs < 700, 'Preview regression exceeds 700ms on this runner');
        await panel.getByRole('button', { name: '原图', exact: true }).click(); await waitView('original');
        assert.deepEqual(await readPixels(), neutral, 'Compare uses the untouched working image');
        await panel.getByRole('button', { name: '调整后', exact: true }).click(); await waitView('adjusted');
        const hold = panel.getByRole('button', { name: '按住看原图', exact: true });
        await hold.scrollIntoViewIfNeeded();
        const holdBox = await hold.boundingBox();
        await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
        await page.mouse.down(); await waitView('original');
        assert.deepEqual(await readPixels(), neutral);
        await page.mouse.move(0, 0); await page.mouse.up(); await waitView('adjusted');
        assert.deepEqual(await readPixels(), actual, 'Release outside the button restores the draft');
        await hold.focus(); await page.keyboard.down(' '); await waitView('original');
        await page.keyboard.up(' '); await waitView('adjusted');
        await page.keyboard.down('Enter'); await waitView('original');
        await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await waitView('adjusted');
        await page.keyboard.up('Enter');
        if (width < 700) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: holdBox.x + holdBox.width / 2, y: holdBox.y + holdBox.height / 2 }] });
          await waitView('original');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
          await waitView('adjusted'); await cdp.detach();
        }
        await panel.getByRole('button', { name: '划线对比', exact: true }).click(); await waitView('split');
        const split = page.getByRole('slider', { name: '前后对比分界线', exact: true });
        const assertSplit = async percent => {
          await page.waitForFunction(p => Math.abs(Number(document.querySelector('.viewer-slide.is-active canvas')?.dataset.toneSplit) - p) < 1, percent);
          const composite = await readPixels(), size = await canvas.evaluate(el => ({ width: el.width, height: el.height }));
          const exactPercent = Number(await canvas.getAttribute('data-tone-split'));
          const expectedComposite = actual.map((value, index) => Math.floor(index * 1009 / 4) % size.width < Math.round(size.width * exactPercent / 100) ? neutral[index] : value);
          assert.deepEqual(composite, expectedComposite, 'Split is pixel-aligned original left / edited right');
        };
        await assertSplit(50);
        await split.focus(); await page.keyboard.press('ArrowRight'); await assertSplit(55);
        await page.keyboard.press('Home'); await assertSplit(0);
        await page.keyboard.press('End'); await assertSplit(100);
        await page.keyboard.press('Home');
        for (let n = 0; n < 10; n++) await page.keyboard.press('ArrowRight');
        await assertSplit(50);
        const imageBox = await canvas.boundingBox(), handleBox = await split.boundingBox();
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        const targetX = Math.round(imageBox.x + imageBox.width * 0.7);
        await page.mouse.move(targetX, handleBox.y + handleBox.height / 2, { steps: 8 }); await page.mouse.up();
        const draggedPercent = (targetX - imageBox.x) / imageBox.width * 100;
        await assertSplit(draggedPercent);
        if (width < 700) {
          const cdp = await context.newCDPSession(page), grip = await split.boundingBox();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: imageBox.x + imageBox.width * 0.3, y: grip.y + grip.height / 2 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await assertSplit(30); await cdp.detach();
        }
        assert.equal(await page.locator('.viewer-slide.is-active img[alt="viewer-0"]').count(), 1, 'Divider drag must not swipe to another photo');
        await page.screenshot({ path: path.join(output, `compare-${width}.png`), animations: 'disabled' });
        await hold.focus(); await page.keyboard.down(' '); await waitView('original');
        await page.keyboard.up(' '); await waitView('split');
        await assertSplit(width < 700 ? 30 : draggedPercent);
        assert.equal(await panel.getByRole('spinbutton', { name: '曝光数值' }).inputValue(), '0.7', 'Comparison never changes adjustments');
        assert.equal(fixture.stats.saves - before.saves, 0, 'Comparison never saves');
        assert.equal(fixture.stats.faceRequests - before.faceRequests, 1, 'Existing face detections are read only once');
        await panel.getByRole('button', { name: '调整后', exact: true }).click(); await waitView('adjusted');
        const exposure = panel.getByRole('slider', { name: '曝光 EV', exact: true });
        await exposure.focus();
        await page.keyboard.down('ArrowRight');
        await page.keyboard.down('ArrowRight');
        await page.keyboard.down('ArrowRight');
        await page.keyboard.up('ArrowRight');
        await waitTone({ ...values, exposure: 0.85 });
        await panel.getByRole('button', { name: '撤销调色' }).click(); await waitTone(values);
        assert.equal(fixture.stats.sourceRequests - before.sourceRequests, 1, 'Burst edits reuse the decoded source');
        await panel.getByRole('button', { name: '撤销调色' }).click(); await waitTone({ ...values, skinBrightness: 0 });
        await panel.getByRole('button', { name: '重做调色' }).click(); await waitTone(values);
        await panel.getByRole('button', { name: '重置', exact: true }).click(); await waitTone({});
        assert.deepEqual(await readPixels(), neutral);
        await panel.getByRole('button', { name: '撤销调色' }).click(); await waitTone(values);
        await panel.getByRole('button', { name: '自动明暗', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.tone-editor-footer button')?.disabled);
        const autoValues = {};
        for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation', 'skinSaturation', 'skinBrightness']) {
          autoValues[key] = Number(await panel.locator(`#tone-value-${key}`).inputValue());
        }
        assert.ok(autoValues.exposure >= 0, 'Auto should not globally darken this source');
        assert.equal(autoValues.temperature, values.temperature);
        assert.equal(autoValues.vibrance, values.vibrance);
        assert.equal(autoValues.skinSaturation, values.skinSaturation);
        assert.equal(autoValues.skinBrightness, values.skinBrightness);
        const firstAuto = await readPixels();
        await panel.getByRole('button', { name: '自动明暗', exact: true }).click(); await waitTone(autoValues);
        assert.deepEqual(await readPixels(), firstAuto, 'Auto is source-relative, not cumulative');
        await panel.getByRole('button', { name: '撤销调色' }).click(); await waitTone(values);
        await panel.getByRole('button', { name: '保存', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.tone-editor-head span')?.textContent === '已保存');
        assert.equal(fixture.photos[0].adjustments.version, 3); assert.equal(fixture.photos[0].adjustments.exposure, 0.7);
        assert.equal(fixture.photos[0].adjustments.skinBrightness, 30);
        assert.equal(fixture.photos[0].adjustments.skinSaturation, -25);
        await panel.getByRole('slider', { name: '肤色亮度', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `skin-${width}.png`), animations: 'disabled' });
        await panel.locator('.tone-editor-body').evaluate(el => { el.scrollTop = 0; });
        await page.waitForTimeout(550);
        const bounds = await panel.evaluate(el => {
          const r = el.getBoundingClientRect(), footer = el.querySelector('footer').getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scroll: el.scrollWidth - el.clientWidth, footerBottom: footer.bottom };
        });
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width + 1 && bounds.bottom <= height + 1 && bounds.scroll <= 1, JSON.stringify(bounds));
        assert.ok(bounds.footerBottom <= bounds.bottom + 1, 'Save footer stays reachable');
        const exposureVisible = await panel.locator('#tone-exposure').evaluate(el => {
          const r = el.getBoundingClientRect(), body = el.closest('.tone-editor-body').getBoundingClientRect();
          return r.top >= body.top && r.bottom <= body.bottom;
        });
        assert.ok(exposureVisible, `Exposure is visible without scrolling at ${width}x${height}`);
        await page.screenshot({ path: path.join(output, `tone-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
        if (width === 1440) {
          await panel.getByRole('spinbutton', { name: '曝光数值' }).fill('1');
          await waitTone({ ...values, exposure: 1 });
          const downloadEvent = page.waitForEvent('download');
          await page.getByRole('button', { name: '下载', exact: true }).click();
          const download = await downloadEvent; await download.saveAs(path.join(output, 'current-adjustment.jpg'));
          assert.ok((await sharp(path.join(output, 'current-adjustment.jpg')).metadata()).icc);
          assert.equal(fixture.photos[0].adjustments.exposure, 0.7, 'Downloading a draft does not silently save it');
          await page.reload();
          await page.locator('.detail-photo-item[data-photo-id="11"] img[alt="调色本地测试-0"]').click();
          await page.getByRole('button', { name: '调色', exact: true }).click();
          await waitTone(values);
          assert.equal(await panel.getByRole('spinbutton', { name: '曝光数值' }).inputValue(), '0.7', 'Saved parameters survive a reload');
          assert.equal(await panel.getByRole('spinbutton', { name: '肤色亮度数值' }).inputValue(), '30');
          assert.equal(await panel.getByRole('spinbutton', { name: '肤色饱和度数值' }).inputValue(), '-25');
          await page.goto(base + '/?projectId=9001&photoId=12');
          await page.getByRole('button', { name: '调色', exact: true }).click(); await waitTone({});
          await panel.getByText('全图测光', { exact: true }).waitFor();
          assert.deepEqual(await readPixels(), neutral, 'Old saved looks return to the original');
        }
        assert.deepEqual(errors, []);
        results.push({ width, height, dark, renderMs, maxPixelError, browserErrors: errors.length });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); await new Promise(resolve => fixture.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
