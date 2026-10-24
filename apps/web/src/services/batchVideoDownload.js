import { request } from './request';
import { createVideoDownloadQueue, canSaveVideoDirectory } from './videoDownloadQueue';
import { startNativeZipDownload } from './zipDownload';

export const batchVideoDownload = createVideoDownloadQueue({
  supportsDirectory: () => canSaveVideoDirectory(window),
  pickDirectory: () => window.showDirectoryPicker({ mode: 'readwrite' }),
  manifest: (photoIds, signal, kind) => request(`/api/photos/video-downloads/${kind === 'video' ? 'manifest' : 'summary'}`, { method: 'POST', data: { photoIds }, signal }),
  source: (photoId, signal) => request('/api/photos/video-downloads/source', { method: 'POST', data: { photoId }, signal }),
  nativeZip: (photoIds, signal, options) => startNativeZipDownload({ photoIds, ...options, signal }),
});
