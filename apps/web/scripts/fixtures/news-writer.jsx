// Standalone QA entry. This file is not imported by the application build.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/global.css';
import '../../src/liquidGlass.css';
import AiNewsWriter from '../../src/AiNewsWriter';

const draftKey = 'mamage.aiNewsWriter.draft.v2:900003:900003';
const backendKey = 'news-writer-fixture-backend-v2';
if (!localStorage.getItem(draftKey)) localStorage.setItem(draftKey, JSON.stringify({
  formValues: { sourceMaterial: '学校组织了一次学生实践交流，地点在报告厅。\n学生介绍了自己的项目，老师现场点评，希望稿子多写学生实践和交流的过程。',
    writingMode: 'draft', targetWords: '500-800' },
  selectedPhotos: [
    { id: 900101, url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=480&q=75',
      description: '几人在桌边共同交流，查看电脑上的资料。', tags: ['交流', '讨论'] },
    { id: 900102, url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=480&q=75',
      description: '几人坐在一起查看纸质材料。', tags: ['交流', '讨论'] },
  ],
  selectedChannels: ['press_release'], activeChannelKey: 'press_release',
  advancedPrompt: '导语突出学生实践，不写没有依据的领导讲话。',
  channelContent: {},
}));

const nativeFetch = window.fetch.bind(window);
let offline = false;
window.fetch = async (url, options = {}) => {
  const pathname = new URL(String(url), location.origin).pathname;
  if (!pathname.startsWith('/api/')) return nativeFetch(url, options);
  if (offline) throw new TypeError('Fixture offline');
  const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  if (pathname.endsWith('/generate/batch')) {
    const payload = JSON.parse(options.body);
    const batch = { id: Date.now(), pending: true, readyAt: Date.now() + 1500, payload };
    localStorage.setItem(backendKey, JSON.stringify(batch));
    return json({ batchId: batch.id, jobs: payload.channels.map((channelKey, i) => ({ jobId: batch.id + i, channelKey })) });
  }
  if (/\/batches\/\d+$/.test(pathname)) {
    const batch = JSON.parse(localStorage.getItem(backendKey));
    const pending = batch.pending && Date.now() < batch.readyAt;
    const photos = (batch.payload.selectedPhotos || []).slice(0, 2);
    const images = photos.map(photo => `![现场交流](PHOTO:${photo.id})`).join('\n\n');
    const hasDate = batch.payload.form.eventDate || /\d{1,2}月\d{1,2}日/.test(batch.payload.form.sourceMaterial || '');
    return json({ batchId: batch.id, status: pending ? 'running' : batch.error ? 'failed' : 'succeeded',
      jobs: batch.payload.channels.map((channelKey, i) => ({ jobId: batch.id + i, channelKey,
        status: pending ? 'running' : batch.error ? 'failed' : 'succeeded', error: batch.error,
        result: pending || batch.error ? null : { title: '学生交流实践项目进展',
          markdown: `# 学生交流实践项目进展\n\n学校在报告厅组织学生实践交流。学生围绕各自的项目展开介绍，教师在现场进行点评。\n\n交流中，学生分享项目实践的过程，介绍推进中的思考。教师结合学生的介绍提出建议，师生围绕具体项目进行讨论。\n\n${images}`,
          photos: photos.map(photo => ({ id: photo.id, url: photo.thumbUrl })),
          extra: { reviewNotes: hasDate ? [] : ['活动具体日期尚未提供，发布前请确认。'] },
          factCheck: { reviewRequired: true, issues: [], forbiddenHits: [] } },
      })) });
  }
  if (/\/jobs\/\d+\/retry$/.test(pathname)) {
    const batch = JSON.parse(localStorage.getItem(backendKey));
    localStorage.setItem(backendKey, JSON.stringify({ ...batch, pending: true, readyAt: Date.now() + 1500, error: null }));
    return json({ status: 'pending' });
  }
  if (pathname.endsWith('/check')) return json({ reviewRequired: true, issues: [], forbiddenHits: [] });
  throw new Error(`Unexpected fixture API: ${pathname}`);
};
function Fixture() {
  const [network, setNetwork] = React.useState(true);
  return <>
    <div className="news-qa-notice">
      <strong>MaMage</strong><span>交互演示 · 固定样稿，不连接生产环境</span>
      <details className="news-qa-tools"><summary>测试工具</summary>
      <button onClick={() => { offline = !offline; setNetwork(!offline); }}>{network ? '模拟断网' : '恢复网络'}</button>
      <button onClick={() => {
        const batch = JSON.parse(localStorage.getItem(backendKey) || 'null');
        if (batch) localStorage.setItem(backendKey, JSON.stringify({ ...batch, pending: false }));
      }}>完成模拟任务</button>
      <button onClick={() => {
        const batch = JSON.parse(localStorage.getItem(backendKey) || 'null');
        if (batch) localStorage.setItem(backendKey, JSON.stringify({ ...batch, pending: false, error: '模型请求超时，请稍后重试' }));
      }}>模拟生成失败</button>
      </details>
    </div>
    <AiNewsWriter currentUser={{ id: 900003 }} workspaceId={900003} initialChannelKey="press_release" />
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
