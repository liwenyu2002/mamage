const { distributed } = require('./shared_runtime_state');

async function attachVideoProcessingState(photos, { db, enabled = distributed() } = {}) {
  if (!enabled || !Array.isArray(photos)) return photos;
  const ids = [...new Set(photos.filter(photo => photo?.type === 'video' && !(photo.playbackUrl || photo.playback_url || photo.playbackSrc))
    .map(photo => Number(photo.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return photos;
  const states = new Map();
  try {
    for (let offset = 0; offset < ids.length; offset += 250) {
      const [tasks] = await db.query(`SELECT dedupe_key, status FROM runtime_tasks
        WHERE kind IN ('video-postprocess', 'video-playback') AND dedupe_key IN (?)
        AND status IN ('queued', 'running', 'failed')`, [ids.slice(offset, offset + 250).map(String)]);
      for (const task of tasks) {
        const key = String(task.dedupe_key);
        const state = ['queued', 'running'].includes(task.status) ? 'transcoding' : 'failed';
        if (state === 'transcoding' || !states.has(key)) states.set(key, state);
      }
    }
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') console.warn('[video-processing-state]', error.code || error.name);
    return photos;
  }
  return photos.map(photo => {
    if (photo.type !== 'video') return photo;
    const state = photo.playbackUrl || photo.playback_url || photo.playbackSrc ? null : states.get(String(photo.id)) || null;
    return { ...photo, processingStatus: state, processing_status: state };
  });
}

module.exports = { attachVideoProcessingState };
