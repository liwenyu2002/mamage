import React from 'react';
import { Card, Input, Button, Toast } from '@douyinfe/semi-ui';
import './AuthPage.css';
import * as authService from './services/authService';

const PASSWORD_RE = /^(?![0-9]+)(?![a-zA-Z]+)[0-9A-Za-z]{8,16}$/;
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
  const [active, setActive] = React.useState('login');
  const [loading, setLoading] = React.useState(false);
  // controlled fields
  const [loginEmail, setLoginEmail] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [regName, setRegName] = React.useState('');
  const [regEmail, setRegEmail] = React.useState('');
  const [regPassword, setRegPassword] = React.useState('');
  const [loginErrors, setLoginErrors] = React.useState({ email: '', password: '', general: '' });
  const [regErrors, setRegErrors] = React.useState({ name: '', email: '', password: '', general: '' });
  const commonSuffixes = ['@qq.com', '@163.com', '@gmail.com', '@hotmail.com', '@edu.cn'];
  const [showRegSuggestions, setShowRegSuggestions] = React.useState(false);
  const [regPasswordValid, setRegPasswordValid] = React.useState(false);
  React.useEffect(() => {
    try {
      const btn = document.getElementById('mamage-register-btn');
      if (!btn) {
        console.debug('[AuthPage] register button not found in DOM');
        return;
      }
      console.debug('[AuthPage] register button found', { disabled: btn.disabled, rect: btn.getBoundingClientRect(), pointerEvents: window.getComputedStyle(btn).pointerEvents });
      const onNative = (e) => console.debug('[AuthPage] native click event on register button', e.type, e);
      btn.addEventListener('click', onNative);
      return () => btn.removeEventListener('click', onNative);
    } catch (e) {
      console.debug('[AuthPage] register button effect error', e);
    }
  }, []);
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
      console.debug('[AuthPage] login payload', payload);
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      console.debug('[AuthPage] login response', res.status, data);
      if (!res.ok) {
        const code = data.error_code || data.error || 'UNKNOWN_ERROR';
        const message = data.message || '登录失败';
        if (code === 'INVALID_PASSWORD') {
          setLoginErrors((prev) => ({ ...prev, password: message }));
        } else if (code === 'USER_NOT_FOUND') {
          setLoginErrors((prev) => ({ ...prev, general: message }));
        } else {
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

  const handleRegister = async () => {
    console.debug('[AuthPage] handleRegister click', { regName, regEmail, regPassword: regPassword ? '***' : '' });
    const trimmedEmail = regEmail ? regEmail.trim() : regEmail;
    const trimmedPassword = regPassword ? regPassword.trim() : regPassword;
      // Use explicit fetch to call backend and handle server validation codes.
      console.debug('[AuthPage] handleRegister click');
      const name = regName ? regName.trim() : '';
      const email = regEmail ? regEmail.trim() : '';
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
      if (email) {
        const emailOk = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
        if (!emailOk) {
          setRegErrors((prev) => ({ ...prev, email: '邮箱格式不正确', general: '' }));
          return;
        }
      }

      setRegErrors({ name: '', email: '', password: '', general: '' });
      setLoading(true);
      try {
        const res = await fetch('/api/users/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password, email: email || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        console.debug('[AuthPage] register response', res.status, data);
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
    try {
      console.debug('[AuthPage] register button clicked');
    } catch (e) {}
    // call the async handler
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
              />
              {loginErrors.password && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{loginErrors.password}</div>}
            </div>

            {/* login errors shown via Toast, no inline general message */}

            <div style={{ marginTop: 12 }}>
              <Button type="primary" theme="solid" loading={loading} onClick={handleLogin}>登录</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>
              <Input placeholder="昵称（可选）" value={regName} onChange={(v) => { setRegName(v); setRegErrors({ ...regErrors, name: '' }); }} />
              {regErrors.name && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.name}</div>}
            </div>

            <div style={{ position: 'relative' }}>
              <Input
                placeholder="邮箱"
                value={regEmail}
                onChange={(v) => { setRegEmail(v); setRegErrors({ ...regErrors, email: '' }); setShowRegSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowRegSuggestions(false), 120)}
                onFocus={() => setShowRegSuggestions(true)}
              />
              {showRegSuggestions && regEmail.indexOf('@') === -1 && regEmail.length > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #eee', zIndex: 20 }}>
                  {commonSuffixes.map((suf) => (
                    <div key={suf} style={{ padding: 8, cursor: 'pointer' }} onMouseDown={() => { setRegEmail(regEmail + suf); setShowRegSuggestions(false); }}>
                      {regEmail}{suf}
                    </div>
                  ))}
                </div>
              )}
              {regErrors.email && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{regErrors.email}</div>}
            </div>

            <div>
              <Input
                placeholder="密码"
                type="password"
                value={regPassword}
                onChange={(v) => {
                  // debug: 输出密码相关信息以便排查不可见字符或长度问题（仅用于本地调试）
                  try {
                    console.debug('[AuthPage] regPassword change', { v, len: v ? v.length : 0, passTest: PASSWORD_RE.test(v), codes: v ? Array.from(v).map((c) => c.charCodeAt(0)) : [] });
                  } catch (e) {
                    console.debug('[AuthPage] regPassword debug error', e);
                  }
                  setRegPassword(v);
                  // live validate registration password
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
              {/* 临时替换为原生按钮以确保事件可捕获（仅用于调试） */}
              <button
                id="mamage-register-btn-native"
                disabled={loading}
                onClick={handleRegisterClick}
                style={{
                  background: '#1677ff',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 14px',
                  borderRadius: 4,
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                注册并登录
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
