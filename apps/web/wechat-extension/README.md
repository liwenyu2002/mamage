# MaMage 公众号 SVG 注入器（浏览器扩展）

把 MaMage 排版器里带 **SVG 点击交互**的推文，注入公众号图文编辑器——**免认证、免第三方插件**。

## 为什么需要它

公众号编辑器（ProseMirror）的**粘贴入口有净化**，直接 Ctrl+V 会把 `<svg>/<animate>/<set>` 剥掉。但编辑器本身**支持** SVG（内部用 `nodeleaf`/`node` 节点存，`namespaceURI` 保留 SVG 命名空间）。

正确姿势是调微信**自己的**编辑器 API：
```js
__MP_Editor_JSAPI__.invoke({ apiName: "mp_editor_insert_html", apiParam: { html } })
```
这个 API 会把 HTML（含 SVG）转成模型、绕开粘贴净化。壹伴/135 内部就是这么做的。本扩展只做这一件事，不采集、不上传任何数据。

> 实测：裸 SVG（含 `<set begin="click">`）经此 API 插入后，`begin` / `<set>` / `pointer-events` 全部保留。

## 安装（加载未打包扩展）

1. Chrome/Edge 打开 `edge://extensions`（或 `chrome://extensions`）。
2. 右上角打开 **开发者模式**。
3. 点 **加载解压缩的扩展 / Load unpacked**，选择本 `wechat-extension` 文件夹。
4. 装好后打开公众号后台「图文消息」编辑页，右下角会出现 **「MaMage 插入」** 悬浮按钮。

## 用法

1. 在 **MaMage 排版器** 点导出菜单里的 **「复制·SVG源码版（保交互）」**。
2. 到公众号「图文消息」编辑页，点右下角 **「MaMage 插入」** → 面板里点「读剪贴板」（或手动粘贴）→ **「插入正文」**。
3. 检查、保存、预览。手机预览里点 SVG 应能交互。

## 已知限制（诚实说明）

- **保存时公众号后台白名单仍会二次过滤**：会剥 `id`/`class`，图片须是微信素材库线上链接，`background:url()` 地址不能加引号，动画属性须在白名单内。导入的是**已发布=已合规**的推文时通常直接过；若有元素被过滤，按白名单调整源码。
- `mp_editor_insert_html` 是微信**未公开**的内部 API，理论上微信可能改动；若失效需跟进适配。
- 仅在 `mp.weixin.qq.com/cgi-bin/appmsg*` 编辑页生效。

## 文件

- `manifest.json` — MV3 配置，仅注入公众号编辑页。
- `content.js` — 隔离世界：悬浮按钮 + 面板 UI，注入 `page-api.js`。
- `page-api.js` — 页面主世界：调 `__MP_Editor_JSAPI__` 官方 API 插入。
