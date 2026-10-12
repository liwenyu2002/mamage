import React from 'react';
import CreateAlbumModal from '../CreateAlbumModal';
import AlbumDetailsFields from '../AlbumDetailsFields';
import { Button, MotionModal } from '../ui';
import { setPermissions } from '../permissions/permissionStore';

setPermissions(['projects.create']);

export default function AlbumFormPrototype() {
  const [mode, setMode] = React.useState('create');
  const [title, setTitle] = React.useState('2026 秋季开学典礼');
  const [description, setDescription] = React.useState('记录开学典礼当天的精彩瞬间。');
  const [date, setDate] = React.useState('2026-09-27');
  const [tags, setTags] = React.useState(['开学典礼', '校园活动']);

  return (
    <main style={{ minHeight: '100dvh', padding: 28, background: 'linear-gradient(130deg, #c9d1d2, #d8d5e5 55%, #d3dfd1)' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={() => setMode('create')}>新建相册</Button>
        <Button onClick={() => setMode('edit')}>编辑相册</Button>
      </div>
      <p style={{ color: '#374147', fontSize: 12 }}>本地交互预览，不会修改线上数据</p>
      <CreateAlbumModal visible={mode === 'create'} onClose={() => setMode('')} createProject={async () => ({})} />
      <MotionModal
        title="编辑相册"
        className="album-form-modal detail-edit-modal"
        width={560}
        visible={mode === 'edit'}
        onCancel={() => setMode('')}
        onOk={() => setMode('')}
        okText="保存"
      >
        <div className="detail-edit-modal-body">
          <AlbumDetailsFields
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            eventDate={date}
            onEventDateChange={setDate}
            tags={tags}
            onTagsChange={setTags}
          />
        </div>
      </MotionModal>
    </main>
  );
}
