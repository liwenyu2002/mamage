const assert = require('node:assert/strict');
process.env.ORGANIZATION_UNITS_ACTIVE = '1';
process.env.MEDIA_URL_SECRET = 'isolated-media-acl-test';
let activeUnit = 1;
let shareActive = true;
const original = 'uploads/2025/10/01/private.jpg';
const thumbnail = 'uploads/2025/10/01/thumb_private.jpg';
const photo = { id: 77, photo_id: 77, project_id: 9, organization_id: 2, unit_id: 1,
  url: `/${original}`, thumb_url: `/${thumbnail}` };
const db = { async query(sql) {
  if (sql.includes('FROM organization_units WHERE')) return [[{ id: 1 }]];
  if (sql.includes('organization_admin_grants')) return [[]];
  if (sql.includes('SELECT active_unit_id')) return [[{ active_unit_id: activeUnit }]];
  if (sql.includes('SELECT m.role')) return [[{ role: 'member' }]];
  if (sql.includes('FROM photos WHERE id')) return [[photo]];
  if (sql.includes('FROM photos ph LEFT JOIN projects')) return [[photo]];
  if (sql.includes('FROM users WHERE id')) return [[{ id: 7, organization_id: 2, role: 'photographer' }]];
  if (sql.includes('internal_shares')) return [[]];
  if (sql.includes('FROM share_links')) return [shareActive ? [{ id: 3, share_type: 'project', project_id: 9, sync_mode: 'automatic' }] : []];
  throw new Error(`Unexpected SQL: ${sql}`);
} };
const mock = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
mock('../db', { pool: db, UPLOAD_BASE_URL: 'https://media.test/api/image', buildUploadUrl: p => `https://media.test/api/image/${p.replace(/^\//,'')}` });
mock('../lib/cos_storage', { keyFromUrlOrPath: value => String(value).replace(/^\//, '') });
const media = require('../lib/media_access');
const access = require('../lib/workspace_access');
const avatar = require('../lib/user_avatar');
(async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../db'), 'utf8');
  const context = {
    URL, Buffer, crypto: require('node:crypto'), MEDIA_URL_SECRET: process.env.MEDIA_URL_SECRET,
    UPLOAD_BASE_URL: 'https://media.test/api/image', INTERNAL_UPLOAD_BASE_URL: 'http://127.0.0.1:8080/api/image',
    buildUploadUrl: value => /^https?:/.test(value) ? value : `https://media.test/api/image${value}`,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function buildInternalMediaUrl('), source.indexOf('module.exports =')), context);
  const internal = new URL(context.buildInternalMediaUrl(`/${original}`));
  assert.equal(internal.origin, 'http://127.0.0.1:8080');
  assert.equal(media.verifyPayload(internal.searchParams.get('ma')).t, 'service');
  assert.equal(await media.authorizeMediaKey(original, internal.searchParams.get('ma'), db), true, 'background analysis must retain access to legacy photos');
  const foreign = `https://external.test/api/image/${original}`;
  assert.equal(context.buildInternalMediaUrl(foreign), foreign, 'never send internal service capabilities to a foreign host');
  assert.equal(await media.authorizeMediaKey(original, null, db), false, 'global legacy signatures must not authorize private photos');
  const url = new URL(media.buildMediaUrl(`/${original}`, { userId: 7, photoId: 77 }));
  assert(url.searchParams.has('ma'), 'legacy keys also need a resource-scoped token');
  assert.equal(await media.authorizeMediaKey(original, url.searchParams.get('ma'), db), true);
  activeUnit = 2;
  assert.equal(await media.authorizeMediaKey(original, url.searchParams.get('ma'), db), false, 'changing units must revoke old private access');
  const share = new URL(media.buildMediaUrl(`/${thumbnail}`, { shareId: 3, photoId: 77 }));
  assert.equal(await media.authorizeMediaKey(thumbnail, share.searchParams.get('ma'), db), true);
  shareActive = false;
  assert.equal(await media.authorizeMediaKey(thumbnail, share.searchParams.get('ma'), db), false);
  assert.equal(avatar.validAvatar(`/${original}`,7),false);
  assert.equal(avatar.buildAvatarUrl(`/${original}`,7),null);
  assert.equal(avatar.validAvatar('/uploads/avatars/8/a.jpg',7),false);
  assert.equal(avatar.validAvatar('/uploads/avatars/7/a.jpg',7),true);
  process.env.ORGANIZATION_UNITS_ACTIVE = '0';
  await assert.rejects(access.resolveWorkspace({ user: { id:7,organization_id:2 }, get:()=>undefined }, db), e=>e.status===503);
  delete process.env.ORGANIZATION_UNITS_ACTIVE;
  await assert.rejects(access.resolveWorkspace({ user: { id:7,organization_id:2 }, get:()=>undefined }, db), e=>e.status===503);
  assert.equal(access.projectListScope({enabled:false}).sql,'p.unit_id IS NULL');
  console.log('PASS: legacy media ACL, current unit, share revocation, avatar signing and fail-closed configuration');
})().catch(error=>{ console.error(error);process.exitCode=1; });
