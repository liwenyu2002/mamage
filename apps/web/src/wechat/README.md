# src/wechat 接入说明

1. 编辑区：`import WechatPreviewEditor from './wechat/WechatPreviewEditor'`，作为公众号 Tab 内容渲染，`markdown`/`title` 传该渠道 job 的 per-channel state，`photosMap` 传 `{id: 真实url}`（由已选照片 id→url 构建），`onChangeMarkdown`/`onChangeTitle` 回写 per-channel state。
2. 导出：`import { copyWechatRichText, downloadImagePack } from './wechat/wechatExport'`，绑定到公众号 Tab 的「复制富文本」「下载图片包」两个按钮，均为 async，需 try/catch 后用 Toast 展示成功/失败（失败会 throw 出具体原因，不会静默吞掉）。
3. 三个文件零外部改动，未在任何现有文件中被引用；样式类名均为 `.wechat-` 前缀，`wechat.css` 由 `WechatPreviewEditor.jsx` 自行 import，接入方无需单独引入。
