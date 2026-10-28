const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const dist = path.resolve(process.env.MAMAGE_SHARE_QA_DIST || path.join(__dirname, '../dist'));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
  const images = {
    '/api/image/original.jpg': await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#547b9e' } }).jpeg().toBuffer(),
    '/api/image/thumb.jpg': await sharp({ create: { width: 160, height: 106, channels: 3, background: '#547b9e' } }).jpeg().toBuffer(),
    '/api/image/public.jpg': await sharp({ create: { width: 1000, height: 666, channels: 3, background: '#547b9e' } }).jpeg().toBuffer(),
  };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (images[pathname]) { res.setHeader('Content-Type', 'image/jpeg'); res.end(images[pathname]); return; }
    const file = path.join(dist, pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, acceptDownloads: true });
      try {
        const requested = [], errors = [], popups = [];
        await context.route('**/api/**', route => {
          const url = new URL(route.request().url()); requested.push(url.pathname);
          if (images[url.pathname]) return route.fulfill({ contentType: 'image/jpeg', body: images[url.pathname] });
          if (url.pathname === '/api/share/test-original') return route.fulfill({ json: { code:'test-original', shareType:'project', title:'测试相册',
            photos:[{id:1,type:'normal',title:'测试照片.jpg',url:'/api/image/original.jpg',thumbUrl:'/api/image/thumb.jpg',publicDownloadUrl:'/api/image/public.jpg'}] } });
          return route.fulfill({ status:404, json:{} });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        page.on('popup', popup => popups.push(popup));
        await page.goto(`http://127.0.0.1:${server.address().port}/share/test-original`);
        const photo = page.getByRole('button', { name:'查看第 1 张照片', exact:true }); await photo.waitFor();
        await photo.locator('img').evaluate(image => image.decode());
        assert.equal(await photo.locator('img').evaluate(image => image.naturalWidth),160);
        assert.equal(requested.includes('/api/image/original.jpg'),false,'loading the gallery never preloads the full image');
        await photo.click();
        const viewer = page.getByRole('dialog', { name:'照片查看器' }), media = viewer.locator('img.sv-media');
        await media.evaluate(image => image.decode());
        assert.equal(await media.evaluate(image => image.naturalWidth),160);
        await viewer.getByRole('button', { name:'原图', exact:true }).click();
        await page.waitForFunction(() => document.querySelector('img.sv-media')?.naturalWidth === 2400);
        assert.equal(await media.evaluate(image => image.naturalHeight),1600);
        const downloadEvent = page.waitForEvent('download');
        await viewer.getByRole('button', { name:'下载', exact:true }).click();
        const download = await downloadEvent, chunks = [];
        for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        assert.equal(digest(Buffer.concat(chunks)),digest(images['/api/image/original.jpg']),'download bytes must match the actual original');
        assert.equal(new URL(download.url()).pathname,'/api/image/original.jpg');
        assert.equal(popups.length,0,'download must not open another window');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({width,thumb:160,original:2400,originalDownload:true,newWindow:false,passed:true}));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
