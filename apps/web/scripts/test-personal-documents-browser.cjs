const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const { PDFDocument, PDFName, PDFRawStream, PDFArray } = require('pdf-lib');
const JSZip = require('jszip');
const { createPersonalPreview } = require('./serve-personal-workspace.cjs');
const directory = path.resolve(__dirname, '../../../.local/personal-documents-qa');

async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function download(page, label, name) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const value = await promise, file = path.join(directory, name);
  await value.saveAs(file); assert.equal(await value.failure(), null); return file;
}
async function pixel(file, x, y) {
  return Array.from(await sharp(file).removeAlpha().extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer());
}
async function draw(page, from, to, touch) {
  const canvas = page.getByRole('img', { name: '图片标注画布', exact: true });
  await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  const start = { x: box.x + box.width * from[0], y: box.y + box.height * from[1] };
  const end = { x: box.x + box.width * to[0], y: box.y + box.height * to[1] };
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up(); }
}
async function checkPdf(file, prefix, imageMode = false) {
  const document = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false }), pages = document.getPages();
  assert.equal(pages.length, 2); assert.equal(document.getCreator(), 'MaMage');
  assert.equal(document.catalog.get(PDFName.of('AcroForm')), undefined);
  assert.equal(document.catalog.get(PDFName.of('Names')), undefined, 'No embedded files or named actions');
  assert.equal(document.catalog.get(PDFName.of('OCProperties')), undefined, 'No removable optional layers');
  const images = document.context.enumerateIndirectObjects().map(([, object]) => object)
    .filter(object => object instanceof PDFRawStream && String(object.dict.get(PDFName.of('Subtype'))) === '/Image');
  assert.equal(images.length, 2, 'One flattened image per page; no source, thumbnails or soft-mask copies');
  for (const image of images) assert.equal(image.dict.get(PDFName.of('SMask')), undefined);
  for (const page of pages) {
    assert.equal(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() || 0, 0);
    if (!imageMode) { assert.ok(Math.abs(page.getWidth() - 595.276) < 0.01); assert.ok(Math.abs(page.getHeight() - 841.89) < 0.01); }
  }
  execFileSync('pdfimages', ['-png', file, prefix]);
  assert.deepEqual(await pixel(prefix + '-001.png', 480, 320), [0, 0, 0], 'The embedded raster itself is redacted');
  assert.deepEqual(await pixel(prefix + '-000.png', 400, 600), [40, 100, 190], 'Reordering applies to the actual exported page sequence');
  execFileSync('pdftoppm', ['-f', '2', '-singlefile', '-scale-to', '1100', '-png', file, prefix + '-page']);
  return { pages: pages.length, embeddedImages: images.length, pageSizes: pages.map(page => [page.getWidth(), page.getHeight()]) };
}

