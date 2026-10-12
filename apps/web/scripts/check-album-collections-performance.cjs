// Run against the local dev server. PLAYWRIGHT_MODULE and CHROMIUM_PATH may
// point to an existing browser test runtime instead of adding app dependencies.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.PREVIEW_URL || 'http://localhost:5188'}/__prototype/album-collections`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('.acp-all-collections .acp-collection').first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.acp-fan-cover img')].every((img) => img.complete));
    const bounds = await card.locator('.acp-fan-stage').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 8, bounds.y + 25);
    await page.waitForTimeout(400);
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    let paints = 0;
    client.on('Tracing.dataCollected', ({ value }) => { paints += value.filter((event) => event.name === 'Paint').length; });
    await client.send('Tracing.start', { categories: 'devtools.timeline', options: 'record-as-much-as-possible' });
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    const before = await metrics();
    const samples = await card.evaluate(async (element) => {
      const stage = element.querySelector('.acp-fan-stage');
      const bounds = stage.getBoundingClientRect();
      const covers = [...element.querySelectorAll('.acp-fan-cover')];
      const frames = [];
      let previous = performance.now();
      for (let i = 0; i < 64; i += 1) {
        const index = i % covers.length;
        stage.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerType: 'mouse',
          clientX: bounds.left + bounds.width * ((index + .5) / covers.length),
          clientY: bounds.top + 25,
        }));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
        if (element.querySelector('.acp-fan-cover.is-active') !== covers[index]) throw new Error('Cover selection lagged behind the pointer');
        const name = covers[index].getAttribute('aria-label').replace(/^\S+\s/, '');
        if (element.querySelector('.acp-collection-caption.is-visible strong')?.textContent !== name) throw new Error('The visible title does not match the selected cover');
      }
      return { switches: frames.length };
    });
    await page.waitForTimeout(350);
    const after = await metrics();
    const finished = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));
    await client.send('Tracing.end');
    await finished;
    const result = {
      ...samples,
      layouts: after.LayoutCount - before.LayoutCount,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      mainThreadMs: (after.TaskDuration - before.TaskDuration) * 1000,
      paints,
    };
    console.log(JSON.stringify(result));
    assert(result.layouts <= 4, `Cover scrubbing triggered ${result.layouts} layouts; the fixed-size title must not relayout on every selection`);
    assert(result.paints <= 32, `Cover scrubbing triggered ${result.paints} paints; cached covers and captions should switch in the compositor`);
    assert.deepEqual(errors, []);
    const selectedName = (await card.locator('.acp-fan-cover.is-active').getAttribute('aria-label')).replace(/^\S+\s/, '');
    await card.locator('.acp-collection-label').click();
    await page.getByRole('dialog').waitFor();
    assert((await page.getByRole('dialog').innerText()).includes(selectedName));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
