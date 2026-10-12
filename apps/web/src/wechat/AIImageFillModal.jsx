import React from 'react';
import { Modal, Toast } from '../ui';
import { request, resolveAssetUrl } from '../services/request';

// AI 自动配图：扫描画布中的占位图（imageCard 且 src 为 data: 占位 SVG），按每张占位图
// 的语义标签（caption "占位图：特写镜头" → "特写镜头"）+ 推文标题构造搜索词，调用全库
// AI 搜图（/api/photos/search smart=1，带"推荐"触发质量筛选），每槽位出候选供确认后
// 一次性批量替换。AI 不直接进稿：人只做一次总确认。
const CANDIDATES = 6;

function toCandidate(p) {
  const thumb = resolveAssetUrl(p.thumbUrl || p.url || '');
  const full = resolveAssetUrl(p.url || thumb);
  const id = p.id != null ? String(p.id) : '';
  if (!id || !thumb) return null;
  return { id, thumbUrl: thumb, fullUrl: full || thumb, description: p.description || p.title || '', projectName: p.projectName || '' };
}

export default function AIImageFillModal({ visible, onClose, slots, contextText, onApply }) {
  // slots: [{uid, semantic}]；结果状态：slotUid -> { items, hint, selectedId, skipped }
  const [results, setResults] = React.useState({});
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!visible) { setResults({}); setLoading(false); return undefined; }
    if (!slots.length) return undefined;
    let canceled = false;
    setLoading(true);
    Promise.all(slots.map((slot) => {
      // 标题常含诗意词（如"以星空为幕"）与照片描述词不匹配，只带槽位语义 + 质量词；
      // 零结果时后端会自动放宽，语义太宽也优于空手而归
      const q = [slot.semantic, '推荐'].filter(Boolean).join(' ');
      return request('/api/photos/search', {
        method: 'GET',
        data: { q, smart: 1, page: 1, pageSize: CANDIDATES, sort: 'relevance' },
      })
        .then((d) => ({
          slot,
          items: (d && d.list ? d.list : []).map(toCandidate).filter(Boolean),
          hint: ((d && d.search) || {}).relaxedHint || '',
        }))
        .catch(() => ({ slot, items: [], hint: '检索失败，可稍后单独重试' }));
    })).then((all) => {
      if (canceled) return;
      const next = {};
      all.forEach(({ slot, items, hint }) => {
        next[slot.uid] = { items, hint, selectedId: items.length ? items[0].id : null, skipped: false };
      });
      setResults(next);
      setLoading(false);
    });
    return () => { canceled = true; };
  }, [visible, slots, contextText]);

  const choose = (uid, id) => setResults((prev) => ({ ...prev, [uid]: { ...prev[uid], selectedId: id, skipped: false } }));
  const toggleSkip = (uid) => setResults((prev) => ({ ...prev, [uid]: { ...prev[uid], skipped: !prev[uid].skipped } }));

  const chosenCount = Object.values(results).filter((r) => r && !r.skipped && r.selectedId && r.items.some((i) => i.id === r.selectedId)).length;

  const apply = () => {
    const picks = [];
    Object.entries(results).forEach(([uid, r]) => {
      if (!r || r.skipped || !r.selectedId) return;
      const item = r.items.find((i) => i.id === r.selectedId);
      if (item) picks.push({ uid, item });
    });
    if (!picks.length) { Toast.info('没有选中任何照片'); return; }
    onApply(picks);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title="AI 配图 · 确认后替换占位图"
      onCancel={onClose}
      footer={null}
      width={720}
    >
      <div className="aif-intro">按每张占位图的语义（{slots.map((s) => s.semantic).slice(0, 3).join(' / ')}{slots.length > 3 ? '…' : ''}）从全库智能检索，默认选第 1 张，可换选或跳过。</div>
      {loading ? <div className="ppk-empty">AI 正在为 {slots.length} 张占位图检索照片…（首次约 5~15 秒）</div> : null}
      {!loading && slots.map((slot) => {
        const r = results[slot.uid] || { items: [], skipped: false };
        return (
          <div key={slot.uid} className="aif-slot">
            <div className="aif-slot-head">
              <span className="aif-slot-name">{slot.semantic}</span>
              {r.hint ? <span className="aif-slot-hint">{r.hint}</span> : null}
              <button type="button" className={`aif-skip${r.skipped ? ' is-on' : ''}`} onClick={() => toggleSkip(slot.uid)}>
                {r.skipped ? '已跳过（点击恢复）' : '跳过此图'}
              </button>
            </div>
            {r.items.length ? (
              <div className="aif-cands">
                {r.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={`aif-cand${(!r.skipped && r.selectedId === it.id) ? ' is-selected' : ''}`}
                    onClick={() => choose(slot.uid, it.id)}
                    title={`${it.description || ''}${it.projectName ? `（${it.projectName}）` : ''}`}
                  >
                    <img src={it.thumbUrl} alt={it.description || `#${it.id}`} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="aif-none">没有检索到匹配照片，已跳过——可稍后用「AI 搜图」手动配</div>
            )}
          </div>
        );
      })}
      {!loading ? (
        <div className="aif-actions">
          <button type="button" className="tpl-btn is-primary" disabled={!chosenCount} onClick={apply}>
            替换 {chosenCount} 张占位图
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
