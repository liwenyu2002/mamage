// Local-only interaction preview. No request is sent to the production API.
import React from 'react';
import { Button, GlassSelect, MotionModal, SegmentedControl } from '../ui';
import { IconShare } from '../ui/icons';
import { LiquidGlassDefs } from '../liquidGlass';
import { initLiquidLens } from '../liquidLens';
import './shareAlbumPrototype.css';

const UNITS = [
  { value: 'business', label: '商学院' },
  { value: 'public', label: '公关部门' },
];
const PEOPLE = {
  business: [{ value: '', label: '部门所有成员' }, { value: '李智贵', label: '李智贵' }],
  public: [{ value: '', label: '部门所有成员' }, { value: '赵宇薇', label: '赵宇薇' }, { value: '荣尚', label: '荣尚' }],
};
const MODES = [
  { value: 'read', label: '只读', detail: '实时同步，可查看和下载原片' },
  { value: 'copy', label: '可复制', detail: '生成独立副本，之后不随源相册变化' },
  { value: 'collaborate', label: '共同编辑', detail: '可继续上传和修改，最长 90 天' },
];
const EXPIRIES = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: 'permanent', label: '永久' },
];

function AlbumSummary() {
  return <div className="sap-album-summary">
    <span>当前相册</span>
    <strong>2026 秋季开学典礼</strong>
    <span>学工与融媒体中心</span>
  </div>;
}

function ShareModes({ value, onChange }) {
  return <div className="sap-mode-field">
    <span className="mamage-field-label">分享方式</span>
    <SegmentedControl label="分享方式" options={MODES} value={value} onChange={onChange} />
    <p className="sap-mode-help" key={value}>{MODES.find((item) => item.value === value)?.detail}</p>
  </div>;
}

