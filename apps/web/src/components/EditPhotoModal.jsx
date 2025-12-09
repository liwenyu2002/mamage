import React from 'react';
import { Modal, Input, TextArea, Button, Toast, Spin } from '@douyinfe/semi-ui';
import { getToken } from '../services/authService';
import { BASE_URL } from '../services/request';

function EditPhotoModal({
  visible,
  onClose,
  photo,
  onSuccess,
}) {
  const [description, setDescription] = React.useState('');
  const [tagsInput, setTagsInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  // 初始化表单数据
  React.useEffect(() => {
    if (visible && photo) {
      setDescription(photo.description || '');
      // 如果tags是数组，用逗号分隔；如果是字符串，直接显示
      const tags = Array.isArray(photo.tags) ? photo.tags.join(',') : (photo.tags || '');
      setTagsInput(tags);
    }
  }, [visible, photo]);

  const handleSave = async () => {
    if (!photo || !photo.id) {
      Toast.error('照片信息不完整');
      return;
    }

    setLoading(true);
    try {
      const token = getToken();
      if (!token) {
        Toast.error('未登录，请先登录');
        setLoading(false);
        return;
      }

      // 将逗号分隔的标签转为数组
      const tagsArray = tagsInput
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

      const payload = {
        description: description || null,
        tags: tagsArray.length > 0 ? tagsArray : null,
      };

      const url = `${BASE_URL || ''}/api/photos/${photo.id}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        Toast.error('权限不足，仅管理员可编辑');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        Toast.error(`更新失败: ${errText}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      Toast.success('照片信息已更新');
      onSuccess && onSuccess(data);
      onClose();
    } catch (err) {
      console.error('编辑照片失败:', err);
      Toast.error(`编辑失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="修改照片信息"
      visible={visible}
      onOk={handleSave}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      okButtonProps={{ loading }}
      style={{ maxHeight: '90vh', overflowY: 'auto' }}
    >
      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>描述</label>
            <TextArea
              value={description}
              onChange={setDescription}
              placeholder="输入照片描述"
              rows={4}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              标签 <span style={{ fontSize: '12px', color: '#999' }}>(逗号分隔)</span>
            </label>
            <Input
              value={tagsInput}
              onChange={setTagsInput}
              placeholder="输入标签，用逗号分隔，例如: 风景,建筑,黑白"
            />
          </div>
        </div>
      </Spin>
    </Modal>
  );
}

export default EditPhotoModal;
