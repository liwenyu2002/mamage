const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { scanPhotoPlus } = require('../lib/external_gallery_scan');

const origin = 'https://live.photoplus.cn';
const activity = '12345000';
const source = `${origin}/live/pc/${activity}/#/live`;
const counts = [100, 100, 44];

function galleryHtml(nested) {
  return `<!doctype html>
    <h1>Fixture gallery</h1>
    <div class="photo-content container" style="${nested ? 'height: 600px; overflow-y: auto' : ''}"></div>
    <script>
      const gallery = document.querySelector('.photo-content');
      const scroller = ${nested ? 'gallery' : 'document.scrollingElement'};
      let page = 0, loading = false;
      async function load() {
        if (loading || page >= ${counts.length}) return;
        loading = true;
        await (await fetch('/pic/list?fixturePage=' + page)).json();
        const content = document.createElement('section');
        content.style.height = '4280px';
        gallery.append(content);
        page++;
        loading = false;
      }
      ${nested ? 'gallery' : 'window'}.addEventListener('scroll', () => {
        if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 150) void load();
      });
      void load();
    </script>`;
}

function installViewerFixture(t, nested) {
  const requested = [];
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, 'launch', async (options) => {
    const browser = await launch(options);
    return {
      close: () => browser.close(),
      async newContext(contextOptions) {
        const context = await browser.newContext(contextOptions);
        return {
          close: () => context.close(),
          route: (...args) => context.route(...args),
          async newPage() {
            const page = await context.newPage();
            await page.route('**/*', async (route) => {
              const url = new URL(route.request().url());
              assert.equal(url.origin, origin);
              if (url.pathname === `/live/pc/${activity}/`) {
                return route.fulfill({ contentType: 'text/html', body: galleryHtml(nested) });
              }
              if (url.pathname !== '/pic/list') return route.abort();
              const index = Number(url.searchParams.get('fixturePage'));
              requested.push(index);
              if (index === 2 && !nested) await new Promise(resolve => setTimeout(resolve, 2300));
              const entries = Array.from({ length: counts[index] }, (_, i) => ({
                id: 100000 + 100 * index + i,
                activity_no: activity,
                watermark_origin_img: `https://pb.plusx.cn/fixture-${index}-${i}.jpg`,
              }));
              return route.fulfill({ json: { result: { pics_array: entries, pics_total: 244 } } });
            });
            return page;
          },
        };
      },
    };
  });
  return requested;
}

for (const nested of [false, true]) {
  test(`PhotoPlus reads all 244 photos when ${nested ? 'the gallery' : 'the document'} scrolls`, async (t) => {
    const requested = installViewerFixture(t, nested);
    const batches = [];
    const result = await scanPhotoPlus(source, { timeoutMs: 18000, onBatch: batch => batches.push(batch) });
    assert.deepEqual(requested, [0, 1, 2]);
    assert.deepEqual(batches.map(batch => batch.length), counts);
    assert.equal(new Set(batches.flat().map(photo => photo.id)).size, 244);
    assert.equal(result.scannedCount, 244);
    assert.equal(result.reportedTotal, 244);
    assert.equal(result.complete, true);
    assert.equal(result.quality, 'watermarked_original_view');
  });
}
