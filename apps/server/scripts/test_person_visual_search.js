const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compileVisualConditions, judgeEvidence, evidenceKey, normalizeEvidence, assertionKey } = require('../lib/person_visual_evidence');

const subject = { id: 343, name: '甲老师' };
const evidence = { binding: 'clear', visibility: 'clear', colors: ['green'],
  activities: { speech: 'unknown', group_photo: 'yes', award: 'unknown', signing: 'unknown' }, observation: '目标人物穿绿色上衣' };

test('anonymous clothing uses the same structured colors without inventing an identity or swallowing other conditions', () => {
  const request = compileVisualConditions({ people: [], mustTerms: ['白衣服', '会议室'], excludeTerms: ['黑衣服'] }, [], { anonymous: true, semantic: true });
  assert.ok(request);
  assert.equal(request.anonymous, true);
  assert.equal(request.personId, null);
  assert.deepEqual(request.positive, [{ kind: 'color', value: 'white' }]);
  assert.deepEqual(request.remainingMustTerms, ['会议室']);
  assert.equal(compileVisualConditions({ people: ['陌生人'], mustTerms: ['白衣服'] }, [], { anonymous: true }), null);
  assert.equal(compileVisualConditions({ people: [], mustTerms: ['白色背景'] }, [], { anonymous: true }), null);
  const patterned = { ...evidence, colors: ['white', 'blue'] };
  assert.equal(judgeEvidence({ positive: request.positive, negative: [] }, patterned, { allowMulticolor: true }), 'match');
  assert.equal(judgeEvidence({ positive: request.positive, negative: [] }, patterned), 'unknown', 'named-person ambiguity policy must remain strict');
  const shirt = compileVisualConditions({ people: [], mustTerms: ['白衬衫'] }, [], { anonymous: true });
  assert.equal(shirt.positive[0].garment, 'shirt');
  assert.equal(judgeEvidence(shirt, { ...evidence, colors: ['white'], profile: { clothing: { upper: '白色羽绒服' } } }, { allowMulticolor: true }), 'reject');
  assert.equal(judgeEvidence(shirt, { ...evidence, colors: ['white'], profile: { clothing: { upper: '白色衬衫' } } }, { allowMulticolor: true }), 'match');
});

test('clothing queries use person-bound evidence, not whole-image text or background colors', () => {
  const request = compileVisualConditions({ mustTerms: ['绿衣服'], excludeTerms: [], people: ['甲老师'] }, [subject]);
  assert.deepEqual(request.positive, [{ kind: 'color', value: 'green' }]);
  assert.equal(judgeEvidence(request, evidence), 'match');
  assert.equal(judgeEvidence(request, { ...evidence, colors: ['black'] }), 'reject');
  assert.equal(judgeEvidence(request, null), 'unknown');
});

test('negation requires positive visible evidence; missing, hidden and ambiguous never mean non-black', () => {
  const request = compileVisualConditions({ mustTerms: [], excludeTerms: ['黑色衣服'], people: ['甲老师'] }, [subject]);
  assert.equal(judgeEvidence(request, evidence), 'match');
  for (const row of [null, {}, { ...evidence, colors: [] }, { ...evidence, visibility: 'partial' },
    { ...evidence, binding: 'uncertain' }]) assert.equal(judgeEvidence(request, row), 'unknown');
  assert.equal(judgeEvidence(request, { ...evidence, colors: ['green', 'black'] }), 'unknown');
});

test('independent conditions are retained and unsupported expressions never silently disappear', () => {
  const request = compileVisualConditions({ mustTerms: ['绿衣服', '发言', '体育馆'], excludeTerms: ['黑衣服'], people: ['甲老师'] }, [subject], { activities:true });
  assert.deepEqual(request.positive, [{ kind: 'color', value: 'green' }, { kind: 'activity', value: 'speech' }]);
  assert.deepEqual(request.remainingMustTerms, ['体育馆']);
  assert.equal(judgeEvidence(request, evidence), 'unknown');
  assert.equal(judgeEvidence(request, { ...evidence, activities: { speech: 'yes' } }), 'match');
  assert.equal(compileVisualConditions({ mustTerms: ['绿衣服'], excludeTerms: [], people: ['甲老师','乙老师'] },
    [subject, { id: 44, name: '乙老师' }]), null, 'ambiguous multi-person clothing ownership must not be guessed');
});

test('cache fingerprints invalidate after face correction, source replacement or model change', () => {
  const face = { id: 8, photoId: 10, personId: 343, x: 0.2, y: 0.1, w: 0.1, h: 0.1,
    unit: 'ratio', imageWidth: 800, imageHeight: 600, photoUrl: '/uploads/source.jpg', thumbUrl: '/uploads/thumb.jpg' };
  const key = evidenceKey(face, 'fixture-model');
  for (const change of [{ personId: 44 }, { x: 0.4 }, { photoUrl: '/uploads/replacement.jpg' }]) {
    assert.notEqual(evidenceKey({ ...face, ...change }, 'fixture-model'), key);
  }
  assert.notEqual(evidenceKey(face, 'new-model'), key);
});

test('malformed or incomplete model output cannot certify visual matches', () => {
  assert.equal(normalizeEvidence({ binding: 'clear', colors: ['green'] }).binding, 'uncertain');
  assert.deepEqual(normalizeEvidence({ ...evidence, colors: ['invented-color'] }).colors, []);
  assert.equal(normalizeEvidence({ ...evidence, activities: { speech: 'probably' } }).activities.speech, 'unknown');
});

test('unlisted visual requests use explicit model judgments, not additional keyword patches', () => {
  const plan = compileVisualConditions({ mustTerms:['手里拿着相机'], excludeTerms:['遮住脸'], people:['甲老师'] },[subject],{semantic:true});
  assert.equal(plan.positive[0].kind,'assertion');
  assert.deepEqual(plan.remainingMustTerms,[]);
  assert.equal(judgeEvidence(plan,evidence),'unknown');
  const assertions = {[assertionKey('手里拿着相机')]:{state:'yes'},[assertionKey('遮住脸')]:{state:'no'}};
  assert.equal(judgeEvidence(plan,{...evidence,assertions}),'match');
  assert.equal(judgeEvidence(plan,{...evidence,assertions:{...assertions,[assertionKey('遮住脸')]:{state:'unknown'}}}),'unknown');
});
