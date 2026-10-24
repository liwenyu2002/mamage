function createPhotoSearchStream(res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.on('close', abort);
  res.on('error', abort);
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const heartbeat = setInterval(() => {
    if (controller.signal.aborted || res.writableNeedDrain) return;
    try { res.write('{"type":"heartbeat"}\n'); } catch { abort(); }
  }, 15000);
  heartbeat.unref?.();

  async function send(event) {
    controller.signal.throwIfAborted();
    if (res.write(JSON.stringify(event) + '\n')) return;
    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const cancelled = () => { cleanup(); reject(controller.signal.reason); };
      const cleanup = () => { res.off('drain', done); controller.signal.removeEventListener('abort', cancelled); };
      res.once('drain', done);
      controller.signal.addEventListener('abort', cancelled, { once: true });
      if (controller.signal.aborted) cancelled();
    });
  }

  return { signal: controller.signal, send, end: () => res.end(), dispose: () => {
    clearInterval(heartbeat); res.off('close', abort); res.off('error', abort); abort();
  } };
}

module.exports = { createPhotoSearchStream };
