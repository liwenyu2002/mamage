import React from 'react';
import DOMPurify from 'dompurify';
import { Layout, Card, Button, Input, Modal, Toast, Typography } from './ui';
import { getAll as getTransferAll, subscribe as subscribeTransfer } from './services/transferStore';
import { request, resolveAssetUrl } from './services/request';
import { WECHAT_THEMES, THEME_PRESETS, BUILTIN_BLOCKS_BY_ID, applyBlock } from './wechat/themes';
import { copyWechatRichText, downloadImagePack } from './wechat/wechatExport';
import CanvasEditor from './wechat/CanvasEditor';
import { makeUid, markdownToDoc, docToHtml, docToPlainText, createHistory } from './wechat/docModel';
import { setDragPayload, clearDragPayload } from './wechat/dragContext';
import './wechat/composer.css';
import './wechat/canvas.css';

const { Header, Content } = Layout;
const { Text } = Typography;

const DRAFT_KEY = 'wechat-composer-draft';
const IMPORT_KEY = 'wechat-composer-import'; // 矩阵页"去排版器精修"写入的 {title, markdown}，进页即读即清
const DEFAULT_THEME_KEY = 'minimal';
const TITLE_LIMIT = 64;
const DIGEST_LIMIT = 120;

// 样式库面板：类型 tab 与每类的微缩预览示例文案
const BLOCK_TYPES = [
  { key: 'h2', name: '标题', sample: '标题样式' },
  { key: 'h3', name: '小标题', sample: '小标题样式' },
  { key: 'quote', name: '引用', sample: '这是一段引用示例，感谢每一位参与者。' },
  { key: 'divider', name: '分隔线', sample: '' },
  { key: 'imageCard', name: '图片卡', sample: '图注示例' },
  { key: 'signoff', name: '落款', sample: '— 完 —' },
];
const ACCENT_CHOICES = ['#111111', '#1f4e8c', '#e8590c', '#c0392b', '#2f9e44', '#7048e8', '#0c8599', '#d6336c'];
// 图片卡微缩预览占位图（内联 SVG，避免外链）
const PREVIEW_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d8dce2"/><circle cx="120" cy="80" r="28" fill="#f5f6f8"/><path d="M40 150 L120 90 L190 140 L240 110 L290 150 Z" fill="#b8bfc9"/></svg>');

// 后端样式库行 → 前端 StyleBlock（id 加 db- 前缀避免与内置块撞名；dbId 留给删除接口）
function normalizeDbBlock(row) {
  return {
    id: `db-${row.id}`,
    dbId: row.id,
    type: row.type,
    name: row.name || '提取样式',
    htmlTemplate: row.html_template || row.htmlTemplate || '',
    accentEditable: !!(row.accent_editable || row.accentEditable),
    source: 'extracted',
    sourceUrl: row.source_url || null,
  };
}

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
  const themeKey = draft.themeKey || DEFAULT_THEME_KEY;
  const blockConfig = (draft.blockConfig && typeof draft.blockConfig === 'object') ? draft.blockConfig : null;
  const effective = blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY];

  // 文档来源优先级：矩阵导入 markdown > v3 草稿 doc > 旧草稿 markdown（一次性转块）> 空文档
  let doc = null;
  if (hasImport && imported.markdown) {
    doc = markdownToDoc(imported.markdown, { blockConfig: effective });
  } else if (Array.isArray(draft.doc) && draft.doc.length) {
    doc = draft.doc;
  } else if (draft.markdown) {
    doc = markdownToDoc(draft.markdown, { blockConfig: effective });
  }
  return {
    title: (hasImport && imported.title) || draft.title || '',
    digest: draft.digest || '',
    doc: doc || [],
    themeKey,
    blockConfig,
    imported: hasImport,
  };
}

