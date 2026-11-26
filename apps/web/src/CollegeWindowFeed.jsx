import React from 'react';
import { Button, Modal } from './ui';
import { IconChevronRight, IconDownload } from './ui/icons';
import './CollegeWindowFeed.css';

const ROOT = '/api/integrations/college-window/v1';
const PER_PAGE = 24;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

async function feedRequest(key, path, signal) {
  const response = await fetch(ROOT + path, {
    headers: { Authorization: 'Bearer ' + key },
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
  });
  if (!response.ok) throw Object.assign(new Error('Feed request failed'), { status: response.status });
  return response;
}

function label(error) {
  if (error.status === 401) return 'API Key 不正确或已失效。';
  if (error.status === 403 || error.status === 404) return '当前网络无法访问学院窗照片。';
  return '暂时无法读取照片，请重试。';
}

async function listPage(key, cursor, signal) {
  const query = new URLSearchParams({ limit: String(PER_PAGE) });
  if (cursor) query.set('after', cursor);
  const data = await (await feedRequest(key, '/photos?' + query, signal)).json();
  return { photos: data.photos.filter(photo => UUID.test(photo.id)), nextCursor: data.nextCursor };
}

function originalPath(photo) {
  const path = '/api/college-window-share/' + photo.id;
  return photo.publicImagePath === path ? path : null;
}

function PhotoTags({ tags, limit }) {
  if (!Array.isArray(tags) || !tags.length) return null;
  const displayed = limit ? tags.slice(0, limit) : tags;
  const remaining = tags.length - displayed.length;
  return <ul className="college-feed-tags" aria-label="照片标签">
    {displayed.map(tag => <li key={tag}>{tag}</li>)}
    {remaining > 0 && <li title={'还有 ' + remaining + ' 个标签'}>+{remaining}</li>}
  </ul>;
}

