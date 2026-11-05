import React from 'react';
import { isObservedGallery, observedGalleryHtml } from '../../src/wechat/observedGallery';
import { sanitizeRawHtml, unproxyWeChatImages } from '../../src/wechat/docModel';

// QA-only：给源图 URL 加一次性查询参数，击穿浏览器/上游 CDN 里可能残留的防盗链占位图缓存。
// 真正让 mmbiz 原图能加载的是文档级 <meta name="referrer" content="no-referrer">
// （生产 public/index.html；QA 见 fixtures/news-gallery.jsx），不是这个参数。
const previewSession = Date.now().toString(36);
function previewImageUrl(src) {
  const url = new URL(src);
  url.searchParams.set('mamage_preview', previewSession);
  return url.href;
}

function sourcePreviewHtml(html) {
  const doc = new DOMParser().parseFromString(unproxyWeChatImages(html), 'text/html');
  doc.querySelectorAll('img[src]').forEach(img => img.setAttribute('src', previewImageUrl(img.getAttribute('src'))));
  doc.querySelectorAll('[style]').forEach(element => {
    const background = element.style.backgroundImage;
    if (background) element.style.backgroundImage = background.replace(/url\(["']?(.*?)["']?\)/g, (_, src) => `url("${previewImageUrl(src)}")`);
  });
  return sanitizeRawHtml(doc.body.innerHTML);
}

export default function GalleryStylePreview() {
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [replaced, setReplaced] = React.useState(false);
  const images = [1681, 1685, 1687, 1693, 1682, 1683, 1684, 1686];
  const styles = (window.__newsObservedLibrary?.blocks || []).filter(isObservedGallery);
  React.useEffect(() => {
    let cancelled = false;
    // Warm the browser cache before the source DOM's background styles are parsed.
    // Detached HTML/SVG documents can otherwise fetch with a different referrer policy.
    Promise.all([...new Set(styles.flatMap(style => style.sourceImages))].map(src => new Promise(resolve => {
      const image = new Image(); const timeout = setTimeout(() => resolve(false), 15000);
      image.referrerPolicy = 'no-referrer';
      image.onload = () => { clearTimeout(timeout); resolve(image.naturalWidth > 140); };
      image.onerror = () => { clearTimeout(timeout); resolve(false); };
      image.src = previewImageUrl(src);
    }))).then(results => {
      if (!cancelled) { setLoadError(results.some(value => !value)); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, []);
  return <div className="gallery-design-preview">
    <style>{`
      .gallery-design-preview { background: #eceff1; min-height: 100vh; color: #222; }
      .gallery-design-preview header { display: flex; flex-wrap:wrap; gap:12px; justify-content: space-between; align-items: center; padding: 20px 28px; background: #fff; border-bottom: 1px solid #dce1e4; }
      .gallery-design-preview h1 { margin: 0; font-size: 20px; }
      .gallery-design-preview header a { color: #475765; font-size: 14px; }
      .gallery-design-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding: 20px 0; align-items: start; }
      .gallery-design-grid h2 { margin: 0 0 16px; font-size: 15px; font-weight: 600; }
      .gallery-design-paper { background: #fff; padding: 18px; }
      .gallery-source-section { padding:24px; border-bottom:1px solid #d5dce1; max-width:1120px; margin:auto; }
      .gallery-source-section > h2 { margin:0 0 8px; font-size:17px; }
      .gallery-source-section > a { color:#425f7a; font-size:13px; }
      .gallery-design-preview button { border:1px solid #c9d0d5; border-radius:6px; padding:8px 12px; color:#222; background:white; font-size:13px; }
      .gallery-design-paper { min-width:0; overflow:hidden; }
      @media (max-width: 600px) { .gallery-design-grid { grid-template-columns: minmax(0, 1fr); padding: 18px; } .gallery-design-preview header { padding: 18px; } }
    `}</style>
    <header><h1>原文样式对照</h1><button onClick={() => setReplaced(!replaced)}>{replaced ? '恢复原文配图' : '替换为测试配图'}</button><a href="/?channel=wechat">返回编辑台</a></header>
    {!loaded && <p role="status">正在加载原文配图...</p>}
    {loadError && <p role="alert">部分原文配图未能加载，请刷新重试。</p>}
    {loaded && styles.map(style => <section className="gallery-source-section" key={style.id} data-source-style={style.id}>
      <h2>{style.name} · {style.slots} 图</h2>
      <a href={style.sourceUrl} target="_blank" rel="noreferrer">{style.sourceAccount} · {style.sourceTitle}</a>
      <div className="gallery-design-grid">
        <div><h2>原文提取</h2><div className="gallery-design-paper source-original"
          dangerouslySetInnerHTML={{ __html: sourcePreviewHtml(style.sourceHtml) }} /></div>
        <div><h2>可换图样式</h2><div className="gallery-design-paper source-replica"
          dangerouslySetInnerHTML={{ __html: sanitizeRawHtml(observedGalleryHtml(style.sourceImages.map((src, index) => ({
            src: replaced ? `/__news-qa/images/${images[index % images.length]}.jpg` : previewImageUrl(src),
          })), style)) }} /></div>
      </div>
    </section>)}
  </div>;
}
