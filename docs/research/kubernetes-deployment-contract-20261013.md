# Kubernetes Deployment Contract: Official-Source Research

Checked **2026-10-13**. Scope: generic Kubernetes migration readiness for this Node/Express API and static-web monorepo, retaining external MySQL and S3-compatible storage. This is research and proposed constraints, **not a deployment approval or horizontal-scaling claim**. Only this document was written; no application/chart edits, installations, service starts, cluster/production access or runtime tests. Audit, containers, chart implementation and all verification belong to the main agent.

## 1. Project Evidence and Recommendation

Read-only observations from the current, already-dirty working tree, not a comprehensive audit:

- [API entrypoint](/Users/liwenyu/mamage/apps/server/app.js:164): `/api/health` unconditionally returns `ok`; startup starts several workers and periodic recovery. No SIGTERM/SIGINT handler appears in this entrypoint.
- [Tag worker](/Users/liwenyu/mamage/apps/server/lib/ai_tags_worker.js:10) and [face worker](/Users/liwenyu/mamage/apps/server/lib/face_auto_worker.js:3): queues and deduplication include process-local state. The face worker optionally uses BullMQ, but can fall back to memory. Redis being present does not establish safety for every other worker.
- [Configuration example](/Users/liwenyu/mamage/apps/server/.env.example:1) and [existing deployment policy](/Users/liwenyu/mamage/docs/deployment.md:1): external database/object storage, local uploads/video scratch space, and a separately managed Python face service are relevant boundaries. Existing policy separates code rollback from database restore/migration.

