import React from 'react';
import { Layout, Card, Button, Input, Modal, Toast, Typography } from './ui';
import { getAll as getTransferAll, subscribe as subscribeTransfer } from './services/transferStore';
import { resolveAssetUrl } from './services/request';
import { WECHAT_THEMES, renderWechatHtml } from './wechat/themes';
import { copyWechatRichText, downloadImagePack } from './wechat/wechatExport';
import './wechat/composer.css';

const { Header, Content } = Layout;
const { Text } = Typography;

const DRAFT_KEY = 'wechat-composer-draft';
const IMPORT_KEY = 'wechat-composer-import'; // 矩阵页"去排版器精修"写入的 {title, markdown}，进页即读即清
const DEFAULT_THEME_KEY = 'minimal';
const TITLE_LIMIT = 64;
const DIGEST_LIMIT = 120;

// 中转站条目 → 插图选择器候选：id 必须存在，url 取原图优先（插入正文用高清图，缩略图只用于选择器展示）
function normalizeStationItems(items) {
  const out = [];
  (items || []).forEach((p) => {
    if (!p) return;
    const id = p.id != null && p.id !== '' ? String(p.id) : '';
    if (!id) return;
    out.push({
      id,
      thumbUrl: resolveAssetUrl(p.thumbSrc || p.url) || '',
      fullUrl: resolveAssetUrl(p.url || p.thumbSrc) || '',
      description: p.description || p.projectTitle || '',
    });
  });
  return out;
}

// 草稿安全解析：损坏的 JSON 不应炸掉整页，静默回退空草稿
function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    return null;
  }
}

// 首帧同步读取草稿 + 导入数据（比 useEffect 异步回填快，避免"先空后填"的闪烁）；
// 导入键读到即删，保证只消费一次。真正的 side-effect（Toast）留给挂载后的 effect 处理。
function buildInitialState() {
  const draft = safeParse((typeof localStorage !== 'undefined') ? localStorage.getItem(DRAFT_KEY) : null) || {};
  let imported = null;
  try {
    const rawImport = (typeof localStorage !== 'undefined') ? localStorage.getItem(IMPORT_KEY) : null;
    if (rawImport) {
      localStorage.removeItem(IMPORT_KEY);
      imported = safeParse(rawImport);
    }
  } catch (e) {
    // 隐私模式/存储被禁用时静默忽略
  }
  const hasImport = !!(imported && (imported.title || imported.markdown));
  return {
    title: (hasImport && imported.title) || draft.title || '',
    digest: draft.digest || '',
    markdown: (hasImport && imported.markdown) || draft.markdown || '',
    themeKey: draft.themeKey || DEFAULT_THEME_KEY,
    imported: hasImport,
  };
}

// 从 markdown 里提取全部图片地址（PHOTO:id 占位符与直接 http(s) 链接都要认），供"下载图片包"使用
function extractImagesFromMarkdown(markdown, photosMap) {
  const list = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  let idx = 0;
  while ((m = re.exec(String(markdown || ''))) !== null) {
    idx += 1;
    const raw = m[1];
    const photoIdMatch = raw.match(/^PHOTO:(.+)$/);
    const url = photoIdMatch ? ((photosMap || {})[photoIdMatch[1]] || '') : raw;
    if (!url) continue;
    list.push({ id: idx, url });
  }
  return list;
}

