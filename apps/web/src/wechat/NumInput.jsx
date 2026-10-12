// src/wechat/NumInput.jsx
// 可量化数值输入：手动键入 + ± 步进，支持负数/清空(默认)。用于行距/边距/字号等一切数值调节。
// 传播处理内置：输入框 stopPropagation(能获焦、不被工具条行的 preventDefault 挡住)；按钮 preventDefault(不夺 contenteditable 焦点)。
import React from 'react';

export default function NumInput({
  value, onChange, min = -9999, max = 9999, step = 1,
  suffix = '', placeholder = '', width = 46,
}) {
  const [draft, setDraft] = React.useState(null); // 键入缓冲；null=展示受控值
  const display = draft != null ? draft : (value == null ? '' : String(value));
  const clamp = (n) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  const cur = value == null ? 0 : Number(value);

  const emit = (raw) => {
    const t = String(raw).trim();
    if (t === '') { onChange(null); return; }
    const n = parseFloat(t);
    if (Number.isFinite(n)) onChange(clamp(n));
  };
  const bump = (d) => onChange(clamp(cur + d));
  const stopPd = (e) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <span className="cve-numin">
      <button type="button" className="cve-numin-btn" onPointerDown={stopPd} onClick={() => bump(-step)} aria-label="减小" tabIndex={-1}>−</button>
      <input
        className="cve-numin-input"
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={placeholder}
        style={{ width }}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => { const raw = e.target.value; setDraft(raw); const n = parseFloat(raw); if (raw.trim() === '') onChange(null); else if (Number.isFinite(n)) onChange(clamp(n)); }}
        onBlur={() => { emit(display); setDraft(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { emit(e.currentTarget.value); setDraft(null); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); bump(step); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-step); }
        }}
      />
      {suffix ? <span className="cve-numin-suffix">{suffix}</span> : null}
      <button type="button" className="cve-numin-btn" onPointerDown={stopPd} onClick={() => bump(step)} aria-label="增大" tabIndex={-1}>＋</button>
    </span>
  );
}