**Recommendation: a small Helm chart using built-in resources, not a custom Operator.** The current requirement is packaging and parameterizing Deployments, Services, configuration, optional persistence and an ingress integration. Helm supports chart templates and values validation. Operators instead add an application-specific reconciliation loop and custom resources. [Helm charts](https://helm.sh/docs/topics/charts/), [Kubernetes Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)

This is conditional engineering judgment, not a claim that Operators are inherently unsuitable. Reconsider only if this project must continuously reconcile domain-specific operations such as coordinated restores, schema-version transitions or failover, with clear ownership, idempotence and recovery semantics. Merely needing deployment, backups or a singleton does not justify writing that controller; an Operator would not repair worker concurrency automatically. Pin the Helm major and Kubernetes versions actually verified by the main agent. Current unversioned Helm pages include notices that some content is not fully updated for Helm 4. [Helm documentation notice](https://helm.sh/docs/chart_template_guide/function_list/)

## 2. Singleton and Storage: Do Not Equate RWO With a Lock

**Proposed first-migration API contract: `replicas: 1`, strategy `Recreate`, no API HPA.** Accept deployment downtime explicitly. This reduces old/new worker overlap during upgrades; it does not make memory queues durable.

Kubernetes defaults Deployments to `RollingUpdate`. `Recreate` waits for old Pods to be removed before creating the new revision **during upgrades only**. A manually deleted Pod can be replaced while its predecessor is still terminating. With rolling updates, terminating Pods can exist beyond the nominal replica/surge count; `maxSurge: 0, maxUnavailable: 1` is not equivalent to an application-wide singleton guarantee. Consider StatefulSet semantics and application-level fencing if a stronger identity/singleton requirement emerges; do not assume either solves partitioned or forcibly deleted processes. [Deployment strategy and terminating Pods](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy)

- **RWO (`ReadWriteOnce`) means one node**, which can host multiple Pods mounting the volume. **RWOP (`ReadWriteOncePod`) means one Pod** and requires suitable CSI support; stable since Kubernetes 1.29. RWOP is a storage constraint, not distributed task ownership. RWX likewise does not make queues or recovery scanners concurrent-safe. [Volume access modes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
- A rolling replacement may wait for an old RWO attachment on another node, or overlap writers on the same node. Treat these as CSI/scheduling risks to verify, not universal RWO behavior. `Recreate` does not remove detach/attach delays.
- Classify paths: durable local uploads need retained storage or an explicitly verified object-storage-only mode; disposable render scratch may use bounded `emptyDir`. It is not durable across Pod replacement. Mounting a PVC does not persist JavaScript arrays, timers or in-memory indexes. [Volume lifetimes](https://kubernetes.io/docs/concepts/storage/volumes/)
- A separate, immutable/read-only static-web Deployment can use `RollingUpdate` once its serving contract is established. That exception does **not** authorize additional API replicas.

Do not relax a singleton gate merely because MySQL/S3 are external, Redis is enabled, or session affinity is configured. The implementation now adds shared MySQL sessions/state, atomic upload intents, durable dispatch, coordinator ownership and fault-injection tests. Scaling is conditional on actual RWX volumes; tests cover two independent APIs and local Pods, not the target school's multi-node CSI or every network partition. Background delivery remains at-least-once.

## 3. Probes and a Bounded Shutdown Budget

Kubernetes gives probes different consequences: startup protects initialization before readiness/liveness begin; readiness removes an unready Pod from normal Service traffic without restarting it; liveness failure can restart the container. Size the startup allowance using `failureThreshold * periodSeconds` against measured cold starts. [Probe behavior](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

**Proposed application contract, to be implemented/verified by the main agent:**

| Check | Meaning | Pitfall to avoid |
|---|---|---|
| Startup | HTTP listener and required initialization completed within a bounded budget | Unlimited dependency/model waits; probes invoking inference or downloading models |
| Readiness | Not draining; required configuration and storage usable; bounded checks for dependencies essential to core requests | Treating the existing unconditional `/api/health` as dependency or shutdown readiness |
| Liveness | Local process/event loop can respond | Restarting every API Pod because external MySQL, object storage or an optional model is down |

Optional face/Ollama failure should degrade the affected feature, not automatically remove the whole API. If an operator makes inference mandatory, document that different readiness contract. Cache or bound dependency checks; avoid expensive storage/model requests on every probe.

The grace timer starts **before** `preStop`; kubelet runs that hook before sending TERM to PID 1. The default Pod grace period is 30 seconds, and remaining processes are forcibly killed when it expires. EndpointSlice termination/readiness updates happen alongside local shutdown, not as an acknowledged end-to-end load-balancer barrier. [Pod termination flow](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination-flow)

Recommended timing model, not measured defaults:

```text
terminationGracePeriodSeconds >= preStop/propagation budget
                                + bounded HTTP/stream/worker drain budget
                                + cleanup/safety margin

Example only: 10 seconds + 90 seconds + 20 seconds = 120 seconds.
```

On TERM, first mark unready and stop claiming/enqueuing work; stop accepting new requests, bound active HTTP/stream and worker completion, preserve recoverable job state, then close resources and exit. Ensure the real Node process receives TERM. A `preStop` sleep only consumes grace time; a larger grace period alone does not implement draining. Streams and multi-hour jobs cannot drain forever: define reconnection/resumption and durable retry behavior instead. Verify actual controller propagation and forced-kill recovery separately.

## 4. Secret `envFrom`: Keys, Contents and Version Differences

**Three validations are different:** a valid Secret data key, a valid environment-variable name for the target Kubernetes version, and a key the application actually reads.

Secret keys permit alphanumerics, `.`, `_` and `-`. Current Pod API documentation permits printable ASCII except `=` for environment names; relaxed environment validation became stable in Kubernetes 1.34. Older examples describing skipped `envFrom` names are version-sensitive, not a current universal C-identifier rule. [Secret constraints](https://kubernetes.io/docs/concepts/configuration/secret/#constraints-on-secret-names-and-data), [current Pod `envFrom` API](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/), [validation feature history](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/), [older skipped-key example](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/#restrictions)

For portability, **propose the stricter project policy `^[A-Z_][A-Z0-9_]*$`**, matching its existing configuration names. This is deliberately stricter than current Kubernetes. Enforce it on chart-owned ConfigMap/Secret/extra-env keys and separately validate operator-managed Secret keys.

- `envFrom` imports each data key as one variable. A Secret created with `--from-file=server.env=...` has a single `server.env` key; it does not parse the file into `DB_HOST`, `JWT_SECRET`, etc. Use individually named keys or a reviewed `--from-env-file` workflow. Do not assume dotenv and kubectl env-file parsing are identical. [Secret creation modes](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_generic/)
- Later `envFrom` sources win collisions; explicit `env` overrides `envFrom`. Reserve chart-controlled names, including listener ports and mounted paths, and reject conflicting extra-env overrides. [Pod environment precedence](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/)
- Use a required same-namespace `existingSecret`; do not print or place credentials in committed values, examples or rendered output. A name-only values schema cannot inspect that Secret's keys, empty values or credentials. Those need a separately authorized preflight/application validation. Missing non-optional Secrets block container startup. [Secret use and requirements](https://kubernetes.io/docs/concepts/configuration/secret/)
- Updating Secret-backed environment variables does not update running processes: plan a controlled restart. Never regenerate signing secrets on every Helm upgrade; preserve authentication/media-link continuity. [Secret environment update behavior](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/#define-container-environment-variables-using-secret-data)

## 5. Ingress: Controller-Specific Upload and Streaming Contract

Ingress requires a controller; implementations differ. Require an explicit class and identify the actual controller/version. Body sizes, connection/read/send timeouts and proxy buffering are **not portable core Ingress fields**. [Ingress classes](https://kubernetes.io/docs/concepts/services-networking/ingress/#ingress-class)

**Date-sensitive warning:** the community **ingress-nginx** retirement announcement ends maintenance in March 2026, including security fixes. Do not select it as the new migration default in October 2026. It is distinct from F5 **NGINX Ingress Controller**. The legacy column below is for identifying existing configuration, not a recommendation. [Kubernetes retirement announcement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/), [official controller distinction](https://kubernetes.io/blog/2026/02/27/ingress-nginx-before-you-migrate/)

| Setting | Community ingress-nginx, legacy | F5 NGINX Ingress Controller example |
|---|---|---|
| Maximum request body | `nginx.ingress.kubernetes.io/proxy-body-size: "64m"` | `nginx.org/client-max-body-size: "64m"` |
| Read/send timeout | `nginx.ingress.kubernetes.io/proxy-read-timeout: "180"`, corresponding `proxy-send-timeout` | `nginx.org/proxy-read-timeout: "180s"`, corresponding `proxy-send-timeout` |
| Streaming response buffering | `nginx.ingress.kubernetes.io/proxy-buffering: "off"` | `nginx.org/proxy-buffering: "False"` |

These are illustrative values, not tested limits. Do not mix annotation namespaces, timeout units or boolean syntax. [Legacy annotations](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/), [F5 annotations](https://docs.nginx.com/nginx-ingress-controller/configuration/ingress-resources/advanced-configuration-with-annotations)

NGINX response buffering differs from request-body buffering. `X-Accel-Buffering: no` can affect responses but may be ignored by proxy configuration. NGINX read/send timeouts measure gaps between I/O operations, not total request duration. Heartbeats help with idle timeouts but cannot defeat a separate absolute deadline. [NGINX proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)

Project-specific implications:

- [Upload settings](/Users/liwenyu/mamage/apps/server/.env.example:11) distinguish 30 MB photos, large API fallback and multipart/direct object-storage uploads. Do not translate the 100 GiB video product limit into a blanket ingress body limit. Choose route-specific maximum request/part sizes plus encoding overhead; bound any proxy temporary-disk usage. Direct browser uploads bypass the API ingress only when they truly reach object storage directly; the part-proxy route does not.
- Validate the smallest limit/time budget across client, edge/load balancer, ingress, static-web reverse proxy, Node and upstream services. An ingress annotation does not configure the other hops.
- The inspected [photo-search stream](/Users/liwenyu/mamage/apps/server/lib/photo_search_stream.js:1) is **NDJSON, not SSE**, with `X-Accel-Buffering: no` and 15-second heartbeats. Both NDJSON and any SSE route need incremental delivery, non-caching, suitable idle/total budgets and bounded deployment termination. Verify first-chunk/heartbeat delivery through the actual public proxy chain; an HTTP 200 alone proves none of this.

## 6. External Dependencies and Backups Are Separate Responsibilities

Keep MySQL and S3-compatible storage **external to this application release**. Explicitly exclude database/object-store provisioning, destructive restore and automatic schema migration from install/upgrade hooks. A selectorless Service can represent an external backend if needed; direct endpoint configuration is also possible. This is connectivity, not management or migration of the external service. [Services without selectors](https://kubernetes.io/docs/concepts/services-networking/service/#services-without-selectors)

Specify DNS/routing, egress, TLS/CA verification, credentials and least-privilege access independently. Browser-facing signed upload/playback endpoints must be reachable from clients, not merely from Pods; preserve S3-compatible path-style/CORS behavior only after the chosen provider is verified. Keep signing keys stable across code rollbacks.

| State | Required recovery ownership, proposed |
|---|---|
| MySQL | Database-owner backup schedule, consistency method, retention and restore/PITR rehearsal, with declared RPO/RTO |
| Object storage | Storage-owner versioning/retention/replication or backups, deletion recovery and actual restore rehearsal |
| Durable local uploads/PVC | Explicit retention/reclaim policy and application-consistent recovery procedure |
| Scratch/models/indexes | Mark disposable versus rebuildable; document source, model versions and rebuild cost |

MySQL documents backup strategies and point-in-time recovery separately from deployment. AWS S3 Versioning retains object versions, but that AWS behavior must not be presumed for every S3-compatible provider. CSI snapshots cover supported volumes, not external MySQL or bucket contents. Code/chart rollback is not data restore, and data restore must not happen automatically on a failed release. [MySQL backup/recovery](https://dev.mysql.com/doc/refman/8.4/en/backup-and-recovery.html), [AWS S3 Versioning scope](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [CSI snapshot scope](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)

## 7. Optional Face Python and Ollama: Endpoint Contract, Not Mac Assumptions

Default to not provisioning either inference service in the application chart; configure approved existing endpoints, or explicitly disable/degrade the feature. Changing an endpoint does not install Python, models or accelerator drivers.

- [Face client](/Users/liwenyu/mamage/apps/server/lib/face_detector.js:153) reads `FACE_DETECTOR_SERVICE_URL`; `FACE_DETECTOR_USE_SERVICE` and `FACE_DETECTOR_SERVICE_REQUIRED` control service preference/requirement, with a local Python fallback when permitted. Service-disabled is not necessarily face-feature-disabled. A slim image without Python must not silently select that fallback.
- [Python face service](/Users/liwenyu/mamage/apps/server/scripts/face_embed_service.py:95) selects ONNX Runtime CPU, or CUDA then CPU when `FACE_SERVICE_USE_GPU` is enabled. This implementation is not a PyTorch MPS service. CPU/CUDA/CoreML are distinct execution providers. [ONNX Runtime providers](https://onnxruntime.ai/docs/execution-providers/)
- [Ollama client](/Users/liwenyu/mamage/apps/server/ai_function/ai_for_tags/ai_for_tags.js:113) uses `AI_VISION_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_VISION_MODEL` and `OLLAMA_REQUEST_TIMEOUT_MS`. Confirm provider selection; adding `OLLAMA_BASE_URL` alone does not select Ollama. Configure the client base URL separately from the server's `OLLAMA_HOST` bind setting. [Ollama server binding](https://docs.ollama.com/faq#how-can-i-expose-ollama-on-my-network)
- `127.0.0.1` refers to the Pod network namespace, not the Mac or a different Pod. It works for cooperating containers in the **same** Pod; otherwise use Service DNS or a reachable external address. Separate Python/Ollama Pods must listen on an appropriate interface. The [media URL rewrite](/Users/liwenyu/mamage/apps/server/db.js:114) must also yield a URL reachable by the Python service, not an API-Pod loopback URL. [Pod networking](https://kubernetes.io/docs/concepts/workloads/pods/#pod-networking)
- PyTorch MPS targets macOS/Metal and does not transfer to a Linux container by setting `device=mps`. Ollama uses Metal on Apple hardware and different supported backends on Linux; these are not interchangeable runtime settings. Choose CPU or a specifically supported Linux accelerator stack and verify model/backend compatibility, memory and latency. Kubernetes GPU access additionally needs node drivers/device plugins and the matching resource request. Do not expose an apparently universal `mps` chart option. [PyTorch MPS](https://docs.pytorch.org/docs/stable/notes/mps.html), [Ollama hardware support](https://docs.ollama.com/gpu), [Kubernetes GPU scheduling](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)

## 8. Actionable Values Schema and Render Guards

**Proposed value paths below are illustrative, not claims about an existing chart.** Encode explicit types, required parent/child fields and defaults in values; reject unknown keys in closed configuration objects, while deliberately allowing documented extension maps. JSON Schema `default` is not a substitute for supplying runtime defaults.

Helm applies `values.schema.json` to final merged values for install, upgrade, lint and template, but validation can be skipped. Repeat safety-critical checks with template `fail`; this still cannot prevent someone applying different manifests or manually scaling a live Deployment. Neither schema nor rendering proves dependency reachability, Secret contents or controller behavior. [Helm schema validation](https://helm.sh/docs/topics/charts/#schema-files), [Helm template guards](https://helm.sh/docs/chart_template_guide/function_list/#fail)

| Value/contract | Schema constraint | Additional render/preflight constraint |
|---|---|---|
| `api.replicaCount` | Required integer, 1..32 | Reject invalid types/ranges; replicas, rolling updates and HPA require actual RWX storage; repeat storage guard in templates |
| `api.autoscaling.enabled` | Required `boolean`, `const: false` | Render no API HPA; reject enabling it, even with `maxReplicas: 1` |
| `api.strategy.type` | Required `string`, `const: "Recreate"` | No `rollingUpdate` block in the rendered Recreate strategy; do not offer a bypass flag |
| Probe paths/ports | Nonempty string paths beginning `/`; integer ports 1..65535 or declared named port | Must exist in the selected image; do not invent readiness semantics for `/api/health` |
| Probe timers | Integer periods/timeouts/failure counts >=1; delays >=0; startup/liveness success threshold exactly 1 | Cold-start allowance and bounded dependency timeout compatible with measured behavior |
| Grace/drain timers | Grace integer >=1; hook/drain/margin integers >=0 | Template comparison enforces grace >= hook + drain + margin; real drain remains an application requirement |
| `existingSecret` | Required nonblank name, Kubernetes object-name syntax | Same namespace; required keys/nonempty values checked separately without revealing contents |
| `env` / `extraEnv` maps | Object; `propertyNames.pattern: "^[A-Z_][A-Z0-9_]*$"`; string values | Explicit allowlist/denylist for chart-owned ports, mounted paths and feature controls; reject collisions |
| Persistence mode | Enum such as `existingClaim`, `createClaim`, `ephemeral` | Mutually exclusive claim inputs using `oneOf`/conditionals; ephemeral forbidden for required durable local data |
| Claim access mode | Singleton baseline enum `ReadWriteOnce` / `ReadWriteOncePod` | RWOP requires CSI compatibility; no scaling authorization from either choice; no automatic claim deletion/migration |
| Ingress enabled | Boolean; when true require nonblank class, host and documented controller profile | Unknown/custom controller must supply reviewed settings; no universal NGINX defaults |
| Ingress annotations | String-valued map | Validate against selected controller's documented units/syntax, especially size/timeouts/buffering |
| Face/Ollama mode | Explicit enums such as `disabled` / `external`, plus endpoint string when external | Parse HTTP(S) URL with host; reject loopback unless same-Pod topology is explicitly established; set actual provider/requirement flags |
| DB/object-storage mode | External-only enum or disabled provisioning booleans | No bundled MySQL/S3 deployment, credentials generation, auto-migration or restore hooks |

Avoid `default 1` masking an invalid replica value of 0, and `default true` undoing an explicit boolean false: Helm considers both 0 and false empty. Use presence/type-aware checks. [Helm default semantics](https://helm.sh/docs/v3/chart_template_guide/function_list/#default)

**Future HPA constraints are not current API permission:** only after a separate scaling design is approved, use integer `minReplicas/maxReplicas >=1`, render-time `minReplicas <= maxReplicas`, nonempty valid metrics, required resource requests for utilization metrics, and omit Deployment `spec.replicas` while the HPA owns scaling. Resource metric infrastructure must exist. JSON Schema draft-07 does not by itself compare two arbitrary sibling numeric values; use a template guard. [HPA resource requests and replica ownership](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)

## 9. Handoff: Verification Required, Not Performed Here

The main agent should verify valid/invalid values, rendered resource kinds/strategy/replicas, image health endpoints, required Secret-key handling, SIGTERM plus forced-kill/recovery behavior, CSI permissions/retention, optional-model degradation, and real upload/stream delivery through the selected ingress chain. Confirm externally owned backup/restore procedures separately. Until those checks pass, this note supports design decisions only, not operational readiness.
