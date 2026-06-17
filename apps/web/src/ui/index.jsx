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

function Spin({ tip = '加载中', className = '' }) {
  return (
    <div className={cx('mamage-spin', className)}>
      <span className="mamage-spin-dot" aria-hidden="true" />
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
  zIndex,
}) {
  const [pending, setPending] = React.useState(false);
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
    <div className="mamage-modal-mask" style={{ zIndex }}>
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
  Divider,
  Empty,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Spin,
  Tabs,
  Tag,
  TextArea,
  Toast,
  Tooltip,
  Typography,
};
