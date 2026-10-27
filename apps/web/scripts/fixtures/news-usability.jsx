import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/global.css';
import '../../src/liquidGlass.css';
import AiNewsWriter from '../../src/AiNewsWriter';
import WechatWorkspace from '../../src/WechatWorkspace';
import { NewsRevisionEnvironment } from '../../src/NewsDraftChat';
import { Button, SegmentedControl } from '../../src/ui';
import { THEME_PRESETS } from '../../src/wechat/themes';

const params = new URLSearchParams(location.search);
let userId = Number(params.get('user')) || 900003;
let workspaceId = Number(params.get('workspace')) || 900003;
const backendKey = `news-usability-fixture:${userId}:${workspaceId}`;
const album = { id: 9101, projectName: '学生实践交流', eventDate: '2026-10-24', photoCount: 41, coverThumbUrl: '/__news-qa/images/1681.jpg' };
const imageIds = [1681,1682,1683,1685,1686,1687,1688,1689,1691,1693,1695,1696];
const photos = Array.from({ length: 41 }, (_, i) => ({ id: 9201 + i, projectId: album.id,
  url: `/__news-qa/images/${imageIds[i % imageIds.length]}.jpg?original=1`, thumbUrl: `/__news-qa/images/${imageIds[i % imageIds.length]}.jpg`,
  description: '活动现场交流画面', faceNames: ['待确认候选'], type: i === 10 ? 'video' : 'normal' }));
