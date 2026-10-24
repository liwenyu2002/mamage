const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm');
const { normalizeOriginalFilename } = require('../lib/original_filename');

test('original names retain case, Unicode and source extensions without accepting file paths', () => {
  assert.equal(normalizeOriginalFilename('C:\\DCIM\\IMG_0123.CR3'), 'IMG_0123.CR3');
  assert.equal(normalizeOriginalFilename('/DCIM/活动 原图.HEIC'), '活动 原图.HEIC');
  assert.equal(normalizeOriginalFilename(Buffer.from('校园现场.MOV').toString('latin1'), { multipart: true }), '校园现场.MOV');
  assert.equal(normalizeOriginalFilename('café.jpg', { multipart: true }), 'café.jpg');
  assert.equal(normalizeOriginalFilename(''), null);
  assert.equal(normalizeOriginalFilename('../'), null);
  assert.equal(normalizeOriginalFilename('bad\0name.mp4'), 'badname.mp4');
});

test('the migration is nullable and additive, without inventing filenames for history', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261020_001_photo_original_filename.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN original_filename VARCHAR\(512\) NULL/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/);
});

test('the actual upload record transaction persists the original name separately from title and UUID paths', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/upload.js'), 'utf8');
  const writes = [];
  const connection = { async beginTransaction() {}, async commit() {}, async rollback() {},
    async query(sql, params) {
      if (sql.includes('SELECT unit_id')) return [[{ unit_id: 1 }]];
      if (sql.includes('INSERT INTO photos')) { writes.push({ sql, params }); return [{ insertId: 55 }]; }
      throw Error('Unexpected query');
    } };
  const context = { normalizeOriginalFilename, ensureProjectInScope: async () => {}, ensureTimelineSectionInProject: async () => {},
    distributed: () => false, buildMediaUrl: value => value, JSON };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function createPhotoRecord(payload)'), source.indexOf('async function persistPhotoTasks(')), context);
  assert.equal(await context.createPhotoRecord({ connection, projectId: 9, orgId: 2, type: 'video',
    title: '', relPath: '/uploads/uuid.mp4', originalFilename: '活动原片.MOV' }), 55);
  assert.match(writes[0].sql, /original_filename/);
  assert.equal(writes[0].params.at(-1), '活动原片.MOV');
  assert.equal((writes[0].sql.match(/\?/g) || []).length, writes[0].params.length);
  vm.runInContext(source.slice(source.indexOf('function makeResponsePayload('), source.indexOf('function handleUploadMiddleware(')), context);
  assert.equal(context.makeResponsePayload({ insertedId: 55, type: 'video', originalFilename: '活动原片.MOV' }).originalFilename, '活动原片.MOV');
});

test('filename text matching escapes SQL wildcards and does not depend on descriptions or AI', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/photo_search.js'), 'utf8');
  const context = { escapeLikeToken: value => value.replace(/[#%_]/g, '#$&'), usableFaceSql: () => '1=1' };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function textMatch('), source.indexOf('\nfunction ', source.indexOf('function textMatch(') + 10)), context);
  for (const includeFaces of [true, false]) {
    const result = context.textMatch('IMG_100%.JPG', includeFaces);
    assert.match(result.sql, /p\.original_filename/);
    assert.equal((result.sql.match(/\?/g) || []).length, result.params.length);
    assert.ok(result.params.every(value => value === '%img#_100#%.jpg%'));
  }
});
