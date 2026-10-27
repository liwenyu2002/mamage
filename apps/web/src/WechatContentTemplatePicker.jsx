import React from 'react';
import { Button, GlassSelect, Input, Modal, TextArea, Toast } from './ui';
import { IconPlus, IconEditStroked, IconTrash } from './ui/icons';
import { request } from './services/request';

const BASE = '/api/wechat-compositions/content-templates';
const BUILTINS = [
  { value: 'auto', label: '自动判断' }, { value: 'activity', label: '活动报道' },
  { value: 'lecture', label: '讲座交流' }, { value: 'interview', label: '人物访谈' },
  { value: 'custom', label: '自定义结构' },
];

export default function WechatContentTemplatePicker({ form, onChange, workspaceId }) {
  const [items, setItems] = React.useState([]);
  const [unavailable, setUnavailable] = React.useState(false);
  const [dialog, setDialog] = React.useState(null);
  const [name, setName] = React.useState('');
  const [shared, setShared] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const scopeHeaders = React.useMemo(() => ({ 'X-Mamage-Unit-Id': workspaceId ? String(workspaceId) : 'legacy' }), [workspaceId]);
  const load = React.useCallback(async signal => {
    try {
      const result = await request(BASE, { headers: scopeHeaders, signal });
      if (!signal?.aborted) { setItems(Array.isArray(result.items) ? result.items : []); setUnavailable(false); }
    } catch (error) { if (!signal?.aborted) { setItems([]); setUnavailable(true); } }
  }, [scopeHeaders]);
  React.useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  const selected = items.find(item => String(item.id) === String(form.contentTemplateId));
  const select = value => {
    if (value.startsWith('saved:')) {
      const item = items.find(row => String(row.id) === value.slice(6));
      if (item) onChange({ contentTemplate: 'custom', contentTemplateId: item.id, contentOutline: item.outline, reviewCredits: item.reviewCredits });
    } else onChange({ contentTemplate: value, contentTemplateId: null });
  };
  const beginSave = update => {
    if (!String(form.contentOutline || '').trim()) { Toast.warning('请先填写内容结构'); return; }
    setName(update ? selected.name : '');
    setShared(update && selected.visibility === 'workspace');
    setDialog(update ? 'update' : 'create');
  };
  const save = async () => {
    if (saving) return;
    if (!name.trim()) { Toast.warning('请填写模板名称'); return; }
    setSaving(true);
    try {
      const update = dialog === 'update' && selected?.canEdit;
      const result = await request(update ? `${BASE}/${selected.id}` : BASE, { method: update ? 'PUT' : 'POST', headers: scopeHeaders,
        data: { name: name.trim(), outline: form.contentOutline, reviewCredits: form.reviewCredits !== false, visibility: shared ? 'workspace' : 'private' } });
      await load(); onChange({ contentTemplateId: result.id }); setDialog(null); Toast.success(update ? '模板已更新' : '模板已保存');
    } catch (error) { Toast.error(error.message || '模板保存失败'); }
    finally { setSaving(false); }
  };
  const remove = () => {
    if (!selected?.canEdit) return;
    Modal.confirm({ title: '删除内容模板？', content: '已使用此模板的稿件不会改变。', okText: '删除', onOk: async () => {
      try { await request(`${BASE}/${selected.id}`, { method: 'DELETE', headers: scopeHeaders });
        onChange({ contentTemplateId: null }); await load(); Toast.success('模板已删除'); }
      catch (error) { Toast.error(error.message || '删除失败'); }
    } });
  };
  return <div className="news-content-template-field">
    <div className="news-content-template">
      <GlassSelect label="文章类型" value={selected ? `saved:${selected.id}` : form.contentTemplate || 'auto'}
        options={[...BUILTINS, ...items.map(item => ({ value: `saved:${item.id}`, label: `${item.name}${item.visibility === 'workspace' ? ' · 小组' : ' · 个人'}` }))]} onChange={select} />
    </div>
    {form.contentTemplate === 'custom' ? <>
      <label className="news-material-label">内容结构
        <TextArea aria-label="内容结构" value={form.contentOutline || ''} rows={3} maxLength={1000}
          placeholder="例如：导语、活动介绍、现场交流、结尾" onChange={value => onChange({ contentOutline: value })} />
      </label>
      <div className="news-template-actions">
        <Button size="small" theme="borderless" icon={<IconPlus />} disabled={unavailable} onClick={() => beginSave(false)}>保存模板</Button>
        {selected?.canEdit ? <><Button size="small" theme="borderless" icon={<IconEditStroked />} onClick={() => beginSave(true)}>更新模板</Button>
          <Button size="small" theme="borderless" icon={<IconTrash />} title="删除模板" aria-label="删除模板" onClick={remove} /></> : null}
        {unavailable ? <span role="status">模板库暂不可用</span> : null}
      </div>
    </> : null}
    <Modal title={dialog === 'update' ? '更新内容模板' : '保存内容模板'} visible={Boolean(dialog)}
      onCancel={() => { if (!saving) setDialog(null); }} onOk={save} okText={saving ? '保存中' : '保存'}>
      <div className="news-template-dialog"><label>模板名称<Input value={name} onChange={setName} maxLength={80} placeholder="例如：活动报道" /></label>
        <label className="news-content-template-credit"><input type="checkbox" checked={shared} disabled={!workspaceId}
          onChange={event => setShared(event.target.checked)} /><span>共享给当前小组</span></label></div>
    </Modal>
  </div>;
}
