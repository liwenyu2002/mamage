# Kubernetes 迁移准备

## 当前边界

采用 Helm Chart，不引入自定义 Operator。API/web 已支持多副本与滚动更新，API 可选 HPA；默认仍是节省资源的单副本配置。Chart 位于 `deploy/helm/mamage`，使用 Kubernetes 1.29+ 的标准资源；本地验证工具固定 Helm 4.3.0。学校的多节点存储、网关与真实业务链路仍需验收，不能等同于整个平台已高可用。

本机独立 Colima/K3s 已完成 Helm 安装、故障恢复和重启演练；目标 Linux 虚拟机已完成兼容镜像构建、完整数据库恢复和 Helm 部署。2026-10-13 按用户确认，暂停旧写入者后同步最新数据并切换正式流量，旧 API 已停止，旧数据库和备份保留，禁止恢复两端同时写入。没有向镜像仓库发布镜像或推送代码。

2026-10-16 按用户要求完成仅内网切换：应用和数据库运行在新集群，唯一网站入口为 `http://10.1.131.37`；人脸、图片和视频视觉分析使用校内 Hub，不再依赖 Mac Mini。声音转写暂停，旧转写结果保留；旧域名 DNS、Cloudflare 中对应的路由、Mac 上的 MaMage HTTP/HTTPS 反代和模型隧道已停用，其他站点的共享服务未停止。

当前 HTTP 入口仅限可信校园内网使用，不提供传输加密或浏览器安全上下文；“拍照找我”请上传自拍，不能保证网页直接调用摄像头。未来若恢复 HTTPS，应使用学校维护的独立入口，不恢复旧 Mac 网关。此处记录当前状态，下面的 Ingress/独立模型配置是后续部署选项，不代表当前已启用。

Chart 管理前端 Nginx、Node API、Service、可选 Ingress、非敏感 ConfigMap 和两个 PVC。数据库、对象存储、人脸服务、Ollama/其他 AI 服务、语音转写资产与备份由部署方独立管理。不自动执行 SQL 迁移、覆盖数据库、创建默认管理员或下载/更换人脸模型。

## 部署拓扑

```text
校园浏览器 / 现有 VPN
        |
固定内网域名 + HTTPS Ingress/网关
        |
  web Service / Nginx
        |
  API Service / Node（1 至多个 Pod）
     |        |          |
 外部 MySQL   私有 S3    独立人脸 / 视觉模型服务
     |
完整数据库包含组织、成员、文件夹、相册、人物、分享和编辑台数据
```

浏览器默认同源调用 `/api` 和 `/uploads`，镜像不需要为每个环境重建 API 地址。`/uploads` 同样经过后端媒体鉴权，不是公开静态目录。

## 多副本运行

Chart 强制开启 `MAMAGE_DISTRIBUTED_RUNTIME=1`。升级前必须执行 `20261013_003_shared_runtime.sql`；缺少共享状态/任务表时启动与就绪检查失败，不降级为各自的内存队列。

- 上传会话、一次性下载票据、ZIP 状态和关键限流共享 MySQL。相册视频、编辑台视频完成/取消操作由同一会话锁串行化，可在另一个 API Pod 继续；重复完成不会重复建记录，已提交文件不会被迟到的取消删除。
- 新照片记录和分析/派生图/视频后处理意图在同一事务提交，ZIP、渲染任务也持久化。后台按类型分开执行，照片优先于视频语义、交互上传优先于批量导入；已经运行的视频不会被强行抢占。
- 所有 API 可接请求，但只有持有数据库命名锁的协调进程启动后台扫描/执行。锁连接丢失时退出；替代进程重新领取中断任务。数据库必须是同一个写主节点，不能经读写分离代理把命名锁分发到不同 MySQL 节点。[MySQL 命名锁语义](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)
- 消费语义是可重试的 at-least-once，不承诺外部 AI 只调用一次或 exactly-once。已完成语义跳过、正常人脸重试不强制重建已有结果，确定性派生对象避免误删；最终失败任务在 `runtime_tasks` 可检查，保留七天。
- 单实例的旧 PM2 配置未自动切换，仍可沿用兼容内存模式。迁移必须停掉旧写入者/旧 worker；新模式的协调锁不能约束不参与该协议的旧版本或独立 backfill 脚本。

多副本示例（两个卷必须是真正支持 POSIX 共享读写的 RWX 卷，不是只改一个声明）：

