import React from 'react';
import { oidcFrameResult, oidcLoginUrl } from './services/oidcLogin';

export default function OidcLoginFrame({ label, onOpenPage, initialFailure = false, reauthenticate = false }) {
  const frame = React.useRef(null);
  const completed = React.useRef(false);
  const [attempt, setAttempt] = React.useState(0);
  const [status, setStatus] = React.useState(initialFailure ? 'failed' : 'loading');
  const url = React.useMemo(() => oidcLoginUrl(window.location, { embedded: true, reauthenticate }), [reauthenticate]);

  React.useEffect(() => {
    completed.current = false;
    const receive = event => {
      const target = oidcFrameResult(event, frame.current?.contentWindow, window.location.origin);
      if (!target || completed.current) return;
      completed.current = true;
      setStatus('completing');
      window.location.replace(target);
    };
    const loading = setTimeout(() => setStatus(value => value === 'loading' ? 'slow' : value), 15000);
    const expiry = setTimeout(() => setStatus(value => value === 'completing' ? value : 'expired'), 9 * 60000);
    window.addEventListener('message', receive);
    return () => {
      clearTimeout(loading); clearTimeout(expiry);
      window.removeEventListener('message', receive);
    };
  }, [attempt]);

  const retry = () => { setStatus('loading'); setAttempt(value => value + 1); };
  const unavailable = status === 'expired' || status === 'failed';
  return (
    <div className="auth-oidc-embed">
      <div className="auth-oidc-frame-wrap" aria-busy={status === 'loading' || status === 'completing'}>
        {!unavailable && <iframe key={attempt} ref={frame} src={url} title={label || '研究院统一身份认证'}
          className="auth-oidc-frame" referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
          onLoad={() => {
            if (completed.current) return;
            try {
              // 同源 API 的错误页不是已加载的认证界面；跨域 IdP 内容不能、也不需要读取。
              if (frame.current?.contentWindow.location.pathname === '/api/auth/oidc/login') {
                setStatus('failed'); return;
              }
            } catch { /* 正常的跨域认证界面 */ }
            setStatus(value => value === 'completing' ? value : 'visible');
          }} onError={() => setStatus('failed')} />}
        {(status === 'loading' || status === 'completing' || unavailable) && (
          <div className="auth-oidc-frame-state" role="status">
            {!unavailable && <span className="mamage-button-spinner" aria-hidden="true" />}
            <span>{status === 'expired' ? '登录已过期' : status === 'failed' ? '暂时无法显示登录界面'
              : status === 'completing' ? '正在进入 MaMage' : '正在连接研究院登录'}</span>
            {unavailable && <button type="button" className="auth-text-button" onClick={retry}>重新加载</button>}
          </div>
        )}
      </div>
      {reauthenticate && <p className="auth-oidc-slow">如显示已登录的钉钉账号，可点击登录框左上角返回，切换扫码登录。</p>}
      {status === 'slow' && <p className="auth-oidc-slow" role="status">加载较慢，可使用完整登录页</p>}
      <div className="auth-oidc-frame-actions">
        <button type="button" className="auth-text-button" onClick={retry} disabled={status === 'completing'}>刷新登录</button>
        <button type="button" className="auth-secondary-link" onClick={onOpenPage} disabled={status === 'completing'}>打开完整登录页</button>
      </div>
    </div>
  );
}