(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const preview = await createPersonalPreview(), context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 1000 }, hasTouch: width < 700 });
      const errors = [], leaked = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['blob:', 'data:'].includes(url.protocol) || preview.urls.includes(url.origin)) return route.continue();
        leaked.push(url.origin + url.pathname); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(preview.urls[0] + '/personal');
        await page.getByRole('button', { name: '暂不加入，使用个人工具', exact: true }).click();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f3f6fa"/><rect x="300" y="220" width="360" height="230" fill="#efc44e"/><text x="320" y="320" font-size="32">SECRET 5511</text><rect x="15" y="650" width="160" height="130" fill="#23805f"/></svg>`;
        const source = await sharp(Buffer.from(svg)).withMetadata({ exif: { IFD0: { ImageDescription: 'private-original-do-not-embed' } } }).png().toBuffer();
        const second = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#2864be' } }).png().toBuffer();
        await page.getByLabel('选择本地图片', { exact: true }).setInputFiles([{ name: '01-source.png', mimeType: 'image/png', buffer: source }, { name: '02-portrait.png', mimeType: 'image/png', buffer: second }]);
        await page.getByRole('tab', { name: '标注遮挡', exact: true }).click();
        await page.locator('.personal-markup-stage[data-ready=true]').waitFor();
        const counts = page.getByRole('complementary', { name: '标注工具', exact: true }).locator('dd');
        await draw(page, [.08, .08], [.85, .85], width < 700);
        await page.waitForFunction(() => document.querySelector('.personal-markup-options dd')?.textContent === '1 处');
        await page.getByRole('button', { name: '选择标注', exact: true }).click();
        await draw(page, [.4, .7], [.4, .7], width < 700);
        await draw(page, [.85, .85], [.9, .9], width < 700);
        await page.getByRole('button', { name: '撤销标注', exact: true }).click(); assert.equal(await counts.nth(0).innerText(), '1 处', 'Resizing creates exactly one undo step');
        await page.getByRole('button', { name: '撤销标注', exact: true }).click(); assert.equal(await counts.nth(0).innerText(), '0 处');
        await page.getByRole('button', { name: '重做标注', exact: true }).click(); assert.equal(await counts.nth(0).innerText(), '1 处');
        await page.getByRole('button', { name: '箭头标注', exact: true }).click();
        await page.getByRole('button', { name: '蓝色', exact: true }).click();
        await draw(page, [.1, .8], [.23, .6], width < 700);
        await page.getByRole('button', { name: '隐私遮挡', exact: true }).click();
        await draw(page, [.24, .24], [.68, .64], width < 700);
        assert.equal(await counts.nth(1).innerText(), '1 处');
        await page.getByRole('button', { name: '文字标注', exact: true }).click();
        await page.getByLabel('标注文字', { exact: true }).fill('PRIVATE-SHOULD-BE-MASKED');
        await draw(page, [.35, .4], [.35, .4], width < 700);
        assert.equal(await counts.nth(0).innerText(), '3 处');
        const thumbnail = page.locator('.personal-file-pick img[data-flattened=true]');
        await thumbnail.waitFor();
        assert.deepEqual(await thumbnail.evaluate(async image => {
          await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return Array.from(context.getImageData(Math.round(canvas.width * .4), Math.round(canvas.height * .4), 1, 1).data).slice(0, 3);
        }), [0, 0, 0], 'Private thumbnails must not show the original pixels');
        const png = await download(page, '下载图片', `marked-${width}.png`);
        assert.deepEqual(await pixel(png, 480, 320), [0, 0, 0]);
        const metadata = await sharp(png).metadata(); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
        await page.screenshot({ path: path.join(directory, `markup-ui-${width}.png`), fullPage: true });

        await page.getByRole('tab', { name: '压缩转图', exact: true }).click();
        await page.getByRole('checkbox', { name: '限制文件大小', exact: true }).uncheck();
        const zip = await JSZip.loadAsync(fs.readFileSync(await download(page, '批量下载 ZIP', `marked-${width}.zip`)));
        const image = await Object.values(zip.files).filter(item => !item.dir)[0].async('nodebuffer');
        assert.deepEqual(await pixel(image, 480, 320), [0, 0, 0], 'ZIP must retain the redaction');

        await page.getByRole('button', { name: '后移 01-source.png', exact: true }).click();
        await page.getByRole('tab', { name: '图片转 PDF', exact: true }).click();
        await page.getByLabel('PDF 文件名称', { exact: true }).fill('课题组汇报');
        await page.getByRole('group', { name: '页面方向', exact: true }).getByRole('button', { name: '纵向', exact: true }).click();
        await page.locator('.personal-pdf-page[data-ready]').waitFor();
        const pdf = await download(page, '下载 PDF', `pages-${width}.pdf`);
        const documentCheck = await checkPdf(pdf, path.join(directory, `extracted-${width}`));
        await page.screenshot({ path: path.join(directory, `pdf-ui-${width}.png`), fullPage: true });
        await choose(page, '纸张', '随图片比例');
        await page.getByLabel('PDF 页边距（mm）', { exact: true }).fill('0');
        const fitted = await download(page, '下载 PDF', `fitted-${width}.pdf`);
        const fittedCheck = await checkPdf(fitted, path.join(directory, `fitted-${width}`), true);
        assert.deepEqual(fittedCheck.pageSizes, [[600, 900], [900, 600]]);

        await page.getByRole('tab', { name: '组图拼版', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.personal-collage-canvas')?.width === 2400 && !document.querySelector('.personal-canvas-progress'));
        const collage = await download(page, '下载组图', `marked-collage-${width}.png`);
        assert.deepEqual(await pixel(collage, 1661, 379), [0, 0, 0], 'Collage must retain the redaction');

        await page.getByRole('tab', { name: '原图编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.viewer-adjusted-canvas')?.dataset.toneKey);
        await page.getByRole('tab', { name: '裁切与旋转', exact: true }).click();
        await page.getByRole('button', { name: '向右旋转 90 度', exact: true }).click();
        await page.getByRole('button', { name: '1:1', exact: true }).click();
        const rotated = await download(page, '下载图片', `rotated-mask-${width}.png`);
        const rotatedMeta = await sharp(rotated).metadata(); assert.deepEqual([rotatedMeta.width, rotatedMeta.height], [800, 800]);
        assert.deepEqual(await pixel(rotated, 480, 280), [0, 0, 0], 'Crop and rotation must not move the mask off the private pixels');
        if (width === 1440) {
          await page.getByRole('button', { name: '移除 01-source.png', exact: true }).click();
          await page.getByRole('button', { name: '移除 02-portrait.png', exact: true }).click();
          await page.getByRole('tab', { name: '图片转 PDF', exact: true }).click();
          const small = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#237f60' } }).png().toBuffer();
          await page.getByLabel('选择本地图片', { exact: true }).setInputFiles(Array.from({ length: 20 }, (_, index) => ({ name: `page-${index + 1}.png`, mimeType: 'image/png', buffer: small })));
          await choose(page, '纸张', 'A4');
          await page.getByLabel('PDF 页边距（mm）', { exact: true }).fill('31');
          await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
          await page.getByRole('alert').filter({ hasText: 'PDF 页面参数无效' }).first().waitFor();
          await page.getByLabel('PDF 页边距（mm）', { exact: true }).fill('10');
          const twenty = await download(page, '下载 PDF', 'twenty-pages.pdf');
          assert.equal((await PDFDocument.load(fs.readFileSync(twenty), { updateMetadata: false })).getPageCount(), 20);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const uploads = preview.stats.requests.filter(request => !['GET', 'HEAD'].includes(request.method) && !request.path.startsWith('/api/users/workspace-join/'));
        assert.deepEqual(uploads, []); assert.deepEqual(errors, []); assert.deepEqual(leaked, []);
        console.log(JSON.stringify({ width, touch: width < 700, annotations: 3, opaqueMasks: 1, pngMetadataStripped: true, maskInZipAndCollage: true, maskFollowsRotationAndCrop: true,
          pdf: documentCheck, imageSizedPdf: fittedCheck.pageSizes, twentyPageBoundary: width === 1440 ? true : undefined, privateThumbnail: true,
          sourceImagesEmbedded: 0, imageUploads: uploads.length, externalRequests: leaked.length }));
      } catch (error) {
        await page.screenshot({ path: path.join(directory, `failure-${width}.png`), fullPage: true }).catch(() => {});
        console.error(JSON.stringify({ width, errors, leaked, url: page.url() })); throw error;
      } finally { await context.close(); await preview.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
