function aborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
}

function pause(ms, signal) {
  return new Promise((resolve,reject) => {
    const finish = () => { signal?.removeEventListener('abort',cancel); resolve(); };
    const timer = setTimeout(finish,ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort',cancel);
      reject(signal.reason || new DOMException('Aborted','AbortError')); };
    signal?.addEventListener('abort',cancel,{ once: true });
    if (signal?.aborted) cancel();
  });
}

// Refresh only the small, cached search result; inference runs in the durable backend queue.
export async function watchVisualSearch(execute, { signal, onProgress, page = 1, maxWaitMs = 120000,
  wait = pause, now = Date.now, visible = () => typeof document === 'undefined' || !document.hidden } = {}) {
  aborted(signal);
  let result = await execute(onProgress);
  let failures = 0;
  const deadline = now()+maxWaitMs;
  while (page === 1 && typeof onProgress === 'function' && result.search?.visual?.pending > 0
    && !result.search.visual.unavailable && now()<deadline) {
    const visual = result.search.visual;
    onProgress({ type: 'status', phase: 'verifying', search: result.search });
    await wait(Math.max(1000,Math.min(10000,Number(visual.retryAfterMs)||4000)),signal);
    aborted(signal);
    if (!visible()) continue;
    let next;
    try { next = await execute(undefined); failures = 0; }
    catch (error) {
      aborted(signal);
      if ([401,403].includes(Number(error?.status))) throw error;
      if (++failures<3) continue;
      result = {...result,search:{...result.search,visual:{...result.search.visual,refreshFailed:true}}};
      break;
    }
    aborted(signal);
    result = next;
    // A polling response replaces one complete page, never briefly clearing it to its first eight photos.
    onProgress({ type: 'results', data: result });
  }
  if (result.search?.visual?.pending > 0) result = { ...result, search: { ...result.search,
    visual: { ...result.search.visual, watchPaused: true } } };
  return result;
}
