import React from 'react';
import { IconChevronLeft, IconChevronRight, IconClose, IconSliders, IconTimelineFlow } from './ui/icons';
import { calendarDateKey, calendarMonthDays, selectCalendarRange, shiftCalendarDay, shiftCalendarMonth } from './utils/projectCalendar';
import './ProjectLibraryToolbar.css';

const SORT_OPTIONS = [
  { key: 'createdAt', order: 'desc', label: '最新创建的相册', short: '最新创建', detail: '创建时间 · 从新到旧' },
  { key: 'createdAt', order: 'asc', label: '最早创建的相册', short: '最早创建', detail: '创建时间 · 从旧到新' },
  { key: 'eventDate', order: 'desc', label: '最近开展的活动', short: '最近活动', detail: '活动日期 · 从近到远' },
  { key: 'eventDate', order: 'asc', label: '最早开展的活动', short: '最早活动', detail: '活动日期 · 从远到近' },
];

function dateLabel(filter) {
  const format = value => {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value || '');
    return match ? `${Number(match[1])}/${Number(match[2])}` : '';
  };
  const from = format(filter.from), to = format(filter.to);
  if (from && to) return `${from} - ${to}`;
  if (from) return `${from} 起`;
  if (to) return `至 ${to}`;
  return '全部时间';
}

