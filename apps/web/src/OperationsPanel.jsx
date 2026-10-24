import React from 'react';
import { Button } from './ui';
import { IconInfoEdit } from './ui/icons';
import { request } from './services/request';
import './operationsPanel.css';

const KIND_NAMES = { semantic: '画面分析', face: '人物识别', 'person-visual': '人物观察',
  'public-download': '衍生图', 'image-similarity': '相似照片', 'video-postprocess': '视频处理', zip: '下载打包' };
const STATE_NAMES = { queued: '等待', running: '处理中', done: '完成', failed: '失败' };
const bytes = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(1)} GB` : '未知';
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '未测';

export default function OperationsPanel() {
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const input = React.useRef(null);
  const refresh = React.useCallback(async signal => {
    setBusy(true);
    try {
      const next = await request('/api/operations/status', { signal });
      if (signal?.aborted) return;
      setStatus(next); setError('');
    } catch (e) { if (!signal?.aborted) setError(e.message || '运行状态暂时不可用'); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  const importEvaluation = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('评测文件不能超过 1 MB'); return; }
    setImporting(true);
    try {
      const data = JSON.parse(await file.text());
      const evaluation = await request('/api/operations/evaluations', { method: 'POST', data });
      setStatus(previous => ({ ...previous, evaluation })); setError('');
    } catch (e) { setError(e.message || '评测文件无法导入'); }
    finally { setImporting(false); }
  };
  return <section className="operations-panel" aria-label="运行状态">
    <header className="operations-header"><div><h2>运行状态</h2><span>{status ? time(status.checkedAt) : '正在读取'}</span></div>
      <Button size="small" loading={busy} onClick={() => refresh()}>刷新</Button></header>
    {error ? <div className="operations-error" role="alert">{error}</div> : null}
    {status ? <>
      <div className="operations-alerts" role="status">{status.alerts.length ? status.alerts.map(alert =>
        <span key={alert.code} data-severity={alert.severity}>{alert.title}</span>) : <span data-severity="healthy">运行正常</span>}</div>
      <dl className="operations-metrics">
        <div><dt>待处理分析</dt><dd>{status.analysis.pending + status.analysis.running}</dd></div>
        <div><dt>分析失败</dt><dd>{status.analysis.failed}</dd></div>
        <div><dt>磁盘可用</dt><dd>{bytes(status.system.disk?.availableBytes)}</dd></div>
        <div><dt>进程内存</dt><dd>{bytes(status.system.rssBytes)}</dd></div>
      </dl>
      <div className="operations-band"><h3>数据备份</h3>
        <dl className="operations-details"><div><dt>最近完整备份</dt><dd>{time(status.backup?.createdAt)}</dd></div>
          <div><dt>存储校验</dt><dd>{status.backup?.verified ? '已通过' : '尚无验证记录'}</dd></div>
          <div><dt>加密体积</dt><dd>{status.backup ? bytes(status.backup.bytes) : '未知'}</dd></div></dl>
      </div>
      <div className="operations-band"><h3>后台处理</h3>
        <div className="operations-table-scroll"><table><thead><tr><th>任务</th><th>状态</th><th>数量</th></tr></thead><tbody>
          {status.tasks.map(task => <tr key={`${task.kind}:${task.status}`}><td>{KIND_NAMES[task.kind] || task.kind}</td>
            <td>{STATE_NAMES[task.status] || task.status}</td><td>{task.count}</td></tr>)}
          {!status.tasks.length ? <tr><td colSpan="3">暂无后台任务</td></tr> : null}
        </tbody></table></div>
        {status.failures.length ? <ul className="operations-failures">{status.failures.map(item => <li key={item.id}>
          <span>{item.filename || `媒体 #${item.id}`}</span><small>{item.errorCode === 'LEGACY_MODEL_NOT_FOUND' ? '历史模型不可用' : '分析失败'}</small>
          {item.projectId ? <a href={`/?projectId=${item.projectId}&focusPhotoId=${item.id}`} title="查看媒体" aria-label={`查看媒体 ${item.id}`}><IconInfoEdit /></a> : null}
        </li>)}</ul> : null}
      </div>
      <div className="operations-band"><header className="operations-subheader"><h3>检索与评测</h3>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={importEvaluation} />
        <Button size="small" loading={importing} onClick={() => input.current?.click()}>导入标注评测</Button></header>
        <dl className="operations-details"><div><dt>近七日检索</dt><dd>{status.search.count}</dd></div>
          <div><dt>检索 P95</dt><dd>{status.search.p95Ms === null ? '未测' : `${status.search.p95Ms} ms`}</dd></div>
          <div><dt>请求失败</dt><dd>{status.search.errors}</dd></div>
          <div><dt>空结果</dt><dd>{status.search.empty}</dd></div></dl>
        {status.regression ? <p className="operations-muted">算法回归 {status.regression.passed} / {status.regression.cases} · {time(status.regression.createdAt)}</p> : null}
        {status.evaluation ? <dl className="operations-details"><div><dt>前十条准确率</dt><dd>{percent(status.evaluation.summary?.precisionAt10)}</dd></div>
          <div><dt>召回率</dt><dd>{percent(status.evaluation.summary?.recallAt50)}</dd></div>
          <div><dt>硬约束违规率</dt><dd>{percent(status.evaluation.summary?.hardConstraintViolationRate)}</dd></div></dl>
          : <p className="operations-muted">尚无完整人工标注评测</p>}
      </div>
      <div className="operations-band"><h3>学校接入</h3><dl className="operations-details">
        <div><dt>内网 HTTPS</dt><dd>{status.integrations.https ? '已配置' : '待学校域名与证书'}</dd></div>
        <div><dt>钉钉登录</dt><dd>{status.integrations.dingtalk ? '已配置' : '待学校应用凭证'}</dd></div>
        <div><dt>声音转写</dt><dd>{status.integrations.transcription ? '已启用' : '暂停'}</dd></div>
      </dl></div>
    </> : null}
  </section>;
}
