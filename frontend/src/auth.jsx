import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setToken('');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = async (email, password) => {
    const res = await api.login({ email, password });
    setToken(res.access_token);
    try {
      if (res.user?.role === 'admin') {
        localStorage.setItem('medrag-active-view', 'admin');
        localStorage.setItem('medrag-admin-tab', 'dashboard');
        window.history.replaceState(null, '', '#admin/dashboard');
      } else {
        localStorage.setItem('medrag-active-view', 'chat');
        window.history.replaceState(null, '', '#chat');
      }
    } catch { /* ignore */ }
    setUser(res.user);
    return res.user;
  };

  const register = async (email, username, password) => {
    const res = await api.register({ email, username, password });
    setToken(res.access_token);
    try {
      const defaultView = res.user?.role === 'admin' ? 'admin' : 'chat';
      localStorage.setItem('medrag-active-view', defaultView);
      window.history.replaceState(null, '', defaultView === 'admin' ? '#admin/dashboard' : '#chat');
    } catch { /* ignore */ }
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    setToken('');
    try {
      localStorage.removeItem('medrag-active-view');
      localStorage.removeItem('medrag-admin-tab');
      window.history.replaceState(null, '', window.location.pathname);
    } catch { /* ignore */ }
    setUser(null);
  };

  const refreshUser = async () => {
    try { const me = await api.me(); setUser(me); return me; } catch { return null; }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
