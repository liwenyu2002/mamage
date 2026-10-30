import React from 'react';

export default function CampusLoginQr() {
  const [revision, setRevision] = React.useState(0);
  const [state, setState] = React.useState({ phase: 'loading' });
  const stop = React.useRef(() => {});
  React.useEffect(() => {
    const returned = event => { if (event.persisted) setRevision(value => value + 1); };
    window.addEventListener('pageshow', returned);
    return () => window.removeEventListener('pageshow', returned);
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    let canceled = false, terminal = false, attempt, timer, expiryTimer, navigating = false;
    const cancel = id => fetch(`/api/auth/iam/qr/${id}/cancel`, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
    async function post(path, body = {}, timeout = 30000) {
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      const deadline = setTimeout(abort, timeout);
      try {
        const response = await fetch(path, { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: request.signal });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error('QR unavailable'), { expired: result.error === 'IAM_QR_EXPIRED' });
        return result;
      } finally { clearTimeout(deadline); controller.signal.removeEventListener('abort', abort); }
    }
    function finish(phase) {
      terminal = true;
      clearTimeout(timer); clearTimeout(expiryTimer);
      if (!canceled) setState(current => ({ ...current, phase }));
    }
    stop.current = () => { finish('fallback'); controller.abort(); if (attempt) void cancel(attempt); };
    async function poll() {
      if (canceled || terminal || navigating) return;
      try {
        const result = await post(`/api/auth/iam/qr/${attempt}/status`);
        if (canceled || terminal) return;
        if (result.phase === 'ready') {
          if (result.completeUrl !== `/api/auth/iam/qr/${attempt}/complete`) throw new Error('Invalid completion');
          navigating = true; finish('ready'); window.location.assign(result.completeUrl);
        } else if (result.phase === 'waiting') timer = setTimeout(poll, 1500);
        else finish(result.phase === 'expired' ? 'expired' : 'fallback');
      } catch (e) { if (!canceled && !terminal) finish(e.expired ? 'expired' : 'fallback'); }
    }
    setState({ phase: 'loading' });
    // Defer startup so React's development effect replay cannot create two challenges.
    timer = setTimeout(async () => {
      try {
        const result = await post('/api/auth/iam/qr', { returnTo: window.location.pathname + window.location.search }, 55000);
        if (!/^[\w-]{43}$/.test(result.id) || result.imageUrl !== `/api/auth/iam/qr/${result.id}/image`
          || !(result.expiresAt > Date.now())) throw new Error('Invalid QR challenge');
        attempt = result.id;
        if (canceled) { void cancel(attempt); return; }
        setState({ phase: 'waiting', image: result.imageUrl });
        expiryTimer = setTimeout(() => { finish('expired'); controller.abort(); void cancel(attempt); }, result.expiresAt - Date.now());
        void poll();
      } catch { if (!canceled) finish('fallback'); }
    }, 0);
    return () => {
      canceled = true; clearTimeout(timer); clearTimeout(expiryTimer); controller.abort();
      if (attempt && !navigating) void cancel(attempt);
    };
  }, [revision]);
  const pending = state.phase === 'loading' || state.phase === 'ready';
  return <div className="auth-campus-qr">
    <div className="auth-qr-frame" aria-busy={pending}>
      {state.phase === 'waiting' ? <img src={state.image} alt="校园登录二维码" width="224" height="224"
        onError={() => stop.current()} /> :
        <div className="auth-qr-state" role="status">
          {pending ? <span className="mamage-button-spinner" aria-hidden="true" /> : null}
          <span>{state.phase === 'loading' ? '正在获取二维码' : state.phase === 'ready' ? '已确认，正在登录' :
            state.phase === 'expired' ? '二维码已过期' : '二维码暂不可用'}</span>
          {!pending && <button className="auth-text-button" type="button" onClick={() => setRevision(value => value + 1)}>刷新二维码</button>}
        </div>}
    </div>
    <p className="auth-qr-caption">使用钉钉扫一扫登录</p>
  </div>;
}