function WechatComposer() {
  const [initial] = React.useState(buildInitialState);
  const [title, setTitle] = React.useState(initial.title);
  const [digest, setDigest] = React.useState(initial.digest);
  const [markdown, setMarkdown] = React.useState(initial.markdown);
  const [themeKey, setThemeKey] = React.useState(initial.themeKey);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [previewHtml, setPreviewHtml] = React.useState('');
  const [stationItemsRaw, setStationItemsRaw] = React.useState(() => getTransferAll());
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  const textareaRef = React.useRef(null);
  const debounceRef = React.useRef(null);

  React.useEffect(() => {
    if (initial.imported) Toast.success('已导入公众号草稿');
    // 只在挂载时触发一次；initial 本身不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 实时镜像中转站：从相册新存入的照片立即能在插图选择器里点选
  React.useEffect(() => subscribeTransfer((items) => setStationItemsRaw(items)), []);
  const stationItems = React.useMemo(() => normalizeStationItems(stationItemsRaw), [stationItemsRaw]);

  // photosMap 供 renderWechatHtml 解析正文里的 PHOTO:id 占位符（例如从矩阵页导入的稿子）
  const photosMap = React.useMemo(() => {
    const map = {};
    stationItems.forEach((it) => { map[it.id] = it.fullUrl || it.thumbUrl; });
    return map;
  }, [stationItems]);

  // 草稿持久化：任意字段变化即写回 localStorage；写入失败（隐私模式/配额满）静默忽略，不打断编辑
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, digest, markdown, themeKey }));
    } catch (e) {
      // ignore
    }
  }, [title, digest, markdown, themeKey]);

  // 预览防抖 300ms：renderWechatHtml 每次都要跑一遍 marked+内联样式，逐字触发会卡顿
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const { html } = renderWechatHtml(markdown, { themeKey, photosMap, title, digest });
        setPreviewHtml(html || '');
      } catch (e) {
        console.error('[WechatComposer] renderWechatHtml failed', e);
        setPreviewHtml('<p style="color:#c0392b;font-size:14px;">预览渲染失败，请检查 markdown 内容</p>');
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [markdown, themeKey, photosMap, title, digest]);

  // 在光标处插入 markdown 片段；textarea 失焦后 selectionStart/End 仍保留上次的值，是标准的"插入到光标"技巧。
  // 依赖 markdown 是为了在闭包里拿到最新正文（工具栏按钮点击会先让 textarea 失焦，此时读它的 selection 仍然有效）。
  const insertAtCursor = React.useCallback((snippet) => {
    const ta = textareaRef.current;
    const start = ta ? (ta.selectionStart ?? markdown.length) : markdown.length;
    const end = ta ? (ta.selectionEnd ?? markdown.length) : markdown.length;
    const next = markdown.slice(0, start) + snippet + markdown.slice(end);
    const pos = start + snippet.length;
    setMarkdown(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [markdown]);

  const insertPhoto = React.useCallback((item) => {
    const url = item.fullUrl || item.thumbUrl;
    if (!url) { Toast.warning('该照片缺少可用地址'); return; }
    const alt = String(item.description || `照片${item.id}`).replace(/[[\]]/g, '');
    insertAtCursor(`\n![${alt}](${url})\n\n`);
    Toast.success('已插入到光标处');
  }, [insertAtCursor]);

  const titleLen = React.useMemo(() => Array.from(String(title || '')).length, [title]);
  const digestLen = React.useMemo(() => Array.from(String(digest || '')).length, [digest]);
  const titleOver = titleLen > TITLE_LIMIT;
  const digestOver = digestLen > DIGEST_LIMIT;

  const handleCopyRich = React.useCallback(async () => {
    if (!markdown.trim()) { Toast.warning('正文还是空的，先写点内容'); return; }
    try {
      const { html } = renderWechatHtml(markdown, { themeKey, photosMap, title, digest });
      // 预览与复制共用同一份主题化渲染结果；text/plain 用 markdown 原文（降级粘贴场景可读）
      await copyWechatRichText({ html, plainText: [title, digest, markdown].filter(Boolean).join('\n\n') });
      Toast.success('已复制，去公众号后台粘贴即可，外链图片会被自动转存；个别未显示的用图片包补传');
    } catch (e) {
      console.error('[WechatComposer] copy rich text failed', e);
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [markdown, themeKey, photosMap, title, digest]);

  const handleDownloadPack = React.useCallback(async () => {
    const photos = extractImagesFromMarkdown(markdown, photosMap);
    if (!photos.length) { Toast.warning('正文里没有图片，无需下载图片包'); return; }
    try {
      const n = await downloadImagePack({ photos, baseName: title || 'wechat' });
      Toast.success(`已下载 ${n} 张图片，按序号对应正文里的〔图N〕标注`);
    } catch (e) {
      console.error('[WechatComposer] downloadImagePack failed', e);
      Toast.error(e && e.message ? e.message : '下载失败');
    }
  }, [markdown, photosMap, title]);

  const handleCopyMarkdown = React.useCallback(async () => {
    if (!markdown.trim()) { Toast.warning('正文还是空的，先写点内容'); return; }
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) {
        throw new Error('当前浏览器不支持剪贴板写入');
      }
      await window.navigator.clipboard.writeText(markdown);
      Toast.success('已复制 Markdown 源文本');
    } catch (e) {
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [markdown]);

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>公众号排版器</h2>
        <div style={{ marginTop: 6, marginBottom: 14 }}>
          <Text type="secondary">
            用 markdown 写正文、选一套主题，右侧手机预览所见即所得；完稿后一键复制粘贴到公众号后台。
          </Text>
        </div>

        <div className="wxc-meta-row">
          <div className="wxc-field">
            <label className="wxc-field-label" htmlFor="wxc-title-input">标题</label>
            <Input
              id="wxc-title-input"
              value={title}
              onChange={(v) => setTitle(v)}
              placeholder="文章标题，公众号列表页展示"
            />
            <span className={`wxc-field-count${titleOver ? ' is-over' : ''}`}>{titleLen}/{TITLE_LIMIT}</span>
          </div>
          <div className="wxc-field">
            <label className="wxc-field-label" htmlFor="wxc-digest-input">摘要（可选）</label>
            <Input
              id="wxc-digest-input"
              value={digest}
              onChange={(v) => setDigest(v)}
              placeholder="摘要，显示在分享卡片和消息列表"
            />
            <span className={`wxc-field-count${digestOver ? ' is-over' : ''}`}>{digestLen}/{DIGEST_LIMIT}</span>
          </div>
        </div>
      </Header>

      <Content>
        <div className="wxc-theme-row" role="radiogroup" aria-label="选择排版主题">
          {(WECHAT_THEMES || []).map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={themeKey === t.key}
              className={`wxc-theme-card${themeKey === t.key ? ' is-selected' : ''}`}
              onClick={() => setThemeKey(t.key)}
              title={t.desc || t.name}
            >
              <span className="wxc-theme-mini" aria-hidden="true">
                <span className="wxc-theme-mini-title" style={{ background: t.accent }} />
                <span className="wxc-theme-mini-line" />
                <span className="wxc-theme-mini-line" style={{ width: '70%' }} />
              </span>
              <span className="wxc-theme-label">
                <span className="wxc-theme-swatch" style={{ background: t.accent }} aria-hidden="true" />
                <span className="wxc-theme-name">{t.name}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="wxc-main">
          <div className="wxc-col wxc-col-left">
            <div className="wxc-toolbar">
              <Button size="small" onClick={() => setPickerOpen(true)}>从中转站插图</Button>
              <Button size="small" type="tertiary" onClick={() => insertAtCursor('\n\n---\n\n')}>分隔线</Button>
              <Button size="small" type="tertiary" onClick={() => insertAtCursor('\n\n> ')}>引用</Button>
              <Button size="small" type="tertiary" onClick={() => insertAtCursor('\n\n## ')}>二级标题</Button>
            </div>
            <textarea
              ref={textareaRef}
              className="wxc-editor-textarea"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="用 markdown 写正文；图片用上面「从中转站插图」插入，也可以直接粘贴图片链接：![图注](https://...)"
              spellCheck={false}
            />
          </div>

          <div className="wxc-col wxc-col-right">
            <div className="wxc-phone-shell">
              <div className="wxc-phone-notch" aria-hidden="true" />
              <div className="wxc-phone-screen">
                {markdown.trim() ? (
                  <div
                    className="wxc-phone-body"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="wxc-phone-empty">正文还是空的，左侧写点什么，这里会实时预览发布效果</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <Card bordered className="wxc-export-card">
          <div className="wxc-export-row">
            <Button type="primary" onClick={handleCopyRich}>复制公众号格式</Button>
            <Button onClick={handleDownloadPack}>下载图片包</Button>
            <Button type="tertiary" onClick={handleCopyMarkdown}>复制 Markdown</Button>
            <div className="wxc-export-draft">
              <Button disabled title="需企业公众号资质配置，即将开放">发送到公众号草稿箱</Button>
              <span className="wxc-export-hint">需企业公众号资质配置，即将开放</span>
            </div>
          </div>
        </Card>
      </Content>

      <Modal
        visible={pickerOpen}
        title="从中转站插图（点击插入到光标处）"
        onCancel={() => setPickerOpen(false)}
        footer={null}
      >
        {stationItems.length ? (
          <div className="wxc-photopick-grid">
            {stationItems.map((it) => (
              <button
                key={it.id}
                type="button"
                className="wxc-photopick-thumb"
                onClick={() => insertPhoto(it)}
                title={it.description || `插入照片 #${it.id}`}
              >
                {it.thumbUrl ? (
                  <img src={it.thumbUrl} alt={it.description || `#${it.id}`} loading="lazy" />
                ) : (
                  <span className="wxc-photopick-fallback">#{it.id}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <Text type="secondary">
            中转站还没有照片。先打开相册，把要用的照片存入右侧中转站，再回来插图。
          </Text>
        )}
      </Modal>
    </Layout>
  );
}

export default WechatComposer;
