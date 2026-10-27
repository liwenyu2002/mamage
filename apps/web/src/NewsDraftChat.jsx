import React from 'react';
import { Button, TextArea } from './ui';
import { IconSparkleAI, IconClose } from './ui/icons';
import { request } from './services/request';
import { revisionSource, applyRevision, revisionTarget, contextualRevisionTarget, requiresExactSelection, revisionContinuation, REVISION_ACTIONS } from './utils/newsRevision';
import { contentSignature } from './utils/wechatWorkflow';
import { floatingPosition } from './utils/newsEditorSelection';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const NewsRevisionEnvironment = React.createContext('api');
function read(key, execution) {
  try {
    const saved = key ? JSON.parse(localStorage.getItem(key) || 'null') || {} : {};
    if (saved.execution === execution) return saved;
    if (key && (saved.pending || saved.proposal)) localStorage.setItem(`${key}:before-execution-scope`, JSON.stringify(saved));
  } catch { /* A stale suggestion must never prevent opening the manuscript. */ }
  return {};
}
export default function NewsDraftChat({ article, storageKey, disabled, onApply, selection, onHighlightChange }) {
  const execution = React.useContext(NewsRevisionEnvironment);
  const [initial] = React.useState(() => read(storageKey, execution));
  const [pending, setPending] = React.useState(initial.pending || null);
  const [proposal, setProposal] = React.useState(initial.proposal || null);
  const [context, setContext] = React.useState(initial.context || initial.pending || null);
  const [question, setQuestion] = React.useState(initial.version === 2 ? initial.question || '' : '');
  const [instruction, setInstruction] = React.useState('');
  const [scope, setScope] = React.useState(initial.proposal ? 'proposal' : 'selection');
  const [open, setOpen] = React.useState(Boolean(initial.pending || initial.proposal));
  const openReason = React.useRef(initial.pending || initial.proposal ? 'resume' : 'selection');
  const [anchor, setAnchor] = React.useState(initial.pending?.anchor || initial.proposal?.anchor || null);
  const [position, setPosition] = React.useState({ left: 12, top: 100, width: 420 });
  const panel = React.useRef(null);
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [epoch, setEpoch] = React.useState(0);
  const busy = React.useRef(false);
  const alive = React.useRef(true);
  const current = proposal && contentSignature(article) === contentSignature(proposal.base);
  const working = React.useMemo(() => current ? { ...article, title: proposal.title, markdown: proposal.markdown } : article, [article, current, proposal]);
  const selectionCurrent = selection?.markdown === article.markdown;
  const highlight = pending?.highlight || (scope === 'proposal' ? proposal?.highlight : selectionCurrent ? selection : context?.highlight);
  React.useLayoutEffect(() => {
    onHighlightChange?.(open && highlight?.markdown === article.markdown ? highlight : null);
  }, [open, highlight, article.markdown, onHighlightChange]);
  React.useEffect(() => () => onHighlightChange?.(null), [onHighlightChange]);
  React.useEffect(() => { if (proposal) setScope('proposal'); }, [proposal]);
  React.useEffect(() => {
    if (selection?.markdown === article.markdown && (selection.text || selection.explicit)) {
      openReason.current = 'selection'; setScope('selection'); setAnchor(selection.anchor); setOpen(true);
      if (!pending) { setQuestion(''); setInstruction(''); setError(''); }
    }
    else if (!selection && openReason.current === 'selection') setOpen(false);
  }, [selection]);
  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const viewport = window.visualViewport;
      setPosition(floatingPosition(anchor, { height: panel.current?.getBoundingClientRect().height, width: 420 }, {
        width: viewport?.width || innerWidth, height: viewport?.height || innerHeight,
        left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      }));
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place); window.visualViewport?.addEventListener('resize', place);
    const outside = event => { if (!panel.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    let scrollX = window.scrollX, scrollY = window.scrollY;
    const scroll = event => {
      if (panel.current?.contains(event.target)) return;
      const dx = window.scrollX - scrollX, dy = window.scrollY - scrollY;
      scrollX = window.scrollX; scrollY = window.scrollY;
      if (dx || dy) setAnchor(previous => previous ? { x: previous.x - dx, top: previous.top - dy, bottom: previous.bottom - dy } : previous);
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); document.removeEventListener('scroll', scroll, true);
    };
  }, [open, anchor]);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const remember = React.useCallback(value => { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ ...value, execution })); }, [storageKey, execution]);
  React.useEffect(() => {
    try { remember({ version: 2, pending, proposal, context, question }); }
    catch { setError('本机草稿空间不足，请先备份稿件'); }
  }, [pending, proposal, context, question, remember]);
  React.useEffect(() => {
    if (!pending || submitting) return undefined;
    const controller = new AbortController();
    let timer, misses = 0;
    const poll = async () => {
      try {
        const response = await request(`/api/wechat-compositions/revision/${pending.clientRequestId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 'succeeded' && response.result?.plan) {
          if (response.result.plan.questions?.length) {
            setQuestion(response.result.plan.questions.join('\n'));
            setPending(null); setProposal(null); setError(''); return;
          }
          let result;
          try { result = applyRevision(pending.working || pending.base, response.result.plan); }
          catch (failure) { setError(failure.message); setPending(null); return; }
          let continuationTarget = null, continuationError = '';
          try { continuationTarget = revisionContinuation(pending, response.result.plan, result); }
          catch (failure) { continuationError = failure.message; }
          setProposal({ ...result, base: pending.base, instruction: pending.instruction, mode: pending.mode, target: pending.target,
            anchor: pending.anchor, label: pending.label,
            highlight: pending.highlight,
            changes: response.result.plan.blocks.filter(block => pending.source.blocks.find(old => old.uid === block.uid)?.text !== block.text)
              .map(block => ({ ...block, original: pending.source.blocks.find(old => old.uid === block.uid)?.text || '' })),
            continuationTarget, continuationError }); setPending(null); setError(''); return;
        }
        if (['failed', 'cancelled'].includes(response.status)) { setError(response.error || '改稿未完成，原稿已保留'); setPending(null); return; }
        misses = 0;
      } catch (failure) {
        if (controller.signal.aborted) return;
        if ([401, 403].includes(failure.status)) { setError('无法读取此账号或空间的改稿任务'); return; }
        if (failure.status === 404 && ++misses >= 3) { setError('任务尚未确认，可重试提交同一条要求'); return; }
        setError('正在重新连接，原稿已保留');
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 10000 : 2000);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, epoch, submitting]);
  const submit = async snapshot => {
    if (busy.current || disabled) return;
    busy.current = true; setSubmitting(true); setError('');
    try {
      // Persist before sending so a reload can recover the same idempotent request.
      remember({ version: 2, pending: snapshot, proposal: null, context: snapshot, question: '' });
      setPending(snapshot); setProposal(null); setContext(snapshot); setQuestion('');
      await request('/api/wechat-compositions/revision', { method: 'POST', data: {
        source: snapshot.source, instruction: snapshot.instruction, clientRequestId: snapshot.clientRequestId,
        mode: snapshot.mode || 'custom', target: snapshot.target || null, originalSelection: snapshot.originalSelection || null, conversation: snapshot.conversation || [],
        form: { ...snapshot.base.formValues, confirmedParticipantNames: snapshot.base.participantChips || [] }, interviewText: snapshot.base.interviewText || '',
      } });
      if (alive.current) setEpoch(value => value + 1);
    } catch (failure) {
      if (alive.current) {
        setError(failure.message || '暂未确认改稿任务，原稿已保留');
        if (failure.status && failure.status < 500) setPending(null);
      }
    } finally { busy.current = false; if (alive.current) setSubmitting(false); }
  };
  const send = (action = 'custom') => {
    if ((!instruction.trim() && action === 'custom') || pending || busy.current || disabled) return;
    try {
      const answering = (question || !selectionCurrent) && !proposal && context && contentSignature(article) === contentSignature(context.base);
      const sourceArticle = answering ? context.working || article : scope === 'selection' && selectionCurrent ? article : working;
      if (scope === 'selection' && !selectionCurrent && !answering) throw Error('选区已变化，请重新选择正文');
      const fullSource = revisionSource(sourceArticle);
      const actionLabel = REVISION_ACTIONS.find(item => item.value === action)?.label || '修改';
      const followUp = current && scope === 'proposal';
      if (followUp && proposal.continuationError) throw Error(proposal.continuationError);
      if (followUp && context?.originalSelection && requiresExactSelection(instruction.trim())) throw Error('请先采用或放弃建议，再重新选中文字进行精确修改');
      if (!followUp && !selectionCurrent && !answering) throw Error('请在正文中重新选择要修改的位置');
      const requestMode = followUp ? 'custom' : answering ? context.mode || action : action;
      const initialTarget = followUp ? proposal.continuationTarget : answering ? context.target : revisionTarget(action, 'selection', fullSource, selection);
      const expanded = followUp ? { target: initialTarget, originalSelection: null } : answering
        ? contextualRevisionTarget(requestMode, context.originalSelection || initialTarget, fullSource, instruction.trim())
        : contextualRevisionTarget(action, initialTarget, fullSource, instruction.trim());
      const { target, originalSelection } = expanded;
      const conversation = followUp || answering ? [
        ...(context?.conversation || []).slice(-2),
        ...(context?.instruction ? [{ role: 'user', text: context.instruction }] : []),
        ...(question ? [{ role: 'assistant', text: question }] : []),
      ].slice(-4) : [];
      const snapshot = { base: article, working: sourceArticle, source: fullSource, instruction: instruction.trim() || (followUp ? actionLabel : ''), mode: requestMode, target, originalSelection,
        highlight: followUp ? proposal.highlight : answering ? context.highlight : selection,
        anchor, label: followUp ? proposal.label : answering ? context.label : selection?.text ? `已选 ${selection.ranges?.length || 1} 段 · ${selection.text.length} 字` : '当前段落',
        conversation,
        clientRequestId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `revision-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      setInstruction('');
      submit(snapshot);
    } catch (failure) { setError(failure.message); }
  };
  const resumable = pending || proposal || error || (context && question);
  const followUp = current && scope === 'proposal';
  const label = pending?.label || (scope === 'proposal' ? proposal?.label : null)
    || (selection?.text ? `已选 ${selection.text.length} 字${selection.ranges?.length > 1 ? ` · ${selection.ranges.length} 段` : ''}` : context?.label || '当前段落');
  return <>
    {!open && resumable ? <button type="button" className="news-revision-resume" onClick={() => { openReason.current = 'resume'; setScope(proposal ? 'proposal' : 'selection'); setOpen(true); }}>
      <IconSparkleAI />{pending ? 'AI 修改中' : proposal ? '查看修改建议' : '补充材料'}</button> : null}
    {open ? <section ref={panel} className="news-draft-chat news-context-chat" role="dialog" aria-modal="false" aria-label="AI 就地改稿" style={position}>
    <div className="news-chat-heading"><IconSparkleAI /><strong>{label}</strong>
      <button type="button" aria-label="关闭 AI 浮窗" title="关闭" onClick={() => setOpen(false)}><IconClose /></button></div>
    {(pending?.originalSelection || (scope === 'proposal' && context?.originalSelection)) ? <p className="news-chat-scope">允许为衔接调整同一句文字，句外内容保持不变</p> : null}
    <div className="news-chat-presets">
      {REVISION_ACTIONS.filter(item => ['polish', 'shorten', 'expand', ...(followUp ? [] : ['complete', 'add_paragraph'])].includes(item.value)).map(item =>
        <button type="button" key={item.value} disabled={Boolean(pending) || disabled || (!followUp && !selectionCurrent) || (item.value === 'complete' && selection?.ranges?.length > 1)}
          onPointerDown={event => event.preventDefault()} onClick={() => send(item.value)}>{item.value === 'expand' ? '扩充' : item.label}</button>)}
    </div>
    {pending ? <p className="news-chat-pending" role="status"><span className="news-status-dot" />后台改稿中</p> : null}
    {question ? <p className="news-chat-question" role="status">{question}</p> : null}
    {error ? <p className="news-input-error" role="alert">{error}</p> : null}
    {pending && error ? <Button size="small" disabled={submitting || disabled} onClick={() => submit(pending)}>重试改稿任务</Button> : null}
    {proposal && scope === 'proposal' ? <div className="news-chat-proposal">
      <div className="news-chat-proposal-preview" aria-label="修改建议">
        {(proposal.changes || [{ text: proposal.markdown }]).map((change, index) => <div key={index} className="news-chat-comparison">
          {change.original ? <div><span className="news-chat-comparison-label">原文</span><div
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(change.original), { FORBID_TAGS: ['img'] }) }} /></div> : null}
          <div><span className="news-chat-comparison-label">建议</span><div
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(change.text), { FORBID_TAGS: ['img'] }) }} /></div>
        </div>)}
      </div>
      {!current ? <p role="status">正文已修改，这份建议不能覆盖当前稿件。</p> : null}
      <div className="news-paragraph-actions"><Button size="small" type="primary" disabled={!current || disabled} onClick={() => {
        if (!current) return;
        onApply(proposal); setProposal(null); setContext(null); setQuestion(''); setInstruction(''); setOpen(false);
      }}>采用修改</Button><Button size="small" theme="borderless" onClick={() => {
        setProposal(null); setContext(null); setQuestion(''); setInstruction(''); setOpen(false);
      }}>放弃建议</Button></div>
    </div> : null}
    <div className="news-chat-input"><TextArea aria-label="改稿要求" value={instruction} onChange={setInstruction} rows={2} maxLength={2000}
      placeholder="希望怎么改？" disabled={Boolean(pending) || disabled}
      onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
      <Button type="primary" size="small" icon={<IconSparkleAI />} disabled={!instruction.trim() || Boolean(pending) || disabled || submitting} onClick={() => send()}>{followUp ? '继续调整' : '发送'}</Button></div>
  </section> : null}</>;
}
