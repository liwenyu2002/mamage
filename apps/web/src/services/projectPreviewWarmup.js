const ready = new Map(), inFlight = new Map(), queue = [];
const MAX_CONCURRENT = 4;
let active = 0;

function drain() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (![...job.consumers].some(consumer => consumer.active)) {
      inFlight.delete(job.src); job.resolve(false); continue;
    }
    active++;
    let image = new Image(), settled = false;
    const finish = success => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null; image.onerror = null;
      image = null;
      if (success) {
        ready.delete(job.src); ready.set(job.src, Date.now() + 120000);
        while (ready.size > 240) ready.delete(ready.keys().next().value);
      }
      inFlight.delete(job.src); active--; job.resolve(success); drain();
    };
    const timer = setTimeout(() => finish(false), 8000);
    image.decoding = 'async'; image.fetchPriority = 'low';
    image.onload = () => {
      const decoding = typeof image?.decode === 'function' ? image.decode() : Promise.resolve();
      decoding.catch(() => {}).then(() => finish(true));
    };
    image.onerror = () => finish(false);
    image.src = job.src;
  }
}

export async function warmProjectPreviewImages(sources, { signal } = {}) {
  if (typeof Image === 'undefined' || signal?.aborted) return [];
  const consumer = { active: true };
  const abort = () => { consumer.active = false; };
  signal?.addEventListener('abort', abort, { once: true });
  const unique = [...new Set(sources.filter(Boolean))];
  try {
    const jobs = unique.map(src => {
      if (ready.get(src) > Date.now()) return true;
      let job = inFlight.get(src);
      if (!job) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        job = { src, promise, resolve, consumers: new Set() };
        inFlight.set(src, job); queue.push(job);
      }
      job.consumers.add(consumer);
      return job.promise;
    });
    drain();
    const results = await Promise.all(jobs);
    return consumer.active ? unique.filter((src, index) => results[index]) : [];
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
