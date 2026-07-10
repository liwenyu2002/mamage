import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import './ui.css';

function cx(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}

function normalizeDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function Button({
  children,
  className = '',
  disabled = false,
  loading = false,
  type = 'default',
  theme = '',
  size = '',
  icon = null,
  onClick,
  ...rest
}) {
  return (
    <button
      {...rest}
      type="button"
      className={cx(
        'mamage-button',
        type && `mamage-button-${type}`,
        theme && `mamage-button-${theme}`,
        size && `mamage-button-${size}`,
        (disabled || loading) && 'mamage-button-disabled',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {loading ? <span className="mamage-button-spinner" aria-hidden="true" /> : null}
      {icon ? <span className="mamage-button-icon" aria-hidden="true">{icon}</span> : null}
      <span className="mamage-button-content">{children}</span>
    </button>
  );
}

function ButtonGroup({ children, className = '', ...rest }) {
  return <div {...rest} className={cx('mamage-button-group', className)}>{children}</div>;
}

function Input({
  className = '',
  onChange,
  mode,
  type = 'text',
  value = '',
  prefix,
  suffix,
  showClear,
  onClear,
  onEnterPress,
  ...rest
}) {
  const inputType = mode === 'password' ? 'password' : type;
  const inputNode = (
    <input
      {...rest}
      type={inputType}
      value={value ?? ''}
      className={cx((prefix || suffix || showClear) ? 'mamage-input-inner' : 'mamage-input-wrapper', className && !(prefix || suffix || showClear) ? className : '')}
      onChange={(e) => onChange?.(e.target.value, e)}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        if (e.key === 'Enter') onEnterPress?.(e);
      }}
    />
  );

  if (prefix || suffix || showClear) {
    return (
      <span className={cx('mamage-input-wrapper mamage-input-composite', className)}>
        {prefix ? <span className="mamage-input-prefix" aria-hidden="true">{prefix}</span> : null}
        {inputNode}
        {showClear && value ? (
          <button
            type="button"
            className="mamage-input-clear"
            aria-label="清空"
            onClick={(e) => {
              onChange?.('', e);
              onClear?.(e);
            }}
          >
            ×
          </button>
        ) : null}
        {suffix ? <span className="mamage-input-suffix" aria-hidden="true">{suffix}</span> : null}
      </span>
    );
  }

  return (
    inputNode
  );
}

function TextArea({ className = '', onChange, value = '', rows = 3, ...rest }) {
  return (
    <textarea
      {...rest}
      rows={rows}
      value={value ?? ''}
      className={cx('mamage-input-textarea-wrapper mamage-textarea-wrapper', className)}
      onChange={(e) => onChange?.(e.target.value, e)}
    />
  );
}

function DatePicker({ className = '', onChange, value, placeholder, clearable, format, ...rest }) {
  return (
    <input
      {...rest}
      type="date"
      value={normalizeDateValue(value)}
      placeholder={placeholder}
      className={cx('mamage-input-wrapper mamage-date-picker', className)}
      onChange={(e) => onChange?.(e.target.value || (clearable ? null : ''), e)}
    />
  );
}

// 年月日+时分选择，value 形如 '2026-07-09T18:30'。
// 自绘液态玻璃日历弹层（原生 datetime-local 的日历弹窗无法定制，风格违和）。
function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateTimeValue(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], hh: m[4] !== undefined ? +m[4] : 0, mi: m[5] !== undefined ? +m[5] : 0 };
}

function formatDateTimeValue(p, dateOnly) {
  const d = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
  return dateOnly ? d : `${d}T${pad2(p.hh)}:${pad2(p.mi)}`;
}

