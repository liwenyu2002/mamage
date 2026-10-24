const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'apps/server/package.json'));
const yaml = load('yaml');
const helm = process.env.HELM_BIN || 'helm';
const chart = path.join(root, 'deploy/helm/mamage');
const example = path.join(root, 'deploy/helm/values.example.yaml');

function render(overrides = {}, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-helm-test-'));
  try {
    const file = path.join(dir, 'values.yaml');
    fs.writeFileSync(file, JSON.stringify(overrides));
    const result = spawnSync(helm, ['template', 'migration', chart, '-f', example, '-f', file, '--kube-version', '1.34.0', ...args],
      { encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    return { ...result, resources: result.status === 0 ? yaml.parseAllDocuments(result.stdout).map(doc => {
      assert.deepEqual(doc.errors, []); return doc.toJSON();
    }).filter(Boolean) : [] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const component = (items, name) => items.find(item => item.kind === 'Deployment' && item.metadata.name.endsWith(`-${name}`));

test('rendered deployments keep singleton strategy, separate probes, retained volumes and no account tokens', () => {
  const rendered = render();
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.resources.filter(r => r.kind === 'Deployment').length, 2);
  assert.equal(rendered.resources.filter(r => r.kind === 'PersistentVolumeClaim').length, 2);
  assert.ok(rendered.resources.every(r => !['Secret', 'Job', 'HorizontalPodAutoscaler', 'CustomResourceDefinition'].includes(r.kind)));
  for (const role of ['api', 'web']) {
    const deploy = component(rendered.resources, role);
    assert.equal(deploy.spec.replicas, 1);
    assert.equal(deploy.spec.strategy.type, 'Recreate');
    const pod = deploy.spec.template.spec;
    assert.equal(pod.automountServiceAccountToken, false);
    assert.equal(pod.securityContext.runAsNonRoot, true);
    assert.equal(pod.containers[0].securityContext.readOnlyRootFilesystem, true);
    assert.ok(pod.containers[0].lifecycle.preStop.exec.command.join(' ').includes(role === 'api' ? '5000' : 'sleep 5'));
  }
  const api = component(rendered.resources, 'api').spec.template.spec;
  const container = api.containers[0];
  assert.equal(container.livenessProbe.httpGet.path, '/api/health/live');
  assert.equal(container.readinessProbe.httpGet.path, '/api/health/ready');
  const env = Object.fromEntries(container.env.map(row => [row.name, row.value]));
  assert.equal(env.ORGANIZATION_UNITS_ACTIVE, '1');
  assert.equal(env.MEDIA_URL_SIGNING, '1');
  assert.ok(!env.INTERNAL_UPLOAD_BASE_URL.includes('127.0.0.1'));
  assert.ok(env.INTERNAL_UPLOAD_BASE_URL.includes('migration-mamage-api'));
  assert.equal(env.FACE_DETECTOR_SERVICE_REQUIRED, '1');
  assert.ok(api.terminationGracePeriodSeconds >= Number(env.SHUTDOWN_TIMEOUT_MS) / 1000 + 10);
  assert.ok(rendered.resources.filter(r => r.kind === 'PersistentVolumeClaim').every(r => r.metadata.annotations['helm.sh/resource-policy'] === 'keep'));
});

test('dangerous deployment options, secrets in ConfigMaps and accidental unknown keys are rejected', () => {
  for (const values of [
    { api: { replicaCount: 2 } }, { api: { autoscaling: true } }, { api: { strategy: 'RollingUpdate' } },
    { api: { terminationGracePeriodSeconds: 15 } }, { web: { replicaCount: 2 } },
    { images: { api: { tag: 'latest' } } }, { config: { ORGANIZATION_UNITS_ACTIVE: '0' } },
    { config: { COS_SECRET_ID: 'not-a-real-secret' } }, { config: { SMTP_PASS: 'not-a-real-secret' } },
    { config: { REDIS_URL: 'redis://user:password@redis.example:6379' } },
    { modelServices: { faceURL: 'http://localhost:8009' } }, { typoAutoscaling: true },
    { modelServices: { visionURL: 'http://127.0.0.1:11434' } },
    { modelServices: { visionURL: '' }, config: { AI_VISION_PROVIDER: 'ollama' } },
    { publicURL: 'https://user:password@example.test' },
    { objectStorage: { endpoint: 'http://user:password@storage.example.test' } },
    { modelServices: { visionURL: 'https://user:password@vision.example.test' } },
    { modelServices: { mediaCallbackURL: 'http://127.0.0.1:8080/api/image' } },
    { modelServices: { mediaCallbackURL: 'https://user:password@example.test/api/image' } },
    { modelServices: { mediaCallbackURL: 'https://example.test/api/image?token=secret' } },
  ]) assert.notEqual(render(values).status, 0, JSON.stringify(values));
  assert.notEqual(render({ api: { replicaCount: 2 } }, ['--skip-schema-validation']).status, 0,
    'the shared-storage guard remains active when schema validation is skipped');
});

test('external model callbacks can use a reachable private gateway without changing the public origin', () => {
  const rendered = render({ modelServices: { mediaCallbackURL: 'http://10.1.131.37/api/image' } });
  assert.equal(rendered.status, 0, rendered.stderr);
  const env = Object.fromEntries(component(rendered.resources, 'api').spec.template.spec.containers[0].env.map(row => [row.name, row.value]));
  assert.equal(env.INTERNAL_UPLOAD_BASE_URL, 'http://10.1.131.37/api/image');
  assert.ok(env.UPLOAD_BASE_URL.startsWith('https://'));
});
test('Hub-only intranet deployment does not require or publish Mac face/Ollama endpoints', () => {
  const overrides = { publicURL: 'http://10.1.131.37', modelServices: { faceURL: '', visionURL: '' },
    config: { FACE_INFERENCE_PROVIDER: 'zgcai', AI_VISION_PROVIDER: 'zgcai', VIDEO_TRANSCRIPT_ENABLED: '0' } };
  const rendered = render(overrides);
  assert.equal(rendered.status, 0, rendered.stderr);
  const env = Object.fromEntries(component(rendered.resources, 'api').spec.template.spec.containers[0].env.map(row => [row.name, row.value]));
  assert.equal(env.FACE_DETECTOR_SERVICE_URL, undefined);
  assert.equal(env.FACE_DETECTOR_USE_SERVICE, '0');
  assert.equal(env.OLLAMA_BASE_URL, undefined);
  assert.equal(env.UPLOAD_BASE_URL, 'http://10.1.131.37/api/image');
  assert.notEqual(render({ ...overrides, config: { FACE_INFERENCE_PROVIDER: 'local' } }).status, 0);
});

test('API multi-replica rolling updates and optional HPA require shared storage', () => {
  const values = { persistence: { data: { accessMode: 'ReadWriteMany' } }, api: { replicaCount: 2, strategy: 'RollingUpdate' } };
  const rendered = render(values);
  assert.equal(rendered.status, 0, rendered.stderr);
  const api = component(rendered.resources, 'api');
  assert.equal(api.spec.replicas, 2);
  assert.equal(api.spec.strategy.type, 'RollingUpdate');
  assert.equal(api.spec.strategy.rollingUpdate.maxUnavailable, 0);
  assert.equal(api.spec.template.spec.containers[0].env.find(row => row.name === 'MAMAGE_DISTRIBUTED_RUNTIME').value, '1');
  const scaled = render({ ...values, api: { ...values.api, autoscaling: true } });
  assert.equal(scaled.status, 0, scaled.stderr);
  const hpa = scaled.resources.find(item => item.kind === 'HorizontalPodAutoscaler');
  assert.equal(hpa.apiVersion, 'autoscaling/v2');
  assert.equal(hpa.spec.minReplicas, 2);
  assert.equal(hpa.spec.maxReplicas, 4);
  assert.equal(component(scaled.resources, 'api').spec.replicas, undefined);
  assert.notEqual(render({ ...values, api: { autoscaling: true, minReplicas: 4, maxReplicas: 2 } }).status, 0);
  const web = render({ web: { replicaCount: 2, strategy: 'RollingUpdate' }, persistence: { webAssets: { accessMode: 'ReadWriteMany' } } });
  assert.equal(web.status, 0, web.stderr);
  assert.equal(component(web.resources, 'web').spec.replicas, 2);
  assert.equal(component(web.resources, 'web').spec.strategy.type, 'RollingUpdate');
});

test('existing claims and digest-pinned images do not create replacement claims or expose the API', () => {
  const rendered = render({ ingress: { enabled: false }, persistence: { data: { existingClaim: 'data-restored' }, webAssets: { existingClaim: 'assets-restored' } },
    images: { api: { tag: '', digest: 'sha256:' + 'a'.repeat(64) } } });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(!rendered.resources.some(r => ['PersistentVolumeClaim', 'Ingress'].includes(r.kind)));
  const api = component(rendered.resources, 'api').spec.template.spec;
  assert.ok(api.containers[0].image.includes('@sha256:'));
  assert.equal(api.volumes.find(v => v.name === 'data').persistentVolumeClaim.claimName, 'data-restored');
  assert.equal(rendered.resources.find(r => r.kind === 'Service' && r.metadata.name.endsWith('-api')).spec.type, 'ClusterIP');
});

test('web proxy preserves streaming and private-media routing; asset cache survives image replacement', () => {
  const rendered = render();
  assert.equal(rendered.status, 0, rendered.stderr);
  const nginx = rendered.resources.find(r => r.kind === 'ConfigMap' && r.metadata.name.endsWith('-web')).data['nginx.conf'];
  for (const value of ['proxy_buffering off', 'proxy_request_buffering off', 'proxy_read_timeout 3600s', 'api|uploads', 'no-store', '@historical_asset', '$request_method $uri $server_protocol']) assert.ok(nginx.includes(value));
  const pod = component(rendered.resources, 'web').spec.template.spec;
  const command = pod.initContainers[0].args[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-assets-test-'));
  const image = path.join(dir, 'image'); const assets = path.join(dir, 'assets');
  fs.mkdirSync(image); fs.mkdirSync(assets);
  try {
    const run = () => execFileSync('/bin/sh', ['-ec', command.replaceAll('/usr/share/nginx/html', image).replaceAll('/assets/', assets + '/')]);
    fs.writeFileSync(path.join(image, 'bundle.old.js'), 'original'); run();
    fs.writeFileSync(path.join(image, 'bundle.old.js'), 'different');
    fs.writeFileSync(path.join(image, 'bundle.new.js'), 'new'); run();
    assert.equal(fs.readFileSync(path.join(assets, 'bundle.old.js'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(assets, 'bundle.new.js'), 'utf8'), 'new');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('chart lint succeeds with explicit non-secret deployment settings', () => {
  const result = spawnSync(helm, ['lint', chart, '-f', example, '--strict'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('encrypted backup uses separate keys, private runtime settings and a bounded singleton job', () => {
  const result = render({ backup: { enabled: true } });
  assert.equal(result.status, 0, result.stderr);
  const cron = result.resources.find(r => r.kind === 'CronJob');
  assert.equal(cron.spec.concurrencyPolicy, 'Forbid');
  assert.equal(cron.spec.timeZone, 'Asia/Shanghai');
  const job = cron.spec.jobTemplate.spec;
  assert.equal(job.activeDeadlineSeconds, 1800);
  const pod = job.template.spec;
  assert.equal(pod.automountServiceAccountToken, false);
  assert.ok(pod.initContainers[0].args[0].includes('--single-transaction'));
  assert.ok(!pod.initContainers[0].args[0].includes('--databases'));
  assert.ok(pod.volumes.some(v => v.name === 'runtime-settings' && v.configMap));
  const keys = pod.volumes.find(v => v.name === 'backup-key').secret;
  const settings = pod.volumes.find(v => v.name === 'runtime-config').secret;
  assert.notEqual(keys.secretName, settings.secretName);
  assert.notEqual(render({ backup: { enabled: true, encryptionSecret: 'mamage-runtime' }, existingSecret: 'mamage-runtime' }).status, 0);
});

test('generated values preserve literal environment switches instead of YAML 1.1 booleans', () => {
  const rendered = render({ config: { AI_VISION_PROVIDER: 'off', REQUEST_LOGS: '0' } });
  assert.equal(rendered.status, 0, rendered.stderr);
  const config = rendered.resources.find(r => r.kind === 'ConfigMap' && r.metadata.name.endsWith('-config'));
  assert.equal(config.data.AI_VISION_PROVIDER, 'off');
  assert.equal(config.data.REQUEST_LOGS, '0');
});

test('verification workflows are valid YAML and do not publish or deploy containers', () => {
  for (const name of ['ci.yml', 'containers.yml']) {
    const doc = yaml.parseDocument(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'));
    assert.deepEqual(doc.errors, []);
    assert.ok(doc.toJSON().jobs);
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/containers.yml'), 'utf8');
  assert.doesNotMatch(workflow, /docker push|kubectl apply|helm upgrade/);
});
