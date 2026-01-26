
# MaMage_Web

一个基于 React + Webpack 的相册/图库前端项目（配合后端 `/api` 使用）。适合：做“项目相册列表 + 详情图片管理 + 打包下载 + 中转站复制”的内部工具。

## 快速开始

> 目标：10 分钟内在本地看到页面并能请求到后端接口。

### 1）安装（前端）

```powershell
npm install
```

### 2）启动后端（必需：否则前端请求 `/api/*` 会失败）

本仓库带了一个示例后端在 `backend/`（Express + MySQL），脚本来自 `backend/package.json`。

```powershell
cd backend
npm install
npm run dev
```

默认后端监听 `PORT=3000`（见 `backend/server.js`）。

### 3）启动前端（Webpack Dev Server）

根目录脚本来自根 `package.json`：

```powershell
# 推荐：把前端端口改到 5173（避免和后端 3000 冲突）
$env:WEBPACK_DEV_SERVER_PORT='5173'

# 关键：把前端代理指向后端（后端默认 3000；webpack 默认会代理到 8000）
$env:MAMAGE_BACKEND_URL='http://localhost:3000'

npm run start
```

### 4）访问地址

- 前端：`http://localhost:5173/`（如果你没改端口，默认是 3000）
- 后端：`http://localhost:3000/ping` 返回 `pong` 代表后端已启动

---

## 环境要求

### Node / 包管理器

- 建议 Node `18+`（依据不足：仓库未提供 `.nvmrc` / `engines`；但 `package-lock.json` 为 `lockfileVersion: 3`，通常对应较新的 npm/Node 版本）。
- 包管理器：`npm`（仓库包含 `package-lock.json`）。

### 后端依赖

- 你需要一个 MySQL 实例（示例后端使用 `knex` + `mysql2`）。
- 后端环境变量需要配置（见下方“配置说明”）。

---

### 环境变量（前端开发服务器 / Webpack）

> 这些变量在启动 `npm run start` 前通过 PowerShell 设置。

| 变量名 | 作用 | 示例值 | 常见坑 |
|---|---|---:|---|
| `WEBPACK_DEV_SERVER_PORT` | 前端 dev server 端口 | `5173` | 不设置时默认 `3000`，容易和后端示例端口冲突 |
| `PORT` | 也会影响 dev server 端口（同上） | `5173` | 和很多后端/工具都叫 PORT，混用时容易误配置 |
| `MAMAGE_BACKEND_URL` | Webpack devServer 代理 `/api` 的目标后端 | `http://localhost:3000` | **不设置时默认 `http://localhost:8000`**，会导致接口全 404/ECONNREFUSED |

示例（Windows PowerShell）：

```powershell
$env:WEBPACK_DEV_SERVER_PORT='5173'
$env:MAMAGE_BACKEND_URL='http://localhost:3000'
npm run start
```

修改环境变量后需要**重启** `npm run start` 才会生效。

### 运行时变量（浏览器 window.*）

> 主要给“部署后前端静态文件不在同域”时用。可以在浏览器控制台临时设置验证。

| 变量名 | 作用 | 示例值 | 常见坑 |
|---|---|---:|---|
| `window.__MAMAGE_API_BASE__` | 覆盖 API 基址（影响 `src/services/request.js` 和部分 service） | `https://api.example.com` | 设置后需要刷新页面；本地开发推荐留空，走相对路径配合代理 |
| `window.__MAMAGE_LOG_REQUESTS` | 开启请求日志（写到 `window.__MAMAGE_POST_LOGS`） | `true` | 可能包含敏感信息摘要（不要在生产环境长期开） |

### 环境变量（后端示例 backend/）

> 后端通过 `process.env` 读取；示例写在 `backend/README.md`。

| 变量名 | 作用 | 示例值 | 常见坑 |
|---|---|---:|---|
| `PORT` | 后端端口 | `3000` | 与前端 dev server 端口冲突 |
| `DEV_FRONTEND_ORIGIN` | 允许跨域的前端 Origin（CORS） | `http://localhost:5173` | 如果前端端口改了，这里也要改，否则登录/请求可能被浏览器拦截 |
| `DB_HOST` | MySQL 地址 | `127.0.0.1` | Docker/远程 MySQL 时别写错内网地址 |
| `DB_PORT` | MySQL 端口 | `3306` | 云 MySQL 可能不是 3306 |
| `DB_USER` | MySQL 用户 | `root` | 权限不足会导致启动报错 |
| `DB_PASSWORD` | MySQL 密码 | `your_mysql_password` | 空密码/特殊字符需要正确引用 |
| `DB_NAME` | 数据库名 | `mamage` | 库不存在会连接失败 |
| `JWT_SECRET` | JWT 签名密钥 | `please-change-this...` | 生产环境务必更换；变更后旧 token 全部失效 |

