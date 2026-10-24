import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/global.css';
import '../../src/liquidGlass.css';
import '../../src/newsWriter.css';
import OperationsPanel from '../../src/OperationsPanel';
import NewsParagraphTools from '../../src/NewsParagraphTools';

const initial = '# 摄影交流\n\n20名同学在报告厅交流摄影作品。\n\n教师对学生作品进行点评。';
const form = { sourceMaterial: '20名同学在报告厅交流摄影作品。教师对学生作品进行点评。' };
const confirmedNames = [];
function Fixture() {
  const [markdown, setMarkdown] = React.useState(() => localStorage.getItem('hardening-body') || initial);
  React.useEffect(() => localStorage.setItem('hardening-body', markdown), [markdown]);
  return <main style={{ maxWidth: 960, margin: '24px auto', padding: 16 }}>
    <OperationsPanel />
    <section className="ai-news-writer"><textarea aria-label="正文" style={{ width: '100%', minHeight: 160 }} value={markdown} onChange={e => setMarkdown(e.target.value)} />
      <NewsParagraphTools markdown={markdown} form={form} confirmedNames={confirmedNames} interviewText=""
        storageKey="hardening-user-1:workspace-1:press"
        onApply={proposal => setMarkdown(previous => previous === proposal.base
          ? previous.slice(0, proposal.start) + proposal.proposal + previous.slice(proposal.end) : previous)} />
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
