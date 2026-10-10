const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const code = babel.transformFileSync(path.join(__dirname, '../src/utils/projectPreviewPhotos.js'), {
  presets: [require.resolve('@babel/preset-env')],
}).code;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { pickProjectPreviewSrc, projectPreviewSourceKey, findProjectPreviewPhotoId, findProjectPreviewIndex } = mod.exports;
const photos = Array.from({ length: 21 }, (_, index) => ({ id: 900 + index, thumbUrl: `/photo.jpg?index=${index}` }));
assert.equal(pickProjectPreviewSrc({ fullThumbUrl: '/full.jpg' }), '/full.jpg');
assert.equal(findProjectPreviewPhotoId('/photo.jpg?index=20', photos), '920');
assert.equal(findProjectPreviewIndex([...photos].reverse(), { photoId: '920' }), 0, 'Match IDs, not the thumbnail position');
assert.equal(findProjectPreviewIndex(photos, { photoId: 'missing', src: photos[0].thumbUrl }), -1, 'Never open a different photo when the requested ID is missing');
assert.equal(findProjectPreviewIndex(photos, { src: '/photo.jpg?index=20' }), 20, 'Legacy URL-only previews still open the exact image');
assert.equal(findProjectPreviewPhotoId('/unknown.jpg', photos), null);
assert.equal(findProjectPreviewIndex(photos, {}), -1);
const signed = [{ photo_id: '71', thumbUrl: '/api/image/key71?sig=old', url: '/api/image/original71?sig=old' }];
assert.equal(findProjectPreviewPhotoId('https://gallery.test/api/image/key71?sig=new', signed), '71');
assert.equal(findProjectPreviewPhotoId('/api/image/original71?sig=new', signed), '71');
assert.equal(findProjectPreviewIndex(signed, { src: '/api/image/key71?sig=new' }), 0);
assert.notEqual(projectPreviewSourceKey('/photo.jpg?index=1'), projectPreviewSourceKey('/photo.jpg?index=2'));
const resolve = src => src.startsWith('/') ? `https://gallery.test${src}` : src;
assert.equal(findProjectPreviewPhotoId('https://gallery.test/photo.jpg?index=20', photos, resolve), '920');
assert.equal(findProjectPreviewIndex(photos, { src: 'https://gallery.test/photo.jpg?index=20' }, resolve), 20);
assert.equal(findProjectPreviewPhotoId('/legacy.jpg', ['/legacy.jpg']), null, 'Do not fabricate photo IDs from URL-only data');
assert.equal(findProjectPreviewIndex(['/legacy.jpg'], { src: '/legacy.jpg' }), 0);
console.log('PASS: all 20 previews retain exact photo IDs, reordered galleries, refreshed signatures, URL-only compatibility, missing-photo safety');