---

## 常用命令

> 只列出仓库 `package.json` 里真实存在的 scripts。

### 前端（根目录）

- 开发（dev）：

```powershell
npm run start
```

- 构建（build）：

```powershell
npm run build
```

- 预览（preview）：未提供脚本（⚠️ 待补充）
- 代码检查（lint）：未提供脚本（⚠️ 待补充）
- 测试（test）：未提供脚本（⚠️ 待补充）

### 后端示例（backend/）

- 开发（dev，自动重启）：

```powershell
npm run dev
```

- 运行（start）：

```powershell
npm run start
```

---

## 目录结构（关键目录）

- `public/`：HTML 模板入口（`public/index.html`）。
- `src/`：前端源码（页面、组件、服务封装都在这里）。
- `src/services/`：所有 API 请求与业务 service（如 `authService.js`、`projectService.js`、`photoService.js`、`request.js`）。
- `src/components/`：可复用组件（如权限组件 `IfCan.jsx`、`PermButton.jsx`）。
- `backend/`：示例后端（Express + MySQL），仅包含用户相关路由示例（`/api/users/*`）。
- `dist/`：前端构建产物（`npm run build` 输出）。
- `webpack.config.js`：前端构建与开发服务器配置（端口、proxy 等）。
- `vite.config.js`：Vite 配置示例（当前未被 scripts 使用）。

---

## 开发约定

### 1）页面与组件怎么放

- 页面级组件：直接放在 `src/` 下（例如 `ProjectDetail.jsx`、`TransferStation.jsx`、`AuthPage.jsx`）。
- 复用组件：放在 `src/components/`（例如权限相关组件）。
- 样式：同名 `.css` 文件紧挨组件（例如 `ProjectDetail.css`、`AuthPage.css`）。

### 2）API 请求写在哪里

- 统一请求封装：`src/services/request.js`（基于 `fetch`，自动注入 `Authorization`）。
- 业务 API：按领域拆分到 `src/services/*Service.js`：
  - `authService.js`：登录/注册/获取当前用户（token 存在 `localStorage['mamage_jwt_token']`）。
  - `projectService.js`：项目列表/详情/创建/更新/删除。
  - `photoService.js`：图片上传/删除/打包等（以实际文件为准）。

建议新增接口时：
1) 先在对应 `*Service.js` 里加函数；2) 页面里只调用 service，不要到处散写 `fetch`。

### 3）路由与页面跳转（本项目不是 react-router）

- 本项目目前用 `window.history.pushState` + `window.location.pathname/search` 自己管理“伪路由”。
- 常见路径：
-  `/`：项目列表（默认为导航状态 `projects`，点击相册卡片会在地址栏写入 `?projectId=xxx` 并显示项目详情页面）
-  `/?projectId=xxx`：直接通过 query 参数访问某个项目详情，可复用同一页面逻辑，刷新/分享该链接会再次触发详情视图
-  `/scenery`：风景页，点击底部导航“风景”或手动访问会切换到 `selectedNav = 'scenery'`
-  `/function`：功能页总览，导航菜单“功能”对应的默认子页；会在 `window.history` 写入此路径
-  `/function/ai-writer`：AI 写新闻/推送入口，可以通过功能页按钮或直接访问该路径（`functionPage` 状态变为 `ai-writer`）
-  `/account`：账户信息页，只在登录后可见；通过头像下拉“账户信息”按钮或手动访问会把 `selectedNav` 设为 `account`
-  `/login`：认证页，未登录时访问会显示 `AuthPage`；登录成功后会用 `history.replaceState` 回到 `/`
-  `/about`：关于页，当前仅展示占位文本；在导航中点击“关于”会把路径更换为 `/about`
-  `/` 以外路径刷新、后退、前进都会触发 `popstate` 监听器来同步 `selectedNav` / `currentProjectId`

访问这些路径时，App 也会保存对应的状态（`selectedNav`、`functionPage`、`currentProjectId`），因此在浏览器地址栏粘贴路径后直接回车即可进入对应视图，导航按钮会自动同步；如果需要在代码里打开某个页面，可以调用 `window.history.pushState({}, '', '/function/ai-writer')`（在点击按钮的 `onClick` 中已示例）。

