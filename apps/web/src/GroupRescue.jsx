import React from 'react';
import { Layout, Card, Button, Toast, Spin, Typography } from './ui';
import { getAll as getTransferAll } from './services/transferStore';
import { resolveAssetUrl } from './services/request';
import { runGroupRescueJob, getPhotoById } from './services/photoService';

const { Header, Content } = Layout;
const { Text } = Typography;

// 合影救场（手动模式）：与 AI 写稿助手并列的功能页。
// 查看器里的语义入口负责自动圈连拍组；这里是识别不准/想自己挑照片时的兜底：
// 先在相册里把同一组连拍存入中转站，回到本页填充后发起合成。
function GroupRescue() {
  const [photos, setPhotos] = React.useState([]); // { id, thumbUrl, projectTitle }
  const [running, setRunning] = React.useState(false);
  const [step, setStep] = React.useState('');
  const [result, setResult] = React.useState(null); // { kind: 'done'|'noop'|'failed', ... }
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const fillFromTransfer = React.useCallback(() => {
    try {
      const items = getTransferAll() || [];
      if (!items.length) { Toast.info('中转站为空。先去相册把连拍照片"存入"中转站'); return; }
      const mapped = [];
      let skipped = 0;
      items.forEach((p) => {
        const idNum = Number(p.id);
        if (!Number.isFinite(idNum) || idNum <= 0) { skipped += 1; return; }
        mapped.push({
          id: String(idNum),
          thumbUrl: resolveAssetUrl(p.thumbSrc || p.url) || '',
          projectTitle: p.projectTitle || '',
        });
      });
      if (!mapped.length) { Toast.warning('中转站里的照片缺少编号信息，无法用于合成'); return; }
      setPhotos(mapped);
      setResult(null);
      const msg = `已填充 ${mapped.length} 张` + (skipped ? `，${skipped} 张缺少编号已跳过` : '');
      Toast.success(msg);
    } catch (e) {
      console.error('fill from transfer failed', e);
      Toast.error('从中转站读取失败');
    }
  }, []);

  const removePhoto = React.useCallback((id) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const projectTitles = React.useMemo(() => {
    const set = new Set(photos.map((p) => p.projectTitle).filter(Boolean));
    return Array.from(set);
  }, [photos]);

  const start = React.useCallback(async () => {
    if (running) return;
    if (photos.length < 2) { Toast.warning('至少选择同一组连拍中的 2 张照片'); return; }
    if (photos.length > 5) { Toast.warning('最多支持 5 张，请移除多余的照片'); return; }
    setRunning(true);
    setResult(null);
    setStep('排队中');
    try {
      const job = await runGroupRescueJob(photos.map((p) => Number(p.id)), setStep);
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
  }, [photos, running]);

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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>候选连拍（来自中转站）</div>
                <Button size="small" onClick={fillFromTransfer}>从中转站填充</Button>
              </div>
            )}
            bordered
          >
            {photos.length ? (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {photos.map((p) => (
                    <div key={p.id} style={{ position: 'relative', width: 132 }}>
                      <img
                        src={p.thumbUrl}
                        alt={`#${p.id}`}
                        style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                      <button
                        type="button"
                        title="移除"
                        onClick={() => removePhoto(p.id)}
                        style={{
                          position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                          borderRadius: '50%', border: 'none', cursor: 'pointer',
                          background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, lineHeight: '22px', padding: 0,
                        }}
                      >
                        ×
                      </button>
                      {p.projectTitle ? (
                        <div style={{ fontSize: 11, color: '#888', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.projectTitle}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {projectTitles.length > 1 ? (
                  <div style={{ marginTop: 10 }}>
                    <Text type="warning">这些照片好像来自不同相册（{projectTitles.join(' / ')}），只有同一相册的连拍才能合成。</Text>
                  </div>
                ) : null}
              </>
            ) : (
              <Text type="secondary">
                还没有候选照片。先打开相册，选中同一组连拍（2-5 张，人物位置基本不变的抓拍）存入右侧中转站，再回到这里点"从中转站填充"。
              </Text>
            )}
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button type="primary" disabled={running || photos.length < 2 || photos.length > 5} onClick={start}>
              {running ? (step || '合成中…') : `开始合成（${photos.length} 张）`}
            </Button>
            {running ? <Spin size={22} tip="" /> : null}
            {!running && photos.length > 5 ? <Text type="warning">最多 5 张，请移除多余照片</Text> : null}
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