const nativeFetch = window.fetch.bind(window);
let liveRevision = false;
let liveBackend = false;
const ready = nativeFetch('/__news-qa/config').then(response => {
  if (!response.ok) throw Error('本地预览配置未连接');
  return response.json();
}).then(config => {
  if (typeof config.liveRevision !== 'boolean') throw Error('本地预览配置无效');
  liveRevision = config.liveRevision === true;
  liveBackend = config.liveBackend === true;
  if (liveBackend) {
    userId = config.session.user.id; workspaceId = config.session.workspaceId;
    localStorage.setItem('mamage_jwt_token', config.session.token);
    const marker = `news-preview-real-backend:${userId}:${workspaceId}`;
    if (!localStorage.getItem(marker)) {
      for (const key of Object.keys(localStorage)) {
        if ((key.startsWith(`mamage.aiNewsWriter.draft.v2:${userId}:${workspaceId}:`) && key.endsWith(':chat'))
          || key === `mamage.wechat.workflow.v1:${userId}:${workspaceId}:layout-job`) localStorage.removeItem(key);
      }
      const draftKey = `mamage.aiNewsWriter.draft.v2:${userId}:${workspaceId}`;
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved);
        localStorage.setItem(`${draftKey}:before-real-backend`, saved);
        localStorage.setItem(draftKey, JSON.stringify({ ...draft, batchId: null, batchStatus: '', channelJobs: {}, processedJobIds: [] }));
      }
      localStorage.setItem(marker, '1');
    }
  }
  if (liveRevision) {
    const marker = `news-preview-live-revision:${userId}:${workspaceId}`;
    if (!localStorage.getItem(marker)) {
      // Discard only old mock proposals, never the document or its undo history.
      for (const channel of ['wechat_article', 'press_release']) localStorage.removeItem(`mamage.aiNewsWriter.draft.v2:${userId}:${workspaceId}:${channel}:chat`);
      localStorage.setItem(marker, '1');
    }
  }
});
window.fetch = async (url, options = {}) => {
  const target = new URL(String(url), location.origin), pathname = target.pathname;
  if (!pathname.startsWith('/api/')) return nativeFetch(url, options);
  if (liveBackend) {
    const headers = new Headers(options.headers || {}); headers.set('X-Mamage-Unit-Id', String(workspaceId));
    return nativeFetch(url, { ...options, headers });
  }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (pathname === '/api/projects/list') {
    if (window.__newsQaFailAlbumRead) {
      window.__newsQaFailAlbumRead = false;
      return new Response(JSON.stringify({ message: '模拟相册读取失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.searchParams.get('keyword') === '过期') {
      window.__newsQaDelayedRead = true;
      await new Promise(resolve => setTimeout(resolve, 700));
      return json({ list: [album], hasMore: false });
    }
    return json({ list: target.searchParams.get('keyword') ? [] : [album], hasMore: false });
  }
  if (pathname === '/api/photos/search') {
    const page = Number(target.searchParams.get('page') || 1);
    return json({ list: photos.slice((page - 1) * 40, page * 40), hasMore: page === 1, total: photos.length });
  }
  if (pathname.endsWith('/generate/batch')) {
    const payload = JSON.parse(options.body), id = Date.now();
    localStorage.setItem(backendKey, JSON.stringify({ payload, id, readyAt: Date.now() + 2200 }));
    return json({ batchId: id, jobs: payload.channels.map((channelKey, i) => ({ channelKey, jobId: id + i })) });
  }
  if (/\/batches\/\d+$/.test(pathname)) {
    const batch = JSON.parse(localStorage.getItem(backendKey)), pending = Date.now() < batch.readyAt;
    return json({ batchId: batch.id, status: pending ? 'running' : 'succeeded', jobs: batch.payload.channels.map((channelKey, i) => ({
      channelKey, jobId: batch.id + i, status: pending ? 'running' : 'succeeded', result: pending ? null : {
        title: '学生分享实践项目 师生交流推进思路',
        markdown: '# 学生分享实践项目 师生交流推进思路\n\n学校在报告厅举行学生实践交流。学生介绍了各自的项目，教师在现场进行点评。\n\n交流围绕具体项目展开，学生分享实践中的思考。教师结合项目进展提出建议，师生共同讨论下一步的推进方向。\n\n'
          + (batch.payload.selectedPhotos || []).slice(0, 2).map(photo => `![活动交流现场](PHOTO:${photo.id})`).join('\n\n'),
        photos: (batch.payload.selectedPhotos || []).map(photo => ({ ...photo, url: photos.find(item => item.id === photo.id)?.url || photo.thumbUrl })),
        references: channelKey === 'wechat_article' && Array.isArray(batch.payload.form?.monitorReferences)
          ? batch.payload.form.monitorReferences.map(({ id, revisionId, title }) => ({ id, revisionId, title })) : null,
        extra: { reviewNotes: ['请发布前核实活动日期、地点与署名。'] }, factCheck: { issues: [], forbiddenHits: [] },
      },
    })) });
  }
  if (pathname.endsWith('/check')) return json({ issues: [], forbiddenHits: [] });
  if (pathname === '/api/ai/news/jobs/777/references') return json({ references: [{ id: 771, revisionId: 1, title: '校园交流范例' }] });
  if (pathname === '/api/wechat-monitor/articles') return json({ items: [
    { id: 771, title: '校园交流范例', author: '测试公众号', analysisState: 'ready' },
    { id: 772, title: '未分析的范例', author: '测试公众号', analysisState: 'pending' },
  ], hasMore: false });
  if (pathname === '/api/wechat-monitor/articles/771') return json({ id: 771, revisionId: 1, title: '校园交流范例',
    analysisState: 'ready', analysis: { summary: '先交代活动，再介绍交流过程。', lessons: [{ principle: '用简短导语交代背景', application: '适合活动报道', caveat: '不要补造事实' }] } });
  if (pathname === '/api/wechat-monitor/articles/771/revisions/1') return json({ id: 771, revisionId: 1, title: '校园交流范例',
    author: '测试公众号', blocks: ['<p>这是一篇参考推文的原文。</p><script>window.parent.__unsafe = true</script>'] });
  const taskMatch = pathname.match(/^\/api\/wechat-compositions\/(layout|revision|content-template)(?:\/([A-Za-z0-9_-]+))?$/);
  if (taskMatch) {
    const [, kind, requestId] = taskMatch;
    if (kind === 'revision' && liveRevision) return nativeFetch(`/__news-qa/revision${requestId ? '/' + requestId : ''}?user=${userId}&workspace=${workspaceId}`, options);
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body), key = `${backendKey}:${kind}:${payload.clientRequestId}`;
      if (window.__newsQaTaskSubmitDelay) {
        window.__newsQaTaskSubmitting = true;
        await new Promise(resolve => setTimeout(resolve, window.__newsQaTaskSubmitDelay));
        window.__newsQaTaskSubmitting = false;
      }
      if (window.__wechatQaRejectTask) { window.__wechatQaRejectTask = false; return json({ message: '模拟模型暂不可用' }, 503); }
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ payload, status: 'pending', readyAt: Date.now() + 1600,
        fail: Boolean(window.__wechatQaFailTask) }));
      return json({ jobId: payload.clientRequestId, status: 'pending' }, 202);
    }
    if (window.__newsQaTaskSubmitting) window.__newsQaTaskEarlyPoll = true;
    const saved = JSON.parse(localStorage.getItem(`${backendKey}:${kind}:${requestId}`) || 'null');
    if (!saved) return json({ message: '未找到任务' }, 404);
    if (Date.now() < saved.readyAt) return json({ status: 'running' });
    if (saved.fail) return json({ status: 'failed', error: '模拟模型失败，原稿已保留' });
    if (kind === 'content-template') return json({ status: 'succeeded', result: { plan: { outline: '导语\n活动经过\n结尾' } } });
    const { source } = saved.payload;
    if (kind === 'layout') {
      const config = THEME_PRESETS.fresh;
      return json({ status: 'succeeded', result: { plan: { blocks: source.doc.map(block => ({ uid: block.uid,
        styleId: block.kind === 'para' ? 'builtin-body-plain' : config[block.type] })), accent: '#277a70',
        body: { fontSize: 16, lineHeight: 1.8, textIndent: false, justify: true }, page: { paddingX: 20 } } } });
    }
    const { mode = 'custom', target, originalSelection, instruction = '' } = saved.payload;
    const blocks = source.blocks.map(({ uid, text }) => ({ uid, text }));
    if (/负责人.*原话/.test(instruction)) return json({ status: 'succeeded', result: { plan: {
      title: source.title, blocks, questions: ['请提供本次负责人的现场发言原文。'],
    } } });
    if (mode === 'add_paragraph' || mode === 'continue') {
      const index = mode === 'continue' ? blocks.length : blocks.findIndex(block => block.uid === target?.uid) + 1;
      blocks.splice(index, 0, { uid: 'new-paragraph', text: mode === 'continue' ? '续写的结尾段落。' : '新增的活动说明段落。' });
    } else {
      const targets = target?.ranges?.map(range => range.uid) || target?.uids || (target?.uid ? [target.uid] : [blocks.find(item => source.blocks.find(original => original.uid === item.uid)?.type === 'paragraph')?.uid]);
      for (const block of blocks.filter(item => targets.includes(item.uid))) {
        const replacement = mode === 'complete' ? '补全的衔接' : block.text === '新增的活动说明段落。' ? '简短的说明。' : '学生围绕实践项目分享进展，教师与同学交流。';
        const range = originalSelection?.uid === block.uid ? originalSelection : target?.ranges?.find(range => range.uid === block.uid) || target;
        block.text = range?.start !== undefined ? block.text.slice(0, range.start) + replacement + block.text.slice(range.end) : replacement;
      }
    }
    return json({ status: 'succeeded', result: { plan: { title: source.title, blocks } } });
  }
  const backupsKey = `${backendKey}:backups`;
  const backups = JSON.parse(localStorage.getItem(backupsKey) || '[]');
  const templateKey = `${backendKey}:content-templates`;
  const contentTemplates = JSON.parse(localStorage.getItem(templateKey) || '[]');
  if (pathname === '/api/wechat-compositions/content-templates') {
    if (options.method === 'POST') {
      const row = { ...JSON.parse(options.body), id: Date.now(), ownerId: userId, canEdit: true };
      localStorage.setItem(templateKey, JSON.stringify([row, ...contentTemplates])); return json({ id: row.id }, 201);
    }
    return json({ items: contentTemplates });
  }
  const templateId = pathname.match(/^\/api\/wechat-compositions\/content-templates\/(\d+)$/)?.[1];
  if (templateId) {
    const row = contentTemplates.find(item => String(item.id) === templateId);
    if (!row) return json({ message: '模板不存在' }, 404);
    if (options.method === 'DELETE') { localStorage.setItem(templateKey, JSON.stringify(contentTemplates.filter(item => item !== row))); return json({ deleted: true }); }
    if (options.method === 'PUT') { Object.assign(row, JSON.parse(options.body)); localStorage.setItem(templateKey, JSON.stringify(contentTemplates)); return json({ id: row.id }); }
  }
  if (pathname === '/api/wechat-compositions') {
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body), id = Date.now();
      const row = { ...payload, id, updatedAt: new Date().toISOString(), blockCount: payload.doc.length };
      localStorage.setItem(backupsKey, JSON.stringify([row, ...backups])); return json(row, 201);
    }
    return json({ items: backups });
  }
  const archiveId = pathname.match(/^\/api\/wechat-compositions\/(\d+)$/)?.[1];
  if (archiveId) {
    const row = backups.find(item => String(item.id) === archiveId);
    if (!row) return json({ message: '备份不存在' }, 404);
    if (options.method === 'DELETE') { localStorage.setItem(backupsKey, JSON.stringify(backups.filter(item => item !== row))); return json({ ok: true }); }
    if (options.method === 'PUT') {
      Object.assign(row, JSON.parse(options.body)); localStorage.setItem(backupsKey, JSON.stringify(backups));
    }
    return json(row);
  }
  if (pathname === '/api/favorites') return json({ items: [] });
  const observedBlock = { id: 'monitor-771-1-1', type: 'h2', name: '论坛推文 · 标题',
    htmlTemplate: '<p style="text-align:center"><strong>{{content}}</strong></p>', source: 'observed' };
  if (pathname === '/api/wechat-style/blocks') return json({ blocks: [observedBlock] });
  if (pathname === '/api/wechat-style/monitor-templates') return json({ blocks: [observedBlock], templates: [{
    id: 'article-771', name: '论坛推文', sourceTitle: '校园交流范例', articleId: 771, revisionId: 1, count: 1,
    styleIds: { h2: 'db-monitor-771-1-1' },
  }] });
  throw new Error(`Unexpected fixture API ${pathname}`);
};
function Fixture() {
  const [channel, setChannel] = React.useState(params.get('channel') === 'wechat' ? 'wechat' : 'news');
  const changeChannel = value => {
    const next = new URL(location.href); next.searchParams.set('channel', value); history.replaceState({}, '', next);
    setChannel(value);
  };
  return <NewsRevisionEnvironment.Provider value={liveBackend ? 'sandbox-api' : liveRevision ? 'model-only' : 'fixture'}>
    <header className="news-qa-navigation" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 24px', background: '#ffffffb3', borderBottom: '1px solid #dfe4e0' }}>
      <strong>MaMage</strong>
      <SegmentedControl label="写作类型" value={channel} options={[{ value: 'news', label: '新闻稿' }, { value: 'wechat', label: '公众号图文' }]} onChange={changeChannel} />
      <Button size="small" theme="borderless" onClick={() => location.reload()}>刷新预览</Button>
    </header>
    <div className="news-qa-notice"><span>{liveBackend ? '真实 AI 后端 · 独立测试数据库 · 不写入生产数据'
      : liveRevision ? '示例初稿 · 真实 AI 改稿 · 不写入生产数据' : '本地交互预览 · 模拟 AI 回复，仅用于界面测试'}</span></div>
    {channel === 'wechat' ? <WechatWorkspace currentUser={{ id: userId }} workspaceId={workspaceId}
      initialMode={params.get('entry') === 'library' ? 'library' : 'ai'} />
      : <AiNewsWriter currentUser={{ id: userId }} workspaceId={workspaceId} initialChannelKey="press_release" />}
  </NewsRevisionEnvironment.Provider>;
}
ready.then(() => createRoot(document.getElementById('root')).render(<Fixture />)).catch(() => {
  document.getElementById('root').textContent = '本地预览未连接，请刷新页面重试。';
});
