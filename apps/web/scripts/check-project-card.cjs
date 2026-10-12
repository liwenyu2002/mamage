const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const compile = (file) => babel.transformFileSync(path.join(root, file), {
  presets: [require.resolve('@babel/preset-env'), require.resolve('@babel/preset-react')],
}).code;
const component = compile('src/ProjectCard.jsx');
const icons = compile('src/ui/icons.jsx');
const css = fs.readFileSync(path.join(root, 'src/ProjectCard.css'), 'utf8');
const image = (name) => `https://card.test/${name}.svg`;
const photos = ['a', 'b', 'c', 'd'].map(image);
const fixture = {
  id: 1, title: '2026 秋季开学典礼', count: 268, cover: photos[0], images: photos,
  thumbnails: photos.slice(1), startDate: '2026-10-09', subtitle: '党团与校园活动',
  description: '校园活动纪实', originLabel: '北京中关村学院 / 公关部门',
  importStatus: { status: 'running', scanStatus: 'completed', doneCount: 50, selectedCount: 100 },
};

async function setup(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, ...options });
  page.setDefaultTimeout(8000);
  await page.route('https://card.test/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#94aaa0"/></svg>',
  }));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#eef2f1;font-family:system-ui}</style><div id="root"></div>');
  for (const pkg of ['react', 'react-dom']) {
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd', `${pkg}.development.js`) });
  }
  await page.addStyleTag({ content: css });
  await page.evaluate(({ component, icons }) => {
    const load = (code, modules) => {
      const module = { exports: {} };
      new Function('require', 'module', 'exports', code)((name) => {
        if (!(name in modules)) throw new Error(`Unexpected module ${name}`);
        return modules[name];
      }, module, module.exports);
      return module.exports;
    };
    const counters = window.__counters = { opens: 0, fallbackCalls: [], active: 0, peak: 0 };
    const { default: ProjectCard } = load(component, {
      react: window.React,
      './ProjectCard.css': {},
      './ui/icons': load(icons, { react: window.React }),
      './services/request': { resolveAssetUrl: (src) => src },
      './services/photoQueryService': { fetchRandomByProject: async (id) => {
        counters.fallbackCalls.push(id);
        counters.peak = Math.max(counters.peak, ++counters.active);
        await new Promise((resolve) => setTimeout(resolve, 60));
        counters.active--;
        return { list: ['a', 'b', 'c', 'd'].map((name) => `https://card.test/${name}.svg`) };
      } },
    });
    const root = window.ReactDOM.createRoot(document.getElementById('root'));
    window.__render = (items) => root.render(window.React.createElement('div', { className: 'project-grid' }, items.map((props, index) => (
      window.React.createElement(ProjectCard, { ...props, key: `${props.id}:${index}`, onClick: () => counters.opens++ })
    ))));
  }, { component, icons });
  return page;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const page = await setup(browser);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate((fixture) => window.__render([fixture]), fixture);
    const card = page.locator('.project-card');
    const media = card.locator('.project-card__cover-image');
    const thumbs = card.locator('.project-card__thumb');
    await thumbs.nth(2).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('img')].every((img) => img.complete && img.naturalWidth));
    assert.equal(await media.locator('.is-active').getAttribute('src'), fixture.cover);
    const widths = [1440, 1280, 1024, 820, 600, 390, 320];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1100 });
      const layout = await card.evaluate((element) => {
        const main = element.querySelector('.project-card__cover-image').getBoundingClientRect();
        const previews = element.querySelector('.project-card__thumb-grid').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          below: previews.top >= main.bottom + 3,
          nestedButtons: element.querySelectorAll('button button').length,
          thumbs: [...element.querySelectorAll('.project-card__thumb')].map((el) => el.getBoundingClientRect().height),
          blur: getComputedStyle(element).backdropFilter,
        };
      });
      assert(!layout.overflow && layout.below);
      assert.equal(layout.nestedButtons, 0);
      assert(layout.thumbs.every((height) => height >= 44));
      assert.equal(layout.blur, 'none');
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    const size = await card.boundingBox();
    await thumbs.nth(1).hover();
    assert.equal(await media.getAttribute('data-active-preview'), '2');
    await page.mouse.move(0, 0);
    assert.equal(await media.getAttribute('data-active-preview'), '0');
    await thumbs.nth(2).click();
    await page.mouse.move(0, 0);
    assert.equal(await media.getAttribute('data-active-preview'), '3');
    assert.equal(await page.evaluate(() => window.__counters.opens), 0);
    await card.locator('.project-card__open').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    assert.equal(await media.getAttribute('data-active-preview'), '2');
    await page.keyboard.press('Escape');
    assert.equal(await media.getAttribute('data-active-preview'), '0');
    assert.equal((await card.boundingBox()).height, size.height);
    await card.locator('.project-card__open').click();
    await card.locator('.project-card__copy').click();
    assert.equal(await page.evaluate(() => window.__counters.opens), 2);
    assert.equal(await page.locator('.project-card__origin').innerText(), `来自 ${fixture.originLabel}`);
    assert((await page.locator('.project-card__import').innerText()).includes('50/100'));
    assert.deepEqual(await page.evaluate(() => window.__counters.fallbackCalls), []);
    for (const status of ['paused', 'completed_with_errors', 'cancelled', 'completed']) {
      await page.evaluate(({ fixture, status }) => window.__render([{ ...fixture, importStatus: { status } }]), { fixture, status });
      await page.waitForFunction((status) => status === 'completed'
        ? !document.querySelector('.project-card__import')
        : document.querySelector(`.project-card__import.is-${status}`), status);
    }
    await page.evaluate((image) => window.__render([
      { id: 2, title: '空相册', count: 0, cover: image },
      { id: 3, title: '单张照片', count: 1, cover: image },
    ]), photos[0]);
    await page.locator('.project-card__cover-empty').waitFor();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.project-card__thumb').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__counters.fallbackCalls), []);
    await page.evaluate((cover) => window.__render(Array.from({ length: 7 }, (_, index) => ({
      id: index === 6 ? 10 : 10 + index, title: `Sparse ${index}`, count: 20, cover,
    }))), photos[0]);
    await page.waitForFunction(() => document.querySelectorAll('.project-card__thumb').length === 21);
    const counters = await page.evaluate(() => window.__counters);
    assert.equal(counters.peak, 3);
    assert.equal(counters.fallbackCalls.length, 6);
    assert.equal(new Set(counters.fallbackCalls).size, 6);
    await page.route('https://card.test/broken.svg', (route) => route.abort());
    await page.evaluate((fixture) => window.__render([{ ...fixture, id: 30, thumbnails: [], cover: 'https://card.test/broken.svg', images: ['https://card.test/broken.svg', ...fixture.images] }]), fixture);
    await page.waitForFunction(() => {
      const active = document.querySelector('.project-card__cover-image .is-ready.is-active');
      return active && active.src !== 'https://card.test/broken.svg'
        && !document.querySelector('img[src="https://card.test/broken.svg"]')
        && document.querySelectorAll('.project-card__cover-image img').length === 4;
    });
    assert.equal(await page.locator('img[src="https://card.test/broken.svg"]').count(), 0);
    await page.close();

    const mobile = await setup(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.evaluate((fixture) => window.__render([fixture]), fixture);
    await mobile.locator('.project-card__thumb').nth(1).tap();
    assert.equal(await mobile.locator('.project-card__cover-image').getAttribute('data-active-preview'), '2');
    assert.equal(await mobile.evaluate(() => window.__counters.opens), 0);
    await mobile.locator('.project-card__thumb').nth(1).tap();
    assert.equal(await mobile.locator('.project-card__cover-image').getAttribute('data-active-preview'), '0');
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ widths, hover: true, keyboard: true, touch: true, stableSize: true,
      emptyAndSparseAlbums: true, imageFailure: true, importStates: true, sourceLineage: true,
      fallbackRequests: counters.fallbackCalls.length, peakFallbackConcurrency: counters.peak, errors }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
