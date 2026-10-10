// Run against the local preview using the same browser runtime as the performance check.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function assertPreviewClear(card) {
  const blocked = await card.evaluate((element) => {
    const glass = element.querySelector('.acp-collection-glass').getBoundingClientRect();
    const points = [];
    for (const control of element.querySelectorAll('button:not(.acp-fan-cover):not(.acp-collection-label)')) {
      const bounds = control.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      if (y >= glass.top) continue;
      if (document.elementsFromPoint(x, y).some((hit) => hit.closest('.acp-fan-cover'))) points.push(control.getAttribute('aria-label'));
    }
    return points;
  });
  assert.deepEqual(blocked, [], 'Collection controls overlap the expanded photo preview');
}

async function approachFromPhoto(page, card) {
  await card.scrollIntoViewIfNeeded();
  const stage = await card.locator('.acp-fan-stage').boundingBox();
  await page.mouse.move(0, 0);
  await page.mouse.move(stage.x + stage.width * .45, stage.y + 65);
  await page.waitForTimeout(320);
  assert(await card.evaluate((el) => el.classList.contains('is-expanded')));
  await assertPreviewClear(card);
  // The upper-right photo area must stay available for scrubbing, not hide the fan.
  await page.mouse.move(stage.x + stage.width * .875, stage.y + 25, { steps: 8 });
  await page.waitForTimeout(180);
  assert(await card.evaluate((el) => el.classList.contains('is-expanded')));
  assert(await card.locator('.acp-fan-cover').last().evaluate((el) => el.classList.contains('is-active')));
  const trigger = card.locator('.acp-collection-more');
  const target = await trigger.boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.waitForTimeout(180);
  assert(await card.evaluate((el) => el.classList.contains('is-expanded')), 'Approaching the tools must not collapse the preview');
  assert(target.width >= 44 && target.height >= 44);
  assert(await trigger.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }), 'The footer tool must receive pointer events');
  return trigger;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    const url = `${process.env.PREVIEW_URL || 'http://localhost:5188'}/__prototype/album-collections#collections`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.querySelectorAll('.acp-fan-cover img')].every((img) => img.complete && img.naturalWidth));
    const cards = page.locator('.acp-all-collections .acp-collection');
    const desktopCards = await cards.count();
    for (let index = 0; index < desktopCards; index += 1) {
      const card = cards.nth(index);
      const trigger = await approachFromPhoto(page, card);
      await trigger.click();
      let menu = card.getByRole('menu');
      await menu.waitFor();
      assert.equal(await menu.locator('button').count(), 3);
      const pin = menu.getByRole('menuitemcheckbox');
      const wasPinned = await pin.getAttribute('aria-checked');
      await pin.click();
      await menu.waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('dialog').count(), 0, 'Pinning must not open an album');
      await trigger.click();
      menu = card.getByRole('menu');
      assert.notEqual(await menu.getByRole('menuitemcheckbox').getAttribute('aria-checked'), wasPinned);
      await menu.getByRole('menuitem', { name: /^调整外观/ }).click();
      await page.getByRole('dialog').waitFor();
      assert((await page.getByRole('dialog').innerText()).includes('我的相册集外观'));
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await trigger.focus();
      await trigger.press('ArrowDown');
      menu = card.getByRole('menu');
      await menu.waitFor();
      assert(await menu.locator('button').first().evaluate((el) => el === document.activeElement));
      await page.keyboard.press('End');
      assert(await menu.locator('button').last().evaluate((el) => el === document.activeElement));
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      assert(await trigger.evaluate((el) => el === document.activeElement));
    }
    await cards.first().locator('.acp-collection-more').click();
    await cards.first().getByRole('menuitem', { name: /^查看全部相册/ }).click();
    assert((await page.locator('.acp-page-heading h1').innerText()).includes('党团与校园活动'));
    assert.equal(await page.locator('.acp-albums .acp-album').count(), 4);
    for (const width of [390, 320]) {
      const mobile = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      mobile.setDefaultTimeout(10000);
      mobile.on('pageerror', (error) => errors.push(error.message));
      await mobile.goto(url, { waitUntil: 'domcontentloaded' });
      const card = mobile.locator('.acp-all-collections .acp-collection').first();
      const trigger = card.locator('.acp-collection-more');
      await trigger.tap();
      let menu = card.getByRole('menu');
      await menu.waitFor();
      const pin = menu.getByRole('menuitemcheckbox');
      const wasPinned = await pin.getAttribute('aria-checked');
      await pin.tap();
      await trigger.tap();
      menu = card.getByRole('menu');
      assert.notEqual(await menu.getByRole('menuitemcheckbox').getAttribute('aria-checked'), wasPinned);
      await menu.getByRole('menuitem', { name: /^调整外观/ }).tap();
      await mobile.getByRole('dialog').waitFor();
      assert((await mobile.getByRole('dialog').innerText()).includes('我的相册集外观'));
      assert(!(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
      await mobile.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ desktopCards, clearPhotoPreview: true, rightCoverScrubbing: true, mouse: 'passed', keyboard: 'passed', viewAll: 'passed', touchWidths: [390, 320], errors }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
