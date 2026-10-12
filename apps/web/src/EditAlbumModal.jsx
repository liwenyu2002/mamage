import React from 'react';
import { Button, MotionModal } from './ui';
import AlbumDetailsFields from './AlbumDetailsFields';
import { updateProject } from './services/projectService';
import './CreateAlbumModal.css';

export default function EditAlbumModal({ album, headers, onClose, onSaved }) {
  const [title, setTitle] = React.useState(album.name || album.title || '');
  const [description, setDescription] = React.useState(album.description || '');
  const [eventDate, setEventDate] = React.useState(album.eventDate ? new Date(album.eventDate) : null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const pending = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = async () => {
    if (pending.current || !title.trim()) return;
    pending.current = true; setSaving(true); setError('');
    const date = eventDate instanceof Date
      ? `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`
      : eventDate ? String(eventDate).slice(0, 10) : null;
    const payload = { projectName: title.trim(), description: description.trim(), eventDate: date };
    try {
      await updateProject(album.id, payload, { headers });
      if (alive.current) onSaved({ ...album, name: payload.projectName, title: payload.projectName,
        description: payload.description, eventDate: date, year: String(new Date(date || album.createdAt).getFullYear()), updatedAt: new Date().toISOString() });
    } catch (failure) {
      let message = '保存失败，请稍后重试';
      try { message = JSON.parse(failure.body).message || message; } catch (_) { /* Keep a readable fallback. */ }
      if (alive.current) setError(message);
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return <MotionModal visible title="编辑相册" width={600} className="album-form-modal cam-modal"
    onCancel={() => { if (!pending.current) onClose(); }} footer={null}>
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <AlbumDetailsFields title={title} onTitleChange={setTitle} description={description} onDescriptionChange={setDescription}
        eventDate={eventDate} onEventDateChange={setEventDate} showTags={false} disabled={saving} />
      {error && <p className="desktop-save-error" role="alert">{error}</p>}
      <div className="acp-drop-confirm-actions"><Button disabled={saving} onClick={onClose}>取消</Button>
        <Button type="primary" theme="neu" loading={saving} disabled={!title.trim()} onClick={save}>保存相册</Button></div>
    </form>
  </MotionModal>;
}
