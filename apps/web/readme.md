
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
npm run start
```

默认会启动 `webpack-dev-server`（可在 `webpack.config.js` 中修改端口/静态资源设置）。

- 打包生产版本：

```powershell
npm run build
```

打包输出由 `webpack.config.js` 控制。

## package.json 摘要
- 主要脚本：
	- `start`: `webpack serve --mode development`
	- `build`: `webpack --mode production`
- 关键依赖：`react`, `react-dom`, `@douyinfe/semi-ui`, `@douyinfe/semi-icons`, 自定义主题 `@semi-bot/semi-theme-mamage`。

## 调试与常见问题
- 如果 `npm run start` 报 `npm` 未找到：
	- 关闭并重新打开 PowerShell/终端，使安装器写入的 Machine PATH 生效；或在当前会话临时执行：

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
```

	然后再运行 `node -v` / `npm -v` / `npm run start`。
- 若需将 Node 永久加入用户 PATH（无需管理员），可运行：

```powershell
$u=[Environment]::GetEnvironmentVariable('Path','User')
if ($u -notmatch 'C:\\Program Files\\nodejs') {
	[Environment]::SetEnvironmentVariable('Path', $u + ';C:\Program Files\\nodejs', 'User')
	Write-Output '已添加到 User PATH，重新打开终端后生效。'
} else {
	Write-Output 'User PATH 已包含 nodejs。'
}
```

## 编辑与扩展
- 若需添加新的依赖，执行 `npm install <package> --save` 或 `npm install <package> --save-dev`。
- 若需自定义 Webpack 配置，请编辑 `webpack.config.js`。

## 其他说明
- 若你想要我把 README 调整为英文版或添加更多内容（例如贡献指南、CI 配置、License 等），告诉我具体需求即可。

---
生成于项目 `package.json` 信息与代码结构。
