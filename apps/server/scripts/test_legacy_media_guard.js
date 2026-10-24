const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLegacyMediaGuard } = require('../lib/legacy_media_guard');

test('legacy local files cannot bypass media authorization, including HEAD and dependency failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-static-test-'));
  await fs.mkdir(path.join(root, 'units', '7'), { recursive: true });
  await fs.writeFile(path.join(root, 'units/7/private.jpg'), 'private-media');
  const app = express();
  const seen = [];
  app.use('/uploads', createLegacyMediaGuard({ normalizeKey: value => value.slice(1), isSafeKey: value => !value.includes('..'),
    authorizeMediaKey: async (key, token) => { seen.push(key); if (token === 'db-down') throw Error('DB_DOWN'); return token === 'valid'; } }),
  express.static(root, { dotfiles: 'deny' }));
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const url = `http://127.0.0.1:${server.address().port}/uploads/units/7/private.jpg`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 403);
    assert.equal((await fetch(url + '?ma=db-down')).status, 503);
    const authorized = await fetch(url + '?ma=valid');
    assert.equal(await authorized.text(), 'private-media');
    assert.equal(authorized.headers.get('cache-control'), 'private, no-store');
    assert.ok(seen.every(key => key === 'uploads/units/7/private.jpg'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
