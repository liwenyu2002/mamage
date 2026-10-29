import React from 'react';
import { Input, Button, Toast } from './ui';
import { IconChevronRight } from './ui/icons';
import { campusLoginUrl, autoStartCampusLogin } from './services/iamLogin';
import './AuthPage.css';
import * as authService from './services/authService';

const PASSWORD_RE = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,16}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function validateRegisterInput({ name, email, password }) {
  // name (昵称) 可选
  if (email && !EMAIL_RE.test(email)) return { ok: false, field: 'email', msg: '邮箱格式不正确' };
  if (!password || !PASSWORD_RE.test(password)) return { ok: false, field: 'password', msg: '密码需 8-16 位且同时包含字母和数字' };
  return { ok: true };
}

function validateLoginInput({ email, password }) {
  if (!email || email.trim().length === 0) return { ok: false, msg: '请输入邮箱或学号' };
  if (!password || password.length === 0) return { ok: false, msg: '请输入密码' };
  // 不进行邮箱格式校验，允许学号等其他凭证
  return { ok: true };
}

export default function AuthPage({ onAuthenticated }) {
  const [authProviders, setAuthProviders] = React.useState({ password: true, dingtalk: false, iam: false });
  const [providersLoading, setProvidersLoading] = React.useState(true);
  const [providersFailed, setProvidersFailed] = React.useState(false);
  const [providerRetry, setProviderRetry] = React.useState(0);
  const [loginMode, setLoginMode] = React.useState(null);
  const [redirecting, setRedirecting] = React.useState(false);
  const [loginAlert, setLoginAlert] = React.useState('');
  const initialLoginFailure = React.useRef(/(?:iam|dingtalk)_error=/.test(window.location.hash));
  React.useEffect(() => {
    const returned = () => setRedirecting(false);
    window.addEventListener('pageshow', returned);
    return () => window.removeEventListener('pageshow', returned);
  }, []);
  React.useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    setProvidersLoading(true); setProvidersFailed(false);
    fetch('/api/auth/providers', { signal: controller.signal })
      .then((r) => { if (!r.ok) throw Error('Providers unavailable'); return r.json(); })
      .then((d) => { if (!canceled) setAuthProviders({ password: true, iam: d.iam === true, dingtalk: d.dingtalk === true }); })
      .catch(() => { if (!canceled) setProvidersFailed(true); })
      .finally(() => { clearTimeout(timeout); if (!canceled) setProvidersLoading(false); });
    // 钉钉回调失败时错误信息挂在 hash 上
    try {
      const m = String(window.location.hash || '').match(/(?:dingtalk|iam)_error=([^&]+)/);
      if (m) {
        const code = decodeURIComponent(m[1]);
        const message = code.startsWith('IAM_') ? code === 'IAM_ACCOUNT_LINK_REQUIRED'
          ? '校园账号尚未关联，请联系管理员' : '校园登录未完成，请重试或联系管理员' : code;
        setLoginAlert(message); Toast.error(message);
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }
    return () => { canceled = true; clearTimeout(timeout); controller.abort(); };
  }, [providerRetry]);
  const [active, setActive] = React.useState('login');
  const hasCampusLogin = authProviders.iam || authProviders.dingtalk;
  const currentLoginMode = loginMode || (hasCampusLogin ? 'campus' : 'password');
  React.useEffect(() => {
    if (providersLoading || providersFailed || active !== 'login' || loginMode || initialLoginFailure.current) return;
    try {
      if (autoStartCampusLogin({ providers: authProviders, location: window.location,
        userAgent: navigator.userAgent, storage: window.sessionStorage })) setRedirecting(true);
    } catch { /* Manual login remains available when browser storage is unavailable. */ }
  }, [providersLoading, providersFailed, active, loginMode, authProviders]);
  const beginCampusLogin = () => {
    const url = campusLoginUrl(authProviders, window.location);
    if (!url || redirecting) return;
    setRedirecting(true); window.location.assign(url);
  };
  const [loading, setLoading] = React.useState(false);
  // controlled fields
  const [loginEmail, setLoginEmail] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [regName, setRegName] = React.useState('');
  const [regEmail, setRegEmail] = React.useState('');
  const [regOrgCode, setRegOrgCode] = React.useState('');
  const [regInviteCode, setRegInviteCode] = React.useState('');
  const [regPassword, setRegPassword] = React.useState('');
  const [loginErrors, setLoginErrors] = React.useState({ email: '', password: '', general: '' });
  const [regEmailCode, setRegEmailCode] = React.useState('');
  const [regErrors, setRegErrors] = React.useState({ name: '', email: '', code: '', orgCode: '', password: '', invite: '', general: '' });
  const [codeSending, setCodeSending] = React.useState(false);
  const [codeCooldown, setCodeCooldown] = React.useState(0);
  const commonSuffixes = ['@qq.com', '@163.com', '@gmail.com', '@hotmail.com', '@edu.cn'];
  const [showRegSuggestions, setShowRegSuggestions] = React.useState(false);
  const [regPasswordValid, setRegPasswordValid] = React.useState(false);
  React.useEffect(() => {
    try {
      // prefill invite code from URL ?invite=CODE
      const params = new URLSearchParams(window.location.search);
      const iv = params.get('invite') || params.get('invite_code') || params.get('inviteCode');
      if (iv) setRegInviteCode(iv);
    } catch (e) {
      console.debug('[AuthPage] init error', e);
    }
  }, []);

  React.useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = setTimeout(() => {
      setCodeCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [codeCooldown]);

  // detailed live checks for password
  const passwordChecks = React.useMemo(() => ({
    minMax: (p) => !!p && p.length >= 8 && p.length <= 16,
    hasLetter: (p) => /[A-Za-z]/.test(p),
    hasNumber: (p) => /[0-9]/.test(p),
    allowedChars: (p) => /^[0-9A-Za-z]*$/.test(p),
  }), []);

  const handleLogin = async () => {
    // determine identifier: email or student_no
    const identifier = loginEmail ? loginEmail.trim() : '';
    const password = loginPassword || '';
    if (!identifier) {
      setLoginErrors((prev) => ({ ...prev, general: '请输入邮箱或学号' }));
      return;
    }
    if (!password) {
      setLoginErrors((prev) => ({ ...prev, password: '请输入密码' }));
      return;
    }
    setLoading(true);
    setLoginErrors({ email: '', password: '', general: '' });
    try {
      const payload = { password };
      if (identifier.indexOf('@') !== -1) payload.email = identifier; else payload.student_no = identifier;
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error_code || data.error || 'UNKNOWN_ERROR';
        // Friendly message for authentication failure
        const authFailureCodes = ['INVALID_PASSWORD', 'USER_NOT_FOUND', 'INVALID_CREDENTIALS', 'UNAUTHORIZED'];
        if (res.status === 401 || authFailureCodes.includes(code)) {
          const errMsg = '邮箱或密码错误';
          setLoginErrors((prev) => ({ ...prev, general: errMsg }));
        } else {
          const message = data.message || '登录失败';
          setLoginErrors((prev) => ({ ...prev, general: message }));
        }
        return;
      }

      // success: expect { token, user }
      if (data && data.token) {
        try { localStorage.setItem('mamage_jwt_token', data.token); } catch (e) { console.warn('save token failed', e); }
        const user = data.user || await authService.me();
        Toast.success('登录成功');
        if (typeof onAuthenticated === 'function') onAuthenticated(user);
      } else {
        setLoginErrors((prev) => ({ ...prev, general: '登录未返回 token' }));
      }
    } catch (err) {
      console.error('login failed', err);
      setLoginErrors((prev) => ({ ...prev, general: '网络错误，请稍后重试' }));
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailCode = async () => {
    const email = regEmail ? regEmail.trim() : '';
    if (!email) {
      setRegErrors((prev) => ({ ...prev, email: '请输入邮箱', code: '', general: '' }));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setRegErrors((prev) => ({ ...prev, email: '邮箱格式不正确', code: '', general: '' }));
      return;
    }

    setCodeSending(true);
    setRegErrors((prev) => ({ ...prev, email: '', code: '', general: '' }));
    try {
      const res = await fetch('/api/users/email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'register' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || 'UNKNOWN_ERROR';
        const message = data.message || '验证码发送失败';
        if (code === 'EMAIL_EXISTS') {
          setRegErrors((prev) => ({ ...prev, email: message }));
          return;
        }
        if (code === 'INVALID_EMAIL' || code === 'MISSING_EMAIL') {
          setRegErrors((prev) => ({ ...prev, email: message }));
          return;
        }
        if (code === 'EMAIL_CODE_COOLDOWN') {
          const nextCooldown = Math.max(1, Number(data.cooldownSeconds || 60));
          setCodeCooldown(nextCooldown);
          setRegErrors((prev) => ({ ...prev, code: message }));
          return;
        }
        setRegErrors((prev) => ({ ...prev, general: message }));
        return;
      }
      setCodeCooldown(Math.max(1, Number(data.cooldownSeconds || 60)));
      Toast.success('验证码已发送');
    } catch (err) {
      console.error('send email code failed', err);
      setRegErrors((prev) => ({ ...prev, general: '网络错误，请稍后重试' }));
    } finally {
      setCodeSending(false);
    }
  };

  const handleRegister = async () => {
    const name = regName ? regName.trim() : '';
    const email = regEmail ? regEmail.trim() : '';
    const emailCode = regEmailCode ? regEmailCode.trim() : '';
    const organizationCode = regOrgCode ? regOrgCode.trim().toUpperCase() : '';
    const password = regPassword ? regPassword.trim() : '';

    // client-side checks (backend requires name and password)
    if (!name) {
      setRegErrors((prev) => ({ ...prev, name: '请输入姓名', general: '' }));
      return;
    }
    const pwdOk = /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]{8,16}$/.test(password);
    if (!pwdOk) {
      setRegErrors((prev) => ({ ...prev, password: '密码须为8-16位，且为字母和数字的组合', general: '' }));
      return;
    }
    if (!email) {
      setRegErrors((prev) => ({ ...prev, email: '请输入邮箱', general: '' }));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setRegErrors((prev) => ({ ...prev, email: '邮箱格式不正确', general: '' }));
      return;
    }
    if (!/^\d{6}$/.test(emailCode)) {
      setRegErrors((prev) => ({ ...prev, code: '请输入 6 位邮箱验证码', general: '' }));
      return;
    }
    if (!organizationCode) {
      setRegErrors((prev) => ({ ...prev, orgCode: '请输入组织代号', general: '' }));
      return;
    }
    if (!/^[A-Z0-9_-]{3,32}$/.test(organizationCode)) {
      setRegErrors((prev) => ({ ...prev, orgCode: '组织代号格式不正确', general: '' }));
      return;
    }

    setRegErrors({ name: '', email: '', code: '', orgCode: '', password: '', invite: '', general: '' });
    setLoading(true);
    try {
      const invite_code = regInviteCode ? regInviteCode.trim() : undefined;
      const payload = { name, password, email, emailCode, organizationCode };
      if (invite_code) payload.invite_code = invite_code;
      const res = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || 'UNKNOWN_ERROR';
        const message = data.message || '注册失败';
        if (code === 'EMAIL_EXISTS') {
          setRegErrors((prev) => ({ ...prev, email: message }));
          return;
        }
        if (code === 'INVALID_PASSWORD') {
          setRegErrors((prev) => ({ ...prev, password: message }));
          return;
        }
        if (code === 'INVALID_EMAIL') {
          setRegErrors((prev) => ({ ...prev, email: message }));
          return;
        }
        if (code === 'INVALID_EMAIL_CODE' || code === 'EMAIL_CODE_EXPIRED' || code === 'EMAIL_CODE_ATTEMPTS_EXCEEDED') {
          setRegErrors((prev) => ({ ...prev, code: message }));
          return;
        }
        if (code === 'MISSING_ORGANIZATION_CODE' || code === 'INVALID_ORGANIZATION_CODE' || code === 'ORG_CODE_NOT_CONFIGURED' || code === 'INVALID_ORGANIZATION') {
          setRegErrors((prev) => ({ ...prev, orgCode: message || '组织代号无效' }));
          return;
        }
        if (code === 'INVITE_REQUIRED') {
          setRegErrors((prev) => ({ ...prev, invite: '该组织需要邀请码' }));
          return;
        }
        if (code === 'INVALID_INVITE') {
          setRegErrors((prev) => ({ ...prev, invite: '邀请码无效或不匹配' }));
          return;
        }
        if (code === 'MISSING_FIELDS') {
          setRegErrors((prev) => ({ ...prev, general: message }));
          return;
        }
        setRegErrors((prev) => ({ ...prev, general: message }));
        return;
      }

      // success: expect { id, token }
      if (data && data.token) {
        try {
          localStorage.setItem('mamage_jwt_token', data.token);
        } catch (e) {
          console.warn('Failed to save token to localStorage', e);
        }
        // fetch user via authService.me() to get full user object
        const user = await authService.me();
        Toast.success('注册并登录成功');
        if (typeof onAuthenticated === 'function') onAuthenticated(user);
      } else {
        // unexpected but treat as registered
        Toast.success('注册成功，请登录');
        setActive('login');
      }
    } catch (err) {
      console.error('register failed', err);
      setRegErrors((prev) => ({ ...prev, general: '网络错误，请稍后重试' }));
    } finally {
      setLoading(false);
    }
  };

  // wrapper to log click events before invoking async handler
  const handleRegisterClick = () => {
    void handleRegister();
  };

  return (
    <div className="auth-page-root">
      <header className="auth-brand">
        <img src="/favicon-32x32.png" alt="" width="26" height="26" />
        <span>MaMage</span><span className="auth-brand-caption">校园素材库</span>
      </header>
      <main className="auth-body">
      <section className="auth-content" aria-labelledby="auth-title">
        {active === 'login' && hasCampusLogin && !providersLoading ? (
          <div className="auth-login-tabs" role="tablist" aria-label="登录方式" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : currentLoginMode === 'campus' ? 1 : 0;
            setLoginMode(index === 0 ? 'campus' : 'password'); event.currentTarget.querySelectorAll('[role="tab"]')[index].focus();
          }}>
            <button type="button" role="tab" id="campus-login-tab" aria-controls="campus-login-panel" aria-selected={currentLoginMode === 'campus'} tabIndex={currentLoginMode === 'campus' ? 0 : -1}
              onClick={() => setLoginMode('campus')}>{authProviders.iam ? '校园登录' : '钉钉登录'}</button>
            <button type="button" role="tab" id="password-login-tab" aria-controls="password-login-panel" aria-selected={currentLoginMode === 'password'} tabIndex={currentLoginMode === 'password' ? 0 : -1}
              onClick={() => setLoginMode('password')}>账号密码</button>
          </div>
        ) : null}
        <div className="auth-intro">
          <img className="auth-product-mark" src="/icons/icon-192.png" alt="MaMage" width="52" height="52" />
          <h1 id="auth-title">{active === 'register' ? '创建 MaMage 账号' : '登录 MaMage'}</h1>
          <p>{active === 'register' ? '校园素材库' : '欢迎回来'}</p>
        </div>
        {loginAlert && <div className="auth-notice" role="alert">{loginAlert}</div>}
        {active === 'login' ? (
          providersLoading && !loginMode ? <div className="auth-provider-loading" role="status"><span className="mamage-button-spinner" />正在连接登录服务</div> :
          currentLoginMode === 'campus' && hasCampusLogin ? (
          <div className="auth-campus-panel" id="campus-login-panel" role="tabpanel" aria-labelledby="campus-login-tab">
            <h2>{authProviders.iam ? '校园统一身份认证' : '使用钉钉扫码或点击头像授权登录'}</h2>
            <Button className="auth-primary" loading={redirecting} onClick={beginCampusLogin}>
              {authProviders.iam ? '前往校园登录' : '使用钉钉登录'}<IconChevronRight />
            </Button>
          </div>
          ) : (
          <form className="auth-login-form" id="password-login-panel" role={hasCampusLogin ? 'tabpanel' : undefined}
            aria-labelledby={hasCampusLogin ? 'password-login-tab' : 'auth-title'} onSubmit={(event) => { event.preventDefault(); if (!loading) void handleLogin(); }}>
            <div style={{ position: 'relative' }}>
              <Input
                placeholder="邮箱或学号"
                aria-label="邮箱或学号"
                autoComplete="username"
                value={loginEmail}
                onChange={(v) => { setLoginEmail(v); setLoginErrors({ ...loginErrors, email: '', general: '' }); }}
              />
            </div>

            <div>
              <Input
                placeholder="密码"
                aria-label="密码"
                autoComplete="current-password"
                type="password"
                value={loginPassword}
                onChange={(v) => {
                  setLoginPassword(v);
                  setLoginErrors({ ...loginErrors, password: '' });
                }}
              />
              {loginErrors.password && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{loginErrors.password}</div>}
              {loginErrors.general && <div role="alert" className="auth-error">{loginErrors.general}</div>}
            </div>

            <button type="submit" className="auth-primary" disabled={loading} aria-busy={loading || undefined}>
              {loading ? <span className="mamage-button-spinner" aria-hidden="true" /> : null}{loading ? '正在登录' : '登录'}
            </button>
            {providersFailed && <div className="auth-provider-fallback"><span>校园登录暂不可用</span>
              <button type="button" className="auth-text-button" onClick={() => setProviderRetry(value => value + 1)}>重试</button></div>}
          </form>
          )
        ) : (
          <div className="auth-register-form">
            <div>
              <Input placeholder="姓名" value={regName} onChange={(v) => { setRegName(v); setRegErrors((prev) => ({ ...prev, name: '' })); }} />
              {regErrors.name && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.name}</div>}
            </div>

            <div style={{ position: 'relative' }}>
              <div className="auth-email-row">
                <Input
                  className="auth-email-input"
                  placeholder="邮箱"
                  value={regEmail}
                  onChange={(v) => {
                    setRegEmail(v);
                    setRegEmailCode('');
                    setCodeCooldown(0);
                    setRegErrors((prev) => ({ ...prev, email: '', code: '', general: '' }));
                    setShowRegSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowRegSuggestions(false), 120)}
                  onFocus={() => setShowRegSuggestions(true)}
                />
                <Button
                  className="auth-code-button"
                  type="tertiary"
                  loading={codeSending}
                  disabled={loading || codeSending || codeCooldown > 0}
                  onClick={handleSendEmailCode}
                >
                  {codeCooldown > 0 ? `${codeCooldown}s` : '发送验证码'}
                </Button>
              </div>
              {showRegSuggestions && regEmail.indexOf('@') === -1 && regEmail.length > 0 && (
                <div className="auth-email-suggestions">
                  {commonSuffixes.map((suf) => (
                    <div
                      key={suf}
                      className="auth-email-suggestion"
                      onMouseDown={() => {
                        setRegEmail(regEmail + suf);
                        setRegEmailCode('');
                        setCodeCooldown(0);
                        setRegErrors((prev) => ({ ...prev, email: '', code: '', general: '' }));
                        setShowRegSuggestions(false);
                      }}
                    >
                      {regEmail}{suf}
                    </div>
                  ))}
                </div>
              )}
              {regErrors.email && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.email}</div>}
            </div>

            <div>
              <Input
                placeholder="邮箱验证码"
                value={regEmailCode}
                inputMode="numeric"
                maxLength={6}
                onChange={(v) => {
                  setRegEmailCode(String(v || '').replace(/\D/g, '').slice(0, 6));
                  setRegErrors((prev) => ({ ...prev, code: '', general: '' }));
                }}
              />
              {regErrors.code && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.code}</div>}
            </div>

            <div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>组织代号</div>
                <Input
                  placeholder="请输入组织代号"
                  value={regOrgCode}
                  autoCapitalize="characters"
                  onChange={(v) => {
                    setRegOrgCode(String(v || '').trim().toUpperCase());
                    setRegErrors((prev) => ({ ...prev, orgCode: '', general: '' }));
                  }}
                />
                {regErrors.orgCode && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.orgCode}</div>}
              </div>
              <div>
                <Input placeholder="邀请码（可选）" value={regInviteCode} onChange={(v) => { setRegInviteCode(v); setRegErrors((prev) => ({ ...prev, invite: '' })); }} />
                {regErrors.invite && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{regErrors.invite}</div>}
              </div>
            </div>

            <div>
              <Input
                placeholder="密码"
                type="password"
                value={regPassword}
                onChange={(v) => {
                  setRegPassword(v);
                  if (!v || v.length === 0) {
                    setRegPasswordValid(false);
                    setRegErrors((prev) => ({ ...prev, password: '' }));
                  } else if (PASSWORD_RE.test(v)) {
                    setRegPasswordValid(true);
                    setRegErrors((prev) => ({ ...prev, password: '', general: '' }));
                  } else {
                    setRegPasswordValid(false);
                    setRegErrors((prev) => ({ ...prev, password: '密码需 8-16 位且同时包含字母和数字' }));
                  }
                }}
              />
              {/* Realtime detailed password hints */}
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <div style={{ color: passwordChecks.minMax(regPassword) ? '#2e7d32' : '#e53935' }}>• 长度 8-16 位</div>
                <div style={{ color: passwordChecks.hasLetter(regPassword) ? '#2e7d32' : '#e53935' }}>• 包含字母</div>
                <div style={{ color: passwordChecks.hasNumber(regPassword) ? '#2e7d32' : '#e53935' }}>• 包含数字</div>
                <div style={{ color: passwordChecks.allowedChars(regPassword) ? '#2e7d32' : '#e53935' }}>• 仅允许字母和数字（不允许空格或特殊字符）</div>
              </div>
              {regErrors.password && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.password}</div>}
            </div>

            {regErrors.general && <div style={{ color: '#e53935', fontSize: 13 }}>{regErrors.general}</div>}

            <div style={{ marginTop: 12 }}>
              <Button
                className="auth-primary"
                type="primary"
                theme="solid"
                disabled={loading}
                loading={loading}
                onClick={handleRegisterClick}
              >
                注册并登录
              </Button>
            </div>
          </div>
        )}

        <div className="auth-account-switch">
          {active === 'login' ? <button type="button" className="auth-text-button" onClick={() => setActive('register')}>创建账号</button>
            : <button type="button" className="auth-text-button" onClick={() => setActive('login')}>返回登录</button>}
        </div>
        <div className="auth-consent-row">
          登录即代表同意
          <a href="/privacy">《隐私说明》</a>
        </div>
      </section>
      </main>
      <footer className="auth-footer">MaMage © {new Date().getFullYear()}</footer>
    </div>
  );
}
