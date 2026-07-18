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

const FIND_ME_MAX_SIDE = 1600;
// 拍照找我只需要用于人脸检索，不应把原始相机大图带上网络。
// 使用十进制 1,000,000 bytes，确保浏览器和移动端都能稳定显示为 1MB 以内。
const FIND_ME_TARGET_BYTES = 1_000_000;

function loadFindMeImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadFindMeImageElement(file));
  }
  return loadFindMeImageElement(file);
}

function loadFindMeImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('FIND_ME_IMAGE_DECODE_FAILED'));
    };
    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('FIND_ME_IMAGE_ENCODE_FAILED'));
    }, 'image/jpeg', quality);
  });
}

async function compressFindMeImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  // Small files do not need another lossy pass; large originals are always decoded
  // and reduced before they enter the face-matching request.
  if (file.size <= FIND_ME_TARGET_BYTES) return file;

  const image = await loadFindMeImage(file);
  const sourceWidth = Number(image.width || image.naturalWidth || 0);
  const sourceHeight = Number(image.height || image.naturalHeight || 0);
  if (!sourceWidth || !sourceHeight) throw new Error('FIND_ME_IMAGE_DIMENSIONS_MISSING');

  let best = null;
  // 先尽量保留 1600px 的识别细节；复杂照片再逐级缩小，确保不会把
  // 1MB 上限交给服务端碰运气。质量序列从高到低，命中后立即停止。
  const maxSides = [FIND_ME_MAX_SIDE, 1400, 1200, 1000, 800, 640];
  const qualities = [0.92, 0.86, 0.80, 0.74, 0.68, 0.62, 0.56, 0.50, 0.44, 0.38, 0.32, 0.26, 0.20, 0.15];
  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('FIND_ME_CANVAS_UNAVAILABLE');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= FIND_ME_TARGET_BYTES) break;
    }
    if (best && best.size <= FIND_ME_TARGET_BYTES) break;
  }
  if (typeof image.close === 'function') image.close();

  // 640px JPEG 通常足以保证人脸检索；如果极端浏览器仍无法压到上限，
  // 回退原图让服务端返回明确错误，也不上传一个“看似压缩但仍超限”的文件。
  if (!best || best.size > FIND_ME_TARGET_BYTES || best.size >= file.size) return file;
  try {
    return new File([best], 'find-me.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    return best;
  }
}

export default function FindMeModal({ visible, mode, projectId, shareCode, onClose, onPickPhoto }) {
  const [file, setFile] = React.useState(null);
  const [preview, setPreview] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [compressing, setCompressing] = React.useState(false);
  const [compressionNotice, setCompressionNotice] = React.useState('');
  const [result, setResult] = React.useState(null); // {matches, scannedFaces}
  const [errText, setErrText] = React.useState('');
  const cameraRef = React.useRef(null);
  const pickerRef = React.useRef(null);
  const compressionSeqRef = React.useRef(0);

  const reset = React.useCallback(() => {
    compressionSeqRef.current += 1;
    setFile(null); setResult(null); setErrText(''); setBusy(false); setCompressing(false); setCompressionNotice('');
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return ''; });
  }, []);

  React.useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const onFile = async (f) => {
    if (!f) return;
    const sequence = compressionSeqRef.current + 1;
    compressionSeqRef.current = sequence;
    setResult(null); setErrText('');
    setFile(null);
    setCompressing(true);
    setCompressionNotice('正在压缩照片…');
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
    try {
      const uploadFile = await compressFindMeImage(f);
      if (compressionSeqRef.current !== sequence) return;
      setFile(uploadFile);
      setCompressionNotice(uploadFile === f ? '' : `已压缩至 ${(uploadFile.size / 1024 / 1024).toFixed(1)}MB`);
      if (uploadFile !== f) {
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(uploadFile);
        });
      }
    } catch (e) {
      if (compressionSeqRef.current !== sequence) return;
      // HEIC and a few browser-specific formats may not be canvas-decodable;
      // retain the server-side fallback instead of blocking the user completely.
      setFile(f);
      setCompressionNotice('浏览器无法压缩，将尝试原图上传');
    } finally {
      if (compressionSeqRef.current === sequence) setCompressing(false);
    }
  };

  const submit = async () => {
    if (!file || busy || compressing) return;
    setBusy(true); setErrText(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('photo', file, file.name || 'find-me.jpg');
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
            <Button type="primary" loading={busy || compressing} disabled={!file || busy || compressing} onClick={submit}>
              {compressing ? '压缩中…' : (busy ? '识别匹配中…' : '开始找我')}
            </Button>
          </div>
          {/* capture=user 在手机上直接唤起前置摄像头；桌面浏览器会退化为文件选择 */}
          <input ref={cameraRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          <input ref={pickerRef} type="file" accept="image/*,.heic,.heif" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          {compressionNotice ? <span style={{ fontSize: 12, color: compressing ? '#2563eb' : '#687386' }}>{compressionNotice}</span> : null}
          <span style={{ fontSize: 12, color: '#9098a2' }}>照片仅用于本次匹配，不会被保存。</span>
        </div>

        {errText ? <div className="findme-error">{errText}</div> : null}

        {result && !errText ? (
          matches.length ? (
            <>
              <div className="findme-result-head">
                {result.person
                  ? (result.person.name
                    ? `已在人物档案中找到你，你可能是「${result.person.name}」。为你找到 ${matches.length} 张照片：`
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
