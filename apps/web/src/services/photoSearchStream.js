export async function readPhotoSearchStream(response, { signal, onProgress, rewrite = value => value } = {}) {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    let result;
    try { result = rewrite(await response.json()); } catch { throw Error('检索服务暂不可用，请重试。'); }
    if (!Array.isArray(result?.list) || !Number.isFinite(result?.total)) throw Error('检索结果格式异常。');
    onProgress?.({ type: 'results', data: result });
    return result;
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Error('检索连接不可用，请重试。');
  const decoder = new TextDecoder();
  const photos = new Map();
  let pending = '';
  let result = null;
  let snapshot = null;
  const checkActive = () => { if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError'); };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  function accept(line) {
    checkActive();
    if (!line.trim()) return;
    let event;
    try { event = rewrite(JSON.parse(line)); } catch { throw Error('检索连接格式异常。'); }
    if (event.type === 'heartbeat') return;
    if (result) throw Error('检索连接返回了重复结果。');
    if (event.type === 'error') throw Error('检索暂时中断，已显示的结果可以继续查看。');
    if (event.type === 'results') {
      if (!Array.isArray(event.data?.list)) throw Error('检索结果格式异常。');
      for (const photo of event.data.list) {
        if (!photo || photo.id === undefined || photo.id === null) throw Error('检索结果缺少照片编号。');
        photos.set(String(photo.id), photo);
      }
      if (photos.size > 200) throw Error('检索结果超过单页上限。');
      snapshot = { ...event.data, list: [...photos.values()] };
      onProgress?.({ ...event, data: snapshot });
    } else if (event.type === 'status') onProgress?.(event);
    else if (event.type === 'complete') {
      if (!event.data || !Number.isFinite(event.data.total) || event.data.total < 0) throw Error('检索结果不完整。');
      result = { ...event.data, list: [...photos.values()] };
    } else throw Error('检索连接格式异常。');
  }
  try {
    checkActive();
    while (true) {
      const { value, done } = await reader.read();
      checkActive();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        if (newline > 1024 * 1024) throw Error('检索数据过大。');
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1); accept(line);
      }
      if (pending.length > 1024 * 1024) throw Error('检索数据过大。');
      if (result) break;
      if (done) break;
    }
    if (pending.trim()) accept(pending);
    if (!result) throw Error('检索连接中断，请重试。');
    return result;
  } catch (error) {
    if (snapshot) error.partialResult = snapshot;
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
