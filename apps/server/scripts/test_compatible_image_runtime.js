const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(sharp.versions.sharp, '0.35.5');
  assert.equal(sharp.versions.vips, '8.18.7');
  if (process.env.EXPECT_LEGACY_CPU === '1') {
    assert.equal(process.arch, 'x64');
    assert.ok(!/\bsse4_2\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8')), 'test must run on the actual restricted CPU');
  }
  const width = 256;
  const height = 128;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x;
      pixels[offset + 1] = y * 2;
      pixels[offset + 2] = (x + y) % 256;
    }
  }
  const source = () => sharp(pixels, { raw: { width, height, channels: 3 } });
  const checked = [];
  for (const format of ['jpeg', 'png', 'webp', 'tiff', 'gif', 'avif']) {
    const encoded = await source().toFormat(format).toBuffer();
    assert.ok(encoded.length > 0, format);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.width, width, format);
    assert.equal(metadata.height, height, format);
    const result = await sharp(encoded).rotate().resize(80, 80, { fit: 'inside' }).webp().toBuffer({ resolveWithObject: true });
    assert.equal(result.info.width, 80, format);
    assert.equal(result.info.height, 40, format);
    checked.push(format);
  }
  const original = await source().png().toBuffer();
  const decoded = await sharp(original).removeAlpha().raw().toBuffer();
  assert.equal(Buffer.compare(pixels, decoded), 0, 'PNG decoding must preserve every colour value');
  const oriented = await source().jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await sharp(oriented).rotate().png().toBuffer();
  assert.equal((await sharp(rotated).metadata()).width, height);
  assert.equal((await sharp(rotated).metadata()).height, width);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#c03020"/></svg>');
  const overlay = await sharp(svg).png().toBuffer();
  const composite = await source().composite([{ input: overlay, top: 4, left: 4 }]).png().toBuffer();
  assert.equal((await sharp(composite).metadata()).width, width);
  const profiled = await source().withIccProfile('srgb').jpeg().toBuffer();
  assert.equal((await sharp(profiled).metadata()).hasProfile, true);
  console.log(JSON.stringify({ compatibility: 'passed', formats: checked, losslessPixels: 'exact', orientation: 'passed', svgComposite: 'passed', icc: 'passed' }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
