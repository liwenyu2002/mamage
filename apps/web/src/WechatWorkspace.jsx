import React from 'react';
import { Button, Modal, Toast } from './ui';
import { IconListView, IconDownload, IconSimilarStack } from './ui/icons';
import { wechatAiDraftKey, wechatImportKey, hasWechatDraft } from './utils/wechatDraftState';
import { newsDraftKey } from './utils/newsWriterState';
import { workflowKey, contentSignature, freezeContent, materializeLayout, addObservedBrandAssets } from './utils/wechatWorkflow';
import { saveComposition } from './services/wechatCompositionService';
import WechatLayoutPanel from './WechatLayoutPanel';
import WechatDraftBackups from './WechatDraftBackups';
import './newsWriter.css';

const Composer = React.lazy(() => import('./WechatComposer'));
const Writer = React.lazy(() => import('./AiNewsWriter'));
const Monitor = React.lazy(() => import('./WechatMonitor'));
function read(key) { try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch { return null; } }

export default function WechatWorkspace({ currentUser, workspaceId, initialMode = 'library' }) {
  const [workspaceView, setWorkspaceView] = React.useState(() => new URLSearchParams(location.search).get('view') === 'monitor' ? 'monitor' : 'writing');
  const draftKey = wechatAiDraftKey(currentUser?.id, workspaceId);
  const importKey = wechatImportKey(currentUser?.id, workspaceId);
  const stateKey = workflowKey(currentUser?.id, workspaceId);
  const [initial] = React.useState(() => read(stateKey) || {});
  const [mode, setMode] = React.useState(() => ['ai', 'library'].includes(initial.mode) ? initial.mode : initialMode);
  const [article, setArticle] = React.useState(() => {
    const draft = read(newsDraftKey(currentUser?.id, workspaceId));
    const content = draft?.channelContent?.wechat_article;
    return content ? { title: content.title || '', markdown: content.markdownText || '', photos: draft.selectedPhotos || [],
      formValues: draft.formValues, interviewText: draft.interviewText || '', participantChips: draft.participantChips || [],
      extra: content.extra || {}, references: Array.isArray(content.references) ? content.references : null,
      referenceStatus: content.referenceStatus || null, sourceJobId: content.sourceJobId || null } : null;
  });
  const [confirmed, setConfirmed] = React.useState(initial.confirmed || null);
  const [styled, setStyled] = React.useState(() => initial.styled || (hasWechatDraft(read(draftKey)) ? read(draftKey) : null));
  const [stage, setStage] = React.useState(() => initial.stage === 'styles' && initial.confirmed ? 'styles'
    : initial.stage === 'styled' && (initial.styled || hasWechatDraft(read(draftKey))) ? 'styled' : 'content');
  const [composer, setComposer] = React.useState(() => initial.stage === 'styled' && (initial.styled || hasWechatDraft(read(draftKey)))
    ? { article: initial.styled || read(draftKey), version: 0 } : null);
  const [restoredArticle, setRestoredArticle] = React.useState(null);
  const [backupsOpen, setBackupsOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false), busyRef = React.useRef(false);
  const [storageError, setStorageError] = React.useState('');
  const [legacyAvailable, setLegacyAvailable] = React.useState(() => hasWechatDraft(read('wechat-composer-draft')));
  const latest = React.useRef({ article, stage }); latest.current = { article, stage };
  const onArticleChange = React.useCallback(next => setArticle(next), []);
  const onBusyChange = React.useCallback(busy => { busyRef.current = busy; }, []);
  const onSnapshotChange = React.useCallback(next => setStyled(next), []);
  const contentCurrent = Boolean(confirmed && article && confirmed.signature === contentSignature(article));
  React.useEffect(() => {
    if (!stateKey) return;
    try { localStorage.setItem(stateKey, JSON.stringify({ mode, stage, confirmed, styled })); setStorageError(''); }
    catch { setStorageError('本机存储空间不足，请将稿件备份后再继续'); }
  }, [stateKey, mode, stage, confirmed, styled]);

  const retainLayout = () => {
    const old = read(draftKey);
    if (draftKey && hasWechatDraft(old)) localStorage.setItem(`${draftKey}:previous`, JSON.stringify(old));
  };
  const openStyled = next => {
    retainLayout(); setStyled(next); setComposer({ article: next, version: `${Date.now()}-${Math.random()}` }); setStage('styled');
  };
  const confirmContent = next => {
    try { const snapshot = freezeContent(next); setArticle(next); setConfirmed(snapshot); setStage('styles'); }
    catch (error) { Toast.error(error.message); }
  };
  const applyLayout = (source, plan, library, assets = [], imageStyleId) => {
    if (latest.current.stage !== 'styles' || contentSignature(latest.current.article) !== source.signature) return false;
    try { openStyled(addObservedBrandAssets(materializeLayout(source, plan, library), assets, library, imageStyleId)); return true; }
    catch (error) { Toast.error(error.message || '排版未应用，原稿已保留'); return false; }
  };
  const saveBackup = async kind => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      let payload;
      if (kind === 'content') {
        const source = freezeContent(latest.current.article);
        payload = { title: source.source.title, doc: source.source.doc, sourceDocument: source.article, blockConfig: null };
      } else {
        if (!styled?.doc?.length) throw Error('还没有排版稿');
        payload = styled;
      }
      const label = kind === 'content' ? '内容稿' : '排版稿';
      await saveComposition({ ...payload, draftKind: kind, name: `${payload.title || '未命名图文'} · ${label} · ${new Date().toLocaleString('zh-CN')}`.slice(0, 120) });
      Toast.success(`${label}已备份`);
    } catch (error) { Toast.error(error.message || '备份失败，当前稿件未改变'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const restore = full => {
    if (full.draftKind === 'content' && busyRef.current) { Toast.info('内容稿仍在后台生成，请完成后再恢复'); return; }
    Modal.confirm({ title: `恢复${full.draftKind === 'content' ? '内容稿' : '排版稿'}？`,
      content: full.draftKind === 'content' ? '只恢复文字与配图位置，现有排版稿保持不变。当前内容稿会保留到历史版本。'
        : '只恢复这份排版稿，不改变内容稿。当前排版稿会留存一份本机备份。', okText: '确认恢复', onOk: () => {
        try {
          if (full.draftKind === 'content') {
            if (busyRef.current) throw Error('内容稿仍在生成，请完成后再恢复');
            if (typeof full.sourceDocument?.markdown !== 'string') throw Error('这份备份缺少内容稿');
            setRestoredArticle({ article: full.sourceDocument, restoreId: `${Date.now()}-${Math.random()}` });
            setArticle(full.sourceDocument); setConfirmed(null); setStage('content');
          } else openStyled(full);
          setBackupsOpen(false);
        } catch (error) { Toast.error(error.message); }
      } });
  };
  React.useEffect(() => {
    const pending = read(importKey);
    if (pending?.markdown?.trim()) Modal.confirm({ title: '载入这份内容稿？', content: '当前内容稿会保留到历史版本，现有排版稿不变。', okText: '载入内容稿', onOk: () => {
      if (busyRef.current) { Toast.info('请等待当前生成任务完成'); return; }
      setRestoredArticle({ article: pending, restoreId: `import-${Date.now()}` }); setArticle(pending); setConfirmed(null); setStage('content'); setMode('ai');
      if (importKey) localStorage.removeItem(importKey);
    } });
    // Imports are offered once, never consumed by a render or another account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const restoreLocal = (key, legacy = false) => {
    Modal.confirm({ title: legacy ? '导入本机旧排版草稿？' : '恢复上一份排版草稿？',
      content: legacy ? '旧缓存未区分账号，请确认是你的稿件。原缓存保留，内容稿不变。' : '当前排版稿会与上一份本机备份交换，内容稿不变。', okText: '确认恢复', onOk: () => {
        try { const next = read(key); if (!hasWechatDraft(next)) throw Error('没有可恢复的排版稿'); openStyled(next); if (legacy) setLegacyAvailable(false); }
        catch (error) { Toast.error(error.message); }
      } });
  };
  return <div className={`wechat-workspace is-${stage}`}>
    <nav className="wechat-view-tabs" role="tablist" aria-label="公众号工作区">
      {[['writing', '内容创作', IconListView], ['monitor', '推文观察', IconSimilarStack]].map(([key, label, Icon]) => <button key={key} type="button" role="tab"
        aria-selected={workspaceView === key} onClick={() => { setWorkspaceView(key); const url = new URL(location.href);
          if (key === 'monitor') url.searchParams.set('view', 'monitor'); else url.searchParams.delete('view'); history.replaceState(null, '', url); }}><Icon />{label}</button>)}
    </nav>
    {workspaceView === 'monitor' ? <React.Suspense fallback={<p role="status">正在加载推文观察…</p>}><Monitor workspaceId={workspaceId} /></React.Suspense> : null}
    <div hidden={workspaceView !== 'writing'}>
    {mode === 'library' ? <React.Suspense fallback={<p role="status">正在加载推文列表…</p>}>
      <Composer currentUser={currentUser} workspaceId={workspaceId} onStartAiWorkflow={() => { setStage('content'); setMode('ai'); }} />
    </React.Suspense> : <>
    <div className="wechat-workflow-bar">
      <Button size="small" theme="borderless" icon={<IconListView />} onClick={() => setMode('library')}>推文列表</Button>
      <nav aria-label="公众号制作进度">
        {[['content', '内容草稿'], ['styles', '选择样式'], ['styled', '排版稿']].map(([key, label], index) => <button key={key} type="button"
          aria-current={stage === key ? 'step' : undefined} disabled={key === 'styles' ? !contentCurrent : key === 'styled' ? !styled : false}
          onClick={() => { if (key === 'styled' && !composer) setComposer({ article: styled, version: Date.now() }); setStage(key); }}>
          <span>{index + 1}</span>{label}</button>)}
      </nav>
      <div className="wechat-workflow-actions">
        {stage !== 'styles' ? <Button size="small" icon={<IconDownload />} disabled={saving || (stage === 'content' ? !article?.markdown : !styled?.doc?.length)}
          onClick={() => saveBackup(stage === 'content' ? 'content' : 'layout')}>{stage === 'content' ? '备份内容稿' : '备份排版稿'}</Button> : null}
        <Button size="small" theme="borderless" icon={<IconListView />} onClick={() => setBackupsOpen(true)}>稿件备份</Button>
      </div>
    </div>
    {storageError ? <p className="news-input-error" role="alert">{storageError}</p> : null}
    {stage !== 'content' && confirmed && !contentCurrent ? <p className="wechat-workflow-notice" role="status">内容稿已修改，现有排版稿仍保留。重新确认内容后可生成新版排版。</p> : null}
    <div hidden={stage !== 'content'}><React.Suspense fallback={<p role="status">正在加载内容稿…</p>}>
      <Writer currentUser={currentUser} workspaceId={workspaceId} initialChannelKey="wechat_article" onOpenComposer={confirmContent}
        onArticleChange={onArticleChange} onBusyChange={onBusyChange} restoredArticle={restoredArticle} />
    </React.Suspense></div>
    {confirmed ? <div hidden={stage !== 'styles'}><WechatLayoutPanel confirmed={confirmed} current={contentCurrent}
      storageKey={stateKey} onBack={() => setStage('content')} onApply={applyLayout} onSaveContent={() => saveBackup('content')} /></div> : null}
    {composer ? <div hidden={stage !== 'styled'}><React.Suspense fallback={<p role="status">正在加载排版稿…</p>}>
      <Composer key={composer.version} currentUser={currentUser} workspaceId={workspaceId} initialArticle={composer.article}
        active={stage === 'styled'} onSnapshotChange={onSnapshotChange} draftStorageKey={draftKey} guided />
    </React.Suspense></div> : null}
    <div className="wechat-local-recovery">
      {legacyAvailable ? <Button size="small" theme="borderless" onClick={() => restoreLocal('wechat-composer-draft', true)}>导入旧排版草稿</Button> : null}
      {hasWechatDraft(read(`${draftKey}:previous`)) ? <Button size="small" theme="borderless" onClick={() => restoreLocal(`${draftKey}:previous`)}>恢复上一份排版草稿</Button> : null}
    </div>
    {backupsOpen ? <WechatDraftBackups onClose={() => setBackupsOpen(false)} onRestore={restore} /> : null}
    </>}
    </div>
  </div>;
}
