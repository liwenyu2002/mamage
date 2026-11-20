import React from 'react';
import { GlassSelect, SegmentedControl } from './ui';

export default function PersonalPdfOptions({ value, onChange, count, disabled }) {
  const update = patch => onChange(previous => ({ ...previous, ...patch }));
  return <aside className="personal-options" aria-label="PDF 参数"><h2>图片转 PDF</h2>
    <label>文件名称<input aria-label="PDF 文件名称" type="text" maxLength={100} value={value.title} disabled={disabled} onChange={event => update({ title: event.target.value })} /></label>
    <GlassSelect label="纸张" value={value.paper} disabled={disabled} onChange={paper => update({ paper })}
      options={[{ value: 'a4', label: 'A4' }, { value: 'a5', label: 'A5' }, { value: 'letter', label: 'Letter' }, { value: 'image', label: '随图片比例' }]} />
    {value.paper !== 'image' ? <fieldset className="personal-pdf-orientation" disabled={disabled}><span>页面方向</span><SegmentedControl label="页面方向" value={value.orientation}
      options={[{ value: 'auto', label: '自动' }, { value: 'portrait', label: '纵向' }, { value: 'landscape', label: '横向' }]} onChange={orientation => update({ orientation })} /></fieldset> : null}
    <label>页边距（mm）<input aria-label="PDF 页边距（mm）" type="number" min="0" max="30" step="1" value={value.margin} disabled={disabled} onChange={event => update({ margin: Number(event.target.value) })} /></label>
    <dl><dt>页数</dt><dd>{count} 页</dd><dt>版式</dt><dd>一图一页</dd><dt>图像</dt><dd>完整保留比例</dd><dt>标注与遮挡</dt><dd>合并后写入</dd></dl>
  </aside>;
}
