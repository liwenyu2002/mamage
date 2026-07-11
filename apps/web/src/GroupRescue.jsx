import React from 'react';
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
  const [dragHover, setDragHover] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [step, setStep] = React.useState('');
  const [result, setResult] = React.useState(null); // { kind: 'done'|'noop'|'failed', ... }
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 实时镜像中转站：新存入的照片立即出现在网格里
  React.useEffect(() => subscribeTransfer((items) => setStationItems(normalizeStationItems(items))), []);

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
      if (next[item.id]) delete next[item.id]; else next[item.id] = item;
      return next;
    });
  }, []);

  const clearPicked = React.useCallback(() => setPicked({}), []);
  const pickAll = React.useCallback(() => {
    setPicked(Object.fromEntries(gridItems.map((it) => [it.id, it])));
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
      Toast.success(`已选入 ${list.length} 张`);
    }
    if (badCount > 0) Toast.warning(`${badCount} 张缺少照片编号，无法参与合成`);
  }, []);

  const projectTitles = React.useMemo(() => {
    const set = new Set(pickedList.map((p) => p.projectTitle).filter(Boolean));
    return Array.from(set);
  }, [pickedList]);

  const start = React.useCallback(async () => {
    if (running) return;
    if (pickedCount < 2) { Toast.warning('至少选择同一组连拍中的 2 张照片'); return; }
    if (pickedCount > 5) { Toast.warning('最多支持 5 张，请取消多余的照片'); return; }
    setRunning(true);
    setResult(null);
    setStep('排队中');
    try {
      const job = await runGroupRescueJob(pickedList.map((p) => Number(p.id)), setStep);
      if (job.status === 'done') {
        let thumbUrl = '';
        let title = '';
        try {
          const p = await getPhotoById(job.resultPhotoId);
          thumbUrl = resolveAssetUrl((p && (p.thumbUrl || p.url)) || '') || '';
          title = (p && p.title) || '';
        } catch (e) { /* 预览取图失败不影响结果提示 */ }
        setResult({ kind: 'done', replacedCount: job.replacedCount, photoId: job.resultPhotoId, thumbUrl, title });
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
  }, [pickedCount, pickedList, running]);

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>合影救场</h2>
        <div style={{ marginTop: 6 }}>
          <Text type="secondary">
            从同一组连拍里为每个人挑出睁眼、表情最自然的瞬间，合成一张全员状态最好的新合影（原照片不受影响）。
          </Text>
        </div>
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
          <Card
            title={(
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>挑选连拍（来自中转站，点选或拖入）</div>
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
                          {it.projectTitle ? <span className="rescue-pick-thumb-title">{it.projectTitle}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  {projectTitles.length > 1 ? (
                    <div style={{ marginTop: 10 }}>
                      <Text type="warning">选中的照片好像来自不同相册（{projectTitles.join(' / ')}），只有同一相册的连拍才能合成。</Text>
                    </div>
                  ) : null}
                </>
              ) : (
                <Text type="secondary">
                  中转站还没有可用照片。先打开相册，选中同一组连拍（2-5 张，人物位置基本不变的抓拍）存入右侧中转站；回到这里点选，或直接把照片从中转站拖进这个区域。
                </Text>
              )}
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button type="primary" disabled={running || pickedCount < 2 || pickedCount > 5} onClick={start}>
              {running ? (step || '合成中…') : `开始合成（已选 ${pickedCount} 张）`}
            </Button>
            {running ? <Spin size={22} tip="" /> : null}
            {!running && pickedCount > 5 ? <Text type="warning">最多 5 张，请取消多余照片</Text> : null}
          </div>

          {result ? (
            <Card bordered title={result.kind === 'done' ? '合成完成' : result.kind === 'noop' ? '无需合成' : '合成失败'}>
              {result.kind === 'done' ? (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {result.thumbUrl ? (
                    <img src={result.thumbUrl} alt="合成结果" style={{ width: 220, maxWidth: '100%', borderRadius: 12, display: 'block' }} />
                  ) : null}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Text>替换了 {result.replacedCount} 张人脸，新照片已加入原相册。</Text>
                    {result.title ? <Text type="secondary">{result.title}</Text> : null}
                  </div>
                </div>
              ) : (
                <Text type={result.kind === 'failed' ? 'danger' : 'secondary'}>{result.message}</Text>
              )}
            </Card>
          ) : null}
        </div>
      </Content>
    </Layout>
  );
}

export default GroupRescue;
