const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const version = 'v4.3.0';
const os = { darwin: 'darwin', linux: 'linux' }[process.platform];
const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];

(async () => {
  if (!os || !arch) throw Error('Supported verification hosts: macOS/Linux amd64/arm64');
  const name = `helm-${version}-${os}-${arch}.tar.gz`;
  const url = `https://get.helm.sh/${name}`;
  const download = async (address, binary = false) => {
    const response = await fetch(address, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Helm download HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.text();
  };
  const [archive, checksum] = await Promise.all([download(url, true), download(url + '.sha256sum')]);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  if (digest !== checksum.trim().split(/\s+/)[0]) throw Error('Helm checksum mismatch');
  const directory = path.resolve(__dirname, '../.local/tools');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, archive);
  execFileSync('tar', ['-xzf', file, '-C', directory]);
  console.log(`Helm ${version}, SHA256 ${digest}`);
  console.log(`HELM_BIN=${path.join(directory, `${os}-${arch}/helm`)}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
