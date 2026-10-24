# MaMage 稳定性与 Kubernetes 迁移审计

日期：2026-10-13。基准提交：`a1ef72e2f7bf72391b96735e5b0f60d5474154bf`，审查对象包括当前未提交工作区。原有新闻稿、检索等改动保留，未擅自回退或合并实验权重。

## 结论

**通用 Helm 已支持 API/web 多副本与滚动更新，API 可选 HPA；前后端完整依赖扫描均为零公告。** 已验证双进程上传/任务恢复和本地 Kubernetes 部署。学校多节点存储、真实 S3/模型与负载仍需验收，不以本地通过代替生产验证。

本轮未推送、提交、发布镜像、访问生产服务器或修改生产数据库。仅新建独立本地 Colima/K3s 集群，在随机测试库执行迁移和测试；本机旧开发服务按用户要求关停。既有 Mac Mini/PM2 生产部署保持不变。

本报告是风险导向的代码与回归审查，不是全项目逐行形式化验证、第三方渗透测试或所有终端的视觉验收。

## 尚未解决的风险

### P2：跨节点与外部副作用仍需故障验收

此前的单副本阻碍已做实际修复：新增共享会话/任务迁移，Chart 强制开启数据库共享模式；上传完成幂等、下载票据原子消费、ZIP 状态/取消跨实例可见，照片与处理意图原子提交。语义、人脸、相似向量、派生图、转码、ZIP 与渲染进入持久队列；新闻稿/外链导入/复制沿用数据库任务，由单个选举出的协调进程启动消费。

消费语义是 at-least-once，不是 exactly-once；外部 AI 请求在极端故障下可能重复。普通人脸重试不强制删除已有结果，已完成语义跳过重算，视频与派生图重试避免误删已引用对象。MySQL 命名锁只约束同一个写主节点，不能接入把锁操作分散到不同节点的读写分离代理。滚动更新/多副本必须使用实际 RWX 共享卷，单纯修改 PVC 声明无效。旧版本/独立 backfill 不参与新协调协议，切换前仍必须停止旧写入者。

### P2：学校目标集群与外部业务链路仍待验收

- 已实构建 Linux arm64 API/web 镜像，验证非 root、只读根文件系统、断网条件下的 Sharp、真实 2048 维 ResNet 推理、FFmpeg 视频生成/探测及 Chromium。镜像没有私有配置、原始上传或数据库备份，保留明确的正式迁移脚本。
- 本地 K3s 1.35.0/Docker CRI 已实际安装双 API + 双 web 的 Chart；PVC、代理、登录、ACL、缓存和文件夹读写通过。临时锁定测试数据库账号并断开旧连接后，非协调 API readiness 为 503、liveness 保持 200；协调进程因失锁退出并恢复。API/web 滚动重启后文件夹、相册归属和哈希资源保留。测试 RWX 为单节点专用 hostPath，不证明学校多节点 CSI 可用；专用命名空间与 PV 均已清理。
- 已加入独立容器构建验证工作流，但本轮未推送，所以远端 CI 未执行。Linux amd64 镜像、真实学校存储类/网关及推理硬件仍需目标架构实测。
- 目标集群、镜像仓库、证书、Ingress/网关和推理服务器未确定；本地成功不能证明这些外部条件可用。
- 放行条件：隔离数据库/bucket，真实组织权限、文件夹、分享、人脸、SMTP、搜索流、视频 Range/上传/转码实测；验证 Pod 停机与磁盘不足后的恢复，不只检查 HTTP 200。

### P2：数据库迁移不能视作整文件原子操作

[现有 SQL runner](/Users/liwenyu/mamage/apps/server/scripts/run_migrations.js:65) 用事务包裹文件，但 MySQL 的部分 DDL 会隐式提交；发生中途失败时，rollback 不保证撤销已经生效的结构修改。[MySQL 官方说明](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)

本次 Chart **没有 SQL hook、自动 seed 或恢复数据库动作**。迁移前完整备份并演练恢复；审阅 SQL 后独立执行，检查失败后的部分应用状态。应用回滚不等于数据库回滚。

### P2：外部服务、存储与模型不是复制 Git 就迁好