export default function ShareAlbumPrototype() {
  const [visible, setVisible] = React.useState(true);
  const [tab, setTab] = React.useState('create');
  const [unit, setUnit] = React.useState('');
  const [person, setPerson] = React.useState('');
  const [mode, setMode] = React.useState('read');
  const [expiry, setExpiry] = React.useState('30');
  const [sync, setSync] = React.useState('approval');
  const [publicExpiry, setPublicExpiry] = React.useState('30');
  const [sent, setSent] = React.useState([]);
  const [links, setLinks] = React.useState([]);
  const [pickedPhotos, setPickedPhotos] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');

  React.useEffect(() => initLiquidLens(), []);
  React.useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const simulate = (done) => {
    setBusy(true);
    window.setTimeout(() => { done(); setBusy(false); }, 560);
  };
  const share = () => simulate(() => {
    setSent((items) => [{ id: Date.now(), unit: UNITS.find((item) => item.value === unit)?.label, person, mode, expiry }, ...items]);
    setTab('sent');
    setToast('演示分享已创建');
  });
  const makeLink = () => simulate(() => {
    setLinks((items) => [{ id: Date.now(), sync, expiry: publicExpiry }, ...items]);
    setToast('演示链接已生成');
  });
  const changeMode = (next) => {
    setMode(next);
    if (next === 'collaborate' && expiry === 'permanent') setExpiry('30');
  };

  return <div className="sap-page">
    <LiquidGlassDefs />
    <div className="mamage-dynamic-backdrop" />
    <header className="mamage-header sap-header">
      <div className="sap-header-inner"><strong>MaMage</strong><span>图库</span><span>全媒体编辑台</span><b>李</b></div>
    </header>
    <main className="sap-album-page">
      <p>学工与融媒体中心 / 相册</p>
      <div className="sap-album-head"><div><h1>2026 秋季开学典礼</h1><span>268 项素材 · 更新于今天</span></div>
        <Button icon={<IconShare />} onClick={() => setVisible(true)}>分享相册</Button></div>
      <div className="sap-photo-wall" aria-label="照片勾选样式预览">
        {[1018, 1015, 1016, 1022, 1019, 1039, 1040, 1041].map((id) =>
          <div key={id} style={{ backgroundImage: `url(https://picsum.photos/id/${id}/520/360)` }}>
            <label className="sap-photo-select">
              <input type="checkbox" className="mamage-photo-check-input" checked={pickedPhotos.includes(id)}
                onChange={(event) => setPickedPhotos((items) => event.target.checked
                  ? [...items, id] : items.filter((item) => item !== id))}
                aria-label={`选择照片 ${id}`} />
              <span className="mamage-photo-checkmark" aria-hidden="true" />
            </label>
          </div>)}
      </div>
    </main>

    <MotionModal visible={visible} title="分享相册" onCancel={() => setVisible(false)}
      className="sap-dialog" width={700}
      bodyStyle={{ maxHeight: 'min(76vh, 760px)', overflowY: 'auto' }} footer={null}>
      <AlbumSummary />
      <SegmentedControl className="sap-tabs" kind="tabs" label="分享类别" value={tab} onChange={setTab}
        options={[{ value: 'create', label: '部门分享' }, { value: 'public', label: '公开分享' }, { value: 'sent', label: '部门记录' }]} />

      <div className="sap-tab-content" key={tab}>
        {tab === 'create' && <div className="sap-form">
          <div className="sap-fields">
            <GlassSelect label="接收部门" value={unit} onChange={(next) => { setUnit(next); setPerson(''); }}
              options={UNITS} placeholder="选择部门" />
            <GlassSelect label="接收人" value={person} onChange={setPerson} disabled={!unit}
              options={PEOPLE[unit] || [{ value: '', label: '先选择部门' }]} />
          </div>
          <ShareModes value={mode} onChange={changeMode} />
          <div className="sap-form-end">
            <GlassSelect label="有效期" value={expiry} onChange={setExpiry} upward
              options={EXPIRIES.filter((item) => mode !== 'collaborate' || item.value !== 'permanent')} />
            <Button type="primary" theme="neu" icon={<IconShare />} loading={busy} disabled={!unit} onClick={share}>分享给部门</Button>
          </div>
        </div>}

        {tab === 'public' && <div className="sap-form">
          <div className="sap-fields">
            <GlassSelect label="新增照片" value={sync} onChange={setSync} options={[
              { value: 'approval', label: '新增照片需负责人确认' },
              { value: 'automatic', label: '新增照片自动同步' },
            ]} />
            <GlassSelect label="有效期" value={publicExpiry} onChange={setPublicExpiry} options={EXPIRIES.slice(0, 3)} />
          </div>
          <div className="sap-form-end"><p>生成外链；持链接者可在有效期内查看、逐张下载。</p>
            <Button type="primary" theme="neu" icon={<IconShare />} loading={busy} onClick={makeLink}>创建演示外链</Button></div>
          {links.map((item) => <div className="sap-record" key={item.id}><div><strong>公开链接</strong>
            <span>{item.sync === 'automatic' ? '自动同步' : '负责人确认'} · {item.expiry} 天有效</span></div>
            <Button size="small" onClick={() => setToast('演示链接不会生成真实地址')}>复制</Button></div>)}
        </div>}

        {tab === 'sent' && <div className="sap-records">
          {sent.length ? sent.map((item) => <div className="sap-record" key={item.id}>
            <div><strong>发给 {item.person || item.unit}</strong><span>{MODES.find((entry) => entry.value === item.mode)?.label} · {item.expiry === 'permanent' ? '永久有效' : `${item.expiry} 天有效`}</span></div>
            <span className="sap-status">有效</span>
          </div>) : <p className="sap-empty">还没有发出的部门分享</p>}
        </div>}
      </div>
      <p className="sap-preview-note">交互预览，不会修改线上数据</p>
    </MotionModal>
    {toast && <div className="mamage-toast is-visible sap-toast" role="status">{toast}</div>}
  </div>;
}
