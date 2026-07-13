import React from 'react';
import { Modal, Button } from '../ui';

// 公众号推文「真机效果」预览：左侧手机框里按公众号文章页的排版呈现 标题/公众号名·作者·时间/正文，
// 右侧编辑大图(2.35:1)、小图(1:1)封面并实时预览「单图文大卡」「多图文小卡」两种分享/列表卡片。
// 封面仅用于预览与下载（公众号封面在后台单独设置，不进正文），故不写入复制的正文 HTML。

const WX_BLUE = '#576b95';
const bigPlaceholder = '设置大图封面（2.35:1）';
const smallPlaceholder = '小图（1:1）';

function CoverBox({ url, ratio, label, onPick, onEdit }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#8a94a6', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          width: ratio === 1 ? 96 : 260, aspectRatio: String(ratio), background: url ? `#000 center/cover no-repeat url(${url})` : '#f2f4f8',
          border: '1px solid #e4e8ef', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#aab2c0', fontSize: 12, overflow: 'hidden', boxSizing: 'border-box',
        }}
      >
        {url ? null : (ratio === 1 ? smallPlaceholder : bigPlaceholder)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={onPick} style={btnStyle}>换图</button>
        {url ? <button type="button" onClick={onEdit} style={btnStyle}>裁剪</button> : null}
      </div>
    </div>
  );
}

const btnStyle = {
  padding: '4px 10px', fontSize: 12, border: '1px solid #e4e8ef', borderRadius: 6,
  background: '#fafbfd', color: '#1a2030', cursor: 'pointer',
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
  border: '1px solid #e4e8ef', borderRadius: 6, color: '#1a2030', marginBottom: 8,
};

export default function ArticlePreviewModal({
  visible, onClose, isMobile,
  title = '', wxName = '', author = '', publishTime = '', bodyHtml = '',
  coverBig = '', coverSmall = '',
  onChangeMeta = () => {}, onPickCover = () => {}, onEditCover = () => {},
}) {
  // 小图未单独设置时，卡片回退用大图（object-fit 取中段），与公众号"未设小图取大图"一致
  const smallForCard = coverSmall || coverBig;
  const titleText = title || '（未填标题）';

  return (
    <Modal title="推文预览" visible={visible} onCancel={onClose} footer={null} width={isMobile ? 'calc(100vw - 16px)' : 900}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 左：手机框内的公众号文章页 */}
        <div style={{ flex: '0 0 auto', width: 360, maxWidth: '100%' }}>
          <div style={{ border: '1px solid #e4e8ef', borderRadius: 14, overflow: 'hidden', background: '#fff', boxShadow: '0 6px 20px rgba(20,30,50,.1)' }}>
            <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 16px 24px' }}>
                <h1 style={{ margin: '0 0 14px', fontSize: 22, lineHeight: 1.4, fontWeight: 700, color: '#1a1a1a', wordBreak: 'break-word' }}>{titleText}</h1>
                <div style={{ fontSize: 15, color: WX_BLUE, marginBottom: 6 }}>{wxName || '公众号名称'}</div>
                <div style={{ fontSize: 15, color: '#9a9a9a', marginBottom: 2 }}>
                  {(author || '作者')}<span style={{ margin: '0 8px' }}>·</span>{publishTime || '刚刚'}
                </div>
                <div style={{ height: 14 }} />
                {/* 正文：与复制/手机预览同源的 docToHtml，原样内联样式 */}
                <div
                  style={{ fontSize: 17, color: '#333', lineHeight: 1.75, wordBreak: 'break-word' }}
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: bodyHtml || '<p style="color:#bbb">正文为空，先在画布里加内容</p>' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右：封面编辑 + 卡片预览 + 元信息 */}
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>封面</div>
          <CoverBox url={coverBig} ratio={2.35} label="大图封面 2.35:1（单图文/头条）" onPick={() => onPickCover('big')} onEdit={() => onEditCover('big')} />
          <CoverBox url={coverSmall} ratio={1} label="小图封面 1:1（多图文次条）" onPick={() => onPickCover('small')} onEdit={() => onEditCover('small')} />

          <div style={{ fontWeight: 700, fontSize: 14, margin: '6px 0 10px' }}>信息</div>
          <input style={inputStyle} value={wxName} placeholder="公众号名称" onChange={(e) => onChangeMeta('wxName', e.target.value)} />
          <input style={inputStyle} value={author} placeholder="作者" onChange={(e) => onChangeMeta('author', e.target.value)} />
          <input style={inputStyle} value={publishTime} placeholder="时间（如 2026-07-13 18:00）" onChange={(e) => onChangeMeta('publishTime', e.target.value)} />

          <div style={{ fontWeight: 700, fontSize: 14, margin: '8px 0 10px' }}>分享 / 列表卡片</div>
          {/* 单图文大卡：大封面 + 标题压底渐变 */}
          <div style={{ position: 'relative', width: 260, maxWidth: '100%', aspectRatio: '2.35', borderRadius: 8, overflow: 'hidden', background: coverBig ? `#000 center/cover no-repeat url(${coverBig})` : '#c9cfda', marginBottom: 12 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 12px 10px', background: 'linear-gradient(transparent, rgba(0,0,0,.66))' }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, lineHeight: 1.35, textShadow: '0 1px 2px rgba(0,0,0,.4)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{titleText}</div>
            </div>
          </div>
          {/* 多图文小卡：标题在左 + 方图在右 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 260, maxWidth: '100%', padding: 10, border: '1px solid #e9edf3', borderRadius: 8, boxSizing: 'border-box' }}>
            <div style={{ flex: 1, fontSize: 14, color: '#222', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{titleText}</div>
            <div style={{ flex: '0 0 auto', width: 60, height: 60, borderRadius: 4, background: smallForCard ? `#eee center/cover no-repeat url(${smallForCard})` : '#dfe3ea' }} />
          </div>

          <div style={{ marginTop: 14 }}>
            <Button size="small" type="tertiary" onClick={onClose}>关闭</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