- [MySQL 连接池](/Users/liwenyu/mamage/apps/server/db.js:35) 尚未接入专用 TLS/客户端证书配置。若学校数据库强制 TLS，需要另做连接适配与验收，不能通过关闭校验应付。
- 私有 S3 的 Pod 可达、浏览器签名直传可达、HTTPS/CORS/Range 是不同检查；必须验证实际客户端链路。
- 100GB 视频后处理可能同时存在源文件、faststart 和转码副本。默认 256Gi PVC 只是起点，不是保证并发处理任意大视频的容量承诺；需要峰值临时空间、节点盘/PVC 监控及清理规则。
- 人脸权重/向量维度/预处理与数据库必须一致。Ollama、ONNX Runtime、Linux CUDA/CPU 与 Mac Metal/MPS 不能当成同一运行环境。
- 基础 API 镜像暂不提供 whisper.cpp 转写 CLI/权重，默认关闭转写；开启前需扩展镜像/模型挂载，否则配置检查拒绝启动。默认视觉 provider 也关闭，必须明确填写迁移后真实端点和模型。
- 数据备份需包含组织、小组、成员、文件夹、相册、人物纠错、分享、编辑台与任务表、私有配置和仍使用的本地上传文件；不可只恢复照片表。

### 已解决：开发工具依赖告警

开发预览改用 Vite 8.3.4 / React plugin 6.1.2，移除 webpack-dev-server/HPM/braces 链；正式发布仍用现有 Webpack 5 构建。构建 CLI 固定为不引入开发服务器可选 peer 的 6.0.1。前后端完整 `npm audit` 均为 **0**，没有忽略公告或使用强制审计修复。

