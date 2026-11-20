const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { transformSync } = require('@babel/core');
function load(file) {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../src/utils', file);
  vm.runInNewContext(transformSync(fs.readFileSync(filename, 'utf8'), { configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] }).code,
  { module, exports: module.exports, require: name => require(path.resolve(path.dirname(filename), name)), crypto, Date, Math });
  return module.exports;
}
const { canvasToAnnotationPoint, annotationToCanvasPoint, createPersonalAnnotation, annotationEdit,
  paintPersonalAnnotations, hitPersonalAnnotation, movePersonalAnnotation, resizePersonalAnnotation, assertPersonalCanvasSize } = load('personalAnnotations.js');
const { personalPdfLayout } = load('personalDocumentLayout.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test('annotation coordinates round-trip after arbitrary rotation and non-centered crop', () => {
  for (const rotation of [-180, -90, -21.75, 0, 17, 90, 179]) {
    const adjustments = { rotation, crop: { x: 0.1, y: 0.2, width: 0.65, height: 0.55 } };
    const source = canvasToAnnotationPoint({ x: 183, y: 242 }, 1200, 800, adjustments);
    const result = annotationToCanvasPoint(source, 1200, 800, adjustments);
    near(result.x, 183); near(result.y, 242);
  }
});

test('masks follow source pixels when another tool subsequently rotates or crops the photo', () => {
  const size = { width: 1200, height: 800 };
  const mask = createPersonalAnnotation('redact', { x: 300, y: 200 }, { x: 600, y: 400 }, size, {}, {});
  const result = annotationToCanvasPoint(mask.points[0], 1200, 800, { rotation: 90, crop: { x: 0, y: 1 / 6, width: 1, height: 2 / 3 } });
  near(result.x, 600); near(result.y, 100);
  const moved = movePersonalAnnotation(mask, { x: 0, y: 0 }, { x: 20, y: 30 }, { width: 1200, height: 800 }, { rotation: 90 });
  const start = annotationToCanvasPoint(mask.points[0], 1200, 800, { rotation: 90 });
  const end = annotationToCanvasPoint(moved.points[0], 1200, 800, { rotation: 90 });
  near(end.x - start.x, 20); near(end.y - start.y, 30);
  assert.equal(movePersonalAnnotation(mask, { x: 480, y: 560 }, { x: 480, y: 560 }, size, { rotation: 90 }), mask,
    'Selecting without moving cannot add a spurious undo step');
});

test('annotation undo and redo are per-image, bounded, and new edits discard redo', () => {
  let state = {};
  for (let index = 0; index < 40; index++) state = annotationEdit(state, [index]);
  assert.equal(state.annotationPast.length, 30);
  state = annotationEdit(state, 'undo'); assert.equal(state.annotations[0], 38);
  state = annotationEdit(state, 'redo'); assert.equal(state.annotations[0], 39);
  state = annotationEdit(annotationEdit(state, 'undo'), ['new']); assert.equal(state.annotationFuture.length, 0);
  assert.throws(() => annotationEdit({}, Array(101).fill({})));
});

test('mask color and opacity cannot become translucent; masks paint above text and hit-testing matches', () => {
  const size = { width: 1200, height: 800 };
  const mask = createPersonalAnnotation('redact', { x: 100, y: 100 }, { x: 500, y: 400 }, size, {}, { color: '#ff000080', maskColor: 'transparent' });
  const text = createPersonalAnnotation('text', { x: 120, y: 120 }, {}, size, {}, { text: 'SECRET', color: '#d63b43' });
  assert.equal(mask.color, '#000000');
  const calls = [], context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    translate() {}, rotate() {}, fillText() { calls.push(['text', this.globalAlpha]); }, fill() { calls.push([this.fillStyle, this.globalAlpha]); } };
  paintPersonalAnnotations({ getContext: () => context }, [mask, text], size);
  assert.deepEqual(calls, [['text', 1], ['#000000', 1]]);
  assert.equal(hitPersonalAnnotation([mask, text], { x: 130, y: 130 }, size, {}).id, mask.id);
  assert.throws(() => paintPersonalAnnotations({ getContext: () => context }, [{ kind: 'redact', points: [] }], size));
});

test('zero-length gestures and empty text do not create invisible annotations', () => {
  for (const kind of ['rectangle', 'redact', 'arrow']) assert.equal(createPersonalAnnotation(kind, { x: 2, y: 2 }, { x: 3, y: 3 }, { width: 200, height: 200 }), null);
  assert.equal(createPersonalAnnotation('text', { x: 0, y: 0 }, {}, { width: 200, height: 200 }, {}, { text: '  ' }), null);
  assert.throws(() => createPersonalAnnotation('blur', {}, {}, {}));
  assert.equal(createPersonalAnnotation('redact', { x: 5, y: 5 }, { x: 5, y: 100 }, { width: 200, height: 200 }), null);
});

test('canvas size guard rejects oversized rotated allocations before loading or rendering pixels', () => {
  assert.equal(assertPersonalCanvasSize(6000, 4000, {}).width, 6000);
  assert.throws(() => assertPersonalCanvasSize(16384, 1400, { rotation: 45 }));
  assert.throws(() => assertPersonalCanvasSize(8000, 4000, {}));
  assert.throws(() => assertPersonalCanvasSize(0, 500, {}));
  assert.ok(assertPersonalCanvasSize(6000, 4000, { rotation: 45, crop: { x: .25, y: .25, width: .5, height: .5 } }).width > 0);
});

test('mask corner resizing preserves the selected mask identity, style and opposite corner', () => {
  const size = { width: 1200, height: 800 };
  const mask = createPersonalAnnotation('redact', { x: 300, y: 200 }, { x: 600, y: 400 }, size, {}, { maskColor: '#ffffff' });
  const resized = resizePersonalAnnotation(mask, 2, { x: 700, y: 500 }, size, {});
  assert.equal(resized.id, mask.id); assert.equal(resized.color, '#ffffff');
  near(resized.points[0].x * 1200, 300); near(resized.points[0].y * 800, 200);
  near(resized.points[2].x * 1200, 700); near(resized.points[2].y * 800, 500);
});

test('PDF layout fits complete images on each selected paper size and orientation without clipping', () => {
  for (const paper of ['a4', 'a5', 'letter', 'image']) for (const orientation of ['auto', 'portrait', 'landscape']) for (const margin of [0, 10, 30]) {
    for (const [width, height] of [[1200, 800], [800, 1200], [100, 9000], [9000, 100]]) {
      const layout = personalPdfLayout(width, height, { paper, orientation, margin });
      near(layout.imageWidth / layout.imageHeight, width / height);
      assert.ok(layout.x >= -0.0001 && layout.y >= -0.0001 && layout.x + layout.imageWidth <= layout.pageWidth + 0.0001 && layout.y + layout.imageHeight <= layout.pageHeight + 0.0001);
      if (paper !== 'image' && orientation !== 'auto') assert.equal(layout.pageWidth > layout.pageHeight, orientation === 'landscape');
    }
  }
  for (const options of [{ paper: 'bad' }, { margin: -1 }, { margin: 31 }, { margin: NaN }, { orientation: 'bad' }]) assert.throws(() => personalPdfLayout(100, 200, options));
});
