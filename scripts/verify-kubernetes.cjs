const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'apps/server/package.json'));
const context = process.env.MAMAGE_K8S_TEST_CONTEXT;
const helm = process.env.HELM_BIN || 'helm';
const suffix = crypto.randomBytes(4).toString('hex');
const namespace = `mamage-verify-${suffix}`;
const mysqlImage = 'mysql:8.4@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70';

function run(binary, args, { input, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(Error(`${binary} ${args[0]} failed (${code}): ${stderr}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const kubectl = (args, options) => run('kubectl', ['--context', context, '-n', namespace, ...args], options);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, description, ms = 60000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { last = error; }
    await pause(500);
  }
  throw Error(`${description} timed out${last ? `: ${last.message}` : ''}`);
}

async function portForward(target, remote, forwards) {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn('kubectl', ['--context', context, '-n', namespace, 'port-forward', '--address', '127.0.0.1', target, `${port}:${remote}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  forwards.push({ child, closed });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Test port-forward timed out')), 15000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('Forwarding from')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.resume();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('Test port-forward exited early')); });
  });
  return `http://127.0.0.1:${port}`;
}

async function main() {
  // This harness may create/delete only its own namespace on an explicit local test cluster.
  if (!/^(colima|kind)-mamage-verify$/.test(context || '')) throw Error('Set MAMAGE_K8S_TEST_CONTEXT to colima-mamage-verify or kind-mamage-verify');
  const kubeconfig = JSON.parse(await run('kubectl', ['--context', context, 'config', 'view', '--minify', '-o', 'json']));
  const server = new URL(kubeconfig.clusters[0].cluster.server);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) throw Error('Refusing a non-loopback Kubernetes API');
  const forwards = [];
  const password = crypto.randomBytes(24).toString('hex');
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const database = `mamage_${suffix}_workspace_test`;
  const labels = { app: 'mamage-test-mysql' };
  let created = false; let databaseLocked = false;
  const sharedVolume = `${namespace}-shared`;
  let sharedVolumeCreated = false;
  const sql = input => kubectl(['exec', '-i', 'deployment/mysql', '--', 'env', `MYSQL_PWD=${password}`,
    'mysql', '-uroot', '--batch', '--skip-column-names', database], { input });
  try {
    const objects = [
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { 'mamage.test/owned': 'true' } } },
      { apiVersion: 'v1', kind: 'Service', metadata: { name: 'mysql', namespace }, spec: { selector: labels, ports: [{ port: 3306, targetPort: 3306 }] } },
      { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'mysql', namespace },
        spec: { replicas: 1, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: {
          automountServiceAccountToken: false,
          containers: [{ name: 'mysql', image: mysqlImage, imagePullPolicy: 'IfNotPresent',
            env: [{ name: 'MYSQL_ROOT_PASSWORD', value: password }, { name: 'MYSQL_DATABASE', value: database },
              { name: 'MYSQL_USER', value: 'mamage' }, { name: 'MYSQL_PASSWORD', value: password }],
            resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { cpu: '1', memory: '1Gi' } },
            readinessProbe: { exec: { command: ['sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -h 127.0.0.1 -u root --silent'] }, periodSeconds: 2 },
            volumeMounts: [{ name: 'data', mountPath: '/var/lib/mysql' }] }],
          volumes: [{ name: 'data', emptyDir: {} }],
        } } } },
      { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'mamage-runtime', namespace }, type: 'Opaque',
        stringData: { JWT_SECRET: jwtSecret, DB_HOST: 'mysql', DB_PORT: '3306', DB_USER: 'mamage', DB_PASSWORD: password,
          DB_NAME: database, COS_SECRET_ID: 'verification-only', COS_SECRET_KEY: 'verification-only', COS_BUCKET: 'verification-only' } },
    ];
    await run('kubectl', ['--context', context, 'create', 'namespace', namespace]);
    created = true;
    await run('kubectl', ['--context', context, 'apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: objects }) });
    // Test-only shared volume on this guarded, single-node local cluster. This
    // exercises two Pods, not the future school's multi-node RWX CSI driver.
    await run('kubectl', ['--context', context, 'apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: [
      { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: sharedVolume, labels: { 'mamage.test/owned': 'true' } },
        spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], storageClassName: '', persistentVolumeReclaimPolicy: 'Retain',
          claimRef: { name: 'shared-data', namespace }, hostPath: { path: `/tmp/${namespace}`, type: 'DirectoryOrCreate' } } },
      { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'shared-data', namespace },
        spec: { accessModes: ['ReadWriteMany'], storageClassName: '', volumeName: sharedVolume, resources: { requests: { storage: '1Gi' } } } },
      { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: `${sharedVolume}-assets`, labels: { 'mamage.test/owned': 'true' } },
        spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], storageClassName: '', persistentVolumeReclaimPolicy: 'Retain',
          claimRef: { name: 'shared-assets', namespace }, hostPath: { path: `/tmp/${namespace}-assets`, type: 'DirectoryOrCreate' } } },
      { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'shared-assets', namespace },
        spec: { accessModes: ['ReadWriteMany'], storageClassName: '', volumeName: `${sharedVolume}-assets`, resources: { requests: { storage: '1Gi' } } } },
      { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'prepare-test-volume', namespace }, spec: { template: { spec: {
        restartPolicy: 'Never', automountServiceAccountToken: false, containers: [{ name: 'prepare', image: 'mamage-api:verify-20261013', imagePullPolicy: 'Never',
          securityContext: { runAsUser: 0 }, command: ['node', '-e', "for (const p of ['/data','/assets']) require('fs').chmodSync(p, 0o777)"],
          volumeMounts: [{ name: 'data', mountPath: '/data' }, { name: 'assets', mountPath: '/assets' }] }],
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'shared-data' } }, { name: 'assets', persistentVolumeClaim: { claimName: 'shared-assets' } }],
      } } } },
    ] }) });
    sharedVolumeCreated = true;
    await kubectl(['wait', '--for=condition=complete', 'job/prepare-test-volume', '--timeout=120s']);
    console.log('[k8s-smoke] created isolated namespace and disposable MySQL');
    await kubectl(['rollout', 'status', 'deployment/mysql', '--timeout=180s'], { timeout: 190000 });
    const migrationDir = path.join(root, 'apps/server/scripts/migrations');
    const readSql = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const schema = readSql(path.join(root, 'apps/server/db/mamage_schema_only.sql'));
    const migrations = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()
      .map(file => readSql(path.join(migrationDir, file))).join('\n');
    const hash = load('bcryptjs').hashSync('verification-only-password', 10);
    const mysql = load('mysql2');
    const seed = mysql.format(`
      INSERT INTO organizations (id, name, slug, code) VALUES (7000001, 'Verification', 'verification', 'VERIFY');
      INSERT INTO organization_units (id, organization_id, name, slug) VALUES (7000001, 7000001, 'Verification', 'verification');
      INSERT INTO users (id, student_no, name, email, role, password_hash, organization_id, active_unit_id)
        VALUES (7000001, 'verification', 'Verification', 'smoke@example.invalid', 'photographer', ?, 7000001, 7000001);
      INSERT INTO organization_unit_memberships (unit_id, user_id, role) VALUES (7000001, 7000001, 'manager');
      INSERT INTO role_permissions (role, permission) VALUES ('photographer', 'photos.view');
      INSERT INTO projects (id, uuid, name, organization_id, unit_id) VALUES (7000001, UUID(), 'Verification album', 7000001, 7000001);
    `, [hash]);
    await sql(schema + '\n' + migrations + '\n' + seed);
    const values = {
      images: { api: { repository: 'mamage-api', tag: 'verify-20261013', pullPolicy: 'Never' },
        web: { repository: 'mamage-web', tag: 'verify-20261013', pullPolicy: 'Never' } },
      publicURL: 'http://127.0.0.1',
      objectStorage: { endpoint: 'http://unconfigured-storage:8080' },
      modelServices: { faceURL: 'http://unconfigured-face:8009' },
      api: { replicaCount: 2, strategy: 'RollingUpdate' },
      web: { replicaCount: 2, strategy: 'RollingUpdate' },
      persistence: { data: { existingClaim: 'shared-data', accessMode: 'ReadWriteMany', size: '1Gi' },
        webAssets: { existingClaim: 'shared-assets', accessMode: 'ReadWriteMany', size: '1Gi' } },
      config: { AI_VISION_PROVIDER: 'off', VIDEO_TRANSCRIPT_ENABLED: '0', AI_REQUEUE_ON_BOOT: '0' },
    };
    // The test does not provision object storage, real models, SMTP or public ingress.
    await run(helm, ['upgrade', '--install', 'smoke', 'deploy/helm/mamage', '--kube-context', context, '-n', namespace,
      '-f', '-', '--wait', '--timeout', '180s'], { input: JSON.stringify(values), timeout: 190000 });
    console.log('[k8s-smoke] Helm install: two API/two web Pods ready with non-root/read-only containers and shared test PVCs');
    let web = await portForward('service/smoke-mamage-web', 80, forwards);
    const status = async url => (await fetch(url, { signal: AbortSignal.timeout(5000) })).status;
    assert.equal(await status(web + '/'), 200);
    assert.equal(await status(web + '/api/health/ready'), 200);
    assert.equal(await status(web + '/uploads/units/7000001/private.jpg'), 403);
    assert.equal(await status(web + '/bundle.missing.js'), 404);
    const index = await fetch(web + '/index.html');
    assert.match(index.headers.get('cache-control'), /no-store/);
    const html = await index.text();
    const asset = /src="(\/bundle\.[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset);
    const script = await fetch(web + asset);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('cache-control'), /immutable/);
    const login = await fetch(web + '/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke@example.invalid', password: 'verification-only-password' }) });
    assert.equal(login.status, 200, await login.clone().text());
    const headers = { Authorization: `Bearer ${(await login.json()).token}`, 'X-Mamage-Unit-Id': '7000001', 'Content-Type': 'application/json' };
    const desktop = await (await fetch(web + '/api/album-desktop', { headers })).json();
    assert.equal(desktop.albums.length, 1);
    const saved = await fetch(web + '/api/album-desktop/state', { method: 'PUT', headers, body: JSON.stringify({
      scope: desktop.scope, workspaceRevision: desktop.workspaceRevision, groups: [
        { id: 'parent', name: 'Parent', parentId: null, projectIds: [] },
        { id: 'child', name: 'Child', parentId: 'parent', projectIds: [7000001] },
      ],
    }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    console.log('[k8s-smoke] login, private media ACL, static caching and nested folder write/read passed');
    const pods = JSON.parse(await kubectl(['get', 'pod', '-l', 'app.kubernetes.io/component=api', '-o', 'json'])).items;
    assert.equal(pods.length, 2);
    const leaderHost = (await sql(`SELECT HOST FROM information_schema.PROCESSLIST WHERE ID = IS_USED_LOCK(SHA2('mamage-runtime-leader:${database}', 256));`)).trim().split(':')[0];
    assert.ok(leaderHost, 'one background leader must hold the shared database lock');
    const pod = pods.find(item => item.status.podIP !== leaderHost);
    assert.ok(pod, 'a separate API replica remains available for readiness checks');
    const api = await portForward(`pod/${pod.metadata.name}`, 8080, forwards);
    await sql("ALTER USER 'mamage'@'%' ACCOUNT LOCK;");
    databaseLocked = true;
    const connections = (await sql("SELECT ID FROM information_schema.PROCESSLIST WHERE USER = 'mamage';"))
      .trim().split(/\s+/).map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
    for (const id of connections) await sql(`KILL CONNECTION ${id};`).catch(() => {});
    try {
      await until(async () => await status(api + '/api/health/ready') === 503, 'DB failure readiness');
      assert.equal(await status(api + '/api/health/live'), 200);
      const same = JSON.parse(await kubectl(['get', 'pod', pod.metadata.name, '-o', 'json']));
      assert.equal(same.metadata.uid, pod.metadata.uid);
      assert.equal(same.status.containerStatuses[0].restartCount, 0);
    } finally {
      await sql("ALTER USER 'mamage'@'%' ACCOUNT UNLOCK;");
      databaseLocked = false;
    }
    await until(async () => await status(api + '/api/health/ready') === 200, 'DB recovery readiness');
    console.log('[k8s-smoke] DB failure: non-leader API readiness 503/liveness 200; coordinator exits on lock loss and recovers');
    await kubectl(['rollout', 'status', 'deployment/smoke-mamage-api', '--timeout=180s'], { timeout: 190000 });
    const observerCode = `
      const fs = require('node:fs');
      (async () => {
        let requests = 0; const failures = []; const deadline = Date.now() + 120000;
        console.log('OBSERVING');
        while (Date.now() < deadline && !fs.existsSync('/tmp/finish')) {
          try {
            const response = await fetch('http://smoke-mamage-web/api/album-desktop', {
              headers: ${JSON.stringify(headers)}, signal: AbortSignal.timeout(3000)
            });
            const body = await response.json();
            if (response.status !== 200 || body.groups?.length !== 2) throw Error('status=' + response.status);
          } catch (error) { failures.push(String(error.message).slice(0, 150)); }
          requests++;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(JSON.stringify({ requests, failures }));
        process.exitCode = failures.length ? 1 : 0;
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    await kubectl(['apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'Pod',
      metadata: { name: 'rollout-observer', namespace }, spec: { restartPolicy: 'Never', automountServiceAccountToken: false,
        containers: [{ name: 'observe', image: 'mamage-api:verify-20261013', imagePullPolicy: 'Never',
          command: ['node', '-e', observerCode], securityContext: { runAsNonRoot: true, runAsUser: 1000, readOnlyRootFilesystem: true,
            allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
          resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
          volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }] }], volumes: [{ name: 'tmp', emptyDir: {} }],
      } }) });
    await until(async () => (await kubectl(['logs', 'rollout-observer'])).includes('OBSERVING'), 'service observer startup');
    await kubectl(['rollout', 'restart', 'deployment/smoke-mamage-api']);
    await kubectl(['rollout', 'status', 'deployment/smoke-mamage-api', '--timeout=180s'], { timeout: 190000 });
    await until(async () => await status(web + '/api/health/ready') === 200, 'API restart');
    const persisted = await (await fetch(web + '/api/album-desktop', { headers })).json();
    assert.deepEqual(persisted.groups.map(group => [group.id, group.parentId, group.projectIds]),
      [['parent', null, []], ['child', 'parent', [7000001]]]);
    await kubectl(['rollout', 'restart', 'deployment/smoke-mamage-web']);
    await kubectl(['rollout', 'status', 'deployment/smoke-mamage-web', '--timeout=180s'], { timeout: 190000 });
    web = await portForward('service/smoke-mamage-web', 80, forwards);
    assert.equal(await status(web + asset), 200);
    assert.equal(await status(web + '/api/health/ready'), 200);
    await kubectl(['exec', 'rollout-observer', '--', 'node', '-e', "require('fs').writeFileSync('/tmp/finish', '')"]);
    await until(async () => {
      const observer = JSON.parse(await kubectl(['get', 'pod', 'rollout-observer', '-o', 'json']));
      if (observer.status.phase === 'Failed') throw Error(await kubectl(['logs', 'rollout-observer']));
      return observer.status.phase === 'Succeeded';
    }, 'continuous service verification');
    const observed = (await kubectl(['logs', 'rollout-observer'])).trim().split('\n').at(-1);
    const traffic = JSON.parse(observed);
    assert.ok(traffic.requests >= 5);
    assert.deepEqual(traffic.failures, []);
    console.log(`[k8s-smoke] ${traffic.requests} continuous authorized folder requests during API/web rolling updates: zero failures`);
    console.log('[k8s-smoke] API/web rolling restarts preserved folder state and hashed assets; smoke verification passed');
  } catch (error) {
    if (created) {
      console.error(await kubectl(['get', 'pods', '-o', 'wide']).catch(() => 'Test pod status unavailable'));
      console.error(await kubectl(['logs', 'deployment/smoke-mamage-api', '--tail=60']).catch(() => 'Test API logs unavailable'));
    }
    throw error;
  } finally {
    if (databaseLocked) await sql("ALTER USER 'mamage'@'%' ACCOUNT UNLOCK;").catch(() => {});
    for (const { child, closed } of forwards) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await closed; clearTimeout(timer);
    }
    if (created) {
      await run('kubectl', ['--context', context, 'delete', 'namespace', namespace, '--wait=true', '--timeout=90s'], { timeout: 95000 });
      console.log('[k8s-smoke] removed owned namespace and all test data');
    }
    if (sharedVolumeCreated) await run('kubectl', ['--context', context, 'delete', 'pv', sharedVolume, `${sharedVolume}-assets`, '--wait=true', '--timeout=30s']);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
