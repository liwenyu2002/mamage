# 学校 Kubernetes 发布

网站与 MySQL 运行在 `ubuntu@10.1.131.37` 的 K3s，namespace `mamage`，Helm release `school`。网站入口为 `http://10.1.131.37/`。图片、人脸和视频视觉分析使用校内 Hub；不恢复 Mac Mini 网关或本地模型，声音转写保持关闭。

## 发布源

`main` 同时推送到 GitHub `liwenyu2002/mamage` 与校内 Gitee `Levy/MaMage`。发布仅接受干净工作区的完整提交，导出同一份源码到服务器不可变目录 `~/mamage-releases/<提交>-<时间戳>`，不从临时工作目录发布。

根目录 `npm run deploy` 是当前入口。`scripts/deploy-remote.cjs` 是历史 Mac 流程，不再使用。通用集群安装与存储要求见 [Kubernetes 部署](kubernetes.md)。

## 更新流程

1. 本地完成后端、前端、浏览器、Helm 验证并提交。
2. 检查两端推送、发布锁、至少 12 GiB 可用空间和未执行的数据库迁移。
3. 保存私有 Helm 值与 Secret，完整导出数据库，记录各组织媒体数量、文件夹状态摘要和人脸授权。
4. 从固定源码构建镜像，在服务器实际 CPU 上检查 Sharp、HEIF 和 Python 运行时，再执行完整 API 测试。
5. 启动健康过渡 Pod，确认进入服务端点后逐个更新 API、前端；新 Deployment 健康后移除过渡 Pod。
6. 核对数据库 Pod 未重启、保护数据一致、健康接口可用，保存发布回执。

服务器最小安装可用已经验证的 API 镜像提供 Node。可指定 `MAMAGE_DEPLOY_HOST`、`MAMAGE_NAMESPACE`、`MAMAGE_RELEASE`。`MAMAGE_HELM_VALUES` 指向未入库的本地 JSON 覆盖文件；不在命令行传密码。默认推送两端；已单独验证镜像的发布可使用 `--skip-push`。

学校虚拟 CPU 缺少部分指令集。默认执行完整兼容构建；使用 `MAMAGE_COMPAT_BASE_IMAGE` 时必须指定已验证镜像的完整 digest 或本地 image ID。依赖更新保留该镜像的原生编译结果，Sharp 版本变化会拒绝此捷径，必须重做完整兼容构建。`MAMAGE_WEB_BASE_IMAGE` 可指定同样固定的本机 Nginx 基础镜像，避免内网构建依赖外网拉取。不得直接部署未验证的官方预编译 Sharp/MySQL。

## 失败与回退

详细日志、导出数据与回执在 `~/mamage-deploy/releases/`，权限仅限部署账号。当前成功版本记录在 `~/mamage-deploy/current-kubernetes-release.json`。

构建失败不更新在线服务；切换失败保留健康过渡 Pod并记录待处理事项，不自动恢复数据库。先核对 EndpointSlice、Pod 和日志，再对兼容现有 schema 的已验证镜像做代码回退。不得跨越人物维护权限迁移，恢复忽略 `can_manage` 的旧 API。不要删除仍在运行的发布锁或过渡 Pod。

## 加密备份

Chart 的 `backup.enabled` 启用每日 02:35（Asia/Shanghai）CronJob；禁止重叠运行，最长 30 分钟。MySQL 单事务导出与运行配置使用 AES-256-GCM 流式加密后写入独立对象前缀，并完整回读校验 SHA256 和体积，成功才写入运行状态。

加密密钥必须位于单独的 Secret，并在另一台设备离线保管；不要仅备份密文却遗失密钥。运行 Secret 与 ConfigMap 均包含在加密包内。原始照片、视频仍在对象存储，不复制到应用服务器；对象版本保护与存储平台的独立备份负责原件恢复。版本保护不能替代异地备份。

`scripts/configure_storage_protection.js` 默认只读，`--apply` 才开启版本保护及规则：原件仅清理 7 天未完成的分片，不到期删除完整原件；加密备份保留 35 天并清理旧版本。规则保留其他所有者的配置。

恢复先用 `scripts/backup.js extract --input <密文> --output <新私有目录> --key-file <私钥文件>` 校验认证标签与文件摘要，再手动恢复到全新的隔离数据库。该工具不运行 SQL、不覆盖现有目录。演练应核对所有表的数量、文件夹摘要与授权，不直接对生产库测试恢复。

## 学校接入

HTTPS 与钉钉必须使用学校域名、受信证书及学校应用凭证。配置示例在 `deploy/helm/values.school-https.example.yaml`；`npm --prefix apps/server run integrations:check` 检查配置及 HTTPS 可达性。资料不齐时保持禁用，不使用个人域名或要求用户安装自签名证书。