function FeedImage({ photo, readImage, eager = false }) {
  const box = React.useRef(null);
  const [nearby, setNearby] = React.useState(eager);
  const [image, setImage] = React.useState(null);
  const [broken, setBroken] = React.useState(false);
  const original = originalPath(photo);

  React.useEffect(() => {
    if (eager || original) return undefined;
    if (!('IntersectionObserver' in window)) { setNearby(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [eager, original]);

  React.useEffect(() => {
    if (!nearby || original) return undefined;
    const controller = new AbortController();
    let url;
    readImage(photo, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setImage(url);
    }).catch(() => { if (!controller.signal.aborted) setBroken(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [nearby, original, photo, readImage]);

  const src = original || image;
  return <span ref={box} className={'college-feed-image' + (eager ? ' is-preview' : '')}>
    {broken ? <span>图片不可用</span> : src ? <img src={src} alt={photo.albumName || '学院窗照片'}
      loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : null}
  </span>;
}

function FeedDownload({ photo, readImage }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const controllerRef = React.useRef(null);
  const original = originalPath(photo);
  React.useEffect(() => () => controllerRef.current?.abort(), []);

  async function download() {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(false);
    try {
      const blob = await readImage(photo, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = photo.id + '.jpg';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      controllerRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="college-feed-download">
    {original ? <a className="college-feed-icon" href={original + '?download=1'} target="_blank" rel="noreferrer"
      title="下载原图" aria-label="下载原图"><IconDownload /></a>
      : <button className="college-feed-icon" type="button" title={error ? '下载失败，重试' : '下载照片'}
        aria-label={error ? '下载失败，重试' : '下载照片'} disabled={busy} onClick={download}><IconDownload /></button>}
    {error && <span role="alert" className="college-feed-download-error">下载失败</span>}
  </div>;
}

export default function CollegeWindowFeed() {
  const [typed, setTyped] = React.useState('');
  const [key, setKey] = React.useState('');
  const [photos, setPhotos] = React.useState([]);
  const [next, setNext] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const listing = React.useRef(null);
  React.useEffect(() => () => listing.current?.abort(), []);

  const lock = React.useCallback((message = '') => {
    listing.current?.abort();
    listing.current = null;
    setKey('');
    setTyped('');
    setPhotos([]);
    setNext(null);
    setPreview(null);
    setBusy(false);
    setError(message);
  }, []);

  const readImage = React.useCallback(async (photo, signal) => {
    try {
      return await (await feedRequest(key, '/photos/' + photo.id + '/image', signal)).blob();
    } catch (err) {
      if (!signal.aborted && err.status === 401) lock(label(err));
      throw err;
    }
  }, [key, lock]);

  async function load(credential, cursor) {
    if (!credential || listing.current) return;
    const controller = new AbortController();
    listing.current = controller;
    setBusy(true);
    setError('');
    try {
      const page = await listPage(credential, cursor, controller.signal);
      if (controller.signal.aborted) return;
      setPhotos(items => cursor ? [...new Map([...items, ...page.photos].map(photo => [photo.id, photo])).values()] : page.photos);
      setNext(page.nextCursor);
      setTyped('');
      setKey(credential);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (key && err.status === 401) lock(label(err));
      else setError(label(err));
    } finally {
      if (listing.current === controller) {
        listing.current = null;
        setBusy(false);
      }
    }
  }

  return <main className="college-feed">
    <header className="college-feed-header">
      <div><p>MaMage</p><h1>学院窗照片</h1></div>
      {key && <Button type="secondary" onClick={() => lock()}>退出浏览</Button>}
    </header>
    {!key ? <form className="college-feed-unlock" onSubmit={event => { event.preventDefault(); load(typed.trim()); }}>
      <label htmlFor="college-feed-key">API Key</label>
      <input id="college-feed-key" type="password" value={typed} maxLength={128} autoComplete="off"
        spellCheck={false} autoCapitalize="none" onChange={event => setTyped(event.target.value)} />
      {error && <p className="college-feed-error" role="alert">{error}</p>}
      <button type="submit" data-glass-button="" className="mamage-button mamage-button-primary"
        aria-busy={busy || undefined} disabled={busy || !typed.trim()}>
        {busy && <span className="mamage-button-spinner" aria-hidden="true" />}
        <span className="mamage-button-content">进入浏览</span>
      </button>
    </form> : <>
      <div className="college-feed-section"><h2>已发布照片</h2><span>已显示 {photos.length} 张</span></div>
      {error && <p className="college-feed-error" role="alert">{error}</p>}
      {photos.length ? <div className="college-feed-grid">
        {photos.map(photo => <article className="college-feed-photo" key={photo.id}>
          <button className="college-feed-preview-button" type="button" aria-label={'预览 ' + (photo.albumName || '学院窗照片')}
            onClick={() => setPreview(photo)}><FeedImage photo={photo} readImage={readImage} /></button>
          <div className="college-feed-photo-label">
            <div><strong>{photo.albumName || '未分类照片'}</strong>
              {photo.peopleNames?.length > 0 && <p>{photo.peopleNames.join('、')}</p>}</div>
            <FeedDownload photo={photo} readImage={readImage} />
          </div>
          <PhotoTags tags={photo.tags} limit={3} />
        </article>)}
      </div> : <p className="college-feed-empty" role="status">暂无已发布照片</p>}
      {next && <div className="college-feed-more"><Button type="secondary" icon={<IconChevronRight />}
        loading={busy} disabled={busy} onClick={() => load(key, next)}>加载更多</Button></div>}
    </>}
    {preview && <Modal visible width={880} className="college-feed-preview" title={preview.albumName || '学院窗照片'} onCancel={() => setPreview(null)}
      footer={<FeedDownload photo={preview} readImage={readImage} />}>
      <FeedImage key={preview.id} photo={preview} readImage={readImage} eager />
      <PhotoTags tags={preview.tags} />
      {preview.peopleNames?.length > 0 && <p>{preview.peopleNames.join('、')}</p>}
      {preview.description && <p className="college-feed-description">{preview.description}</p>}
    </Modal>}
  </main>;
}
