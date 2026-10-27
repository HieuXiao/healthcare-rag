import { useState } from 'react';
import { useAuth } from './auth.jsx';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), username.trim(), password);
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">✚</span>
          <div>
            <h1>Trợ lý Y tế RAG</h1>
            <p className="brand-sub">Clinical Medical RAG · GraphRAG · PHI-safe</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Đăng ký</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="bacsi@benhvien.vn" required autoComplete="email" />
          </label>
          {mode === 'register' && (
            <label>
              <span>Tên hiển thị</span>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                     placeholder="BS. Nguyễn Văn A" required />
            </label>
          )}
          <label>
            <span>Mật khẩu</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   placeholder="Tối thiểu 6 ký tự" required minLength={6}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>

          {error && <div className="auth-error">⚠️ {error}</div>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Đang xử lý…' : (mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản')}
          </button>
        </form>

        <p className="auth-hint">
          {mode === 'login'
            ? 'Chưa có tài khoản? Chọn “Đăng ký”.'
            : 'Đã có tài khoản? Chọn “Đăng nhập”.'}
        </p>
      </div>
    </div>
  );
}