```yaml
api:
  replicaCount: 2
  strategy: RollingUpdate
  autoscaling: false
web:
  replicaCount: 2
  strategy: RollingUpdate
persistence:
  data:
    accessMode: ReadWriteMany
    existingClaim: mamage-shared-data
  webAssets:
    accessMode: ReadWriteMany
    existingClaim: mamage-shared-webassets
```

API 自动扩容另设 `api.autoscaling=true`、`minReplicas`、`maxReplicas` 和 `targetCPUUtilizationPercentage`；需要集群提供资源指标，生产上限应按数据库连接数与硬件压测决定，不以 Chart 的配置上限视为容量承诺。后台重型任务仍保持单协调者、每类一个执行槽，不随 API 副本数翻倍。HPA 模板已验证，尚未做目标集群负载自动扩缩容验收。[Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)

## 先确定的资源

| 项目 | 必须确认 |
| --- | --- |
| 集群 | Kubernetes 1.29+、命名空间权限、节点架构、CPU/内存配额 |
| 镜像仓库 | API/web 仓库地址、节点拉取权限、不可变提交标签或 digest |
| 固定入口 | 内网域名、HTTPS 证书、Ingress/Gateway 类型；不要求公网入口 |
| 存储 | 可用 StorageClass 或现有 PVC、容量、fsGroup 权限、快照/备份责任人 |
| 数据库 | 独立应用账号、完整备份与恢复演练、字符集/时区/版本及 TLS 要求 |
| 对象存储 | 私有 S3 端点、原 bucket/对象键、读写权限、浏览器直传 CORS/HTTPS可达性 |
| 推理 | 人脸服务端点与相同权重、视觉模型端点与模型名、可选转写运行环境 |

API 的默认资源请求为 0.5 CPU/1Gi，限制为 4 CPU/4Gi，仅为起点，包含 Python 子进程和视频处理开销；不包含独立 AI 模型服务的预算。重型任务需要在目标硬件压测后调整。

## 构建镜像

先审核并提交需要发布的代码，再用该完整提交号标记镜像，不用 `latest`。构建上下文必须是仓库根目录：

```bash
docker build -f deploy/docker/Dockerfile.api -t REGISTRY/mamage/api:COMMIT_SHA .
docker build -f deploy/docker/Dockerfile.web -t REGISTRY/mamage/web:COMMIT_SHA .
```

API 镜像包含 Node、FFmpeg/ffprobe、Chromium、CPU Python/Torch/torchvision 和 ResNet-50 V2 预训练缓存，以及正式 SQL 迁移脚本。它不包含私人 `.env`、上传目录、数据库备份或本地检索实验。迁移不会自动执行。镜像较大，首次构建需要访问依赖/模型下载源；校园无外网构建机应提前准备镜像与缓存。

基础镜像已固定多架构 index digest；发布时还应扫描最终 Linux 镜像，并维护基础镜像补丁。2026-10-13 已实构建 Linux arm64 普通镜像和 Linux amd64 兼容镜像，并在断网、非 root、只读根文件系统下验证 Sharp、2048 维 ResNet 推理、FFmpeg/ffprobe 和 Chromium；这不是人脸模型准确率验证。arm64 普通 API 镜像逻辑大小约 1.11GB，web 约 23.8MB；amd64 兼容 API 约 4.06GB，MySQL 约 772MB，web 约 85MB。大小随架构和构建方式不同，不等于运行内存或压缩传输量。