function DateTimePicker({ className = '', onChange, value, placeholder = '选择时间', clearable, style, title, disabled, dateOnly = false }) {
  const parsed = parseDateTimeValue(value);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const [view, setView] = React.useState(() => {
    const p = parseDateTimeValue(value);
    const now = new Date();
    return { y: p ? p.y : now.getFullYear(), mo: p ? p.mo : now.getMonth() + 1 };
  });
  const triggerRef = React.useRef(null);
  const popRef = React.useRef(null);

  const openPop = () => {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = 256;
    const height = dateOnly ? 286 : 330;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    setPos({ left, top });
    const p = parseDateTimeValue(value);
    const now = new Date();
    setView({ y: p ? p.y : now.getFullYear(), mo: p ? p.mo : now.getMonth() + 1 });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const commitDate = (d) => {
    const base = parsed || { hh: 9, mi: 0 };
    onChange?.(formatDateTimeValue({ y: view.y, mo: view.mo, d, hh: base.hh, mi: base.mi }, dateOnly));
    if (dateOnly) setOpen(false); // 只选日期时点选即完成
  };
  const commitTime = (hh, mi) => {
    const now = new Date();
    const base = parsed || { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
    onChange?.(formatDateTimeValue({ y: base.y, mo: base.mo, d: base.d, hh, mi }, dateOnly));
  };
  const shiftMonth = (delta) => setView((v) => {
    let mo = v.mo + delta;
    let { y } = v;
    if (mo < 1) { mo = 12; y -= 1; }
    if (mo > 12) { mo = 1; y += 1; }
    return { y, mo };
  });

  const firstDow = (new Date(view.y, view.mo - 1, 1).getDay() + 6) % 7; // 周一为首
  const daysInMonth = new Date(view.y, view.mo, 0).getDate();
  const today = new Date();
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const displayText = parsed
    ? (dateOnly
      ? `${parsed.y}-${pad2(parsed.mo)}-${pad2(parsed.d)}`
      : `${parsed.y}-${pad2(parsed.mo)}-${pad2(parsed.d)} ${pad2(parsed.hh)}:${pad2(parsed.mi)}`)
    : '';
  const minutes = [];
  for (let m = 0; m < 60; m += 5) minutes.push(m);
  if (parsed && !minutes.includes(parsed.mi)) {
    minutes.push(parsed.mi);
    minutes.sort((a, b) => a - b);
  }

  const pop = open && pos && typeof document !== 'undefined' ? createPortal(
    <div ref={popRef} className="mamage-dtp-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="选择日期时间">
      <div className="mamage-dtp-head">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button>
        <span>{view.y} 年 {view.mo} 月</span>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="下个月">›</button>
      </div>
      <div className="mamage-dtp-grid mamage-dtp-week">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mamage-dtp-grid">
        {cells.map((d, i) => (d === null ? <span key={`e${i}`} /> : (
          <button
            type="button"
            key={d}
            className={cx(
              'mamage-dtp-day',
              parsed && parsed.y === view.y && parsed.mo === view.mo && parsed.d === d && 'is-selected',
              today.getFullYear() === view.y && today.getMonth() + 1 === view.mo && today.getDate() === d && 'is-today',
            )}
            onClick={() => commitDate(d)}
          >{d}</button>
        )))}
      </div>
      <div className="mamage-dtp-time" style={dateOnly ? { display: 'none' } : undefined}>
        <select value={parsed ? parsed.hh : ''} onChange={(e) => commitTime(Number(e.target.value), parsed ? parsed.mi : 0)}>
          <option value="" disabled>时</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad2(h)} 时</option>)}
        </select>
        <select value={parsed ? parsed.mi : ''} onChange={(e) => commitTime(parsed ? parsed.hh : 9, Number(e.target.value))}>
          <option value="" disabled>分</option>
          {minutes.map((m) => <option key={m} value={m}>{pad2(m)} 分</option>)}
        </select>
      </div>
      <div className="mamage-dtp-foot">
        {clearable ? (
          <button type="button" className="mamage-dtp-clear" onClick={() => { onChange?.(null); setOpen(false); }}>清除</button>
        ) : <span />}
        <button type="button" className="mamage-dtp-ok" onClick={() => setOpen(false)}>完成</button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        title={title}
        disabled={disabled}
        className={cx('mamage-input-wrapper mamage-dtp-trigger', className)}
        style={style}
        onClick={() => (open ? setOpen(false) : openPop())}
      >
        <span className={displayText ? 'mamage-dtp-value' : 'mamage-dtp-placeholder'}>{displayText || placeholder}</span>
        <svg className="mamage-dtp-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      </button>
      {pop}
    </>
  );
}

function Select({ children, className = '', value = '', onChange, placeholder, allowClear, filterOption, onSearch, ...rest }) {
  return (
    <select
      {...rest}
      value={value ?? ''}
      className={cx('mamage-select-selection', className)}
      onChange={(e) => onChange?.(e.target.value, e)}
    >
      {(placeholder || allowClear) ? <option value="">{placeholder || '请选择'}</option> : null}
      {children}
    </select>
  );
}

Select.Option = function Option({ children, value, ...rest }) {
  return <option {...rest} value={value}>{children}</option>;
};

