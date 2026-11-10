const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const sharp = runtime('sharp');
const tone = require('../../server/lib/photo_tone/engine.mjs');
const { renderAdjustedPhotoBuffer, renderPhotoToneWorkingCopy } = require('../../server/lib/photo_tone/render.cjs');
const { preparePhotoEdit } = require('../../server/lib/photo_tone/save.cjs');
const { publicAdjustments, editRevision, getBakedEdit } = require('../../server/lib/photo_tone/artifacts.cjs');

async function createTonePreview({ sourcePath, sourceBuffer, faces = [], faceDelay = 0, distDirectory = path.resolve(__dirname, '../dist') } = {}) {
  const original = sourceBuffer || fs.readFileSync(sourcePath);
  const thumb = await sharp(original).rotate().resize({ width: 900, height: 900, fit: 'inside' }).withIccProfile('srgb').jpeg().toBuffer();
  const working = await renderPhotoToneWorkingCopy(original, 1280, true);
  const objects = new Map();
  const storage = { isConfigured: () => true,
    uploadBuffer: async (key, data) => objects.set(key, data),
    deleteObjects: async keys => { keys.forEach(key => objects.delete(key)); return { deleted: keys }; } };
  const stats = { sourceRequests: 0, faceRequests: 0, renders: 0, saves: 0 };
  const photos = [11, 12].map(id => ({ id, projectId: 9001, unitId: 1, type: 'normal', photographerId: 7,
    title: id === 11 ? '本地调色测试' : '旧版调色回归原图', originalFilename: sourcePath ? path.basename(sourcePath) : 'tone-test.png',
    url: `/api/image/${id}/original.jpg`, thumbUrl: `/api/image/${id}/thumb.jpg`, description: '', tags: [], aiStatus: 'done',
    adjustments: id === 12 ? { version: 2, brightness: 50, shadows: 50, temperature: -40, wbGains: [1.4, 0.7, 0.8] } : null,
  }));
  const actor = { id: 7, name: '本地测试', role: 'admin', activeUnitId: 1, metadataEditScope: 'own',
    permissions: ['projects.view', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] };
  const publicPhoto = photo => ({ ...photo, adjustments: publicAdjustments(photo.adjustments, photo.id), editRevision: editRevision(photo) });
  const album = () => ({ id: 9001, name: '调色本地测试', adminId: 7, unitId: 1, count: 2, images: photos.map(publicPhoto) });
  const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const body = async req => {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 16384) throw new Error('request too large'); }
    return JSON.parse(data || '{}');
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return json(res, { error: 'local preview only' }, 403);
      const url = new URL(req.url, 'http://localhost'), p = url.pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (p === '/api/users/me') return json(res, actor);
      if (p === '/api/workspaces') return json(res, { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '本地测试', role: 'manager' }] });
      if (p === '/api/projects/9001') return json(res, album());
      if (p === '/api/photos') return json(res, { list: album().images, total: 2, hasMore: false });
      if (p === '/api/album-desktop') return json(res, { albums: [album()], groups: [], preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] }, workspaceRevision: 1, userRevision: 1, scope: { userId: 7, organizationId: 1, unitId: 1 } });
      const match = /^\/api\/photos\/(11|12)(?:\/(.*))?$/.exec(p);
      if (match) {
        const photo = photos.find(item => item.id === Number(match[1])), action = match[2];
        if (!action && req.method === 'PATCH') {
          const payload = await body(req);
          if (!Object.hasOwn(payload, 'adjustments')) return json(res, { error: 'tone-only preview' }, 400);
          const prepared = await preparePhotoEdit({ row: { ...photo }, adjustments: payload.adjustments, baseRevision: payload.baseEditRevision,
            storage, loadOriginal: async () => original });
          prepared.assertCurrent(photo);
          photo.adjustments = prepared.saved; stats.saves++;
          await prepared.committed();
          return json(res, publicPhoto(photo));
        }
        if (!action) return json(res, publicPhoto(photo));
        if (action === 'faces') {
          stats.faceRequests++;
          if (faceDelay) await new Promise(resolve => setTimeout(resolve, faceDelay));
          return json(res, { photoId: photo.id, faces: photo.id === 11 ? faces : [] });
        }
        if (action === 'pixel-source') {
          stats.sourceRequests++;
          res.writeHead(200, { 'Content-Type': 'image/png', 'X-MaMage-Tone-Engine': tone.ENGINE,
            'X-MaMage-Source-Width': working.width, 'X-MaMage-Source-Height': working.height });
          return res.end(working.buffer);
        }
        if (action === 'rendered' && req.method === 'POST') {
          const options = await body(req); stats.renders++;
          const baked = getBakedEdit(photo);
          const buffer = baked && tone.getToneAdjustmentKey(photo.adjustments) === tone.getToneAdjustmentKey(options.adjustments)
            ? objects.get(options.variant === 'thumb' ? baked.thumbUrl : baked.url)
            : await renderAdjustedPhotoBuffer(options.variant === 'thumb' ? thumb : original, options.adjustments, options);
          res.writeHead(200, { 'Content-Type': options.format === 'png' ? 'image/png' : options.format === 'webp' ? 'image/webp' : 'image/jpeg', 'X-MaMage-Tone-Engine': tone.ENGINE });
          return res.end(buffer);
        }
        if (action === 'direct-url') return json(res, { url: photo.url, downloadUrl: photo.url, filename: photo.originalFilename });
        return json(res, {});
      }
      if (p.startsWith('/api/image/')) {
        const photo = photos.find(item => p.includes(`/${item.id}/`)), baked = getBakedEdit(photo);
        const isThumb = p.endsWith('thumb.jpg');
        const saved = url.searchParams.get('original') !== '1' && baked ? objects.get(isThumb ? baked.thumbUrl : baked.url) : null;
        res.writeHead(200, { 'Content-Type': saved && isThumb ? 'image/webp' : 'image/jpeg' }); return res.end(saved || (isThumb ? thumb : original));
      }
      if (p.startsWith('/api/')) return json(res, {});
      const filename = path.resolve(distDirectory, '.' + p);
      if (filename.startsWith(distDirectory + path.sep) && fs.existsSync(filename) && fs.statSync(filename).isFile()) {
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
        return fs.createReadStream(filename).pipe(res);
      }
      let html = fs.readFileSync(path.join(distDirectory, 'index.html'), 'utf8');
      // A separate loopback-only origin and fake session; never contacts production.
      html = html.replace('<head>', '<head><script>localStorage.setItem("mamage_jwt_token","tone-local-fixture");</script>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
    } catch (error) { console.error(error.message); if (!res.headersSent) json(res, { error: error.message }, error.status || 500); else res.end(); }
  });
  return { server, stats, photos, working, original, objects };
}
module.exports = { createTonePreview };

if (require.main === module) {
  const sourcePath = process.argv[2];
  if (!sourcePath) { console.error('Usage: node scripts/serve-photo-tone.cjs /path/to/photo.jpg [test-face-boxes.json]'); process.exitCode = 1; }
  else Promise.resolve().then(() => {
    const faces = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [];
    if (!Array.isArray(faces)) throw new Error('Test face boxes must be a JSON array');
    return createTonePreview({ sourcePath, faces });
  }).then(({ server }) => {
    const port = Number(process.env.PORT || 5201);
    server.listen(port, '127.0.0.1', () => console.log(`Local tone preview: http://127.0.0.1:${port}/?projectId=9001&photoId=11`));
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
