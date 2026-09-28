import React from 'react';
import { Button, MotionModal } from './ui';
import { startExternalImport } from './services/externalImportService';
import './ExternalImportModal.css';

function ExternalImportModal({ visible, onClose, projectId, onStarted }) {
  const [url, setUrl] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (visible) setError('');
  }, [visible]);

  const handleStart = async (event) => {
    event?.preventDefault();
    if (!url.trim() || starting) return;
    setStarting(true);
    setError('');
    try {
      const result = await startExternalImport({ projectId, url: url.trim() });
      onStarted?.(result);
      setUrl('');
      onClose?.();
    } catch (err) {
      setError(err?.message || '创建转存任务失败');
    } finally { setStarting(false); }
  };

  return (
    <MotionModal
      visible={visible}
      onCancel={onClose}
      title="链接转存"
      className="external-import-modal"
      width="min(480px, calc(100vw - 24px))"
      footer={<>
        <Button type="tertiary" onClick={onClose} disabled={starting}>取消</Button>
        <Button type="primary" onClick={handleStart} loading={starting} disabled={!url.trim()}>开始解析并转存</Button>
      </>}
    >
      <form className="external-import-body" onSubmit={handleStart}>
        <label htmlFor="external-import-url">外部相册链接</label>
        <input
          id="external-import-url"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          disabled={starting}
          autoComplete="url"
        />
        <p className="external-import-note">请仅转存已获授权的照片。</p>
        {error ? <div className="external-import-error" role="alert">{error}</div> : null}
      </form>
    </MotionModal>
  );
}

export default ExternalImportModal;