function Card({ title, children, className = '', bordered, ...rest }) {
  return (
    <section {...rest} className={cx('mamage-card', bordered && 'mamage-card-bordered', className)}>
      {title ? (
        <div className="mamage-card-header">
          <div className="mamage-card-header-title">{title}</div>
        </div>
      ) : null}
      <div className="mamage-card-body">{children}</div>
    </section>
  );
}

function Tag({ children, className = '', size = '', type = '', color = '', onClick, ...rest }) {
  return (
    <span
      {...rest}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cx('mamage-tag', size && `is-${size}`, type && `is-${type}`, color && `is-${color}`, className)}
      onClick={onClick}
    >
      <span className="mamage-tag-content">{children}</span>
    </span>
  );
}

// 品牌加载动画：六路编织六边形依次传递高亮（源自 中关村学院 loader，浅色玻璃配色版）
const HEXLOADER_ANGLES = [0, 60, 120, 180, 240, 300];

function HexLoader({ size = 44, className = '' }) {
  const uid = React.useId();
  const loopId = `mamage-hexloader-loop-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className={cx('mamage-hexloader', className)}
      viewBox="-160 -160 320 320"
      width={size}
      height={size}
      role="img"
      aria-label="加载中"
    >
      <defs>
        <path
          id={loopId}
          pathLength="480"
          d="M 18 -140 L 87.282 -100 V -20 L 18 20 L -51.282 -20 V -100 Z"
        />
      </defs>
      <g className="mamage-hexloader-base">
        {HEXLOADER_ANGLES.map((deg) => (
          <use key={deg} href={`#${loopId}`} transform={deg ? `rotate(${deg})` : undefined} />
        ))}
      </g>
      <g aria-hidden="true">
        {HEXLOADER_ANGLES.map((deg, i) => (
          <g key={deg} transform={deg ? `rotate(${deg})` : undefined}>
            <use href={`#${loopId}`} className={`mamage-hexloader-relay is-relay-${i}`} />
          </g>
        ))}
      </g>
      <polygon className="mamage-hexloader-core" points="0,-18 15.588,-9 15.588,9 0,18 -15.588,9 -15.588,-9" />
      <rect className="mamage-hexloader-eye" x="-10" y="-6.5" width="5" height="5" rx="0.4" />
      <rect className="mamage-hexloader-eye" x="5" y="-6.5" width="5" height="5" rx="0.4" />
    </svg>
  );
}

function Spin({ tip = '加载中', size = 44, className = '' }) {
  return (
    <div className={cx('mamage-spin', className)}>
      <HexLoader size={size} />
      {tip ? <span className="mamage-spin-tip">{tip}</span> : null}
    </div>
  );
}

function Empty({ description = '暂无内容', className = '' }) {
  return <div className={cx('mamage-empty', className)}>{description}</div>;
}

function Text({ children, type = '', strong = false, size = '', className = '', ...rest }) {
  return (
    <span
      {...rest}
      className={cx(
        'mamage-typography',
        type && `is-${type}`,
        strong && 'is-strong',
        size && `is-${size}`,
        className,
      )}
    >
      {children}
    </span>
  );
}

function Title({ children, heading = 3, className = '', ...rest }) {
  const level = Math.min(6, Math.max(1, Number(heading) || 3));
  const TagName = `h${level}`;
  return (
    <TagName {...rest} className={cx('mamage-typography', `mamage-typography-h${level}`, className)}>
      {children}
    </TagName>
  );
}

const Typography = { Text, Title };