默认只监听 `127.0.0.1`，保留同源代理和生产写入 405/登录白名单；限制开发文件访问，环境值安全序列化，复用生产 HTML 模板。真实 Chromium 测试覆盖整个 React 应用启动、SPA 回退、环境注入、热更新与代理。[Vite 服务器配置](https://vite.dev/config/server-options)

真实浏览器启动还暴露了 App 中权限变量先使用后初始化的问题，已仅调整声明顺序。开发服务不得暴露到公网；本机旧开发服务仍关停。

### P3：前端分包仍有性能优化空间

生产构建成功但有体积告警：入口合计约 440KiB，详情约 249KiB，风景约 254KiB，一个异步公共包约 353KiB，均为构建输出量而非浏览器压缩后传输量。

后续按真实首屏与交互测量再拆分编辑/导出模块和样式，避免为缩小单包增加大量小请求。本轮没有为了容器迁移大改界面或动画，也未声称完成所有手机/桌面视觉验收。

## 本次已修补

| 风险 | 实现与验证 |
| --- | --- |
| 致命异常仅记录，进程可能继续带病运行 | 新增 runtime lifecycle；致命异常非零退出，SIGTERM/SIGINT 限时排空、停止后台领任务、最后关闭数据库 |
| 旧 health 永远返回 ok，无法反映 DB 或停机状态 | 保留兼容 health；新增 live/ready，ready 检查数据库且有超时、共享在途检查，draining 返回 503；liveness 不请求外部 AI |
| `/uploads` 静态目录可能绕开私有媒体鉴权 | 与媒体代理共用授权规则；未授权/无效路径拒绝、依赖异常 fail closed，禁 dotfiles、no-store/nosniff；真实 HTTP 测试包含 HEAD |
| 重启阻塞于 AI 校验或产生额外推理请求 | 启动 AI 校验改为显式 opt-in、非阻塞，不影响非 AI 功能启动 |
| Redis 人脸任务仅在新上传时初始化消费者 | 启动主动初始化可选消费者，停机关闭 worker/queue/自有连接；本地模拟回归验证，无真实 Redis 验收 |
| 容器沿用本机路径、loopback、缺少转写资产 | 容器专用配置验证；Secret 缺失/无效端点/弱签名密钥/缺少必需资产拒绝启动，仅报告键名 |
| Kubernetes Pod IP 被当作校园内网地址 | 集群默认不自动返回 Pod IP，支持明确的固定 `LAN_ENTRY_HOST` |
| Linux 图像/邮件与前端清洗库存在公告 | sharp 升至 0.35.5、Nodemailer 升至 10.1.0、proxy-addr 锁至 2.0.8、DOMPurify 升至 3.4.17；兼容补丁更新后重新扫描和构建 |
| 新版本删旧前端分包可能造成旧页面白屏 | web 镜像 + 独立资源 PVC，initContainer 追加旧哈希包，不覆盖同名包；缺失 JS/CSS 返回 404，不回 SPA HTML；本地文件模拟验证保留逻辑 |
| 文件夹表只由独立脚本创建，标准初始化会漏表 | 真实隔离数据库复现 GET 桌面 500/缺表；新增 `20261013_002_album_desktop.sql`，只创建不存在的表，不重置数据；真实数据库与 K8s 读写/重启回归通过 |
| 基础镜像旧 pip 无法解析 PyTorch 依赖 | 固定兼容 pip 25.3 后 Linux ARM64 实构建成功；系统包增加重试和构建缓存，不把验证网络代理写入镜像 |
| 内存会话/任务阻碍多副本 | `20261013_003_shared_runtime.sql`；共享状态与持久 outbox、会话完成/取消锁、幂等完成、后台协调者与失锁退出、共享限流；真实双 API 与 SIGKILL 故障回归通过 |
| 前端多个 Pod 同时写资源缓存 | webAssets RWX 限制；临时文件 + 原子硬链接发布，不覆盖已有哈希资源，避免半文件可见 |
| 滚动更新时旧实例过早退出，短暂返回 502 | 双 Pod 重复演练捕获；API/web 增加 5 秒 preStop，给 Endpoint 摘除传播留时间，再执行原有优雅停机；不重试非幂等写入 |

依赖公告确认的是版本风险，不意味着已证明本应用受到利用；例如 proxy-addr 的实际暴露取决于代理信任设置。[sharp 公告](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[Nodemailer 公告](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v)、[proxy-addr 公告](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)、[DOMPurify 公告](https://github.com/advisories/GHSA-6688-9rhm-gjv2)

## Helm 范围

- 提供 API/web 独立镜像、Deployment、Service、ConfigMap、可选 Ingress 与两个保留 PVC；既有 PVC、拉取凭证和节点约束可配置。
- 非 root、只读根文件系统、禁权限提升、drop ALL、禁自动挂载服务账号 token、资源预算和独立探针。
- 模板/Schema 允许 API/web 多副本与滚动更新，API 可选 HPA；缺 RWX 拒绝扩容/滚动更新，拒绝 latest、误拼字段、ConfigMap 常见密钥及带凭证端点。Secret 外部管理。
- 同源 API、私有媒体代理与流式响应；不自动安装数据库/S3/推理服务，不自动升级数据库，不声称已实现高可用。
- [迁移指南](/Users/liwenyu/mamage/docs/kubernetes.md)、[Chart](/Users/liwenyu/mamage/deploy/helm/mamage/Chart.yaml)、[配置示例](/Users/liwenyu/mamage/deploy/helm/values.example.yaml)。官方资料与设计约束见 [研究记录](/Users/liwenyu/mamage/docs/research/kubernetes-deployment-contract-20261013.md)。

## 验证记录

最终结果以本轮终端回归为准，不能外推成生产负载验收：

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 最终轮通过，退出码 0；覆盖检索、新闻稿超时/契约、人脸纠错/访问、外链导入、上传清理、后台恢复、前端流/状态以及既有部署工具 |
| `test:runtime` | 17/17；真实 app.js HTTP/SIGTERM；队列停止/Redis consumer 使用模拟依赖，补测持久重试不重建已有脸、不覆盖已完成语义、排空期间仍保存任务，以及共享临时文件仅由空闲协调者清理 |
| `test:k8s` | 8/8；真实 Helm lint/template、RWX/多副本/HPA 配置、非法配置拒绝、资源约束、原子文件保留、字符串开关和工作流 YAML |
| `test:video` | 本地视频生产逻辑测试通过，不是大型视频或新集群播放实测 |
| `npm run build` | 成功，保留两组性能告警，见上文 |
| 完整依赖 audit | server/web 均为 0，包含开发依赖；以 2026-10-13 当前公告为准 |
| `test:workspace:isolated` | 空 schema + 39 个迁移、七组真实数据库用例。新增双独立 API 上传/重启/重复完成、编辑素材、票据单次消费、ZIP/取消、16 并行限流、outbox 失败回滚/重试、优先级及协调者 SIGKILL 接续；对象存储为替身，完成后停库清理 |
| `test:dev-server` | 1/1；真实 Vite/Chromium 全应用启动、代理、只读保护、登录、SPA、配置安全序列化和原生热更新 |
| Linux ARM64 镜像 | API/web 实构建成功；API 非 root/只读/断网原生运行检查成功，web Nginx 配置检查成功 |
| `test:k8s:smoke` | 本地 K3s 1.35.0 双 API + 双 web 实际安装成功；登录/文件夹/ACL/缓存、DB 故障与恢复、API/web 滚动更新保留数据与哈希资源通过；更新期间另由独立 Pod 连续发起 167 次带权限的文件夹请求，零失败；专用测试资源已清理 |
| 目标架构/真实 S3/模型/SMTP/HTTPS 网关/生产数据恢复 | **未执行**，必须在正式迁移前补验；本地集群只模拟外部配置，不伪称已验证实际模型准确率或对象存储吞吐 |
| 语法与补丁检查 | 75 个新增/修改 Node 文件语法通过，`git diff --check` 通过；`.local`、私有 API 文档和本地 Secret/values 覆盖文件仍被忽略 |

已有测试大量使用模拟数据库/对象存储/AI，能够覆盖错误路径与协议，不证明生产数据完整性、真实模型准确率或网络吞吐。禁止据此直接把迁移状态标为“生产验收完成”。
