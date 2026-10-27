import React from 'react';
import DOMPurify from 'dompurify';
import { Button, TextArea, SegmentedControl } from './ui';
import { IconSparkleAI, IconChevronLeft } from './ui/icons';
import { request } from './services/request';
import { THEME_PRESETS, applyBlock } from './wechat/themes';
import { normalizeLayoutLibrary, templateLayout } from './utils/wechatWorkflow';

export default function WechatLayoutPanel({ confirmed, current, storageKey, onBack, onApply, onSaveContent }) {
  const jobKey = storageKey ? `${storageKey}:layout-job` : null;
  const [choice, setChoice] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(jobKey) || 'null') ? 'ai' : 'template'; } catch { return 'template'; }
  });
  const [template, setTemplate] = React.useState('');
  const [observed, setObserved] = React.useState({ templates: [], library: {}, loading: true, error: '' });
  const [selectedAssets, setSelectedAssets] = React.useState([]);
  const [failedAssets, setFailedAssets] = React.useState([]);
  const [brief, setBrief] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(jobKey) || 'null')?.brief || ''; } catch { return ''; }
  });
  const [pending, setPending] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(jobKey) || 'null'); } catch { return null; }
  });
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const busyRef = React.useRef(false);
  const [epoch, setEpoch] = React.useState(0);
  const applyRef = React.useRef(onApply);
  applyRef.current = onApply;
  React.useEffect(() => {
    const controller = new AbortController();
    request('/api/wechat-style/monitor-templates', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      const templates = Array.isArray(data.templates) ? data.templates : [];
      setObserved({ templates, library: normalizeLayoutLibrary(data.blocks || []), loading: false, error: '' });
      setTemplate(previous => templates.some(item => item.id === previous) ? previous : templates[0]?.id || '');
    }).catch(() => { if (!controller.signal.aborted) setObserved({ templates: [], library: {}, loading: false, error: '推文观察库样式暂时无法读取' }); });
    return () => controller.abort();
  }, []);
  const remember = value => {
    if (jobKey) {
      try { if (value) localStorage.setItem(jobKey, JSON.stringify(value)); else localStorage.removeItem(jobKey); }
      catch { if (value) throw Error('本机空间不足，请先备份内容稿'); }
    }
    setPending(value);
  };
  React.useEffect(() => {
    if (!pending?.clientRequestId || submitting) return undefined;
    const controller = new AbortController();
    let timer, misses = 0;
    const poll = async () => {
      try {
        const response = await request(`/api/wechat-compositions/layout/${pending.clientRequestId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 'succeeded' && response.result?.plan) {
          const library = await request('/api/wechat-style/blocks', { signal: controller.signal });
          if (controller.signal.aborted) return;
          const applied = applyRef.current(pending.confirmed, response.result.plan, normalizeLayoutLibrary(library.blocks || []));
          remember(null);
          if (!applied) setError('内容稿已修改，或已离开样式选择。原稿未覆盖，请重新确认内容后排版。');
          return;
        }
        if (['failed', 'cancelled'].includes(response.status)) {
          setError(response.error || 'AI 排版未完成，原稿已保留'); remember(null); return;
        }
        misses = 0;
      } catch (failure) {
        if (controller.signal.aborted) return;
        if ([401, 403].includes(failure.status)) { setError('账号或空间已变化，无法读取此排版任务'); return; }
        if (failure.status === 404 && ++misses >= 3) { setError('尚未确认任务是否提交。可重试同一任务，不会重复创建。'); return; }
        setError('暂时无法读取排版状态，后台任务仍保留');
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 10000 : 2000);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
    // pending is an immutable request snapshot, so a changed brief never changes an in-flight job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, epoch, jobKey, submitting]);
  const submit = async snapshot => {
    if (busyRef.current) return;
    busyRef.current = true; setSubmitting(true); setError('');
    try {
      remember(snapshot);
      await request('/api/wechat-compositions/layout', { method: 'POST', data: {
        source: snapshot.confirmed.source, brief: snapshot.brief, clientRequestId: snapshot.clientRequestId,
      } });
      setEpoch(value => value + 1);
    } catch (failure) {
      setError(failure.message || '排版请求暂未确认，原稿已保留');
      if (failure.status && failure.status < 500) remember(null);
    }
    finally { busyRef.current = false; setSubmitting(false); }
  };
  const run = () => {
    if (!current || !brief.trim() || pending) return;
    submit({ confirmed, brief: brief.trim(), clientRequestId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : `layout-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  };
  const selectedTemplate = observed.templates.find(item => item.id === template);
  const templateConfig = selectedTemplate ? { ...THEME_PRESETS.minimal, ...selectedTemplate.styleIds,
    accent: selectedTemplate.base?.accent || THEME_PRESETS.minimal.accent,
    body: { ...THEME_PRESETS.minimal.body, ...(selectedTemplate.base?.fontSize ? { fontSize: selectedTemplate.base.fontSize } : {}) },
    h1: selectedTemplate.styleIds.h2, bodyStyleId: 'builtin-body-plain' } : null;
  return <section className="wechat-layout-selection" aria-label="选择公众号样式">
    <div className="wechat-layout-heading"><div><h2>选择样式</h2><span>{confirmed?.source.title} · {confirmed?.source.doc.length || 0} 个内容块</span></div>
      <Button size="small" theme="borderless" onClick={onSaveContent}>备份内容稿</Button></div>
    {!current ? <div className="news-input-error" role="alert">内容稿已修改，请重新确认后再排版。<Button size="small" onClick={onBack}>返回确认</Button></div> : null}
    <SegmentedControl label="排版方式" value={choice} options={[{ value: 'template', label: '已有模板' }, { value: 'ai', label: 'AI 排版' }]}
      onChange={setChoice} />
    {choice === 'template' ? <>
      {observed.loading ? <p role="status">正在读取推文观察库样式</p> : observed.error ? <p role="alert">{observed.error}</p>
        : !observed.templates.length ? <p>推文观察库暂无可用的标题样式</p> : null}
      <div className="wechat-layout-templates">
      {observed.templates.map(item => {
        const heading = observed.library[item.styleIds.h2];
        const sample = heading ? DOMPurify.sanitize(applyBlock(heading, { content: '活动纪实', accent: item.base?.accent || THEME_PRESETS.minimal.accent })) : '';
        return <button type="button" key={item.id} aria-pressed={template === item.id} onClick={() => { setTemplate(item.id); setSelectedAssets([]); }}>
          <div className="wechat-template-sample" dangerouslySetInnerHTML={{ __html: sample }} />
          <div className="wechat-template-lines" aria-hidden="true"><i /><i /><i /></div>
          <span>{item.name}</span><small>{item.count > 1 ? `系列 · ${item.count} 篇 · ${item.sourceTitle}` : '北京中关村学院 · 推文观察库'}</small>
        </button>;
      })}
    </div>
    {selectedTemplate?.brandCandidates?.length ? <section className="wechat-brand-assets" aria-label="候选固定图">
      <h3>候选固定图</h3>
      <p>多篇推文重复使用，请核对后选择。</p>
      <div className="wechat-brand-assets-list">{selectedTemplate.brandCandidates.map(asset => <label key={asset.id}>
        <input type="checkbox" disabled={failedAssets.includes(asset.id)} checked={selectedAssets.includes(asset.id)} onChange={event => {
          const checked = event.target.checked;
          setSelectedAssets(previous => checked ? [...previous, asset.id] : previous.filter(id => id !== asset.id));
        }} />
        {failedAssets.includes(asset.id) ? <span className="wechat-brand-asset-unavailable">预览暂不可用</span>
          : <img src={asset.src} alt="" loading="lazy" onError={() => {
            setFailedAssets(previous => [...previous, asset.id]);
            setSelectedAssets(previous => previous.filter(id => id !== asset.id));
          }} />}
        <span>{asset.position === 'top' ? '文首' : '文末'} · {asset.occurrences} 篇使用</span>
      </label>)}</div>
    </section> : null}</> : <div className="wechat-layout-brief">
      <label htmlFor="wechat-style-brief">想要什么风格？</label>
      <TextArea id="wechat-style-brief" aria-label="排版风格描述" value={brief} onChange={setBrief} rows={3} maxLength={1000}
        placeholder="黑白简洁的校园纪实风，导语稍突出，正文留白多一点。" />
    </div>}
    {pending ? <div className="news-generation-status" role="status"><IconSparkleAI /> 正在从样式库匹配排版，内容稿保持不变</div> : null}
    {error ? <p className="news-input-error" role="alert">{error}</p> : null}
    <div className="wechat-layout-actions"><Button size="small" theme="borderless" icon={<IconChevronLeft />} onClick={onBack}>返回内容稿</Button>
      {pending && error ? <Button disabled={submitting} onClick={() => submit(pending)}>重试同一任务</Button> : null}
      {choice === 'template' ? <Button type="primary" disabled={!current || Boolean(pending) || !templateConfig} onClick={() => onApply(confirmed, templateLayout(confirmed.source, templateConfig), observed.library,
        (selectedTemplate.brandCandidates || []).filter(asset => selectedAssets.includes(asset.id)), templateConfig.imageCard)}>应用模板，生成排版稿</Button>
        : <Button type="primary" icon={<IconSparkleAI />} disabled={!current || !brief.trim() || Boolean(pending) || submitting} onClick={run}>AI 自动排版</Button>}
    </div>
  </section>;
}
