import React from 'react';
import { Crop, ImagePlus, Moon, PanelRightClose, PanelRightOpen, Sun } from 'lucide-react';
import { Button, Modal, SegmentedControl } from '../ui';
import './articlePreview.css';

const modes = [
  { value: 'day', label: <><Sun size={14} aria-hidden="true" />日间</> },
  { value: 'night', label: <><Moon size={14} aria-hidden="true" />夜间</> },
];

function CoverBox({ url, square = false, onPick, onEdit }) {
  const label = square ? '小图封面' : '大图封面';
  const pickLabel = `${url ? '更换' : '设置'}${label}`;
  const cropLabel = `裁剪${label}`;
  return <div className={`wx-preview-cover${square ? ' is-square' : ''}`}>
    <div className="wx-preview-cover-label"><span>{label}</span><span>{square ? '1:1' : '2.35:1'}</span></div>
    <div className="wx-preview-cover-media">
      <button type="button" className="wx-preview-cover-pick" title={pickLabel} aria-label={pickLabel} onClick={onPick}>
        {url ? <img src={url} alt="" /> : <ImagePlus size={19} aria-hidden="true" />}
      </button>
      {url ? <button type="button" className="wx-preview-cover-crop" title={cropLabel} aria-label={cropLabel} onClick={onEdit}>
        <Crop size={15} aria-hidden="true" />
      </button> : null}
    </div>
  </div>;
}

const metaFields = [
  ['wxName', '公众号名称'],
  ['author', '作者'],
  ['publishTime', '发布时间', '如 2026-07-13 18:00'],
];

export default function ArticlePreviewModal({
  visible, onClose, isMobile,
  title = '', wxName = '', author = '', publishTime = '', bodyHtml = '',
  coverBig = '', coverSmall = '',
  onChangeMeta = () => {}, onPickCover = () => {}, onEditCover = () => {},
}) {
  const panelId = React.useId();
  const [mode, setMode] = React.useState('day');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  React.useEffect(() => { if (!visible) setDetailsOpen(false); }, [visible]);
  const titleText = title || '（未填标题）';
  const meta = { wxName, author, publishTime };
  // When no square cover is selected, WeChat takes the center of the wide cover.
  const smallForCard = coverSmall || coverBig;
  const detailsIcon = detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />;

  return <Modal title="推文预览" visible={visible} onCancel={onClose} footer={null}
    className={`wx-preview-dialog${isMobile ? '' : ' is-desktop'}${detailsOpen ? ' is-details-open' : ''}`}
    width={isMobile ? 'calc(100vw - 16px)' : undefined}
    headerActions={isMobile ? null : <Button size="small" theme="borderless" className="wx-preview-details-toggle"
      icon={detailsIcon} aria-expanded={detailsOpen} aria-controls={panelId}
      title={detailsOpen ? '收起推文信息' : '展开推文信息'} onClick={() => setDetailsOpen(open => !open)}>
      推文信息
    </Button>}>
    <div className="wx-preview-layout">
      <div className="wx-preview-phone">
        <SegmentedControl label="预览配色" className="wx-preview-modes" options={modes} value={mode} onChange={setMode} />
        <div className="wx-preview-screen" data-mode={mode} role="region" aria-label="手机文章预览" tabIndex={0}>
          <article className="wx-preview-article">
            <h1>{titleText}</h1>
            <div className="wx-preview-account">{wxName || '公众号名称'}</div>
            <div className="wx-preview-byline">{author || '作者'}<span aria-hidden="true">·</span>{publishTime || '刚刚'}</div>
            {/* Keep the original article colors intact to surface dark-mode readability issues. */}
            <div className="wx-preview-body" dangerouslySetInnerHTML={{ __html: bodyHtml || '<p>正文为空</p>' }} />
          </article>
        </div>
      </div>

      <aside className="wx-preview-details" id={panelId} aria-label="推文信息" hidden={!isMobile && !detailsOpen}>
        <section>
          <h2>封面</h2>
          <div className="wx-preview-covers">
            <CoverBox url={coverBig} onPick={() => onPickCover('big')} onEdit={() => onEditCover('big')} />
            <CoverBox url={coverSmall} square onPick={() => onPickCover('small')} onEdit={() => onEditCover('small')} />
          </div>
        </section>
        <section>
          <h2>信息</h2>
          <div className="wx-preview-fields">{metaFields.map(([field, label, placeholder]) => (
            <label key={field}><span>{label}</span>
              <input value={meta[field]} placeholder={placeholder} onChange={event => onChangeMeta(field, event.target.value)} />
            </label>
          ))}</div>
        </section>
        <section>
          <h2>分享 / 列表卡片</h2>
          <div className="wx-preview-share" role="group" aria-label="单图文分享卡片">
            {coverBig ? <img src={coverBig} alt="" /> : null}
            <div><strong>{titleText}</strong></div>
          </div>
          <div className="wx-preview-list-card" role="group" aria-label="次条列表卡片">
            <span>{titleText}</span>
            <div>{smallForCard ? <img src={smallForCard} alt="" /> : null}</div>
          </div>
        </section>
      </aside>
    </div>
  </Modal>;
}
