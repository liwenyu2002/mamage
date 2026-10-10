import React from 'react';
import { Button, Input, SegmentedControl, Toast } from './ui';
import { IconSearch } from './ui/icons';
import { getPersonFaces, listFacePersons, mergeFacePersons } from './services/photoService';
import './FacePersonMerge.css';

function personLabel(person) {
  const id = person?.personId || person?.id || '';
  return String(person?.displayName || person?.name || '').trim() || `人物 #${id}`;
}

function useFaceSample(personId) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState({ personId: '', loading: false, ready: false, faces: [], total: 0, error: '' });

  React.useEffect(() => {
    if (!personId) return undefined;
    let active = true;
    setState({ personId, loading: true, ready: false, faces: [], total: 0, error: '' });
    getPersonFaces({ personId, page: 1, pageSize: 12 }).then((data) => {
      if (!active) return;
      const faces = Array.isArray(data?.faces) ? data.faces : [];
      setState({ personId, loading: false, ready: true, faces: faces.slice(0, 4), total: Number(data?.total) || faces.length, error: '' });
    }).catch((error) => {
      if (!active) return;
      setState({ personId, loading: false, ready: false, faces: [], total: 0, error: error?.message || '人脸预览加载失败' });
    });
    return () => { active = false; };
  }, [personId, attempt]);

  return [state.personId === personId ? state : { personId, loading: Boolean(personId), ready: false, faces: [], total: 0, error: '' }, () => setAttempt((value) => value + 1)];
}

