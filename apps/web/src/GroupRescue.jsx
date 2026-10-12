import React from 'react';
import { createPortal } from 'react-dom';
import { Layout, Card, Button, Toast, Spin, Typography } from './ui';
import { getAll as getTransferAll, subscribe as subscribeTransfer } from './services/transferStore';
import { resolveAssetUrl } from './services/request';
import { runGroupRescueJob, getPhotoById } from './services/photoService';

const { Header, Content } = Layout;
const { Text } = Typography;

// 中转站条目 → 本页候选（只收带数字 id 的，缺编号无法参与合成）
function normalizeStationItems(items) {
  const out = [];
  (items || []).forEach((p) => {
    const idNum = Number(p && p.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    out.push({
      id: String(idNum),
      thumbUrl: resolveAssetUrl(p.thumbSrc || p.thumbUrl || p.url) || '',
      projectTitle: p.projectTitle || '',
    });
  });
  return out;
}

// 合影救场（手动模式）：与 AI 写稿助手并列的功能页。
// 中转站里的照片直接铺成可勾选网格——点选或从中转站浮窗拖进来挑 2-5 张连拍发起合成。
function GroupRescue() {
  const [stationItems, setStationItems] = React.useState(() => normalizeStationItems(getTransferAll()));
  const [picked, setPicked] = React.useState({}); // id -> item（点选/拖入都写这里）
  const [baseId, setBaseId] = React.useState(null); // 基底照片（要修的那张；默认第一张选中的）
  const [dragHover, setDragHover] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [step, setStep] = React.useState('');
  const [result, setResult] = React.useState(null); // { kind: 'done'|'noop'|'failed', ... }
  const [previewOpen, setPreviewOpen] = React.useState(false); // 结果原图全屏预览
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 实时镜像中转站：新存入的照片立即出现在网格里
  React.useEffect(() => subscribeTransfer((items) => setStationItems(normalizeStationItems(items))), []);

  // Esc 关闭原图预览
  React.useEffect(() => {
    if (!previewOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  // 网格 = 中转站 ∪ 拖入的额外照片（拖入的不在中转站也要显示出来）
  const gridItems = React.useMemo(() => {
    const map = new Map(stationItems.map((it) => [it.id, it]));
    Object.values(picked).forEach((it) => { if (!map.has(it.id)) map.set(it.id, it); });
    return Array.from(map.values());
  }, [stationItems, picked]);

  const pickedList = React.useMemo(() => Object.values(picked), [picked]);
  const pickedCount = pickedList.length;

  const togglePick = React.useCallback((item) => {
    setPicked((prev) => {
      const next = Object.assign({}, prev);
      if (next[item.id]) {
        delete next[item.id];
        // 取消的是基底 → 顺位第一个选中照片接任基底
        setBaseId((b) => (b === item.id ? (Object.keys(next)[0] || null) : b));
      } else {
        next[item.id] = item;
        setBaseId((b) => b || item.id);
      }
      return next;
    });
  }, []);

  const clearPicked = React.useCallback(() => { setPicked({}); setBaseId(null); }, []);
  const pickAll = React.useCallback(() => {
    setPicked(Object.fromEntries(gridItems.map((it) => [it.id, it])));
    setBaseId((b) => b || (gridItems[0] && gridItems[0].id) || null);
  }, [gridItems]);

  // 从中转站浮窗把单张照片拖进来 = 选中它
  const onDrop = React.useCallback((e) => {
    e.preventDefault();
    setDragHover(false);
    let payload = null;
    try {
      const raw = e.dataTransfer.getData('application/x-mamage-photo') || e.dataTransfer.getData('application/json') || '';
      if (raw) payload = JSON.parse(raw);
    } catch (err) { payload = null; }
    if (!payload) return;
    const list = normalizeStationItems(Array.isArray(payload) ? payload : [payload]);
    const badCount = (Array.isArray(payload) ? payload.length : 1) - list.length;
    if (list.length) {
      setPicked((prev) => {
        const next = Object.assign({}, prev);
        list.forEach((it) => { next[it.id] = it; });
        return next;
      });
      setBaseId((b) => b || list[0].id);
      Toast.success(`已选入 ${list.length} 张`);
    }
    if (badCount > 0) Toast.warning(`${badCount} 张缺少照片编号，无法参与合成`);
  }, []);

  const start = React.useCallback(async () => {
    if (running) return;
    if (!baseId || !picked[baseId]) { Toast.warning('先选一张要修的基底照片'); return; }
    const refs = pickedList.map((p) => p.id).filter((id) => id !== baseId);
    if (refs.length > 4) { Toast.warning('参考照片最多 4 张，请取消多余的'); return; }
    setRunning(true);
    setResult(null);
    setStep('排队中');
    try {
      const job = await runGroupRescueJob({ basePhotoId: Number(baseId), referencePhotoIds: refs.map(Number) }, setStep);
      if (job.status === 'done') {
        let thumbUrl = '';
        let fullUrl = '';
        let title = '';
        try {
          const p = await getPhotoById(job.resultPhotoId);
          thumbUrl = resolveAssetUrl((p && (p.thumbUrl || p.url)) || '') || '';
          fullUrl = resolveAssetUrl((p && (p.url || p.thumbUrl)) || '') || '';
          title = (p && p.title) || '';
        } catch (e) { /* 预览取图失败不影响结果提示 */ }
        setResult({ kind: 'done', replacedCount: job.replacedCount, photoId: job.resultPhotoId, thumbUrl, fullUrl, title });
        Toast.success(`合成完成：替换了 ${job.replacedCount} 张人脸`);
      } else if (job.status === 'done_noop') {
        setResult({ kind: 'noop', message: job.step || '基准照片里每个人已是最佳状态，无需合成' });
      } else {
        setResult({ kind: 'failed', message: job.error || '未知错误' });
      }
    } catch (e) {
      console.error('group rescue failed', e);
      setResult({ kind: 'failed', message: '任务提交或进度查询失败，请稍后重试' });
    } finally {
      setRunning(false);
      setStep('');
    }
  }, [baseId, picked, pickedList, running]);

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>合影救场</h2>
        <div style={{ marginTop: 6 }}>
          <Text type="secondary">
            选一张要修的照片作为<b>基底</b>，AI 为里面闭眼或状态不佳的人换上最佳瞬间的脸。
            替补优先来自你附加的参考照片（连拍最好，跨相册也行），没有参考时自动从人脸库找同一人的其他照片。原照片不受影响。
          </Text>
        </div>
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
          <Card
            title={(
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>挑选照片（来自中转站，点选或拖入；点"参考"标签可改设基底）</div>
                {gridItems.length ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="small" type="tertiary" onClick={pickAll}>全选</Button>
                    <Button size="small" type="tertiary" onClick={clearPicked} disabled={!pickedCount}>清空选择</Button>
                  </div>
                ) : null}
              </div>
            )}
            bordered
          >
            <div
              className={`rescue-pick-drop${dragHover ? ' is-hover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragHover(true); }}
              onDragLeave={() => setDragHover(false)}
              onDrop={onDrop}
            >
              {gridItems.length ? (
                <>
                  <div className="rescue-pick-grid">
                    {gridItems.map((it) => {
                      const isPicked = !!picked[it.id];
                      const isBase = it.id === baseId;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`rescue-pick-thumb${isPicked ? ' is-picked' : ''}`}
                          onClick={() => togglePick(it)}
                          title={isPicked ? '点击取消选择' : '点击选择'}
                        >
                          {it.thumbUrl ? <img src={it.thumbUrl} alt={`#${it.id}`} loading="lazy" /> : <span className="rescue-pick-thumb-fallback">#{it.id}</span>}
                          <span className={`rescue-pick-thumb-check${isPicked ? ' is-on' : ''}`} aria-hidden>✓</span>
                          {isPicked ? (
                            <span
                              className={`rescue-pick-role${isBase ? ' is-base' : ''}`}
                              title={isBase ? '基底照片（要修的这张）' : '点击设为基底'}
                              onClick={(e) => { e.stopPropagation(); setBaseId(it.id); }}
                            >
                              {isBase ? '基底' : '参考'}
                            </span>
                          ) : null}
                          {it.projectTitle ? <span className="rescue-pick-thumb-title">{it.projectTitle}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  {baseId && picked[baseId] ? (
                    <div style={{ marginTop: 10 }}>
                      <Text type="secondary">新照片将加入基底照片所在的相册{picked[baseId].projectTitle ? `《${picked[baseId].projectTitle}》` : ''}。</Text>
                    </div>
                  ) : null}
                </>
              ) : (
                <Text type="secondary">
                  中转站还没有可用照片。先打开相册，把要修的照片（和可选的参考照片）存入右侧中转站；回到这里点选，或直接把照片从中转站拖进这个区域。只选一张也可以 —— 会自动从人脸库找替补。
                </Text>
              )}
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button type="primary" disabled={running || pickedCount < 1 || pickedCount > 5} onClick={start}>
              {running
                ? (step || '修复中…')
                : pickedCount <= 1
                  ? '开始修复（用人脸库找替补）'
                  : `开始修复（基底 + ${pickedCount - 1} 张参考）`}
            </Button>
            {running ? <Spin size={22} tip="" /> : null}
            {!running && pickedCount > 5 ? <Text type="warning">基底加参考最多 5 张，请取消多余照片</Text> : null}
          </div>

          {result ? (
            <Card bordered title={result.kind === 'done' ? '合成完成' : result.kind === 'noop' ? '无需合成' : '合成失败'}>
              {result.kind === 'done' ? (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {result.thumbUrl ? (
                    <button
                      type="button"
                      title="点击查看原图"
                      onClick={() => setPreviewOpen(true)}
                      style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
                    >
                      <img src={result.thumbUrl} alt="合成结果" style={{ width: 220, maxWidth: '100%', borderRadius: 12, display: 'block' }} />
                    </button>
                  ) : null}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Text>替换了 {result.replacedCount} 张人脸，新照片已加入原相册。</Text>
                    {result.title ? <Text type="secondary">{result.title}</Text> : null}
                    {result.fullUrl ? (
                      <div>
                        <Button size="small" type="tertiary" onClick={() => setPreviewOpen(true)}>查看原图</Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <Text type={result.kind === 'failed' ? 'danger' : 'secondary'}>{result.message}</Text>
              )}
            </Card>
          ) : null}
        </div>
      </Content>

      {previewOpen && result && (result.fullUrl || result.thumbUrl) ? createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(10, 10, 12, 0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
          onClick={() => setPreviewOpen(false)}
        >
          <img
            src={result.fullUrl || result.thumbUrl}
            alt="合成结果原图"
            style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', display: 'block' }}
          />
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setPreviewOpen(false)}
            style={{ position: 'absolute', top: 18, right: 20, width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 20, lineHeight: '40px', padding: 0 }}
          >
            ×
          </button>
        </div>,
        document.body
      ) : null}
    </Layout>
  );
}

export default GroupRescue;
