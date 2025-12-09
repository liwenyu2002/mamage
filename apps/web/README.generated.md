# MaMage_Web — 项目概览（自动生成）

本文档基于当前工作区源码自动生成，包含开发环境、运行步骤、前后端交互约定与主要功能摘要，便于开发与调试。

**重要说明**：后端示例（位于 `backend/`）只包含用户认证路由（`/api/users`）和数据库初始化示例。前端（`src/`）预期后端提供更多接口（projects、photos 等），请确保后端实现了这些接口或通过代理指向真实后端。

**目录**
- **环境与依赖**
- **运行与开发**
- **环境变量（后端）**
- **主要前端文件**
- **后端 API 约定（前端期望）**
- **管理员（Admin）行为说明**
- **调试提示**
- **常见问题**

**环境与依赖**
- **Node / npm**: 使用 Node LTS（文档中测试为 Node v24.x，通常 Node 18+ 可用）。
- **前端依赖**: `react`, `react-dom`, `@douyinfe/semi-ui`, `@douyinfe/semi-icons` 等，详见 `package.json`。
- **开发工具**: `webpack` + `webpack-dev-server`（开发服务器配置见 `webpack.config.js`）。

**运行与开发**
- 安装依赖：

```powershell
npm install
```

- 启动开发服务器（默认使用 `webpack-dev-server` 配置的端口 5173）：

```powershell
npm run start
```

如果端口 5173 被占用，可通过覆盖 dev server 参数或修改 `webpack.config.js` 中 `devServer.port` 来启动到其他端口。

- 打包生产构建：

```powershell
npm run build
```

**后端（示例）**
- 后端示例入口：`backend/server.js`（使用 `express`）。该示例会自动创建 `users` 表（使用 `knex` 连接 MySQL）。
- 启动后端（需在 `backend/` 下自行执行 `npm install` 并运行，或在项目根按需运行）：

```powershell
# 在 backend/ 下
node server.js
# 或 使用 nodemon 等工具
```

**环境变量（后端）**
- `PORT` — 后端监听端口（默认 `3000`）。
- `DEV_FRONTEND_ORIGIN` — 允许 CORS 的前端 origin（默认 `http://localhost:5173`）。
- MySQL 连接：`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`（默认 `mamage`）。
- JWT：`JWT_SECRET`（默认 `change-me-please`，上线请修改）与 `TOKEN_EXPIRES_IN`（如 `7d`）。

**主要前端文件（说明）**
- `src/App.jsx`：应用入口和路由布局，负责加载项目列表、当前用户状态、打开新建相册模态等。
- `src/index.jsx`：React 根渲染。
- `src/ProjectDetail.jsx`：项目详情页（展示图片、元信息、现在已支持在详情下方渲染 `tags`）。
- `src/CreateAlbumModal.jsx`：新建相册模态，支持填写 `title`、`description`、`eventDate`、并（仅管理员）填写 `tags`。
- `src/services/request.js`：前端请求封装和 `resolveAssetUrl`，支持通过 `window.__MAMAGE_API_BASE__` 覆盖 API 基址。
- `src/services/projectService.js`：封装 `GET /api/projects`, `GET /api/projects/list`, `GET /api/projects/:id`, `POST /api/projects`（create）, `POST /api/projects/:id/update`（update）, `DELETE /api/projects/:id`（delete）等调用逻辑。
- `src/services/photoService.js`：封装图片上传 `/api/photos/upload`、删除、查询等操作。
- `src/services/authService.js`：封装 `GET /api/users/me`, `POST /api/users/login`, `POST /api/users/register`, `PUT /api/users/me` 等用户认证与用户信息 API，保存与读取本地 JWT 的键为 `mamage_jwt_token`。

**后端 API 约定（前端期望）**
下面列出前端使用/期望的常用后端接口与行为：

- **用户（Auth）**
  - `POST /api/users/register` — 注册（返回 token 或 id）。
  - `POST /api/users/login` — 登录，返回 `{ id, token }`；前端会把 token 存到 `localStorage['mamage_jwt_token']`。
  - `GET /api/users/me` — 需要 `Authorization: Bearer <token>`，返回当前用户基本信息（包含 `role` 字段，用于判断是否为 admin）。
  - `PUT /api/users/me` — 更新当前用户信息。

