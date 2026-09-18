import React from 'react';
import { ARTICLE_TEMPLATES, extractPlaceholders } from './articleTemplates';

// 推文模板面板：结构化模板（占位文 + 占位图）一键套用；AI 按简报填充全部占位符。
// 纯展示与输入收集，套用/填充动作由 WechatComposer 注入（要走画布历史栈与 setDoc）。
export default function TemplatePanel({
  onApplyTemplate,
  onAppendTemplate,
  appliedTemplateKey,
  docPlaceholderText,
  aiBusy,
  onAiFill,
  aiBrief,
  onAiBriefChange,
}) {
  const slots = React.useMemo(() => extractPlaceholders(docPlaceholderText), [docPlaceholderText]);
  const [aiOpen, setAiOpen] = React.useState(false);

  return (
    <div className="tpl-panel">
      <div className="tpl-panel-hint">
        模板包含<Text code>占位文</Text>与<Text code>占位图</Text>：套用后可用 AI 按简报一键填充文案，图片在右侧「相册」里点占位图替换。
      </div>

      <div className="tpl-list">
        {ARTICLE_TEMPLATES.map((tpl) => (
          <div key={tpl.key} className={`tpl-card${appliedTemplateKey === tpl.key ? ' is-applied' : ''}`}>
            <div className="tpl-card-head">
              <span className="tpl-card-icon" aria-hidden="true">{tpl.icon}</span>
              <div className="tpl-card-title-row">
                <div className="tpl-card-name">{tpl.name}</div>
                {appliedTemplateKey === tpl.key ? <span className="tpl-card-badge">当前</span> : null}
              </div>
            </div>
            <div className="tpl-card-desc">{tpl.desc}</div>
            <div className="tpl-card-meta">
              {extractPlaceholders(tpl.markdown).slice(0, 4).map((k) => (
                <span key={k} className="tpl-chip">{k}</span>
              ))}
              {extractPlaceholders(tpl.markdown).length > 4 ? <span className="tpl-chip is-more">…</span> : null}
            </div>
            <div className="tpl-card-actions">
              <button type="button" className="tpl-btn is-primary" onClick={() => onApplyTemplate(tpl)}>使用（替换画布）</button>
              <button type="button" className="tpl-btn" onClick={() => onAppendTemplate(tpl)}>追加</button>
            </div>
          </div>
        ))}
      </div>

      <div className="tpl-ai">
        <button
          type="button"
          className="tpl-ai-toggle"
          onClick={() => setAiOpen((v) => !v)}
          aria-expanded={aiOpen}
        >
          ✨ AI 填充占位文{slots.length ? `（待填 ${slots.length} 处）` : ''}
        </button>
        {aiOpen ? (
          <div className="tpl-ai-body">
            {slots.length ? (
              <div className="tpl-ai-slots">
                {slots.map((k) => <span key={k} className="tpl-chip">{k}</span>)}
              </div>
            ) : (
              <div className="tpl-ai-empty">画布里暂无 {'{{占位符}}'}。先套用上面的模板，或直接输入简报让 AI 起草。</div>
            )}
            <textarea
              className="tpl-ai-brief"
              value={aiBrief}
              onChange={(e) => onAiBriefChange(e.target.value)}
              placeholder={'活动简报（越具体越好），例如：\n活动名称：2026迎新晚会\n时间：9月20日 19:00\n地点：大学生活动中心\n亮点：无人机开场、院长致辞、抽奖三轮\n数据：演员120人、观众800人'}
              rows={6}
            />
            <button
              type="button"
              className="tpl-btn is-primary is-block"
              disabled={aiBusy}
              onClick={() => onAiFill()}
            >
              {aiBusy ? 'AI 正在撰写…' : '生成并填入模板'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