这意味着：
- 生产部署如果启用了“前端路由刷新”，需要后端/网关把所有路径都回退到 `index.html`（见 FAQ）。

### 4）权限与鉴权

- 启动时会调用 `GET /api/users/me` 拉取用户信息与 `permissions` 列表。
- 权限缓存：`src/permissionStore.js`（内存 Set）。
- 权限组件：
  - `src/components/IfCan.jsx`：没有权限就不渲染。
  - `src/components/PermButton.jsx`：没有权限按钮置灰（不隐藏）。

### 5）中转站（Transfer Station）约定

- 全局存储：`src/services/transferStore.js`，使用 `localStorage['photo-transfer-selection']` 持久化（最多 30 张）。
- 页面需要把“当前选中的照片”暴露为 `window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION`，中转站按钮才知道从哪里取数据。

### 6）前端调用的后端路由

前端目前直接调用的 `/api/*` 路径集中在这几个模块。大多数请求通过 `src/services/request.js` 包装，因而会自动带上 `Authorization` token、代理期待的基础路径以及 `window.__MAMAGE_API_BASE__`。只有少数需要上传/下载二进制（如打包、图片上传）或兼容开发环境才直接用 `fetch`。

#### 用户与权限
- `GET /api/users/me`：启动时拉取当前用户和权限列表（`src/App.jsx`、`src/services/authService.js`）。
- `POST /api/users/login`：登录表单（`src/AuthPage.jsx`），传入 `password` + `email/student_no`，返回 `token`（客户端会存入 `localStorage['mamage_jwt_token']`）。
- `POST /api/users/register`：注册表单（`src/AuthPage.jsx`），需 `name`、`password`，可附带 `email`、`organization_id`、`invite_code`。
- `PUT /api/users/me`：更新当前用户信息（`src/services/authService.js` 的 `updateMe`）。
- `PUT /api/users/me/password`：账号页改密码（`src/AccountPage.jsx`），可带 `currentPassword`（可选）和 `newPassword`。
- `POST /api/users/me/invite`：用户提交邀请码以升级角色（`src/AccountPage.jsx`）。
- `GET /api/users/invitations`、`POST /api/users/invitations`、`DELETE /api/users/invitations/:id`：管理员管理邀请码（`src/AccountPage.jsx`），创建时携带 `role`、`expiresInDays`。
- `GET /api/users/:id`：项目详情里回填摄影师姓名（`src/ProjectDetail.jsx`）或 AI 页面为图片匹配作者（`src/AiNewsWriter.jsx`）。
- `GET /api/organizations`：注册页用来搜索组织列表（`src/AuthPage.jsx`，若 dev server 代理未配置会降级到 `${window.__MAMAGE_API_BASE__ || 'http://localhost:8000'}/api/organizations`）。

#### 项目与列表
- `GET /api/projects/list`：项目首页分页（`src/App.jsx`，`request` 带页码、关键字）。
- `GET /api/projects`：`src/services/projectService.js` 的 `fetchLatestProjects()` 用于 AI/首页的快速预览。
- `GET /api/projects/:id`：项目详情页（`src/services/projectService.js`）以及附带的 `photos`/`previewImages` 数据。
- `POST /api/projects`：新建相册（`CreateAlbumModal.jsx` 调用 `createProject()`，负载包含 `projectName`、`description`、`eventDate`、`meta`）。
- `POST /api/projects/:id/update`：编辑项目元数据（`src/services/projectService.js` 的 `updateProject()`）。
- `DELETE /api/projects/:id`：删除相册（`src/services/projectService.js`）。
- `GET /api/projects/scenery`：风景页拿到用于 `ProjectDetail` 的项目（`src/Scenery.jsx`）。

#### 图片与传输
- `GET /api/photos`：`photoService.fetchLatestByType()` / `fetchRandomByProject()` 会附带查询字段如 `limit`、`type`、`projectId`、`random`，用于侧边精选和项目缺省图片。
- `POST /api/upload/photo`：上传图片（`photoService.uploadPhotos()` 接受 `FormData` 或 `{ file, projectId, title, type, tags }`）。
- `POST /api/photos/delete`、`DELETE /api/photos`、`POST /api/photos`：`photoService.deletePhotos()` 会按照该顺序尝试多种组合（携带 `photoIds` 数组）以兼容不同后端实现。
- `PATCH /api/photos/:id`：项目详情的图片编辑和标记推荐（`src/ProjectDetail.jsx`，含 `tags`、`description`）。
- `GET /api/photos/:id`：AI 写稿页面在解析 `PHOTO:id` 占位符时会请求该接口获取 URL。
- `POST /api/photos/zip`：打包下载中转站和项目详情都会上传 `photoIds` + `zipName`，返回二进制 zip（`src/TransferStation.jsx`、`src/ProjectDetail.jsx`）。

