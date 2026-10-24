import React from 'react';
import { IconChevronRight } from './ui/icons';

function PersonObservations({ photoId, loadPeople }) {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!open || !photoId || !loadPeople) return undefined;
    const controller = new AbortController();
    setResult(null);
    setError('');
    let timer;
    let attempt = 0;
    const load = async () => {
      const deadline = setTimeout(() => {
        if (!controller.signal.aborted) { setError('人物观察暂不可用'); setResult(null); controller.abort(); }
      }, 8000);
      try {
        const value = await loadPeople(photoId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(value);
        setError('');
        if (value?.status === 'incomplete' && ++attempt < 15) timer = setTimeout(load, 4000);
      } catch (err) {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(err?.status === 403 ? '暂无人物查看权限' : '人物观察暂不可用');
        }
      } finally { clearTimeout(deadline); }
    };
    void load();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, photoId, loadPeople]);
  const people = Array.isArray(result?.people) ? result.people : [];
  return (
    <details className="viewer-photo-details viewer-person-observations" onClick={event => event.stopPropagation()}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>人物观察<IconChevronRight aria-hidden="true" /></summary>
      {open ? <div className="viewer-person-observation-list" aria-live="polite">
        {error || (!result ? '加载中' : !people.length ? '暂无人物观察' : '')}
        {people.map(person => <div className="viewer-person-observation" key={person.faceId}>
          <strong>{person.personName || `人物 ${person.faceNo || ''}`}</strong>
          {person.personName && person.identityStatus !== 'confirmed' ? <span className="viewer-person-position">识别匹配</span> : null}
          {person.status === 'ready' ? <>
            {person.position ? <span className="viewer-person-position">{person.position}</span> : null}
            {[['衣着', [person.clothing?.upper, person.clothing?.lower].filter(Boolean).join('，')],
              ['动作', (person.actions || []).join('，')], ['手持物', (person.heldObjects || []).join('，')]]
              .filter(([, value]) => value).map(([label, value]) => <div key={label}><b>{label}</b><span>{value}</span></div>)}
            {person.description ? <div className="viewer-person-observation-description">{person.description}</div> : null}
          </> : <span className="viewer-person-position">{person.status === 'uncertain' ? '头身关系不确定，未绑定衣着与动作' : '尚未分析'}</span>}
        </div>)}
      </div> : null}
    </details>
  );
}

export default function PhotoDescription({ photoId, summary, initialDetail, initialPeopleEnabled, analysisStatus, loadPhoto, loadPeople }) {
  const [detail, setDetail] = React.useState(initialDetail || '');
  const [peopleEnabled, setPeopleEnabled] = React.useState(initialPeopleEnabled === true);
  React.useEffect(() => {
    setDetail(initialDetail || '');
    setPeopleEnabled(initialPeopleEnabled === true);
    if (!photoId || !loadPhoto || initialDetail !== undefined
      || ['pending', 'queued', 'running', 'processing'].includes(analysisStatus)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // Only the open photo requests this field; gallery lists stay lightweight.
    Promise.resolve().then(() => loadPhoto(photoId, { signal: controller.signal })).then(photo => {
      if (!controller.signal.aborted) {
        setDetail(photo?.detailedDescription || '');
        setPeopleEnabled(photo?.personObservationsEnabled === true);
      }
    }).catch(() => {}).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [photoId, initialDetail, initialPeopleEnabled, analysisStatus, loadPhoto]);

  return (
    <>
      {summary ? <div className="viewer-description">{summary}</div> : null}
      {detail ? (
        <details className="viewer-photo-details" onClick={event => event.stopPropagation()}>
          <summary>详细描述<IconChevronRight aria-hidden="true" /></summary>
          <p>{detail}</p>
        </details>
      ) : null}
      {peopleEnabled && loadPeople ? <PersonObservations key={photoId} photoId={photoId} loadPeople={loadPeople} /> : null}
    </>
  );
}