function Modal({
  visible,
  title,
  children,
  onOk,
  onCancel,
  okText = '确定',
  cancelText = '取消',
  okButtonProps = {},
  footer,
  className = '',
  width,
  bodyStyle,
  closable = true,
  maskClosable = true,
  zIndex,
}) {
  const [pending, setPending] = React.useState(false);

  // Esc 关闭（标准弹窗交互；输入法组合键期间不触发）
  React.useEffect(() => {
    if (!visible || typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.isComposing && closable) onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, closable, onCancel]);

  if (!visible || typeof document === 'undefined') return null;

  const runOk = async () => {
    if (!onOk) return;
    try {
      setPending(true);
      await onOk();
    } finally {
      setPending(false);
    }
  };

  const node = (
    <div
      className="mamage-modal-mask"
      style={{ zIndex }}
      onMouseDown={(e) => {
        // 点遮罩空白处关闭（按下即判定，避免拖选文本误关）
        if (maskClosable && closable && e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        className={cx('mamage-modal', className)}
        style={{ width, maxWidth: width ? undefined : undefined }}
        role="dialog"
        aria-modal="true"
      >
        <div className="mamage-modal-content">
          <div className="mamage-modal-header">
            <div className="mamage-modal-title">{title}</div>
            {closable ? (
              <button type="button" className="mamage-modal-close" aria-label="关闭" onClick={onCancel}>×</button>
            ) : null}
          </div>
          <div className="mamage-modal-body" style={bodyStyle}>{children}</div>
          {footer === null ? null : (
            <div className="mamage-modal-footer">
              {footer !== undefined ? footer : (
                <>
                  <Button type="tertiary" onClick={onCancel}>{cancelText}</Button>
                  <Button type="primary" loading={pending || okButtonProps.loading} disabled={okButtonProps.disabled} onClick={runOk}>
                    {okText}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

Modal.confirm = function confirm({ title = '确认操作', content, okText = '确定', cancelText = '取消', onOk } = {}) {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const cleanup = () => {
    root.unmount();
    host.remove();
  };

  function ConfirmModal() {
    return (
      <Modal
        visible
        title={title}
        onCancel={cleanup}
        onOk={async () => {
          await onOk?.();
          cleanup();
        }}
        okText={okText}
        cancelText={cancelText}
      >
        <div className="mamage-confirm-content">{content}</div>
      </Modal>
    );
  }

  root.render(<ConfirmModal />);
};

function ensureToastRoot() {
  if (typeof document === 'undefined') return null;
  let root = document.querySelector('.mamage-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'mamage-toast-root';
    document.body.appendChild(root);
  }
  return root;
}

function showToast(type, message) {
  const root = ensureToastRoot();
  if (!root) return;
  const item = document.createElement('div');
  item.className = `mamage-toast is-${type}`;
  item.textContent = String(message || '');
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  setTimeout(() => {
    item.classList.remove('is-visible');
    setTimeout(() => item.remove(), 180);
  }, 2800);
}

const Toast = {
  success: (message) => showToast('success', message),
  error: (message) => showToast('error', message),
  warning: (message) => showToast('warning', message),
  info: (message) => showToast('info', message),
};

function Tooltip({ children, content }) {
  return (
    <span className="mamage-tooltip" data-tooltip={content}>
      {children}
    </span>
  );
}

function Divider({ className = '', ...rest }) {
  return <div {...rest} className={cx('mamage-divider', className)} />;
}

function Layout({ children, className = '', ...rest }) {
  return <div {...rest} className={cx('mamage-layout', className)}>{children}</div>;
}

Layout.Header = function Header({ children, className = '', ...rest }) {
  return <header {...rest} className={cx('mamage-layout-header', className)}>{children}</header>;
};

Layout.Content = function Content({ children, className = '', ...rest }) {
  return <main {...rest} className={cx('mamage-layout-content', className)}>{children}</main>;
};

function Tabs({ children, defaultActiveKey, className = '' }) {
  const panes = React.Children.toArray(children).filter(Boolean);
  const firstKey = panes[0]?.props?.itemKey;
  const [activeKey, setActiveKey] = React.useState(defaultActiveKey || firstKey);
  const activePane = panes.find((pane) => pane.props.itemKey === activeKey) || panes[0];
  return (
    <div className={cx('mamage-tabs', className)}>
      <div className="mamage-tabs-bar">
        {panes.map((pane) => (
          <button
            key={pane.props.itemKey}
            type="button"
            className={cx('mamage-tabs-tab', pane.props.itemKey === activeKey && 'is-active')}
            onClick={() => setActiveKey(pane.props.itemKey)}
          >
            {pane.props.tab}
          </button>
        ))}
      </div>
      <div className="mamage-tabs-content">{activePane}</div>
    </div>
  );
}

Tabs.TabPane = function TabPane({ children }) {
  return <div className="mamage-tabs-pane">{children}</div>;
};

function List({ children, className = '', ...rest }) {
  return <div {...rest} className={cx('mamage-list', className)}>{children}</div>;
}

export {
  Button,
  ButtonGroup,
  Card,
  DatePicker,
  DateTimePicker,
  Divider,
  Empty,
  Input,
  Layout,
  List,
  Modal,
  Select,
  HexLoader,
  Spin,
  Tabs,
  Tag,
  TextArea,
  Toast,
  Tooltip,
  Typography,
};
