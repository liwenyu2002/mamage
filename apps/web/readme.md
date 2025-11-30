
# MaMage_Web

简体中文说明文档。

## 项目简介
- 这是一个基于 React + Webpack 的前端项目样例，使用 `semi-ui` 组件库与自定义主题 `@semi-bot/semi-theme-mamage`。
- 主要目录：
	- `public/`：静态 HTML 入口 (`index.html`)。
	- `src/`：应用源码，包含 `App.jsx`、`index.jsx`。
	- `webpack.config.js`：构建配置。

## 前置要求
- Node.js（建议使用 LTS 版本，项目在开发环境上已用 Node v24.x 测试；通常使用 Node 18+ 即可）。
- npm：随 Node.js 一起安装。安装后请在新打开的终端运行 `node -v` 与 `npm -v` 验证。

如果在终端中看到 `node` 或 `npm` 未找到错误，请关闭并重新打开终端，或将 Node 安装目录加入你的 PATH（例如 `C:\Program Files\nodejs`）。

## 安装（第一次）
在项目根目录运行：

```powershell
npm install
```

这会安装 `dependencies` 与 `devDependencies`（项目中使用 `webpack`、`babel`、`semi-ui` 等）。

## 常用命令
- 开发服务器（热重载）：

```powershell
"""
Update README with recent feature notes and developer tips.
"""

# MaMage_Web

简体中文说明（更新于 2025-11-30）。

## 项目简介
- 前端：React + Webpack，UI 使用 `@douyinfe/semi-ui`；样式包含自定义主题 `@semi-bot/semi-theme-mamage`。
- 主要目录：
	- `public/`：静态资源与入口 `index.html`。
	- `src/`：应用源码（`App.jsx`, `ProjectDetail.jsx`, `TransferStation.jsx` 等）。
	- `webpack.config.js`：开发/构建配置。

## 新增功能（近期变更摘要）
- 新建相册：在 Header 增加 `新建相册` 按钮，打开模态窗创建项目（前端组件 `src/CreateAlbumModal.jsx`，后端请求 `POST /api/projects`，必需字段 `projectName`）。
- 中转站（Transfer Station）：跨页面收集选中图片，支持“存入 / 展开预览 / 打包下载 / 清空 / 复制”。复制功能会把中转站内图片转换为富文本 HTML（多行 `<img src="...">`）并写入剪贴板，方便粘贴到富文本编辑器中。
- 打包下载（Pack Download）：支持从中转站或项目中选中图片后向后端请求打包（`POST /api/photos/zip`），服务器返回 zip 文件并触发浏览器下载（后端需安装 `archiver` 或实现对应压缩逻辑）。
- 缺省封面：当项目无图片时使用 `uploads/assets/daishangchuan.png` 作为默认封面显示。

## API 与后端约定（前端与后端交互要点）
- 创建项目：`POST /api/projects`，Content-Type: `application/json`。必须包含 `projectName`（也可使用 `name` 或 `title`），可选字段 `description` / `desc`、`eventDate`（格式 `YYYY-MM-DD`）等。示例请求体：

```json
{
	"projectName": "软件工程课堂-2025",
	"description": "课堂拍摄汇总",
	"eventDate": "2025-11-30"
}
```

- 上传图片：前端上传使用 `/api/photos/upload`（FormData，字段名为 `file`）。
- 打包下载：前端向 `/api/photos/zip` POST 需要的 photo IDs；后端应返回 zip 二进制并带 `Content-Disposition` 指定文件名。

## CORS 与开发代理（重要，避免复制图片/Fetch 失败）
- 问题描述：浏览器跨域会阻塞直接 fetch 后端静态图片（例如 `/uploads/...`），导致无法读取 Blob，从而无法把图片写入剪贴板（截图报错：No 'Access-Control-Allow-Origin' header）。
- 解决方法（任选其一）：
	1. 在前端 dev server 配置代理，把 `/uploads`（以及 `/api`）代理到后端（推荐开发时使用）：

```js
// webpack.config.js (devServer.proxy 示例)
devServer: {
	proxy: {
		'/api': { target: 'http://localhost:3000', changeOrigin: true },
		'/uploads': { target: 'http://localhost:3000', changeOrigin: true },
	}
}
```

	2. 或在后端为静态资源/接口添加 CORS 头，例如使用 `cors` middleware：

```js
const cors = require('cors');
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
```

	3. 如果使用 cookies/凭证，确保同时设置 `Access-Control-Allow-Credentials: true` 并把 `fetch` 的 `credentials` 设置为 `include`，且 `Access-Control-Allow-Origin` 不能是 `*`，必须是具体 origin。

## 使用指南（关键操作）
- 启动开发服务器：
```powershell
npm install
npm run start
```
- 新建相册：点击 Header 的 `新建相册`，填写项目名称（必填），可选描述、标签与活动日期，点击创建。创建成功后前端会刷新项目列表。
- 中转站：在项目详情页选中图片后点击 `存入`，在页面右侧打开中转站可展开预览、删除单张、打包下载或复制（富文本 HTML）。
- 打包下载：在中转站或项目详情中选择图片并点击“打包”，前端会 POST photo IDs 到 `/api/photos/zip` 并下载返回的 zip 文件。

## 调试与排错建议
- 复制为图片失败：通常是 CORS 导致 `fetch` 失败，查看浏览器控制台的 Network 与 Console，可见 `No 'Access-Control-Allow-Origin'` 警告。按上文代理或后端 CORS 配置修复。
- 打包下载返回 500：检查后端是否安装并正确使用 `archiver`（或其他 zip 库）。
- 资源路径问题：前端使用 `resolveAssetUrl` 将相对路径转换为绝对 URL，默认 API 基准为 `http://localhost:3000`，但开发时优先使用相对路径以配合 dev-server 代理。

## 贡献与扩展
- 若需添加新功能或修复 bug，建议先在本地创建分支、实现并提交 PR。需要我帮你做具体改动（例如把 `/uploads` 代理加入 `webpack.config.js`）我可以直接提交补丁。

---
如需将 README 翻译为英文或添加部署/CI 示例，请告诉我具体需求。
