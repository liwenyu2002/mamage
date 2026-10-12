import React from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Button } from '../ui';
import './wechat.css';

// 标题超过该字数在公众号列表页会被截断，超限只提示不阻断输入（作者可能就是要长标题排版）
const TITLE_LIMIT = 64;

// 找不到对应图片 id 时的占位图：内联 SVG，避免因单张图缺失整段渲染失败或产生外链请求
const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#eee"/><text x="60" y="44" font-size="12" fill="#999" text-anchor="middle">图片缺失</text></svg>'
);

// markdown 中的图片按后端协议只允许 ![alt](PHOTO:<id>) 占位符出现，预览态必须换成真实地址才能看到实图
function resolvePhotoPlaceholders(markdown, photosMap) {
  const map = photosMap || {};
  return String(markdown || '').replace(/\(PHOTO:([^)\s]+)\)/g, (m, id) => {
    const url = map[String(id)];
    return `(${url || FALLBACK_IMG})`;
  });
}

// 复用站内一致的 marked 配置：关闭 headerIds/mangle 避免生成多余属性，渲染后统一走 DOMPurify
function renderMarkdownToHtml(markdown) {
  if (!markdown) return '';
  try {
    marked.setOptions({ mangle: false, headerIds: false, gfm: true });
    return marked.parse(String(markdown));
  } catch (e) {
    console.error('[WechatPreviewEditor] renderMarkdownToHtml error', e);
    return '';
  }
}

// AI 产出的 markdown 本身不应含危险标签，但仍统一走 DOMPurify 兜底——历史上手写清洗器被绕过过
function sanitizeHtml(dirty) {
  try {
    return DOMPurify.sanitize(String(dirty || ''), {
      FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed', 'script'],
      FORBID_ATTR: ['style'],
    });
  } catch (e) {
    console.error('[WechatPreviewEditor] sanitizeHtml error', e);
    return '';
  }
}

/**
 * 公众号排版预览编辑器。
 * props:
 *   title           string   文章标题
 *   markdown        string   正文 markdown（图片为 PHOTO:<id> 占位符）
 *   photosMap       object   {id: url} 用于把占位符换成真实图片
 *   onChangeMarkdown(next)   正文变化回调（编辑模式下触发）
 *   onChangeTitle(next)      标题变化回调
 */
export default function WechatPreviewEditor({
  title = '',
  markdown = '',
  photosMap = {},
  onChangeMarkdown,
  onChangeTitle,
}) {
  const [mode, setMode] = React.useState('preview'); // 'preview' | 'edit'

  const titleLen = React.useMemo(() => Array.from(String(title || '')).length, [title]);
  const titleOver = titleLen > TITLE_LIMIT;

  const previewHtml = React.useMemo(() => {
    const withRealImages = resolvePhotoPlaceholders(markdown, photosMap);
    return sanitizeHtml(renderMarkdownToHtml(withRealImages));
  }, [markdown, photosMap]);

  return (
    <div className="wechat-editor">
      <div className="wechat-toolbar">
        <div className="wechat-mode-switch">
          <Button
            size="small"
            theme={mode === 'preview' ? 'primary' : ''}
            onClick={() => setMode('preview')}
          >
            预览
          </Button>
          <Button
            size="small"
            theme={mode === 'edit' ? 'primary' : ''}
            onClick={() => setMode('edit')}
          >
            编辑
          </Button>
        </div>
        <span className={`wechat-title-count${titleOver ? ' is-over' : ''}`}>
          标题 {titleLen}/{TITLE_LIMIT}
        </span>
      </div>

      <div className="wechat-canvas-wrap">
        <div className="wechat-canvas">
          <input
            className={`wechat-title-input${titleOver ? ' is-over' : ''}`}
            type="text"
            value={title}
            placeholder="请输入文章标题"
            onChange={(e) => onChangeTitle && onChangeTitle(e.target.value)}
          />

          {mode === 'edit' ? (
            <textarea
              className="wechat-body-textarea"
              value={markdown}
              onChange={(e) => onChangeMarkdown && onChangeMarkdown(e.target.value)}
              placeholder="正文 markdown，图片请用 ![图注](PHOTO:图片id) 占位符"
            />
          ) : (
            <div
              className="wechat-body-preview"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="wechat-empty-hint">暂无内容，切换到编辑模式开始撰写</p>' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
