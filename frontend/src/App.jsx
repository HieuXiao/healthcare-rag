import { useEffect, useState } from 'react';
import './App.css';
import './layout.css';
import { AuthProvider, useAuth } from './auth.jsx';
import AuthScreen from './AuthScreen.jsx';
import Workspace from './Workspace.jsx';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('medrag-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Root() {
  const { user, loading } = useAuth();
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('medrag-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  if (loading) {
    return <div className="boot-screen"><div className="boot-spinner" />Đang tải…</div>;
  }
  if (!user) return <AuthScreen />;
  return <Workspace theme={theme} toggleTheme={toggleTheme} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
