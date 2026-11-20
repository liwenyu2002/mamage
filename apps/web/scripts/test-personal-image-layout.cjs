const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const moduleValue = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync(path.resolve(__dirname, '../src/utils/personalImageLayout.js'), 'utf8'), {
  configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code, { module: moduleValue, exports: moduleValue.exports });
const { fitImageSize, printDimensions, collageLayout, imageExportName } = moduleValue.exports;

test('resizing preserves aspect, does not upscale, and bounds canvas dimensions', () => {
  assert.deepEqual({ ...fitImageSize(6000, 4000, 2400) }, { width: 2400, height: 1600 });
  assert.deepEqual({ ...fitImageSize(100, 200, 2400) }, { width: 100, height: 200 });
  for (const edge of [0, -1, NaN, 16385]) assert.throws(() => fitImageSize(100, 200, edge));
});
test('physical size inspection is a calculation, not a pixel enlargement', () => {
  const physical = printDimensions(3000, 1500, 300);
  assert.equal(physical.widthMm, 254); assert.equal(physical.heightMm, 127);
  for (const dpi of [0, NaN, 2401]) assert.throws(() => printDimensions(3000, 1500, dpi));
});
test('collage puts every image inside a separate uncropped cell with labels below the image', () => {
  for (let count = 1; count <= 20; count++) {
    const layout = collageLayout(count, { width: 2400, columns: 3, gap: 24, labels: true });
    assert.equal(layout.cells.length, count);
    for (const cell of layout.cells) {
      assert.ok(cell.x >= 0 && cell.y >= 0 && cell.width > 0 && cell.height > 0);
      assert.ok(cell.x + cell.width <= layout.width && cell.y + cell.height + cell.labelHeight <= layout.height);
    }
    assert.equal(new Set(layout.cells.map(cell => cell.label)).size, count);
  }
});
test('collage rejects unsafe or excessive canvas allocations', () => {
  for (const [count, options] of [[0, {}], [21, {}], [20, { width: 8192, columns: 1 }], [2, { columns: 0 }], [2, { gap: 500 }], [2, { width: NaN }]]) {
    assert.throws(() => collageLayout(count, options));
  }
});
test('export names are safe, predictable and cannot collide in batch ZIPs', () => {
  assert.equal(imageExportName('../photo.png', 'jpeg', 0), '01-.._photo-mamage.jpg');
  assert.notEqual(imageExportName('同名.jpg', 'png', 0), imageExportName('同名.jpg', 'png', 1));
  assert.throws(() => imageExportName('name', 'html'));
});
