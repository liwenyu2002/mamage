const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 1000);
  assert.equal(fs.existsSync('/app/.env'), false);
  assert.equal(fs.existsSync('/app/uploads'), false);
  assert.equal(fs.existsSync('/app/db/mamage_schema_only.sql'), false);
  assert.ok(fs.existsSync('/app/scripts/migrations/20261013_002_album_desktop.sql'));
  assert.ok(fs.readdirSync('/app/scripts/migrations').every(name => !name.startsWith('.')),
    'migration directory must not contain packaging metadata');
  assert.throws(() => fs.writeFileSync('/app/.container-readonly-check', 'not writable'), { code: 'EROFS' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-native-smoke-'));
  try {
    const image = path.join(dir, 'image.jpg');
    await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#627c9f' } }).jpeg().toFile(image);
    const vector = JSON.parse(execFileSync(process.env.PYTHON_PATH, ['scripts/resnet_feature.py', image],
      { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(vector.length, 2048);
    assert.ok(vector.every(Number.isFinite));
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 0.001);
    const video = path.join(dir, 'video.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=1',
      '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { timeout: 30000 });
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', video], { encoding: 'utf8' }));
    assert.equal(metadata.streams[0].width, 64);
    const browser = await require('playwright').chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<!doctype html><title>MaMage container smoke</title>');
      assert.equal(await page.title(), 'MaMage container smoke');
    } finally { await browser.close(); }
    console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, uid: process.getuid(),
      readOnlyRoot: true, sharp: 'passed', resnetDimensions: vector.length, ffmpeg: 'passed', chromium: 'passed' }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
