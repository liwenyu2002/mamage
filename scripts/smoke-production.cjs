const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const server = process.argv[2] || path.resolve(__dirname, '../apps/server');
const load = createRequire(path.join(server, 'package.json'));
load('dotenv').config({ path: path.join(server, '.env'), override: true });
const keys = load('./config/keys');
const jwt = load('jsonwebtoken');
const pool = load('mysql2/promise').createPool({ host: keys.DB_HOST, port: keys.DB_PORT, user: keys.DB_USER,
  password: keys.DB_PASSWORD, database: keys.DB_NAME, connectionLimit: 1 });
async function main() {
  const [[user]] = await pool.query('SELECT id FROM users WHERE id=?', [Number(process.env.SMOKE_TEST_USER_ID || 47)]);
  if (!user) throw Error('Read-only smoke test account is missing');
  const token = jwt.sign({ id: user.id }, keys.JWT_SECRET, { expiresIn: '5m' });
  const request = async (route, auth = false) => {
    const response = await fetch('http://127.0.0.1:3000' + route, { headers: auth ? { Authorization: 'Bearer ' + token } : {},
      signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`${route.split('?')[0]} returned ${response.status}`);
    return response;
  };
  await request('/api/health');
  const desktop = await (await request('/api/album-desktop', true)).json();
  if (!Array.isArray(desktop.groups) || !Array.isArray(desktop.albums)) throw Error('Malformed desktop response');
  const [[workspace]] = await pool.query('SELECT state FROM album_desktop_workspaces WHERE organization_id=? AND unit_key=?',
    [desktop.scope.organizationId, desktop.scope.unitId || 0]);
  const state = typeof workspace?.state === 'string' ? JSON.parse(workspace.state) : workspace?.state;
  const expectedIds = (state?.groups || []).map(group => group.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(desktop.groups.map(group => group.id).sort())) {
    throw Error('API folder list does not match stored workspace');
  }
  if (desktop.albums.length) {
    await request(`/api/projects/${desktop.albums[0].id}?includeFaces=0`, true);
    const cover = desktop.albums.find(a => a.image)?.image;
    if (!cover) throw Error('Album covers are missing');
    const media = new URL(cover); media.protocol = 'http:'; media.host = '127.0.0.1:3000';
    const image = await fetch(media, { signal: AbortSignal.timeout(30000) });
    if (!image.ok || !(await image.arrayBuffer()).byteLength) throw Error('Signed cover did not load');
    media.searchParams.delete('ma');
    const denied = await fetch(media, { signal: AbortSignal.timeout(10000) });
    await denied.arrayBuffer();
    if (denied.status !== 403) throw Error('Unsigned media was not denied');
  }
  const html = await (await request('/')).text();
  if (html !== fs.readFileSync(path.join(server, '../web/dist/index.html'), 'utf8')) throw Error('Nginx is not serving the target release');
  const assets = [...html.matchAll(/(?:src|href)="([^\"]*bundle[^\"]+\.(?:js|css))"/g)].map(m => m[1]);
  if (!assets.length) throw Error('Frontend bundles are missing');
  for (const asset of assets) await (await request(asset)).arrayBuffer();
  console.log(JSON.stringify({ smoke: 'passed', folders: desktop.groups.length, albums: desktop.albums.length,
    signedCover: 'ok', assets: assets.length, activeUnit: desktop.scope?.unitId }));
}
main().finally(() => pool.end()).then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
