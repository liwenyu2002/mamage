import React from 'react';
import { Button } from './ui';
import './searchFeedback.css';

export function SearchSkeleton({ count = 8, square = false }) {
  return <div className={`search-skeleton${square ? ' is-square' : ''}`} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div className="search-skeleton__tile" key={index} />)}
  </div>;
}

export default function SearchFeedback({ search = {}, loading, phase = 'idle', found = 0, onRelated, onStrict, onRefresh }) {
  search = search || {};
  const related = search.matchType === 'related';
  const message = related ? search.relaxedHint : search.notice;
  const offer = !loading && search.relatedAvailable && onRelated;
  const active = loading || phase === 'complete';
  const visual = search.visual;
  const pending = Number(visual?.pending) > 0;
  const status = pending ? `${visual.watchPaused ? '后台继续核验' : '正在核验目标人物'} · 已确认 ${found} 张`
    : visual?.unavailable ? '视觉核验暂不可用'
    : visual && !visual.coverageComplete ? `已确认 ${found} 张 · 部分照片暂不能判断`
    : loading ? (phase === 'understanding' ? '正在理解检索条件'
    : phase === 'verifying' ? '正在核验衣着与动作'
    : phase === 'counting' ? (found ? `已显示 ${found} 张，正在核对总数` : '正在核对检索结果')
      : found ? `已找到 ${found} 张，继续检索` : phase === 'starting' ? '正在准备检索' : '正在匹配照片')
    : phase === 'complete' ? `检索完成 · 已显示 ${found} 张` : null;
  if (!active && !message && !offer && !search.degraded && !related) return null;
  return (
    <div className={`search-feedback${related ? ' is-related' : ''}${loading ? ' is-searching' : ''}${phase === 'complete' && !pending ? ' is-complete' : ''}`} aria-label="检索状态" aria-busy={loading || undefined}>
      {active ? <span className="search-feedback__activity" aria-hidden="true" /> : null}
      <div className="search-feedback__copy" role="status">
        {status ? <strong key={loading ? phase : 'complete'} className="search-feedback__phase">{status}</strong> : null}
        {offer ? <strong>没有完全匹配的照片</strong> : related ? <strong>相关候选</strong> : null}
        {message ? <span>{message}</span> : null}
        {visual?.refreshFailed ? <span>结果刷新暂时中断，后台核验仍会继续。</span> : null}
        {search.degraded ? <span>AI 解析暂不可用，已保留可识别的条件继续检索。</span> : null}
      </div>
      {offer ? <Button size="small" disabled={loading} onClick={onRelated}>查看人物相关照片</Button> : null}
      {visual?.watchPaused && onRefresh ? <Button size="small" disabled={loading} onClick={onRefresh}>刷新结果</Button> : null}
      {related && onStrict ? <Button size="small" disabled={loading} onClick={onStrict}>返回严格匹配</Button> : null}
    </div>
  );
}
