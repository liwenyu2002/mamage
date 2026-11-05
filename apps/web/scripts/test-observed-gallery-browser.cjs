// Run test-news-gallery-browser.cjs with the local observed-article corpus first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const serverRequire = createRequire(path.join(root, '../server/package.json'));
const { chromium } = serverRequire('playwright');
const { PNG } = serverRequire('pngjs');

async function freeze(page, time) {
  await page.locator('.gallery-design-paper').evaluateAll((papers, seconds) => {
    for (const paper of papers) for (const svg of paper.querySelectorAll('svg')) {
      if (svg.ownerSVGElement) continue;
      svg.pauseAnimations(); svg.setCurrentTime(seconds);
    }
  }, time);
}

async function main() {
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const shots = path.join(output, 'gallery-style-shots');
  fs.mkdirSync(shots, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?view=gallery-styles`);
        const sections = page.locator('[data-source-style]');
        await sections.first().waitFor();
        assert.equal(await sections.count(), 2);
        const loaded = await page.evaluate(async () => {
          const sources = [...document.querySelectorAll('.source-original *')].flatMap(element => {
            if (element.tagName === 'IMG') return [element.src];
            const background = element.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
            return background ? [background[1]] : [];
          });
          return Promise.all([...new Set(sources)].map(src => new Promise(resolve => {
            const image = new Image(); image.referrerPolicy = 'no-referrer';
            image.onload = () => resolve(image.naturalWidth); image.onerror = () => resolve(0); image.src = src;
          })));
        });
        assert(loaded.length >= 12 && loaded.every(value => value >= 700), 'source photos load, not anti-hotlink placeholders');
        await page.waitForFunction(() => [...document.querySelectorAll('.gallery-design-paper img')].every(img => img.complete && img.naturalWidth >= 700));
        await freeze(page, 0);
        const differences = [];
        for (const section of await sections.all()) {
          const source = section.locator('.source-original'), replica = section.locator('.source-replica');
          const sourceBounds = await source.boundingBox(), replicaBounds = await replica.boundingBox();
          assert(Math.abs(sourceBounds.width - replicaBounds.width) < 0.1);
          assert(Math.abs(sourceBounds.height - replicaBounds.height) < 0.1);
          // Mobile stacks the two panels at different fractional Y positions.
          // Align only their test wrappers to avoid screenshot rounding differences.
          for (const paper of [source, replica]) await paper.evaluate(element => {
            const top = element.getBoundingClientRect().top;
            element.style.transform = `translateY(${Math.ceil(top) - top}px)`;
          });
          const a = PNG.sync.read(await source.screenshot()), b = PNG.sync.read(await replica.screenshot());
          for (const paper of [source, replica]) await paper.evaluate(element => element.style.removeProperty('transform'));
          assert.equal(a.width, b.width); assert.equal(a.height, b.height);
          let changed = 0;
          for (let i = 0; i < a.data.length; i += 4) {
            if ([0, 1, 2].some(channel => Math.abs(a.data[i + channel] - b.data[i + channel]) > 20)) changed++;
          }
          const ratio = changed / (a.width * a.height);
          assert(ratio < 0.02, `copied source differs visually: ${ratio}`);
          differences.push(ratio);
        }
        const movingGroup = sections.first().locator('.source-replica animateTransform');
        const transform = () => movingGroup.evaluate(el => getComputedStyle(el.parentElement).transform);
        const firstTransform = await transform();
        await freeze(page, 3);
        assert.notEqual(await transform(), firstTransform, 'copied SVG carousel still moves');
        const originalMarkup = await sections.first().locator('.source-original').innerHTML();
        await page.getByRole('button', { name: '替换为测试配图' }).click();
        await freeze(page, 0);
        assert.equal(await sections.first().locator('.source-original').innerHTML(), originalMarkup);
        assert.equal(await sections.first().locator('.source-replica [data-gallery-slot]').evaluateAll(nodes => new Set(nodes.map(node => node.dataset.gallerySlot)).size), 8);
        assert((await sections.first().locator('.source-replica').innerHTML()).includes('/__news-qa/images/1681.jpg'));
        await page.getByRole('button', { name: '恢复原文配图' }).click();
        await freeze(page, 3);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(shots, `${width}-source-comparison.png`), fullPage: true });
        console.log(JSON.stringify({ width, sources: 2, loadedImages: loaded.length, pixelDifferenceRatios: differences, originalMotion: true, replaceOnlyReplica: true }));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