export default function ProjectLibraryToolbar({ sort = {}, dateFilter = {}, onSortChange, onDateFilterChange }) {
  const [open, setOpen] = React.useState(null);
  const [month, setMonth] = React.useState(() => (dateFilter.from || dateFilter.to || calendarDateKey()).slice(0, 7));
  const [endpoint, setEndpoint] = React.useState('from');
  const rootRef = React.useRef(null);
  const sortRef = React.useRef(null);
  const dateRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const calendarRef = React.useRef(null);
  const pendingFocus = React.useRef(null);
  const id = React.useId();
  const current = SORT_OPTIONS.find(option => option.key === sort.key && option.order === sort.order) || SORT_OPTIONS[0];
  const hasDate = Boolean(dateFilter.from || dateFilter.to);
  const days = React.useMemo(() => calendarMonthDays(month), [month]);
  const today = calendarDateKey();
  const focusDate = dateFilter[endpoint]?.startsWith(month) ? dateFilter[endpoint] : `${month}-01`;
  const close = () => {
    (open === 'sort' ? sortRef : dateRef).current?.focus({ preventScroll: true });
    setOpen(null);
  };

  React.useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!rootRef.current?.contains(event.target)) setOpen(null); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      (open === 'sort' ? sortRef : dateRef).current?.focus({ preventScroll: true });
      setOpen(null);
    };
    panelRef.current?.querySelector(open === 'sort' ? '[aria-checked="true"]' : '[data-range-endpoint]')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  React.useEffect(() => {
    if (open !== 'date' || !pendingFocus.current) return;
    calendarRef.current?.querySelector(`[data-date="${pendingFocus.current}"]`)?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [month, open]);

  const openDate = () => {
    if (open === 'date') { setOpen(null); return; }
    setMonth((dateFilter.from || dateFilter.to || today).slice(0, 7));
    setEndpoint(dateFilter.from && !dateFilter.to ? 'to' : 'from');
    setOpen('date');
  };
  const selectDate = value => {
    const next = selectCalendarRange(dateFilter, endpoint, value);
    onDateFilterChange?.(next);
    setEndpoint(next.to ? 'from' : 'to');
    setMonth(value.slice(0, 7));
  };

  return <div className="project-toolbar album-library-controls" ref={rootRef} role="group" aria-label="相册排序与时间筛选">
    <div className="album-library-control-strip">
      <button ref={sortRef} type="button" className={`lg-popover-trigger album-library-trigger${open === 'sort' ? ' is-open' : ''}`}
        aria-label={`排序：${current.short}`} aria-haspopup="menu" aria-expanded={open === 'sort'} aria-controls={`${id}-sort`}
        onClick={() => setOpen(value => value === 'sort' ? null : 'sort')}
        onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen('sort'); } }}>
        <IconSliders /><span>{current.short}</span><IconChevronRight className="album-library-chevron" />
      </button>
      <span className="album-library-divider" aria-hidden="true" />
      <button ref={dateRef} type="button" className={`lg-popover-trigger album-library-trigger${hasDate ? ' is-active' : ''}${open === 'date' ? ' is-open' : ''}`}
        aria-label={`时间：${dateLabel(dateFilter)}`} title={hasDate ? `${dateFilter.from || '不限'} 至 ${dateFilter.to || '不限'}` : '按活动日期筛选'}
        aria-haspopup="dialog" aria-expanded={open === 'date'} aria-controls={`${id}-date`}
        onClick={openDate}>
        <IconTimelineFlow /><span>{dateLabel(dateFilter)}</span><IconChevronRight className="album-library-chevron" />
      </button>
      {hasDate && <button type="button" className="album-library-clear lg-popover-clear" aria-label="清除时间范围" title="清除时间范围"
        onClick={() => onDateFilterChange?.({ from: '', to: '' })}><IconClose /></button>}
    </div>
    {open === 'sort' && <div ref={panelRef} id={`${id}-sort`} className="album-library-panel album-library-sort-menu" role="menu" aria-label="相册排序方式"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...panelRef.current.querySelectorAll('[role="menuitemradio"]')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {SORT_OPTIONS.map(option => <button type="button" key={`${option.key}-${option.order}`} role="menuitemradio" aria-label={option.label}
        aria-checked={current === option} onClick={() => { onSortChange?.({ key: option.key, order: option.order }); close(); }}>
        <span><strong>{option.short}</strong><small>{option.detail}</small></span>
        <span className="album-library-radio" aria-hidden="true" />
      </button>)}
    </div>}
    {open === 'date' && <div ref={panelRef} id={`${id}-date`} className="album-library-panel album-library-date-panel" role="dialog" aria-label="按时间筛选">
      <div className="album-library-range-fields" role="group" aria-label="活动日期范围">
        {['from', 'to'].map(value => <button type="button" key={value} data-range-endpoint={value} aria-pressed={endpoint === value}
          aria-label={`${value === 'from' ? '开始日期' : '结束日期'}：${dateFilter[value] || '不限'}`} onClick={() => setEndpoint(value)}>
          <small>{value === 'from' ? '开始日期' : '结束日期'}</small><strong>{dateFilter[value] ? dateFilter[value].replace(/-/g, '.') : '不限'}</strong>
        </button>)}
      </div>
      <div className="album-library-calendar-header"><strong id={`${id}-month`}>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</strong>
        <div><button type="button" aria-label="上个月" title="上个月" onClick={() => setMonth(value => shiftCalendarMonth(value, -1))}><IconChevronLeft /></button>
          <button type="button" aria-label="下个月" title="下个月" onClick={() => setMonth(value => shiftCalendarMonth(value, 1))}><IconChevronRight /></button></div>
      </div>
      <div className="album-library-calendar" ref={calendarRef} role="group" aria-labelledby={`${id}-month`}>
        <div className="album-library-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="album-library-days">{days.map(value => {
          const selected = value === dateFilter.from || value === dateFilter.to;
          const inRange = dateFilter.from && dateFilter.to && value > dateFilter.from && value < dateFilter.to;
          return <button type="button" key={value} data-date={value} aria-label={value} aria-pressed={selected}
            aria-current={value === today ? 'date' : undefined} tabIndex={value === focusDate ? 0 : -1}
            className={`${selected ? 'is-selected' : ''}${inRange ? ' is-in-range' : ''}${!value.startsWith(month) ? ' is-outside' : ''}`}
            onClick={() => selectDate(value)} onKeyDown={event => {
              const index = days.indexOf(value);
              const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(index % 7), End: 6 - index % 7 }[event.key];
              if (offset === undefined && !['PageUp', 'PageDown'].includes(event.key)) return;
              event.preventDefault();
              const target = offset === undefined ? `${shiftCalendarMonth(month, event.key === 'PageUp' ? -1 : 1)}-01` : shiftCalendarDay(value, offset);
              if (target.slice(0, 7) !== month) { pendingFocus.current = target; setMonth(target.slice(0, 7)); }
              else calendarRef.current?.querySelector(`[data-date="${target}"]`)?.focus({ preventScroll: true });
            }}>{Number(value.slice(-2))}</button>;
        })}</div>
      </div>
      <div className="album-library-date-actions"><button type="button" disabled={!hasDate} onClick={() => { onDateFilterChange?.({ from: '', to: '' }); setEndpoint('from'); }}>清空</button>
        <button type="button" onClick={() => { onDateFilterChange?.({ from: shiftCalendarDay(today, -29), to: today }); setMonth(today.slice(0, 7)); setEndpoint('from'); }}>近 30 天</button>
        <button type="button" onClick={close}>完成</button></div>
    </div>}
  </div>;
}