function WechatComposer() {
  const [initial] = React.useState(buildInitialState);
  const [title, setTitle] = React.useState(initial.title);
  const [digest, setDigest] = React.useState(initial.digest);
  const [themeKey, setThemeKey] = React.useState(initial.themeKey);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [stationItemsRaw, setStationItemsRaw] = React.useState(() => getTransferAll());
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  // ── 画布文档（v3 编辑主源）────────────────────────────────
  const [doc, setDoc] = React.useState(initial.doc);
  const [selectedUid, setSelectedUid] = React.useState(null);
  const historyRef = React.useRef(null);
  if (!historyRef.current) historyRef.current = createHistory(initial.doc);
  const [historyTick, setHistoryTick] = React.useState(0); // 撤销/重做按钮禁用态的重渲信号
  void historyTick;
  const [replaceTarget, setReplaceTarget] = React.useState(null); // 换样式模式：目标块 uid
  const [pickerTarget, setPickerTarget] = React.useState(null);   // 中转站选图：null=插新图块，uid=给该块换图

  const applyDocChange = React.useCallback((nextDoc, opts) => {
    setDoc(nextDoc);
    if (!opts || !opts.transient) {
      historyRef.current.push(nextDoc);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const handleUndo = React.useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) { setDoc(prev); setSelectedUid(null); setHistoryTick((t) => t + 1); }
  }, []);

  const handleRedo = React.useCallback(() => {
    const next = historyRef.current.redo();
    if (next) { setDoc(next); setSelectedUid(null); setHistoryTick((t) => t + 1); }
  }, []);

  // ⌘Z / ⌘⇧Z（画布不拦截，父级统一处理；输入场景交还浏览器原生撤销）
  React.useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      const typing = t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) handleRedo(); else handleUndo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  // 样式块自选：blockConfig=null 表示跟随主题预设；一旦在样式库里挑过块即转为自定义配置
  const [blockConfig, setBlockConfig] = React.useState(initial.blockConfig);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [libType, setLibType] = React.useState('h2');
  const [myBlocks, setMyBlocks] = React.useState([]); // 从链接提取并保存的"我的样式库"
  const [myBlocksLoaded, setMyBlocksLoaded] = React.useState(false);
  const [extractUrl, setExtractUrl] = React.useState('');
  const [extracting, setExtracting] = React.useState(false);
  const [extractedBlocks, setExtractedBlocks] = React.useState(null); // 非 null 时显示提取结果弹层
  const [extractPicked, setExtractPicked] = React.useState({});
  const [savingExtract, setSavingExtract] = React.useState(false);

  // 生效的块配置：自定义优先，否则用当前主题预设
  const effectiveConfig = React.useMemo(
    () => blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY],
    [blockConfig, themeKey]
  );
  const blocksById = React.useMemo(() => {
    const map = { ...BUILTIN_BLOCKS_BY_ID };
    myBlocks.forEach((b) => { map[b.id] = b; });
    return map;
  }, [myBlocks]);

  const loadMyBlocks = React.useCallback(async () => {
    try {
      const resp = await request('/api/wechat-style/blocks', { method: 'GET' });
      const rows = Array.isArray(resp && resp.blocks) ? resp.blocks : (Array.isArray(resp) ? resp : []);
      setMyBlocks(rows.map(normalizeDbBlock));
      setMyBlocksLoaded(true);
    } catch (e) {
      console.error('[WechatComposer] load my blocks failed', e);
    }
  }, []);

  // 面板首次打开时拉一次"我的样式库"；草稿里引用了 db- 块时进页就要拉（否则渲染回退兜底块）
  React.useEffect(() => {
    if (myBlocksLoaded) return;
    const usesDbBlock = blockConfig && Object.values(blockConfig).some((v) => typeof v === 'string' && v.startsWith('db-'));
    if (libraryOpen || usesDbBlock) loadMyBlocks();
  }, [libraryOpen, blockConfig, myBlocksLoaded, loadMyBlocks]);


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

  // 草稿持久化（v3：存块文档）；写入失败（隐私模式/配额满）静默忽略，不打断编辑
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 3, title, digest, doc, themeKey, blockConfig }));
    } catch (e) {
      // ignore
    }
  }, [title, digest, doc, themeKey, blockConfig]);

  // 在画布中插入一个新块：有选中块插其后，否则追加末尾；返回新块 uid
  const insertDocBlock = React.useCallback((block) => {
    const withUid = { ...block, uid: makeUid() };
    const next = [...doc];
    const idx = selectedUid ? next.findIndex((b) => b.uid === selectedUid) : -1;
    if (idx >= 0) next.splice(idx + 1, 0, withUid); else next.push(withUid);
    applyDocChange(next);
    setSelectedUid(withUid.uid);
    return withUid.uid;
  }, [doc, selectedUid, applyDocChange]);

  // 中转站选图确认：pickerTarget 有值=给该图块换图，否则插入新图片卡块
  const insertPhoto = React.useCallback((item) => {
    const url = item.fullUrl || item.thumbUrl;
    if (!url) { Toast.warning('该照片缺少可用地址'); return; }
    const caption = String(item.description || '').slice(0, 40);
    if (pickerTarget) {
      const next = doc.map((b) => (b.uid === pickerTarget ? { ...b, src: url } : b));
      applyDocChange(next);
      Toast.success('已替换图片');
    } else {
      const imageBlockId = (blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY]).imageCard;
      insertDocBlock({ kind: 'styled', type: 'imageCard', blockId: imageBlockId, src: url, caption, accent: null });
      Toast.success('已插入图片卡');
    }
    setPickerTarget(null);
    setPickerOpen(false);
  }, [pickerTarget, doc, applyDocChange, blockConfig, themeKey, insertDocBlock]);

  const titleLen = React.useMemo(() => Array.from(String(title || '')).length, [title]);
  const digestLen = React.useMemo(() => Array.from(String(digest || '')).length, [digest]);
  const titleOver = titleLen > TITLE_LIMIT;
  const digestOver = digestLen > DIGEST_LIMIT;

  // ── 样式库交互 ────────────────────────────────────────────────

  // 每种类型插入新块时的默认内容
  const DEFAULT_CONTENT = React.useMemo(() => ({
    h2: '在这里输入标题', h3: '在这里输入小标题', quote: '在这里输入引用内容', signoff: '— 完 —',
  }), []);

  // 点样式块：换样式模式=替换目标块的样式保内容；普通模式=向画布插入新块（同时更新默认配置）
  const applyBlockPick = React.useCallback((type, id) => {
    if (replaceTarget) {
      const next = doc.map((b) => (b.uid === replaceTarget && b.type === type ? { ...b, blockId: id } : b));
      applyDocChange(next);
      setReplaceTarget(null);
      Toast.success('已替换样式');
      return;
    }
    setBlockConfig({ ...effectiveConfig, [type]: id });
    if (type === 'imageCard') {
      // 图片卡需要先选图：打开中转站选择器，选定后按当前配置插入
      setPickerTarget(null);
      setPickerOpen(true);
      return;
    }
    insertDocBlock({
      kind: 'styled', type, blockId: id,
      content: DEFAULT_CONTENT[type] || '', accent: null,
    });
  }, [replaceTarget, doc, applyDocChange, effectiveConfig, insertDocBlock, DEFAULT_CONTENT]);

  const applyAccent = React.useCallback((hex) => {
    setBlockConfig({ ...effectiveConfig, accent: hex });
  }, [effectiveConfig]);

  // 单块微缩预览：提取块模板来自后端（已服务端清洗），此处再过一遍 DOMPurify 兜底
  const renderBlockPreview = React.useCallback((block) => {
    try {
      const typeDef = BLOCK_TYPES.find((t) => t.key === block.type);
      const raw = applyBlock(block, {
        content: (typeDef && typeDef.sample) || '示例文本',
        src: PREVIEW_IMG,
        caption: block.type === 'imageCard' ? '图注示例' : '',
        accent: effectiveConfig.accent,
      });
      return DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'script', 'iframe'], ADD_ATTR: ['style'] });
    } catch (e) {
      return '<span style="color:#999;font-size:12px">预览失败</span>';
    }
  }, [effectiveConfig.accent]);

  const handleExtract = React.useCallback(async () => {
    const url = extractUrl.trim();
    if (!url) { Toast.warning('先粘贴一篇公众号文章链接'); return; }
    if (!/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) { Toast.warning('只支持公众号文章链接（mp.weixin.qq.com）'); return; }
    setExtracting(true);
    try {
      const resp = await request('/api/wechat-style/extract', { method: 'POST', data: { url } });
      const blocks = Array.isArray(resp && resp.blocks) ? resp.blocks : [];
      if (!blocks.length) { Toast.info('这篇文章没有识别出可复用的样式块（可能排版太简单）'); return; }
      const picked = {};
      blocks.forEach((b, i) => { picked[i] = true; });
      setExtractedBlocks(blocks);
      setExtractPicked(picked);
    } catch (e) {
      console.error('[WechatComposer] extract failed', e);
      Toast.error(e && e.message ? `提取失败：${String(e.message).slice(0, 100)}` : '提取失败，请稍后重试');
    } finally {
      setExtracting(false);
    }
  }, [extractUrl]);

  const handleSaveExtracted = React.useCallback(async () => {
    const chosen = (extractedBlocks || []).filter((_, i) => extractPicked[i]);
    if (!chosen.length) { Toast.warning('先勾选要保存的样式块'); return; }
    setSavingExtract(true);
    try {
      await request('/api/wechat-style/blocks', { method: 'POST', data: { blocks: chosen } });
      Toast.success(`已存入我的样式库（${chosen.length} 个）`);
      setExtractedBlocks(null);
      setExtractUrl('');
      await loadMyBlocks();
      setLibraryOpen(true);
    } catch (e) {
      console.error('[WechatComposer] save extracted failed', e);
      Toast.error(e && e.message ? `保存失败：${String(e.message).slice(0, 100)}` : '保存失败');
    } finally {
      setSavingExtract(false);
    }
  }, [extractedBlocks, extractPicked, loadMyBlocks]);

  const handleDeleteMyBlock = React.useCallback(async (block) => {
    try {
      await request(`/api/wechat-style/blocks/${block.dbId}`, { method: 'DELETE' });
      setMyBlocks((prev) => prev.filter((b) => b.id !== block.id));
      // 正在使用被删块的槽位回退到当前主题预设对应块
      setBlockConfig((prev) => {
        if (!prev) return prev;
        const preset = THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY];
        const next = { ...prev };
        Object.keys(next).forEach((k) => { if (next[k] === block.id) next[k] = preset[k]; });
        return next;
      });
      Toast.success('已从我的样式库删除');
    } catch (e) {
      Toast.error('删除失败');
    }
  }, [themeKey]);

  // 样式块从左侧面板拖入画布：payload={type, blockId}，插入到指示线位置
  const handleExternalDrop = React.useCallback((payload, insertIndex) => {
    if (!payload || !payload.type || !payload.blockId) return;
    const base = {
      kind: 'styled', type: payload.type, blockId: payload.blockId, accent: null, uid: makeUid(),
    };
    const block = payload.type === 'imageCard'
      ? { ...base, src: PREVIEW_IMG, caption: '点击图片从中转站选图' }
      : payload.type === 'divider'
        ? base
        : { ...base, content: DEFAULT_CONTENT[payload.type] || '' };
    const next = [...doc];
    const idx = Math.max(0, Math.min(Number(insertIndex) || 0, next.length));
    next.splice(idx, 0, block);
    applyDocChange(next);
    setSelectedUid(block.uid);
  }, [doc, applyDocChange, DEFAULT_CONTENT]);

  const docHasContent = React.useMemo(
    () => doc.some((b) => (b.kind === 'para' ? String(b.html || '').trim() : (b.content || b.src))),
    [doc]
  );

  const handleCopyRich = React.useCallback(async () => {
    if (!docHasContent) { Toast.warning('画布还是空的，先从样式库插入内容'); return; }
    try {
      // 画布与复制共用 docToHtml 同源渲染（所见即所得）；标题填在公众号后台标题栏，不进正文
      const { html } = docToHtml(doc, { blocksById, globalAccent: effectiveConfig.accent, body: effectiveConfig.body });
      await copyWechatRichText({ html, plainText: [title, digest, docToPlainText(doc)].filter(Boolean).join('\n\n') });
      Toast.success('已复制正文，去公众号后台粘贴即可（标题单独填），外链图片会被自动转存');
    } catch (e) {
      console.error('[WechatComposer] copy rich text failed', e);
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [docHasContent, doc, blocksById, effectiveConfig, title, digest]);

  const handleDownloadPack = React.useCallback(async () => {
    const photos = doc.filter((b) => b.type === 'imageCard' && b.src).map((b, i) => ({ id: i + 1, url: b.src }));
    if (!photos.length) { Toast.warning('画布里没有图片，无需下载图片包'); return; }
    try {
      const n = await downloadImagePack({ photos, baseName: title || 'wechat' });
      Toast.success(`已下载 ${n} 张图片`);
    } catch (e) {
      console.error('[WechatComposer] downloadImagePack failed', e);
      Toast.error(e && e.message ? e.message : '下载失败');
    }
  }, [doc, title]);

  const handleCopyMarkdown = React.useCallback(async () => {
    if (!docHasContent) { Toast.warning('画布还是空的，先从样式库插入内容'); return; }
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) {
        throw new Error('当前浏览器不支持剪贴板写入');
      }
      await window.navigator.clipboard.writeText(docToPlainText(doc));
      Toast.success('已复制纯文本');
    } catch (e) {
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [docHasContent, doc]);

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      <Header className="wxc-page-header" style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
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
        <div className="wxc-workspace">
          {/* 左侧样式库面板：桌面常驻，窄屏由"样式库"按钮抽屉化 */}
          <aside className={`wxc-side-lib${libraryOpen ? ' is-open' : ''}`}>
            <div className="wxc-lib-extract">
              <input
                className="wxc-lib-extract-input"
                value={extractUrl}
                onChange={(e) => setExtractUrl(e.target.value)}
                placeholder="贴公众号文章链接，提取样式"
                onKeyDown={(e) => { if (e.key === 'Enter') handleExtract(); }}
              />
              <Button size="small" type="primary" loading={extracting} disabled={extracting} onClick={handleExtract}>
                {extracting ? '…' : '提取'}
              </Button>
            </div>
            <div className="wxc-lib-tabs">
              {BLOCK_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`wxc-lib-tab${libType === t.key ? ' is-active' : ''}`}
                  onClick={() => setLibType(t.key)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="wxc-lib-accents" title="主色（作用于可换色的样式块）">
              {ACCENT_CHOICES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`wxc-lib-accent-dot${(effectiveConfig.accent || '').toLowerCase() === hex ? ' is-active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => applyAccent(hex)}
                  aria-label={`主色 ${hex}`}
                />
              ))}
            </div>
            {replaceTarget ? (
              <div className="wxc-lib-replace-bar">
                正在为选中块换样式
                <button type="button" onClick={() => setReplaceTarget(null)}>取消</button>
              </div>
            ) : null}
            <div className="wxc-lib-list">
              {[...Object.values(blocksById)].filter((b) => b.type === libType).map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    const payload = { type: b.type, blockId: b.id };
                    // 同页拖拽走共享上下文（dataTransfer 自定义 mime 跨浏览器不可靠）；
                    // text/plain 兜底是 Firefox 启动拖拽会话的必要条件
                    setDragPayload('style-block', payload);
                    try {
                      e.dataTransfer.setData('application/x-wxc-style-block', JSON.stringify(payload));
                      e.dataTransfer.setData('text/plain', 'wxc-style-block');
                    } catch (err) { /* 某些浏览器限制 setData，全局上下文已兜底 */ }
                  }}
                  onDragEnd={clearDragPayload}
                  className={`wxc-lib-block${effectiveConfig[libType] === b.id ? ' is-active' : ''}`}
                  onClick={() => applyBlockPick(libType, b.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyBlockPick(libType, b.id); }}
                  title={`${b.name}（点击插入 / 拖到画布定位插入）`}
                >
                  <div className="wxc-lib-block-stage">
                    <div
                      className="wxc-lib-block-scale"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderBlockPreview(b) }}
                    />
                  </div>
                  <div className="wxc-lib-block-meta">
                    <span className="wxc-lib-block-name">{b.name}</span>
                    {b.source === 'extracted' ? (
                      <>
                        <span className="wxc-lib-badge">我的库</span>
                        <button
                          type="button"
                          className="wxc-lib-block-del"
                          title="从我的样式库删除"
                          onClick={(e) => { e.stopPropagation(); handleDeleteMyBlock(b); }}
                        >
                          ×
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {libType === 'signoff' ? (
                <div
                  role="button"
                  tabIndex={0}
                  className={`wxc-lib-block wxc-lib-block--none${effectiveConfig.signoff === null ? ' is-active' : ''}`}
                  onClick={() => applyBlockPick('signoff', null)}
                >
                  <div className="wxc-lib-block-stage"><span className="wxc-lib-none-text">不要落款</span></div>
                </div>
              ) : null}
            </div>
          </aside>

          <div className="wxc-workarea">
            <div className="wxc-theme-row" role="radiogroup" aria-label="选择排版主题">
              {(WECHAT_THEMES || []).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={!blockConfig && themeKey === t.key}
                  className={`wxc-theme-card${!blockConfig && themeKey === t.key ? ' is-selected' : ''}`}
                  onClick={() => { setThemeKey(t.key); setBlockConfig(null); }}
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
              <button
                type="button"
                className="wxc-theme-card wxc-theme-card--custom wxc-lib-toggle-mobile"
                onClick={() => setLibraryOpen((v) => !v)}
                title="打开样式库"
              >
                <span className="wxc-theme-label">
                  <span className="wxc-theme-name">{blockConfig ? '自定义 ✓' : '样式库'}</span>
                </span>
              </button>
            </div>

            <div className="wxc-canvas-region">
              <div className="wxc-canvas-toolbar">
                <div className="wxc-canvas-toolbar-left">
                  <Button size="small" onClick={() => { setPickerTarget(null); setPickerOpen(true); }}>从中转站插图</Button>
                  <Text type="secondary" className="wxc-canvas-tip">
                    左侧样式点击或拖到画布插入，点块直接编辑
                  </Text>
                </div>
                <div className="wxc-canvas-toolbar-right">
                  <Button size="small" type="tertiary" disabled={!historyRef.current.canUndo()} onClick={handleUndo} title="撤销 ⌘Z">↩ 撤销</Button>
                  <Button size="small" type="tertiary" disabled={!historyRef.current.canRedo()} onClick={handleRedo} title="重做 ⌘⇧Z">↪ 重做</Button>
                </div>
              </div>
              <CanvasEditor
                doc={doc}
                onChange={applyDocChange}
                selectedUid={selectedUid}
                onSelect={setSelectedUid}
                blocksById={blocksById}
                globalAccent={effectiveConfig.accent}
                bodyConfig={effectiveConfig.body}
                onRequestStylePicker={(type, uid) => { setLibType(type); setReplaceTarget(uid); setLibraryOpen(true); }}
                onRequestImagePick={(uid) => { setPickerTarget(uid); setPickerOpen(true); }}
                onExternalDrop={handleExternalDrop}
              />
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
          </div>
        </div>
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

      {/* 提取结果确认：预览识别出的样式块，勾选后存入我的样式库 */}
      <Modal
        title={`提取到 ${extractedBlocks ? extractedBlocks.length : 0} 个样式块（勾选要保存的）`}
        visible={!!extractedBlocks}
        onCancel={() => setExtractedBlocks(null)}
        footer={null}
        width={isMobile ? 'calc(100vw - 16px)' : 720}
      >
        {extractedBlocks ? (
          <div className="wxc-extract-body">
            <div className="wxc-lib-grid">
              {extractedBlocks.map((b, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={`wxc-lib-block${extractPicked[i] ? ' is-active' : ''}`}
                  onClick={() => setExtractPicked((prev) => ({ ...prev, [i]: !prev[i] }))}
                >
                  <div className="wxc-lib-block-stage">
                    <div
                      className="wxc-lib-block-scale"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderBlockPreview({ ...b, id: `ext-${i}` }) }}
                    />
                  </div>
                  <div className="wxc-lib-block-meta">
                    <span className="wxc-lib-block-name">{b.name || `提取块 ${i + 1}`}</span>
                    <span className="wxc-lib-badge">{(BLOCK_TYPES.find((t) => t.key === b.type) || {}).name || b.type}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="wxc-extract-actions">
              <Button type="tertiary" onClick={() => setExtractedBlocks(null)}>取消</Button>
              <Button type="primary" loading={savingExtract} disabled={savingExtract} onClick={handleSaveExtracted}>
                存入我的样式库（{Object.values(extractPicked).filter(Boolean).length}）
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Layout>
  );
}

export default WechatComposer;
