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
  if (!process.argv[2]) throw Error('Pass a local original image and optional test face-box JSON');
  const faces = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [];
  const fixture = await createTonePreview({ sourcePath: process.argv[2], faces });
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch();
  const output = path.resolve(__dirname, '../../../.local/tone-qa'); fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base + '/?projectId=9001&photoId=11');
    const panel = page.getByRole('region', { name: '照片调色', exact: true });
    const canvas = page.locator('.viewer-slide.is-active .viewer-adjusted-canvas');
    const started = Date.now();
    await page.getByRole('button', { name: '调色', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey, null, { timeout: 60000 });
    const openingMs = Date.now() - started;
    assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [fixture.working.width, fixture.working.height]);
    await page.evaluate(() => {
      window.testFrameGap = 0;
      let previous = performance.now();
      const tick = now => { window.testFrameGap = Math.max(window.testFrameGap, now - previous); previous = now; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const editStart = Date.now();
    await panel.getByRole('spinbutton', { name: '曝光数值' }).fill('0.4');
    await panel.getByRole('spinbutton', { name: '曝光数值' }).blur();
    await page.waitForFunction(key => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey === key,
      tone.getToneAdjustmentKey({ ...tone.DEFAULT_PHOTO_ADJUSTMENTS, exposure: .4 }), { timeout: 60000 });
    const editMs = Date.now() - editStart, workerMs = await canvas.evaluate(el => Number(el.dataset.toneDuration));
    const frameGapMs = await page.evaluate(() => window.testFrameGap);
    const autoStart = Date.now();
    await panel.getByRole('button', { name: '自动明暗', exact: true }).click();
    const auto = await panel.locator('.tone-number').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [input.id.replace('tone-value-', ''), Number(input.value)])));
    await page.waitForFunction(key => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey === key,
      tone.getToneAdjustmentKey(auto), { timeout: 60000 });
    const autoMs = Date.now() - autoStart;
    await panel.getByRole('button', { name: '双图对比', exact: true }).click();
    await page.locator('.tone-photo-stage').evaluate(async stage => {
      await Promise.all(stage.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: path.join(output, 'original-full-auto.png') });
    const saveStart = Date.now();
    if (await panel.getByRole('button', { name: '保存', exact: true }).isEnabled()) {
      await panel.getByRole('button', { name: '保存', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.tone-editor-head span')?.textContent === '已保存', null, { timeout: 60000 });
      const saved = fixture.photos[0].adjustments;
      const meta = await sharp(fixture.objects.get(saved.baked.url)).metadata();
      assert.equal(meta.width, fixture.working.width); assert.equal(meta.height, fixture.working.height); assert.ok(meta.icc);
    }
    const result = { sourceDimensions: [fixture.working.width, fixture.working.height], openingMs, editMs,
      workerMs, frameGapMs, autoMs, auto, saveMs: Date.now() - saveStart,
      sourceRequests: fixture.stats.sourceRequests, browserErrors: errors };
    assert.equal(fixture.stats.sourceRequests, 1); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'original-full-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); await new Promise(resolve => fixture.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