普通 Linux amd64 镜像要求节点向虚拟机暴露 x86-64-v2 指令集（包括 SSE4.2）。仅显示现代 CPU 型号不代表这些指令实际可用；预编译 Sharp 及部分数据库基础镜像会在缺失时拒绝启动。可优先修正虚拟机 CPU 设置，不能修改时使用下面的兼容镜像。构建成功不等于运行验收通过，应先执行原生依赖测试，再导入业务数据或切换旧服务。[Sharp CPU 要求](https://sharp.pixelplumbing.com/install/)

`.github/workflows/containers.yml` 提供镜像构建、真实原生依赖运行及 Nginx 配置检查，**不推送镜像、不部署集群**。本地验收标签 `verify-20261013` 不是正式发布版本。构建固定 pip 25.3，避免基础系统旧安装器无法解析 PyTorch 依赖；系统包下载带重试和构建缓存。若构建机需要代理，通过 Docker 预定义代理 build args 传入，不把代理凭证写进 Dockerfile/镜像。

### 受限 x86-64 虚拟机

兼容构建保留 MySQL 9.6.0 和 Sharp 0.35.5/libvips 8.18.7，不改用 MariaDB，也不通过绕过 CPU 检查运行不兼容的二进制。MySQL 使用官方通用二进制和 Debian 基础；API 使用 baseline x86-64 编译 libheif/libvips/Sharp，并只在该镜像中关闭 PyTorch 的 oneDNN/NNPACK 优化后端。普通镜像仍使用原有优化路径。

先构建普通 API 作为不可变基础，再构建兼容层；仅支持 Linux amd64：

```bash
docker build --platform linux/amd64 -f deploy/docker/Dockerfile.api \
  -t mamage-api:COMMIT_SHA .
docker build --platform linux/amd64 -f deploy/docker/Dockerfile.api.compat \
  --build-arg API_IMAGE=mamage-api:COMMIT_SHA -t mamage-api:COMMIT_SHA-compat .
docker build --platform linux/amd64 -f deploy/docker/Dockerfile.mysql.compat \
  -t mamage-mysql:9.6.0-compat .
```

MySQL 兼容镜像只解决本次同版本迁移，不表示可以把任意旧版本物理数据目录挂进去直接升级。仍应完整逻辑备份、恢复到独立新卷并核对数据。数据库由部署方独立管理，不纳入应用 Chart 的自动升级/回退。

```bash
docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL \
  --entrypoint node mamage-api:COMMIT_SHA-compat scripts/test_compatible_image_runtime.js
docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL \
  --entrypoint node mamage-api:COMMIT_SHA-compat scripts/verify_container_runtime.js
bash deploy/docker/verify-mysql-compat.sh mamage-mysql:9.6.0-compat
```

若确实在不含 SSE4.2 的目标机验收，可给第一个命令增加 `-e EXPECT_LEGACY_CPU=1`，防止误把现代开发机结果当成旧 CPU 实测。CI 手动运行时勾选 `compatibility` 会额外构建并验证两个兼容镜像；CI 通常提供现代 CPU，不能替代受限目标机实测。

2026-10-13 受限目标机已通过 JPEG/PNG/WebP/TIFF/GIF/AVIF 编解码、PNG 像素无损往返、EXIF 旋转、SVG 合成和 ICC 测试，以及完整数据库 48 表计数和文件夹 JSON/时间戳摘要核对。源库的 36 个迁移升级至 39 个成功。固定合成图片的新旧 ResNet 向量余弦相似度大于 0.99999999999；兼容 CPU 启动加单次编码约 4.9 秒。这只证明该样本的向量兼容性，不代表全库检索准确率或热请求延迟。

容器上下文排除 macOS `._*` 元数据；迁移 runner 同时忽略隐藏文件，防止 AppleDouble 被当作 SQL。图片源代码包及数据库二进制下载均校验固定 SHA256。仍需持续更新安全补丁、扫描最终镜像，并在目标机验证实际照片和大视频链路。

## Secret 与配置

非敏感设置参照 `deploy/helm/values.example.yaml`，环境覆盖文件可命名 `deploy/helm/values.local.yaml`，已忽略。将占位域名、镜像标签、Ingress class、StorageClass 和模型名替换为实际值。

`existingSecret` 指向目标命名空间中预先准备的 Secret，必须包含非空键：

```text
JWT_SECRET
DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
COS_SECRET_ID COS_SECRET_KEY COS_BUCKET
```

可选敏感项包括 `MEDIA_URL_SECRET`、`EMAIL_CODE_SECRET`、`SMTP_PASS`、`SMTP_USER`、`VIDEO_TRANSCRIPT_SERVICE_TOKEN`、文本/视觉 API key、钉钉凭证和 `REDIS_URL`。模型名、普通服务地址等放在非敏感 `config` 中。不要把整个旧 `.env` 原封不动搬进 Secret；其中的旧 Mac 路径、loopback 地址、功能开关需要逐项核对。

Secret 不进入 Helm values、镜像或 Git。以安全目录中的专用文件创建，示例：

```bash
kubectl --context TARGET -n mamage create secret generic mamage-runtime \
  --from-env-file=/secure/mamage-runtime.env
```

保护该文件，不输出、提交或分享 Secret 内容。JWT 签名密钥至少 32 字符；迁移时默认保持已有有效密钥，短密钥需获得用户同意后独立轮换。轮换 JWT 会使旧登录失效，账号密码不变；独立的 `MEDIA_URL_SECRET` 应保留，避免顺带改变媒体签名。本次已按用户确认更换新生产的长随机 JWT；新登录有效、旧登录返回 401，旧站备份中的密钥未修改。

Secret 环境变量更新不会自动重建现有 Pod；修改后安排维护窗口并重启相应 Deployment，或使用新 Secret 名发布。

容器会在启动时检查配置完整性；数据库、人脸服务以及内部媒体回调不能指向别的 Pod 的 `127.0.0.1`。`INTERNAL_UPLOAD_BASE_URL` 默认使用 API Service DNS，仅适用于模型能解析并访问集群网络的情形。模型部署在集群外时，设置 `modelServices.mediaCallbackURL` 为模型实际可达的私有网关 `/api/image` 地址；仍使用短期服务签名，不开放无鉴权媒体。`LAN_ENTRY_HOST` 可填固定校园域名；未配置时不把 Pod IP 当作校园网址下发。

学校如果要求 MySQL TLS/客户端证书，需要在切换前核对并补齐当前数据库驱动的连接配置；不能因为 Secret 已填就认为 TLS 已验收。S3 自签证书应使用可信 CA，不全局关闭 Node TLS 验证。

集群外模型若运行在开启系统代理的主机上，需将私有媒体回调地址加入该服务的 `NO_PROXY`；否则模型可能将内网取图请求错误发给外网代理。保留需要的外网代理设置，不全局关闭 TLS 校验或媒体鉴权。应从模型进程的实际运行环境验证回调，不能只看管理终端中的 curl 成功。

## 模型与转写

- 当前 `FACE_INFERENCE_PROVIDER=zgcai`，通过校内 Hub 检测/编码，`modelServices.faceURL` 可以为空，不注入旧本地服务地址。其他需要独立人脸服务的 provider 仍必须提供该地址，并控制网络访问；不可把模型管理/索引接口公开给浏览器或公网。
- 保留当前识别模型、权重版本、向量维度与预处理，迁移后抽样对比新旧向量/匹配结果；不自动重跑或重新聚类全部人物。
- Ollama 配置不仅是 `visionURL`，还需 `config.AI_VISION_PROVIDER: ollama` 与真实 `OLLAMA_VISION_MODEL`。可改用原有云端兼容接口，但密钥通过 Secret 提供。默认 values 关闭视觉服务，示例文件展示接入方式。
- Mac Metal/MPS 不能直接搬到 Linux。Linux 使用 CPU 或经过验证的 CUDA/其他受支持加速后端；GPU 节点需驱动、设备插件与资源配额，主 Chart 不自动申请 GPU。
- 语音转写支持本地 whisper.cpp 或私有远程适配器。基础镜像不提供本地 CLI/模型，默认 `VIDEO_TRANSCRIPT_ENABLED=0`。本地模式需准备经过测试的扩展镜像和模型挂载，并提供 `VIDEO_TRANSCRIPT_WHISPER_CLI`、`VIDEO_TRANSCRIPT_MODEL_PATH`。
- 当前转写为关闭状态，远程转写地址和 token 已移除。未来恢复远程模式时，设置 `VIDEO_TRANSCRIPT_ENABLED=1`、`VIDEO_TRANSCRIPT_SERVICE_URL`，并通过 Secret 提供至少 32 字符的独立 `VIDEO_TRANSCRIPT_SERVICE_TOKEN`。API 提取单声道 16kHz WAV 后流式发送；私有模型主机可使用 `scripts/transcription_service.py`，校验 token、限制体积、只允许一个转写任务，超时/断连终止进程并清理音轨。服务只能通过私有网络访问，不能公开给浏览器。
- “拍照找我”在内存中压缩自拍，向人脸推理服务发送受限图片字节，不传跨主机无法读取的 `/tmp` 路径，也不入库或上传对象存储；响应不包含自拍内容。2026-10-16 停止旧模型隧道后，真实图片检测和视觉请求已通过；向量兼容性沿用此前抽样验收，不表示进行了全库准确率认证。
- 本地衣服颜色实验的研究限定权重不包含在镜像里，也未接入生产。

## 持久数据与容量

`persistence.data` 挂到 `/data`，包含旧本地上传文件、视频工作区与上传临时文件。原始照片/视频仍以对象存储为准，不把 bucket 自动搬进 PVC。

默认 data PVC 为 256Gi，示例为 512Gi。100GB 原视频的后处理可能同时存在源文件、faststart 副本和播放转码输出，不能只准备 100GB 空间；迁移前按实际视频与并发验证峰值空间。PVC 与节点磁盘都要告警，磁盘不足时后台任务可能失败。

目标虚拟盘已于 2026-10-14 扩为 80GB，仍不适合 100GB 视频完整落盘转码或剪辑渲染。100GB 对象存储直传上限不变；相册视频的本地后处理按源文件三倍空间加保留空间做预检，空间不足时保留已上传的原件、拒绝本地处理，不把系统盘填满。该保护不是对所有渲染工作峰值的保证，也不表示已实现对象存储全程流式转码。

webAssets PVC 保留历次带 hash 的 JS/CSS，避免升级后已打开的页面请求旧分包时白屏。首次从旧发布体系迁入时，需要将旧 `dist` 中仍被引用的 `bundle.*` 资源复制到该卷；后续版本由 initContainer 自动追加，不覆盖同名文件。需监控容量，不自动删除旧资源。

Chart 创建的 PVC 带 `helm.sh/resource-policy: keep`，卸载后可能保留，需要管理员处理；这不是备份保证，也不能代替 StorageClass reclaim policy。RWO 不等于全局单实例锁；选 RWOP 需验证 CSI 支持。多副本/滚动更新分别要求 data、webAssets 使用真实 RWX 卷。不得另外装一套连接生产库但配置不一致的 release。

## 网络与流式传输

内部 Nginx 默认关闭请求/响应代理缓冲，支持搜索逐批返回、视频 Range、下载流和上传进度，避免再缓存整份大视频。API 兼容兜底仍限制 5GiB；100GB 文件走对象存储分片/流式链路，不把 Nginx 请求上限简单改成 100GB。

Ingress 的请求体、读写超时、缓冲策略由具体控制器决定，不能照搬其他控制器的注解。`ingress.annotations` 留给学校确认的控制器配置。社区 ingress-nginx 已宣布于 2026 年 3 月停止维护，不建议作为新集群默认方案；它与 F5 NGINX Ingress Controller 不是同一个产品。下例仅供核对既有 ingress-nginx 环境，不作为新部署选型建议。[官方公告](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "5152m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-request-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
```

仅在该集群确实使用兼容控制器且运维审核通过时使用。其他控制器/网关需要等效配置。还需验证 Service、模型服务和对象存储的双向连通，以及浏览器是否能访问签名上传地址；Pod 可访问不等于客户端可访问。

## 本地校验

```bash
node scripts/install-helm.cjs
HELM_BIN="$PWD/.local/tools/darwin-arm64/helm" npm run test:k8s
npm test
npm run build
```

Linux 工具路径为 `.local/tools/linux-amd64/helm`（arm64 则替换架构名）。Chart 默认缺少实际 URL/镜像，因此必须提供配置，不能靠默认值直接安装：

```bash
helm lint deploy/helm/mamage -f deploy/helm/values.local.yaml --strict
helm template mamage deploy/helm/mamage -n mamage \
  -f deploy/helm/values.local.yaml
```

这些命令只渲染/校验，不证明集群资源、Secret 内容、证书或业务链路已经可用。

## 迁移与回退顺序

1. 在隔离环境恢复**完整数据库**，不仅是 projects/photos；组织、成员、小组、文件夹及个人偏好、人物纠错、分享、编辑台、任务表都要保留。测试环境使用独立 bucket/前缀及凭证，不能拿生产写权限测试删除/转码。
2. 备份数据库、私有配置、仍需保留的本地文件、模型资产；确认对象存储备份/版本管理。校验备份可恢复，不在代码回退时自动覆盖数据库。
3. 构建并扫描最终镜像；在新集群验证 PVC 权限、启动/就绪/停机、SMTP、组织隔离、文件夹、照片/视频、分享、检索、人脸和 AI 链路。用真实尺寸视频测临时盘与进度，不只测小文件。
4. SQL 变更由独立维护步骤审阅和执行。现有迁移 runner 的文件级事务不能回滚所有 MySQL DDL；失败要人工处理部分应用状态，不能当作全文件原子迁移。
5. 安排维护窗口，停止新上传/转存/打包/转码，等待重要任务完成；停止旧 API/所有写入者后再启动连接生产库的新 API。不要让 Mac Mini 与新集群并行消费同一批任务。
6. 更新固定内网域名入口，验证组织/文件夹/相册/照片计数及关键操作，再开放写入。旧服务器保留为回退手段，但禁止两端同时写入。
7. 代码回退使用同一 Helm release 的历史镜像和配置，并保持数据库、签名密钥与 bucket 一致。涉及不可逆 SQL 时，代码回退不一定兼容，需要预先设计数据库兼容策略。

Helm 4 可在运维审批后使用 `helm upgrade --install ... --wait --rollback-on-failure --timeout 15m`；Helm 3 相应使用 `--atomic --wait`。回滚 release 不会恢复外部业务数据。本地一次性测试 release 已删除；目标机测试库独立保留，最终生产使用停旧写入后新建并恢复的数据库，不能把测试库误当成生产库。

文件夹表已通过 `20261013_002_album_desktop.sql` 纳入正式迁移，保持旧独立脚本的结构与已有内容；完整恢复旧库后也需核对两张文件夹表，不可只恢复照片表。

## 可重复验收

本机已运行 `npm test`、前端生产构建、9 项 Helm 渲染/校验，以及下列独立验证。测试不会连接生产库：

```bash
# 需要本机 mysqld；新建随机数据目录和端口，空 schema + 39 个迁移，七组集成用例（含双进程故障注入）。
npm run test:workspace:isolated

# 已构建的 Linux API 镜像，断网运行原生依赖验收。
docker --context colima-mamage-verify run --rm --network none --read-only \
  --tmpfs /tmp --cap-drop ALL --entrypoint node \
  mamage-api:verify-20261013 scripts/verify_container_runtime.js

# 仅允许显式本地测试 context，且 API 地址必须为 loopback；不接受学校/生产 context。
MAMAGE_K8S_TEST_CONTEXT=colima-mamage-verify \
HELM_BIN="$PWD/.local/tools/darwin-arm64/helm" npm run test:k8s:smoke
```

集群验证要求先在指定本地集群装载 API/web `verify-20261013` 镜像与脚本固定的 MySQL 8.4 镜像。Colima 使用 Docker CRI 时与 Docker 共享镜像；使用 kind/containerd 时需要显式导入对应镜像。

集群脚本创建独占随机命名空间与一次性 MySQL，检查双 API/web Pod、同源代理、登录、私有媒体拒绝、旧分包缺失 404、嵌套文件夹读写、数据库账号临时锁定时的探针/协调者退出行为，以及滚动重启的数据与哈希资源保留。测试 RWX PV 是仅用于单节点本地演练的 hostPath，不能证明学校跨节点 CSI 可用；结束删除命名空间与专用测试 PV，不创建真实用户或公开入口。

独立测试环境不提供真实 S3、人脸、视觉、SMTP 或 HTTPS Ingress；这些仍需在目标集群验收，不能把本地通过外推为生产链路已迁好。本机验证 VM 结束后关停，保留镜像缓存供下次使用。

本次正式入口已另行验收：完整源库 48 表计数及文件夹摘要、同源相册和签名照片、公开分享、视频 Range、SMTP 认证（不发送测试邮件）、文本模型请求、人脸回调/自拍、远程转写，以及电脑/手机浏览器。合成语音样本转写约 4.4 秒，不代表长视频平均速度；100GB 上传/转码、目标集群扩容与故障切换尚未通过真实容量压测。

新机对象存储客户端还完成了随机临时文本对象的写入、读取和删除验证，不改动真实媒体，不创建测试相册。该小对象验收不能外推为 100GB 分片上传或多人吞吐已通过压测。

## 仍需目标验收

本机真实 MySQL + 双独立 API 测试覆盖跨实例视频/编辑素材上传、会话重启恢复、重复完成、一次性票据、ZIP 状态/取消、共享限流、事务回滚、任务优先级与协调者 SIGKILL 接续。该测试的对象存储使用协议替身，真实 S3/CORS/100GB 视频吞吐仍需目标链路验收。

本地 Kubernetes 验证不代表多节点网络分区、MySQL 主从切换或 CSI 故障已经完整验证。外部模型请求可能在故障后重复计费；本轮不重训或更换识图模型。为对象存储配置未完成 multipart 的生命周期清理，长视频的磁盘峰值、失败重试与终态告警也需压测。