- **项目（Projects）** — 前端预期后端实现下列接口（若后端与这些路径不同，请配置 `window.__MAMAGE_API_BASE__` 或调整 `projectService.js`）：
  - `GET /api/projects` — 列表或最新项目（可接收 `limit`）。
  - `GET /api/projects/list?page=&pageSize=&keyword=` — 分页搜索列表；返回 `{ list: [...], hasMore, total, page, pageSize }`。
  - `GET /api/projects/:id` — 获取项目详情；响应中应包含 `images`、`tags`（数组或可解析的字符串）、`eventDate`、`createdAt`、`photoCount` 等字段。
  - `POST /api/projects` — 创建项目；请求 body 可包含 `projectName`/`title`、`description`、`eventDate`、`tags`（数组或字符串化数组）。前端会在 headers 中携带 `Authorization`（若本地存有 token）。
  - `POST /api/projects/:id/update` — 更新项目；前端会将更新的字段（包括 `tags`，仅当当前用户为 admin 时）放入请求体并带 `Authorization`。
  - `DELETE /api/projects/:id` — 删除项目（需要鉴权）。

- **图片（Photos）**
  - `POST /api/photos/upload` — 上传图片（FormData，字段名 `file`，可附带 `projectId`）。
  - `POST /api/photos/zip` — 打包下载：接收 photo IDs，返回 zip 二进制并带 `Content-Disposition` 文件名。
  - `POST /api/photos/delete` 或 `DELETE /api/photos` — 删除照片（接收 `{ photoIds: [...] }`）。
  - `GET /api/photos` — 可按 `projectId`、`limit`、`random` 等查询。

**管理员（Admin）功能与前端实现细节**
- 前端通过调用 `GET /api/users/me`（`authService.me()`）并检查响应中的 `role` 字段或 `isAdmin` 来判断是否为管理员（`isAdmin` 或 `role === 'admin'` 或角色数组包含 `'admin'`）。
- 在 `CreateAlbumModal.jsx` 与 `ProjectDetail.jsx` 的编辑弹窗中，**tags 编辑控件仅对 admin 可见**。当保存/创建操作发生时：
  - 前端在请求头自动带上 `Authorization: Bearer <token>`（token 来自 `localStorage['mamage_jwt_token']`）。
  - 如果当前用户是 admin，前端会把 `tags` 字段（数组）附加到 `POST /api/projects` 或 `POST /api/projects/:id/update` 的 body 中。
- 后端数据库中 `projects` 表应包含 `tags` 字段（JSON），并且创建/更新接口需要正确写入该字段，GET 接口应返回 `tags`（数组或可被前端解析的形式）。

**主要功能摘要（前端）**
- 项目列表与搜索（按关键字/标签支持搜索）。
- 项目详情页：展示项目元信息、图片画廊、删除/选择/打包下载图片、图片查看器（查看原图/缩略图切换）。
- 中转站（TransferStation）：跨页面收集选中图片并支持复制为富文本 HTML、打包下载等（组件：`src/TransferStation.jsx`）。
- 新建相册与编辑：支持填写 `title`、`description`、`eventDate`，管理员可填写 `tags`。

**调试提示**
- 前端请求基址可通过在页面控制台设置 `window.__MAMAGE_API_BASE__ = 'http://localhost:3000'` 来覆盖（对部署环境或调试代理很有用）。
- 为了检查项目详情页拿到的原始数据，`ProjectDetail.jsx` 暂时会把最后加载的项目数据暴露为 `window.__MAMAGE_LAST_PROJECT`（在浏览器控制台输入该变量可查看 `resolvedProject` 与解析后 `tags`）。
- `localStorage` 中 JWT 使用键：`mamage_jwt_token`。

**示例：创建项目（curl）**

```bash
curl -X POST "http://localhost:3000/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{"projectName":"示例项目","description":"说明","eventDate":"2025-12-05","tags":["tag1","tag2"]}'
```

**常见问题**
- 标签不显示：请确认 `GET /api/projects/:id` 的响应中包含 `tags` 字段（数组或 JSON 字符串），或将后端响应示例粘贴到 issue 中，我可以为你调整前端解析逻辑。
- Token/鉴权失败：确保 `JWT_SECRET` 一致且登录接口返回的 token 已保存到 `localStorage['mamage_jwt_token']`。
- 端口占用：开发服务器默认使用 `5173`，若被占用可以修改 `webpack.config.js` 中的 `devServer.port` 或以命令行参数覆盖。

---
如果你希望我把这份 README 写入项目根（我已经写入为 `README.generated.md`），或将其合并替换现有 `readme.md`，或者希望我添加更详细的 API 示例（比如完整的 projects/photos 后端实现示例或 Postman 集），告诉我下一步即可。