const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { quote } = require('./deploy-kubernetes.cjs');

function merge(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(result[key] || {}, value) : value;
  }
  return result;
}
async function main() {
  const sha = process.argv[2], options = JSON.parse(process.argv[3]);
  if (!/^[a-f0-9]{40}$/.test(sha) || ![options.namespace, options.release].every(s => /^[a-z][a-z0-9-]{0,45}$/.test(s))) throw Error('Invalid release');
  const root = path.resolve(__dirname, '..'), home = os.homedir();
  const archive = path.join(home, 'mamage-deploy/releases', sha + '-' + Date.now());
  const lock = path.join(home, 'mamage-deploy/kubernetes-release.lock');
  fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, sha, archive }));
  const save = (name, data) => fs.writeFileSync(path.join(archive, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  const run = (file, args, opts = {}) => cp.execFileSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, ...opts });
  const kube = (...args) => run('sudo', ['k3s', 'kubectl', '-n', options.namespace, ...args]);
  const json = (...args) => JSON.parse(kube(...args, '-o', 'json'));
  const helm = (...args) => run('sudo', ['env', 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml', 'helm', ...args]);
  const apiName = options.release + '-mamage-api';
  const node = source => run('sudo', ['k3s', 'kubectl', '-n', options.namespace, 'exec', '-i', 'deployment/' + apiName, '--', 'node'], { input: source });
  const snapshot = () => JSON.parse(node(`const {pool}=require('./db');(async()=>{
    const [counts]=await pool.query('SELECT p.organization_id,p.unit_id,COUNT(DISTINCT p.id) albums,COUNT(ph.id) photos FROM projects p LEFT JOIN photos ph ON ph.project_id=p.id GROUP BY p.organization_id,p.unit_id ORDER BY p.organization_id,p.unit_id');
    const [folders]=await pool.query('SELECT organization_id,unit_key,revision,SHA2(CAST(state AS CHAR),256) sha FROM album_desktop_workspaces ORDER BY organization_id,unit_key');
    const [grants]=await pool.query('SELECT * FROM face_search_grants ORDER BY organization_id,user_id');
    console.log(JSON.stringify({counts,folders,grants}));await pool.end();
  })().catch(e=>{console.error(e.code||e.name);process.exitCode=1});`));
  const logRun = (name, file, args, timeout = 1800000) => {
    const fd = fs.openSync(path.join(archive, name + '.log'), 'w', 0o600);
    try { run(file, args, { stdio: ['ignore', fd, fd], timeout }); }
    finally { fs.closeSync(fd); }
  };
  const guards = [];
  const waitEndpoint = async (name, ip) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (json('get', 'endpointslice', '-l', 'kubernetes.io/service-name=' + name).items.some(s =>
        s.endpoints?.some(e => e.conditions?.ready !== false && e.addresses.includes(ip)))) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('Ready endpoint missing');
  };
  try {
    const disk = fs.statfsSync(archive);
    if (Number(disk.bavail) * Number(disk.bsize) < 12 * 1024 ** 3) throw Error('Need 12 GiB available for a safe release');
    const beforeValues = JSON.parse(helm('get', 'values', options.release, '-n', options.namespace, '--all', '-o', 'json'));
    save('values-before.private.json', beforeValues);
    const secret = json('get', 'secret', beforeValues.existingSecret);
    save('runtime-secret-before.private.json', secret);
    const db = Buffer.from(secret.data.DB_NAME, 'base64').toString();
    if (!/^[a-zA-Z0-9_]+$/.test(db)) throw Error('Invalid database name');
    const missing = JSON.parse(node(`const fs=require('fs'),{pool}=require('./db');(async()=>{
      const [rows]=await pool.query('SELECT filename FROM schema_migrations');const applied=new Set(rows.map(r=>r.filename));
      console.log(JSON.stringify(fs.readdirSync('scripts/migrations').filter(f=>f.endsWith('.sql')&&!applied.has(f))));await pool.end();
    })().catch(e=>{console.error(e.code);process.exitCode=1})`));
    assert.deepEqual(missing, [], 'Apply and separately verify reviewed database migrations before releasing');
    const before = snapshot(); save('protected-before.json', before);
    const databasePod = json('get', 'pods').items.find(p => p.spec.containers.some(c => /mamage-mysql/.test(c.image)) && p.status.phase === 'Running');
    if (!databasePod) throw Error('Database pod not found');
    console.log('Backing up the live database before building');
    const dumpFd = fs.openSync(path.join(archive, 'database-before.sql.gz'), 'w', 0o600);
    try {
      run('sudo', ['k3s', 'kubectl', '-n', options.namespace, 'exec', databasePod.metadata.name, '--',
        'bash', '-o', 'pipefail', '-ec', `export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysqldump -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --hex-blob ${db} | gzip -1`], { stdio: ['ignore', dumpFd, 'inherit'], timeout: 300000 });
    } finally { fs.closeSync(dumpFd); }
    run('gzip', ['-t', path.join(archive, 'database-before.sql.gz')]);
    const tag = 'release-' + sha.slice(0, 12);
    const localBase = (reference, component) => {
      const id = run('sudo', ['docker', 'image', 'inspect', reference, '--format', '{{.Id}}']).trim();
      assert.match(id, /^sha256:[a-f0-9]{64}$/);
      if (reference.startsWith('sha256:')) assert.equal(id, reference);
      const alias = `mamage-${component}:verified-base-${id.slice(7, 19)}`;
      run('sudo', ['docker', 'tag', id, alias]);
      return alias;
    };
    const apiBase = options.base ? localBase(options.base, 'api') : null;
    const webBase = options.webBase ? localBase(options.webBase, 'web') : null;
    console.log('Building API and checking the actual native runtime');
    if (options.base) {
      logRun('api-build', 'sudo', ['docker', 'build', '--pull=false', '--build-arg', 'API_IMAGE=' + apiBase,
        '--label', 'org.opencontainers.image.revision=' + sha, '-f', 'deploy/docker/Dockerfile.api.refresh', '-t', 'mamage-api:' + tag, '.']);
    } else {
      logRun('api-build', 'sudo', ['docker', 'build', '-f', 'deploy/docker/Dockerfile.api', '-t', 'mamage-api:' + tag + '-base', '.']);
      if (options.compatibility) logRun('api-compatible-build', 'sudo', ['docker', 'build', '--build-arg', 'API_IMAGE=mamage-api:' + tag + '-base',
        '-f', 'deploy/docker/Dockerfile.api.compat', '-t', 'mamage-api:' + tag, '.']);
      else run('sudo', ['docker', 'tag', 'mamage-api:' + tag + '-base', 'mamage-api:' + tag]);
    }
    for (const script of ['verify_container_runtime.js', 'test_compatible_image_runtime.js']) {
      logRun('api-native-' + script, 'sudo', ['docker', 'run', '--rm', '--network=none', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
        '-e', 'EXPECT_LEGACY_CPU=' + (options.compatibility ? '1' : '0'), 'mamage-api:' + tag, 'node', 'scripts/' + script]);
    }
    logRun('api-tests', 'sudo', ['docker', 'run', '--rm', '--network=none', 'mamage-api:' + tag, 'npm', 'test']);
    console.log('Building the portable same-origin web image');
    logRun('web-build', 'sudo', ['docker', 'build', '--pull=false', ...(apiBase ? ['--build-arg', 'NODE_IMAGE=' + apiBase] : []),
      ...(webBase ? ['--build-arg', 'NGINX_IMAGE=' + webBase] : []), '--label', 'org.opencontainers.image.revision=' + sha,
      '-f', 'deploy/docker/Dockerfile.web', '-t', 'mamage-web:' + tag, '.']);
    logRun('web-check', 'sudo', ['docker', 'run', '--rm', '--network=none', '--read-only', '--tmpfs', '/tmp', '--add-host', 'mamage-api:127.0.0.1', 'mamage-web:' + tag, 'nginx', '-t']);
    const images = {};
    for (const component of ['api', 'web']) {
      console.log('Importing verified ' + component + ' image');
      // Stream to containerd rather than retaining a second multi-gigabyte image archive.
      logRun(component + '-import', 'bash', ['-o', 'pipefail', '-ec', `sudo docker save mamage-${component}:${tag} | sudo k3s ctr images import -`], 600000);
      const ref = `docker.io/library/mamage-${component}:${tag}`;
      const listing = run('sudo', ['k3s', 'ctr', 'images', 'list']);
      const digest = listing.split('\n').find(line => line.split(/\s+/)[0] === ref)?.split(/\s+/)[2];
      assert.match(digest, /^sha256:[a-f0-9]{64}$/);
      const alias = `docker.io/library/mamage-${component}@${digest}`;
      if (!listing.split('\n').some(line => line.split(/\s+/)[0] === alias)) run('sudo', ['k3s', 'ctr', 'images', 'tag', ref, alias]);
      images[component] = { repository: 'mamage-' + component, tag, digest, pullPolicy: 'Never' };
    }
    save('images.json', images);
    const override = options.values ? JSON.parse(fs.readFileSync(path.join(root, 'release-values.private.json'), 'utf8')) : {};
    const next = merge(beforeValues, override);
    next.config = { ...next.config, MAMAGE_RELEASE_SHA: sha };
    next.images = { ...next.images, api: images.api };
    for (const component of ['api', 'web']) {
      console.log('Releasing ' + component + ' with a healthy transition guard');
      if (component === 'web') next.images.web = images.web;
      save('values-' + component + '.private.json', next);
      const name = options.release + '-mamage-' + component;
      const deployment = json('get', 'deployment', name);
      const spec = structuredClone(deployment.spec.template.spec);
      const managedPods = json('get', 'pods', '-l', 'app.kubernetes.io/instance=' + options.release + ',app.kubernetes.io/component=' + component).items;
      spec.nodeName = managedPods.find(p => !p.metadata.deletionTimestamp && p.status.containerStatuses?.every(c => c.ready))?.spec.nodeName;
      if (!spec.nodeName) throw Error('No healthy baseline pod');
      delete spec.affinity;
      for (const container of [...(spec.initContainers || []), ...spec.containers]) if (container.image.includes('mamage-' + component)) {
        container.image = images[component].repository + '@' + images[component].digest; container.imagePullPolicy = 'Never';
      }
      const guard = name + '-release-' + sha.slice(0, 8);
      const labels = { ...deployment.spec.template.metadata.labels, 'app.kubernetes.io/instance': 'release-guard' };
      delete labels['pod-template-hash'];
      run('sudo', ['k3s', 'kubectl', '-n', options.namespace, 'apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'Pod', metadata: { name: guard, labels }, spec }) });
      guards.push(guard);
      kube('wait', '--for=condition=Ready', 'pod/' + guard, '--timeout=180s');
      kube('label', 'pod', guard, 'app.kubernetes.io/instance=' + options.release, '--overwrite');
      await waitEndpoint(name, json('get', 'pod', guard).status.podIP);
      logRun(component + '-helm', 'sudo', ['env', 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml', 'helm', 'upgrade', options.release,
        path.join(root, 'deploy/helm/mamage'), '-n', options.namespace, '-f', path.join(archive, 'values-' + component + '.private.json'), '--wait', '--timeout=300s'], 360000);
      const managed = json('get', 'pods', '-l', 'app.kubernetes.io/instance=' + options.release + ',app.kubernetes.io/component=' + component).items
        .find(p => p.metadata.labels['pod-template-hash'] && !p.metadata.deletionTimestamp && p.status.containerStatuses?.every(c => c.ready));
      assert.ok(managed, 'Replacement deployment is not ready');
      await waitEndpoint(name, managed.status.podIP);
      kube('delete', 'pod', guard, '--wait=true', '--timeout=120s'); guards.pop();
    }
    assert.deepEqual(snapshot(), before, 'Protected data changed during release; inspect, never restore the production database automatically');
    assert.equal(json('get', 'pod', databasePod.metadata.name).metadata.uid, databasePod.metadata.uid, 'Database pod unexpectedly changed');
    run('curl', ['--fail', '--silent', '--max-time', '15', next.publicURL + '/api/health/ready']);
    const receipt = { sha, images, archive, at: new Date().toISOString(), dataVerified: true };
    save('receipt.json', receipt);
    fs.writeFileSync(path.join(home, 'mamage-deploy/current-kubernetes-release.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ deployed: sha, dataVerified: true, archive }));
  } catch (error) {
    save('attention.json', { error: error.message, guards, action: 'Keep healthy guards online. Do not restore the database or roll back across permission migrations.' });
    throw Error('Release stopped; inspect private logs in ' + archive + ': ' + error.message);
  } finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { merge };
