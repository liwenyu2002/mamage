# 开发与验证

## 目录

- `apps/web`：React 前端及 UI 原型。
- `apps/server`：Node.js API、后台任务、人脸与视频分析。
- `scripts`：统一测试、发布、线上只读检查与代码回退。
- [部署与回退](deployment.md)：部署约定与迁移说明。

前后端独立安装依赖、构建和运行。

## 本地开发

Node.js 22.22 或更新版本。首次运行 `npm run setup`。

`npm run dev` 在 5188 端口运行本地前端，连接生产后端，默认阻止写操作。
生产数据只用于查看 UI，不要在本地启动面向生产数据库的后台任务。
后端开发需单独配置测试数据库后运行 `npm run dev:api`。

## 验证与发布

```bash
npm test
npm run build
git add <本次修改的文件>
git commit -m "说明本次修改"
npm run deploy
```

发布只接受 `main` 上已提交、工作区干净的版本。它推送 GitHub 和 Gitee，在学校服务器构建并测试容器，备份数据库后切换 Kubernetes 服务，再检查相册、文件夹与图片请求。失败保留健康过渡实例并停止发布，不自动回退数据库或跨权限迁移回退旧代码。

同步维护 `liwenyu2002/mamage` 与校内 `Levy/MaMage`。旧的 `mamage-web` 与 `mamage-server` 仓库保留作迁移前的历史参考，旧发布任务已停用。

`npm run test:k8s` 验证 Helm 配置与备份隔离；`node apps/web/scripts/test-project-hardening-browser.cjs` 验证运行状态和新闻稿局部改写的刷新恢复、明确采用与并发编辑保护。人工标注评测与确定性算法回归分开记录，不将合成测试通过率当作真实检索准确率。

密码、令牌、生产 `.env`、模型、运行数据、备份和禁止推送的接口文档均不进入仓库。
