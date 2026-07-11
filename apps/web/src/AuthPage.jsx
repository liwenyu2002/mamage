import React from 'react';
import { Card, Input, Button, Toast } from './ui';
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
  const [authProviders, setAuthProviders] = React.useState({ password: true, dingtalk: false });
  React.useEffect(() => {
    let canceled = false;
    fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!canceled && d) setAuthProviders(d); })
      .catch(() => {});
    // 钉钉回调失败时错误信息挂在 hash 上
    try {
      const m = String(window.location.hash || '').match(/dingtalk_error=([^&]+)/);
      if (m) {
        Toast.error(decodeURIComponent(m[1]));
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }
    return () => { canceled = true; };
  }, []);
  const [active, setActive] = React.useState('login');
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
      <Card className="auth-card" title="MaMage 登录 / 注册" bordered>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button type={active === 'login' ? 'primary' : 'tertiary'} onClick={() => setActive('login')}>登录</Button>
          <Button type={active === 'register' ? 'primary' : 'tertiary'} onClick={() => setActive('register')}>注册</Button>
        </div>
        {active === 'login' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Input
                placeholder="邮箱"
                value={loginEmail}
                onChange={(v) => { setLoginEmail(v); setLoginErrors({ ...loginErrors, email: '', general: '' }); }}
                onEnterPress={handleLogin}
              />
            </div>

            <div>
              <Input
                placeholder="密码"
                type="password"
                value={loginPassword}
                onChange={(v) => {
                  setLoginPassword(v);
                  setLoginErrors({ ...loginErrors, password: '' });
                }}
                onEnterPress={handleLogin}
              />
              {loginErrors.password && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{loginErrors.password}</div>}
              {loginErrors.general && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{loginErrors.general}</div>}
            </div>

            {/* login errors shown via Toast, no inline general message */}

            <div style={{ marginTop: 12 }}>
              <Button type="primary" theme="solid" loading={loading} onClick={handleLogin}>登录</Button>
            </div>
            {authProviders.dingtalk ? (
              <div className="auth-sso-row">
                <span className="auth-sso-divider">或</span>
                <Button onClick={() => { window.location.href = '/api/auth/dingtalk/login'; }}>
                  使用钉钉登录
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
      </Card>
    </div>
  );
}
