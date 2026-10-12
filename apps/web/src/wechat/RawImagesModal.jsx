import React from 'react';
import { Modal } from '../ui';

// 「按 svg 列出可替换的图」：整文复现的一个块里，SVG 特效常叠着多张图（Color Walk 彩色层、轮播幻灯…），
// 重叠度高、鼠标点不准。这里把块内所有照片按所属 svg 分组、缩略图铺出来，逐张「换/编辑」，不再靠点画布。

const KIND_LABEL = { img: '图片', image: '矢量图', bg: '背景图' };
const FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="64"><rect width="90" height="64" fill="#f0f2f5"/><text x="45" y="37" font-size="10" fill="#aab" text-anchor="middle">无预览</text></svg>'
);

function Thumb({ photo, onReplace, onEdit }) {
  return (
    <div style={{ width: 96, border: '1px solid #e9edf3', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'relative', width: '100%', height: 66, background: '#f4f6fa' }}>
        <img
          src={photo.url || FALLBACK}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.src = FALLBACK; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '1px 5px' }}>
          {KIND_LABEL[photo.kind] || '图'}
        </span>
      </div>
      <div style={{ display: 'flex' }}>
        <button type="button" onClick={onReplace} style={thumbBtn} title="替换这张图（从中转站/相册）">换</button>
        <button type="button" onClick={onEdit} style={{ ...thumbBtn, borderLeft: '1px solid #eef1f6' }} title="裁切/旋转/滤镜">编辑</button>
      </div>
    </div>
  );
}

const thumbBtn = {
  flex: 1, padding: '5px 0', fontSize: 12, border: 0, background: '#fafbfd',
  color: '#1a2030', cursor: 'pointer',
};

export default function RawImagesModal({ visible, groups = [], isMobile, onReplace = () => {}, onEdit = () => {}, onClose = () => {} }) {
  const total = groups.reduce((n, g) => n + g.photos.length, 0);
  return (
    <Modal title={`本块图片（${total} 张）`} visible={visible} onCancel={onClose} footer={null} width={isMobile ? 'calc(100vw - 16px)' : 560} zIndex={19000}>
      {total === 0 ? (
        <div style={{ color: '#8a94a6', padding: '20px 0', textAlign: 'center' }}>这个块里没有可替换的图片。</div>
      ) : (
        <div style={{ maxHeight: '64vh', overflowY: 'auto', paddingRight: 4 }}>
          <div style={{ fontSize: 12, color: '#8a94a6', marginBottom: 12 }}>
            按 SVG 分组列出块内所有图片。叠层图（如 Color Walk 彩色层）点画布点不准，直接在这里逐张换/编辑。
          </div>
          {groups.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{g.label} <span style={{ color: '#9aa3b2', fontWeight: 400 }}>· {g.photos.length} 张</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.photos.map((p) => (
                  <Thumb key={p.index} photo={p} onReplace={() => onReplace(p.index)} onEdit={() => onEdit(p.index)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
