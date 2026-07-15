// src/FindMeModal.jsx
// 拍照找我（相册页 / 公开分享页共用）：拍摄或上传单人照 → 服务端人脸匹配 → 命中照片网格。
// mode='album' 需 projectId(带登录态)；mode='share' 需 shareCode(公开,无需登录)。
// 隐私：照片仅用于本次匹配，服务端用完即删，不保存。
import React from 'react';
import { Modal, Button } from './ui';
import { getToken } from './services/authService';
import { rewriteMediaUrlsDeep } from './services/request';

const ERR_TEXT = {
  NO_FACE: '未检测到人脸，请换一张清晰的正脸照片',
  MULTIPLE_FACES: null, // 动态拼 count
  NO_EMBEDDING: '人脸太模糊，请换一张更清晰的照片',
  IMAGE_DECODE_FAILED: '图片无法解析，请换一张（支持 JPG/PNG/HEIC）',
  FILE_TOO_LARGE: '图片超过 20MB，请压缩后再试',
  RATE_LIMITED: '操作太频繁，请稍等一分钟再试',
  FACE_SERVICE_UNAVAILABLE: '识别服务暂时不可用，请稍后再试',
  EMPTY_SCOPE: '这里还没有可匹配的照片',
};

export default function FindMeModal({ visible, mode, projectId, shareCode, onClose, onPickPhoto }) {
  const [file, setFile] = React.useState(null);
  const [preview, setPreview] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null); // {matches, scannedFaces}
  const [errText, setErrText] = React.useState('');
  const cameraRef = React.useRef(null);
  const pickerRef = React.useRef(null);

  const reset = React.useCallback(() => {
    setFile(null); setResult(null); setErrText(''); setBusy(false);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return ''; });
  }, []);

  React.useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const onFile = (f) => {
    if (!f) return;
    setResult(null); setErrText('');
    setFile(f);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true); setErrText(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const headers = {};
      let url;
      if (mode === 'share') {
        fd.append('shareCode', shareCode || '');
        url = '/api/faces/find-me/share';
      } else {
        fd.append('projectId', String(projectId || ''));
        url = '/api/faces/find-me';
        const token = typeof getToken === 'function' ? getToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const resp = await fetch(url, { method: 'POST', headers, body: fd, credentials: 'same-origin' });
      // 裸 fetch 不经 request() 封装 → 手动过内网媒体地址改写（内网入口打开时缩略图/原图走内网）
      const data = rewriteMediaUrlsDeep(await resp.json().catch(() => ({})));
      if (!resp.ok) {
        if (data.error === 'MULTIPLE_FACES') setErrText(`检测到 ${data.count || '多'} 张人脸，请上传或拍摄单人照`);
        else setErrText(ERR_TEXT[data.error] || `匹配失败（${data.error || resp.status}），请重试`);
        return;
      }
      setResult(data);
      if (!data.matches || !data.matches.length) setErrText('');
    } catch (e) {
      setErrText('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  const matches = (result && result.matches) || [];

  return (
    <Modal
      visible={visible}
      title="📸 拍照找我"
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div className="findme-body">
        {/* 选图区 */}
        <div className="findme-pick">
          <div className="findme-preview" onClick={() => pickerRef.current && pickerRef.current.click()}>
            {preview ? (
              <img src={preview} alt="待匹配照片" />
            ) : (
              <div className="findme-preview-empty">
                <span className="findme-preview-icon">🙂</span>
                <span>上传或拍摄一张<b>单人</b>照片</span>
              </div>
            )}
          </div>
          <div className="findme-pick-actions">
            <Button onClick={() => cameraRef.current && cameraRef.current.click()}>📷 拍照</Button>
            <Button onClick={() => pickerRef.current && pickerRef.current.click()}>🖼 从相册选择</Button>
            <Button type="primary" loading={busy} disabled={!file || busy} onClick={submit}>
              {busy ? '识别匹配中…' : '开始找我'}
            </Button>
          </div>
          {/* capture=user 在手机上直接唤起前置摄像头；桌面浏览器会退化为文件选择 */}
          <input ref={cameraRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          <input ref={pickerRef} type="file" accept="image/*,.heic,.heif" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          <span style={{ fontSize: 12, color: '#9098a2' }}>照片仅用于本次匹配，不会被保存。</span>
        </div>

        {errText ? <div className="findme-error">{errText}</div> : null}

        {result && !errText ? (
          matches.length ? (
            <>
              <div className="findme-result-head">
                {result.person
                  ? (result.person.name
                    ? `已识别为「${result.person.name}」，找到 ${matches.length} 张照片（含人物档案累积成果）：`
                    : `已按人物档案识别到你，找到 ${matches.length} 张照片：`)
                  : `找到 ${matches.length} 张可能有你的照片（按相似度排序）：`}
              </div>
              <div className="findme-grid">
                {matches.map((m) => (
                  <button
                    key={m.photoId}
                    type="button"
                    className="findme-cell"
                    title={m.title || `照片 #${m.photoId}`}
                    onClick={() => onPickPhoto && onPickPhoto(m, matches)}
                  >
                    <img src={m.thumbUrl || m.url} alt={m.title || `photo-${m.photoId}`} loading="lazy" />
                    <span className="findme-sim">{Math.round(m.sim * 100)}%</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="findme-empty">没有找到与这张脸相似的照片（共比对 {result.scannedFaces} 张脸）。可以换一张更清晰的正脸照再试。</div>
          )
        ) : null}
      </div>
    </Modal>
  );
}