function FaceSample({ person, sample, onRetry }) {
  return (
    <div className="person-merge-sample">
      <div className="person-merge-sample-heading">
        <strong>{personLabel(person)}</strong>
        <span>#{person?.personId || person?.id} · {sample.ready ? `${sample.total} 张人脸` : sample.error ? '读取失败' : '正在读取人脸'}</span>
      </div>
      {sample.error ? (
        <div className="person-merge-sample-error">
          <span>{sample.error}</span>
          <Button size="small" theme="borderless" onClick={onRetry}>重试</Button>
        </div>
      ) : (
        <div className="person-merge-faces" aria-label={`${personLabel(person)}的人脸预览`}>
          {sample.loading ? <span className="person-merge-face-placeholder">读取中</span> : null}
          {sample.ready && !sample.faces.length ? <span className="person-merge-face-placeholder">暂无人脸</span> : null}
          {sample.faces.map((face) => (
            face.avatarDataUrl || face.thumbUrl ? (
              <img key={face.faceId} src={face.avatarDataUrl || face.thumbUrl} alt="" loading="lazy" decoding="async" />
            ) : <span key={face.faceId} className="person-merge-face-placeholder">无图</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FacePersonMerge({ currentPerson, initialQuery = '', onCancel, onMerged }) {
  const currentId = String(currentPerson?.personId || '');
  const [query, setQuery] = React.useState(() => initialQuery.trim());
  const [searchTerm, setSearchTerm] = React.useState(() => initialQuery.trim());
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState('');
  const [listAttempt, setListAttempt] = React.useState(0);
  const [selected, setSelected] = React.useState(null);
  const [keep, setKeep] = React.useState('selected');
  const [step, setStep] = React.useState('select');
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [submitError, setSubmitError] = React.useState('');
  const [currentSample, retryCurrent] = useFaceSample(currentId);
  const selectedId = String(selected?.personId || selected?.id || '');
  const [selectedSample, retrySelected] = useFaceSample(selectedId);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (query.trim() !== searchTerm) return undefined;
    let active = true;
    setListLoading(true);
    setListError('');
    listFacePersons({ q: searchTerm, page, pageSize: 20 }).then((data) => {
      if (!active) return;
      const next = (Array.isArray(data?.list) ? data.list : []).filter((person) => String(person.personId || person.id) !== currentId);
      setRows((previous) => page === 1 ? next : [
        ...previous,
        ...next.filter((person) => !previous.some((old) => String(old.personId || old.id) === String(person.personId || person.id))),
      ]);
      setHasMore(Boolean(data?.hasMore));
    }).catch((error) => {
      if (active) setListError(error?.message || '人物列表加载失败');
    }).finally(() => {
      if (active) setListLoading(false);
    });
    return () => { active = false; };
  }, [currentId, query, searchTerm, page, listAttempt]);

  const onQueryChange = (value) => {
    setQuery(value);
    setPage(1);
    setRows([]);
    setSelected(null);
    setStep('select');
  };

  const previewReady = currentSample.ready && selectedSample.ready;
  const target = keep === 'current' ? currentPerson : selected;
  const source = keep === 'current' ? selected : currentPerson;
  const sourceCount = keep === 'current' ? selectedSample.total : currentSample.total;

  const confirmMerge = async () => {
    if (submittingRef.current || !previewReady || !selectedId || selectedId === currentId) return;
    const targetPersonId = keep === 'current' ? currentId : selectedId;
    const sourcePersonId = keep === 'current' ? selectedId : currentId;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await mergeFacePersons({ targetPersonId, sourcePersonIds: [sourcePersonId],
        referenceFaceIds: [...currentSample.faces, ...selectedSample.faces]
          .filter((face) => face.avatarDataUrl).map((face) => face.faceId),
      });
      try { onMerged?.(result); } catch (error) { console.warn('refresh merged person failed', error); }
      Toast.success(`已合并 ${result?.movedFaces ?? sourceCount} 张人脸，已记录纠正`);
    } catch (error) {
      setSubmitError(error?.userMessage || error?.message || '合并失败，请重试');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="person-merge" aria-label="合并人物">
      <div className="person-merge-heading">
        <strong>合并人物</strong>
        <span>{step === 'confirm' ? '确认保留与删除的档案' : '选择同一个人的另一份档案'}</span>
      </div>

      {step === 'select' ? (
        <>
          <div className="person-merge-search">
            <IconSearch aria-hidden="true" />
            <Input value={query} onChange={onQueryChange} placeholder="搜索姓名或人物 ID" aria-label="搜索待合并人物" />
          </div>
          <div className="person-merge-results" aria-label="人物搜索结果">
            {rows.map((person) => {
              const id = String(person.personId || person.id);
              const isSelected = id === selectedId;
              return (
                <button key={id} type="button" className={`person-merge-result${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected} onClick={() => { setSelected(person); setSubmitError(''); }}>
                  <span className="person-merge-result-name">{personLabel(person)}</span>
                  <span className="person-merge-result-meta">#{id} · {person.faceCount} 张人脸</span>
                </button>
              );
            })}
            {listLoading ? <span className="person-merge-list-message">正在查找人物…</span> : null}
            {!listLoading && !listError && !rows.length ? <span className="person-merge-list-message">没有其他人物档案</span> : null}
            {listError ? (
              <div className="person-merge-list-message is-error">
                <span>{listError}</span>
                <Button size="small" theme="borderless" onClick={() => setListAttempt((value) => value + 1)}>重试</Button>
              </div>
            ) : null}
            {hasMore && !listLoading && !listError ? (
              <Button size="small" theme="borderless" onClick={() => setPage((value) => value + 1)}>加载更多</Button>
            ) : null}
          </div>

          {selected ? (
            <>
              <div className="person-merge-compare">
                <FaceSample person={currentPerson} sample={currentSample} onRetry={retryCurrent} />
                <FaceSample person={selected} sample={selectedSample} onRetry={retrySelected} />
              </div>
              <SegmentedControl label="保留的人物档案" value={keep} onChange={setKeep} options={[
                { value: 'selected', label: '保留选中人物' },
                { value: 'current', label: '保留当前人物' },
              ]} />
            </>
          ) : null}
        </>
      ) : (
        <div className="person-merge-confirm">
          <div><span>保留</span><strong>{personLabel(target)} · #{target?.personId || target?.id}</strong></div>
          <div><span>合并并删除</span><strong>{personLabel(source)} · #{source?.personId || source?.id}</strong></div>
          <p>{sourceCount} 张人脸将转入保留的人物档案。照片不会删除，但原人物档案会被删除，此操作无法一键撤销。</p>
        </div>
      )}

      {submitError ? <div className="person-merge-submit-error" role="alert">{submitError}</div> : null}
      <div className="person-merge-actions">
        <Button size="small" theme="borderless" disabled={submitting} onClick={step === 'confirm' ? () => setStep('select') : onCancel}>
          {step === 'confirm' ? '返回' : '取消'}
        </Button>
        {step === 'confirm' ? (
          <Button size="small" theme="solid" type="danger" loading={submitting} onClick={confirmMerge}>确认合并</Button>
        ) : (
          <Button size="small" theme="solid" type="primary" disabled={!selected || !previewReady || selectedId === currentId}
            onClick={() => { setSubmitError(''); setStep('confirm'); }}>下一步</Button>
        )}
      </div>
    </section>
  );
}