#### AI 生成
- `POST /api/ai/news/generate`：给服务器发送 `form`、`selectedPhotos`、`referenceArticle`、`interviewText` 等，可能同步返回 `result` 或 `jobId`。
- `GET /api/ai/news/jobs/:jobId`：`handleGenerate` 在 `jobId` 返回后轮询直到 `status` 变为 `succeeded/failed/cancelled`，必要时把 `result` 解析回页面。
- `POST /api/ai/news/preview`：高级编辑按钮请求，用于拿到自动组装的 Prompt（`advancedPrompt`）而不是直接生成稿件。

目前的前端仅调用上述路由；若后端新增 `/api` 接口或调整参数，请同步 README 并解释 `request()` 中的 `BASE_URL`/`window.__MAMAGE_API_BASE__` 约定。

---

## 部署说明

本项目未提供官方部署脚本（没有 Docker / Nginx / PM2 配置）。按“静态站点 + 反向代理 API”方式部署即可：

1) 本地构建：运行根目录脚本 `npm run build`，产物在 `dist/`。
2) 部署静态资源：把 `dist/` 放到任意静态托管（Nginx、OSS、CDN、静态站点服务等）。
3) 配置后端转发：确保前端请求 `/api/*` 能被转发到真实后端（推荐由 Nginx/网关做反代）。
4) 如果前端与后端不同域：
   - 方案 A：网关把前端与后端放同域（最省心）。
   - 方案 B：在页面里设置 `window.__MAMAGE_API_BASE__ = 'https://api.example.com'`，同时后端正确配置 CORS。

---

## 常见问题 FAQ

1）打开页面但项目列表一直加载/报错

- 现象：Network 里 `/api/projects/list` 失败，可能是 `ECONNREFUSED` 或 404。
- 原因：前端 dev server 只代理 `/api`，默认目标是 `http://localhost:8000`。
- 解决：启动前端前设置 `$env:MAMAGE_BACKEND_URL='http://localhost:3000'`（或让你的后端真的跑在 8000）。

2）前端启动失败：端口被占用

- 现象：提示 3000 已被占用。
- 原因：示例后端默认也是 3000。
- 解决：把前端换端口：`$env:WEBPACK_DEV_SERVER_PORT='5173'` 后再 `npm run start`。

3）登录后立刻变成未登录 / 一直 401

- 现象：`/api/users/me` 返回 401，前端会自动清除 `localStorage['mamage_jwt_token']`。
- 排查：
  - 后端 `JWT_SECRET` 是否变更导致 token 失效。
  - 代理是否指向了“另一个环境”的后端（比如把 `/api` 代理到了错误地址）。

4）“复制（富文本）”失败或粘贴后没有图片

- 现象：复制按钮报错、或粘贴到富文本编辑器只有文字没有图。
- 原因：浏览器剪贴板写入 `text/html` 受限制（通常需要 `https` 或 `localhost`），也可能是图片 URL 无法访问。
- 解决：
  - 本地开发请用 `localhost` 访问。
  - 确保图片链接能在浏览器直接打开；必要时设置 `window.__MAMAGE_API_BASE__` 指向可访问的后端域名。

5）图片能看到缩略图，但下载/打包失败

- 现象：点击“打包”后端 500 或返回非 zip。
- 原因：后端未实现或未按前端约定实现 `/api/photos/zip`（中转站会 POST `{ photoIds, zipName }` 并期待返回二进制 zip + `Content-Disposition`）。
- 解决：对照前端实现 `src/TransferStation.jsx` 补齐后端接口。

6）部署后刷新某些路径变 404（例如 `/scenery`）

- 原因：本项目使用 History API 做“伪路由”，刷新会让服务器去找真实路径。
- 解决：在 Nginx/网关配置“所有未知路径回退到 `index.html`”。

---

## 贡献方式

- 贡献：欢迎直接提 PR。建议在提交里说明：改动点、影响范围、如何验证（截图/接口返回）。
