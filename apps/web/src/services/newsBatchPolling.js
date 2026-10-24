import { isNewsBatchDone } from '../utils/newsWriterState';

function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function pollNewsBatch({ id, getBatch, onResponse, onError, signal, intervalMs = 2500,
  hiddenIntervalMs = 15000, requestTimeoutMs = 20000, isHidden = () => document.hidden }) {
  let failures = 0;
  while (!signal.aborted) {
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, requestTimeoutMs);
    try {
      const response = await getBatch(id, { signal: requestController.signal });
      if (signal.aborted) return;
      await onResponse(response, () => !signal.aborted);
      if (signal.aborted) return;
      failures = 0;
      onError(null);
      if (isNewsBatchDone(response.status)) return;
    } catch (error) {
      if (signal.aborted) return;
      const fatal = [401, 403, 404].includes(error.status);
      onError(error, fatal);
      if (fatal) return;
      failures += 1;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
    await delay(isHidden() ? hiddenIntervalMs : Math.min(15000, intervalMs * 2 ** failures), signal);
  }
}
