import React from 'react';
import { Button, Modal, Toast } from './ui';
import { IconListView, IconDownload, IconSimilarStack } from './ui/icons';
import { wechatAiDraftKey, wechatImportKey, hasWechatDraft } from './utils/wechatDraftState';
import { newsDraftKey } from './utils/newsWriterState';
import { workflowKey, contentSignature, freezeContent, materializeLayout, addObservedBrandAssets, mergeContentIntoLayout, layoutToMarkdown } from './utils/wechatWorkflow';
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
  const [initial] = React.useState(() => {
    const workflow = read(stateKey) || {};
    const savedDraft = read(draftKey);
    // The composer saves before its parent snapshot, which may lag an immediate reload.
    return hasWechatDraft(savedDraft) ? { ...workflow, styled: savedDraft } : workflow;
  });
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
  const [savedAt, setSavedAt] = React.useState(null);
  const [layoutDirty, setLayoutDirty] = React.useState(false);
  const layoutSnapshotRef = React.useRef(null);
  const markSaved = React.useCallback(() => setSavedAt(Date.now()), []);
  const onArticleChange = React.useCallback(next => { setArticle(next); markSaved(); }, [markSaved]);
  const onBusyChange = React.useCallback(busy => { busyRef.current = busy; }, []);
  const onSnapshotChange = React.useCallback(next => {
    // 只有快照内容真的变化才算“排版稿被编辑过”，避免挂载/恢复备份时误触发文字回写。
    const previous = layoutSnapshotRef.current;
    layoutSnapshotRef.current = next;
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) setLayoutDirty(true);
    setStyled(next);
    markSaved();
    // 快照必须同步回 composer.article：否则去「推文列表」再回来会用旧快照重挂载，覆盖刚做的排版。
    setComposer(previous => previous ? { ...previous, article: next } : previous);
  }, [markSaved]);
  const contentCurrent = Boolean(confirmed && article && confirmed.signature === contentSignature(article));
  React.useEffect(() => {
    if (!stateKey) return;
    try { localStorage.setItem(stateKey, JSON.stringify({ mode, stage, confirmed, styled })); setStorageError(''); }
    catch { setStorageError('本机存储空间不足，请将稿件备份后再继续'); }
  }, [stateKey, mode, stage, confirmed, styled]);

  // 排版稿文字回写内容稿是显式动作（不让“恢复排版稿/切步骤”顺手改内容稿）：用户点按钮才同步。
  const syncLayoutToContent = React.useCallback(() => {
    if (!styled?.doc?.length) { Toast.info('还没有排版稿可回写'); return; }
    const markdown = layoutToMarkdown(styled.doc);
    if (markdown === null) { Toast.info('排版稿含整文复制的复杂块，暂不支持把文字自动回写到内容稿'); return; }
    if (!markdown.trim()) { Toast.info('排版稿没有可回写的文字'); return; }
    // 标题归内容稿管理（恢复排版稿不应改内容稿标题）；只回写正文/图片。
    const nextArticle = { ...(article || {}), title: article?.title || styled.title || '', markdown };
    try {
      const snapshot = freezeContent(nextArticle);
      setArticle(nextArticle); setConfirmed(snapshot);
      setRestoredArticle({ restoreId: `layout-${Date.now()}`, article: nextArticle });
      setLayoutDirty(false);
      layoutSnapshotRef.current = null;
      setStage('content');
      Toast.success('排版稿的文字已回写到内容稿');
    } catch (error) { Toast.warning(error.message || '排版稿文字暂时无法回写到内容稿'); }
  }, [styled, article]);
  const openContentStage = React.useCallback(() => setStage('content'), []);
  const retainLayout = () => {
    const old = read(draftKey);
    if (draftKey && hasWechatDraft(old)) localStorage.setItem(`${draftKey}:previous`, JSON.stringify(old));
  };
  const openStyled = next => {
    retainLayout(); setStyled(next); setComposer({ article: next, version: `${Date.now()}-${Math.random()}` }); setStage('styled');
  };
  const syncContentToLayout = snapshot => {
    try {
      const merged = mergeContentIntoLayout(snapshot, styled);
      retainLayout();
      setArticle(snapshot.article); setConfirmed(snapshot); setStyled(merged);
      setComposer({ article: merged, version: `sync-${Date.now()}` });
      setStage('styled');
      Toast.success('内容已同步到排版稿，原有样式与分组已保留');
    } catch (error) { Toast.error(error.message || '同步失败，原稿已保留'); }
  };
  const confirmContent = next => {
    try {
      const snapshot = freezeContent(next);
      setArticle(next);
      const contentChanged = Boolean(confirmed && confirmed.signature !== snapshot.signature);
      if (styled?.doc?.length && contentChanged) {
        // 已有排版稿且内容有改动：默认把新内容合并进现有排版稿，避免重排丢掉样式/换图/图注。
        Modal.confirm({
          title: '内容稿有改动，如何应用到排版稿？',
          content: '「同步到现有排版稿」会按文字/图片匹配更新内容并保留原样式与分组；若想重新选样式，点「取消」后进入「选择样式」（当前排版稿会先留存本机备份）。',
          okText: '同步到现有排版稿', cancelText: '重新选样式',
          onOk: () => syncContentToLayout(snapshot),
          onCancel: () => { retainLayout(); setConfirmed(snapshot); setStage('styles'); },
        });
        return;
      }
      setConfirmed(snapshot); setStage('styles');
    } catch (error) { Toast.error(error.message); }
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
          onClick={() => { if (key === 'content') { openContentStage(); return; } if (key === 'styled' && !composer) setComposer({ article: styled, version: Date.now() }); setStage(key); }}>
          <span>{index + 1}</span>{label}</button>)}
      </nav>
      <div className="wechat-workflow-actions">
        {stage === 'styled' && layoutDirty ? <Button size="small" onClick={syncLayoutToContent}>文字回写内容稿</Button> : null}
        <span className="wechat-autosave" role="status" title="内容稿与排版稿会自动保存在本机浏览器，刷新后可恢复">
          {savedAt ? `已自动保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '草稿自动保存在本机'}
        </span>
        {stage !== 'styles' ? <Button size="small" icon={<IconDownload />} disabled={saving || (stage === 'content' ? !article?.markdown : !styled?.doc?.length)}
          onClick={() => saveBackup(stage === 'content' ? 'content' : 'layout')}>{stage === 'content' ? '备份内容稿' : '备份排版稿'}</Button> : null}
        <Button size="small" theme="borderless" icon={<IconListView />} onClick={() => setBackupsOpen(true)}>稿件备份</Button>
      </div>
    </div>
    {storageError ? <p className="news-input-error" role="alert">{storageError}</p> : null}
    {stage !== 'content' && confirmed && !contentCurrent ? <p className="wechat-workflow-notice" role="status">内容稿已修改，现有排版稿仍保留。重新确认内容后可生成新版排版。</p> : null}
    {stage === 'content' && layoutDirty ? <p className="wechat-workflow-notice" role="status">排版稿有未回写的文字改动。 <Button size="small" onClick={syncLayoutToContent}>同步回内容稿</Button></p> : null}
    <div hidden={stage !== 'content'}><React.Suspense fallback={<p role="status">正在加载内容稿…</p>}>
      <Writer currentUser={currentUser} workspaceId={workspaceId} initialChannelKey="wechat_article" onOpenComposer={confirmContent}
        onArticleChange={onArticleChange} onBusyChange={onBusyChange} restoredArticle={restoredArticle} />
    </React.Suspense></div>
    {confirmed ? <div hidden={stage !== 'styles'}><WechatLayoutPanel confirmed={confirmed} current={contentCurrent}
      storageKey={stateKey} onBack={openContentStage} onApply={applyLayout} onSaveContent={() => saveBackup('content')} /></div> : null}
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
