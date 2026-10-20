import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import Sidebar from './Sidebar.jsx';
import AdminSidebar from './AdminSidebar.jsx';
import ChatView from './ChatView.jsx';
import SaveBox from './SaveBox.jsx';
import AdminPanel from './AdminPanel.jsx';
import Profile from './Profile.jsx';

const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

const VIEW_TITLES = {
  chat: 'Trò chuyện lâm sàng',
  savebox: 'Save box — Tài liệu của tôi',
  admin: 'Quản trị hệ thống',
  profile: 'Hồ sơ cá nhân',
};

const ADMIN_TITLES = {
  dashboard: 'Quản trị hệ thống — Tổng quan & Biểu đồ y khoa',
  chats: 'Quản trị hệ thống — Nhật ký Truy vấn & Bám nguồn',
  'auth-logs': 'Quản trị hệ thống — Lịch sử Xác thực & Bảo mật',
  docs: 'Quản trị hệ thống — Tài liệu gốc hệ thống',
  users: 'Quản trị hệ thống — Quản lý người dùng',
};

function parseHash(userRole) {
  try {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (!raw) return null;
    const parts = raw.split('/');
    const mainView = parts[0];
    const subTab = parts[1];
    const validViews = ['chat', 'savebox', 'profile', 'admin'];
    if (validViews.includes(mainView)) {
      if (mainView === 'admin' && userRole !== 'admin') {
        return { view: 'chat', adminTab: 'dashboard' };
      }
      const validAdminTabs = ['dashboard', 'chats', 'auth-logs', 'docs', 'users'];
      const resolvedAdminTab = validAdminTabs.includes(subTab) ? subTab : 'dashboard';
      return { view: mainView, adminTab: resolvedAdminTab };
    }
  } catch { /* ignore */ }
  return null;
}

function getInitialViewState(userRole) {
  // 1. Ưu tiên URL Hash (khi F5 hoặc mở link trực tiếp)
  const fromHash = parseHash(userRole);
  if (fromHash) return fromHash;

  // 2. Fallback sang localStorage
  try {
    const savedView = localStorage.getItem('medrag-active-view');
    const savedTab = localStorage.getItem('medrag-admin-tab') || 'dashboard';
    const validViews = ['chat', 'savebox', 'profile', 'admin'];
    if (savedView && validViews.includes(savedView)) {
      if (savedView === 'admin' && userRole !== 'admin') {
        return { view: 'chat', adminTab: 'dashboard' };
      }
      return { view: savedView, adminTab: savedTab };
    }
  } catch { /* ignore */ }

  return { view: 'chat', adminTab: 'dashboard' };
}

export default function Workspace({ theme, toggleTheme }) {
  const { user, logout } = useAuth();
  const initial = getInitialViewState(user?.role);
  const [view, setView] = useState(initial.view);
  const [adminTab, setAdminTab] = useState(initial.adminTab);
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [modelStats, setModelStats] = useState([]);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[0]);
  const [userMenu, setUserMenu] = useState(false);

  // Cập nhật view và lưu vào hash + localStorage
  const updateRoute = useCallback((newView, newAdminTab = adminTab) => {
    setView(newView);
    setAdminTab(newAdminTab);
    try {
      localStorage.setItem('medrag-active-view', newView);
      if (newView === 'admin') {
        localStorage.setItem('medrag-admin-tab', newAdminTab);
        window.history.replaceState(null, '', `#admin/${newAdminTab}`);
      } else {
        window.history.replaceState(null, '', `#${newView}`);
      }
    } catch { /* ignore */ }
  }, [adminTab]);

  // Đồng bộ hash URL lúc mount và khi người dùng bấm Back/Forward trình duyệt
  useEffect(() => {
    if (view === 'admin') {
      window.history.replaceState(null, '', `#admin/${adminTab}`);
    } else {
      window.history.replaceState(null, '', `#${view}`);
    }

    const onHashChange = () => {
      const parsed = parseHash(user?.role);
      if (parsed) {
        setView(parsed.view);
        setAdminTab(parsed.adminTab);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const d = await api.listConversations();
      setConversations(d.conversations || []);
      return d.conversations || [];
    } catch { return []; }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const d = await api.models();
      if (Array.isArray(d.models) && d.models.length) {
        setModelStats(d.models);
        setSelectedModel((prev) => (d.models.some((m) => m.name === prev) ? prev : d.models[0].name));
        return;
      }
    } catch { /* ignore */ }
    setModelStats(FALLBACK_MODELS.map((name) => ({ name, usage_percent: 0 })));
  }, []);

  useEffect(() => { loadConversations(); loadModels(); }, [loadConversations, loadModels]);

  const handleNewChat = () => { setActiveConvId(null); updateRoute('chat'); };
  const handleSelectConv = (id) => { setActiveConvId(id); updateRoute('chat'); };
  const handleDeleteConv = async (id) => {
    if (!window.confirm('Xoá cuộc trò chuyện này?')) return;
    try { await api.deleteConversation(id); } catch { /* ignore */ }
    if (activeConvId === id) setActiveConvId(null);
    loadConversations();
  };

  const onConversationStarted = async (id) => {
    setActiveConvId(id);
    await loadConversations();
  };

  const currentUsage = modelStats.find((m) => m.name === selectedModel)?.usage_percent ?? 0;

  const handleNavigate = (v) => {
    if (v === 'admin') {
      updateRoute('admin', adminTab || 'dashboard');
    } else {
      updateRoute(v);
    }
  };

  const handleSelectAdminTab = (tabName) => {
    updateRoute('admin', tabName);
  };

  const isCurrentAdmin = view === 'admin' && user?.role === 'admin';
  const currentTitle = isCurrentAdmin ? (ADMIN_TITLES[adminTab] || 'Quản trị hệ thống') : VIEW_TITLES[view];

  return (
    <div className="workspace">
      {isCurrentAdmin ? (
        <AdminSidebar
          tab={adminTab}
          onSelectTab={handleSelectAdminTab}
          onSwitchToChat={() => handleNavigate('chat')}
          onNavigate={handleNavigate}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      ) : (
        <Sidebar
          conversations={conversations}
          activeConvId={activeConvId}
          view={view}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onNewChat={handleNewChat}
          onSelectConv={handleSelectConv}
          onDeleteConv={handleDeleteConv}
          onNavigate={handleNavigate}
        />
      )}

      <div className="main-col">
        <header className="topbar">
          <h2 className="topbar-title">{currentTitle}</h2>
          <div className="topbar-controls">
            {view === 'chat' && (
              <div className="model-wrap">
                <select className="ctl model-selector" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  {(modelStats.length ? modelStats : FALLBACK_MODELS.map((name) => ({ name, usage_percent: 0 }))).map((m) => (
                    <option key={m.name || m} value={m.name || m}>{(m.name || m)} · {m.usage_percent ?? 0}%</option>
                  ))}
                </select>
                <span className="usage-dot" style={{ '--p': `${currentUsage}%` }} title={`Usage ${currentUsage}%`} />
              </div>
            )}
            <button className="ctl theme-toggle" onClick={toggleTheme} title="Sáng/tối">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <div className="user-menu-wrap">
              <button className="user-chip" onClick={() => setUserMenu((o) => !o)}>
                <span className="user-avatar">{(user.username || 'U').charAt(0).toUpperCase()}</span>
                <span className="user-name">{user.username}</span>
                {user.role === 'admin' && <span className="role-badge">admin</span>}
              </button>
              {userMenu && (
                <div className="user-dropdown" onMouseLeave={() => setUserMenu(false)}>
                  <button onClick={() => { handleNavigate('profile'); setUserMenu(false); }}>👤 Hồ sơ</button>
                  <button onClick={() => { handleNavigate('savebox'); setUserMenu(false); }}>📁 Save box</button>
                  {user.role === 'admin' && <button onClick={() => { handleNavigate('admin'); setUserMenu(false); }}>🛡️ Quản trị</button>}
                  <div className="dropdown-sep" />
                  <button className="danger" onClick={logout}>🚪 Đăng xuất</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="main-body">
          {view === 'chat' && (
            <ChatView
              key={activeConvId || 'new'}
              conversationId={activeConvId}
              selectedModel={selectedModel}
              onConversationStarted={onConversationStarted}
              onAfterChat={loadConversations}
            />
          )}
          {view === 'savebox' && <SaveBox />}
          {view === 'profile' && <Profile />}
          {view === 'admin' && user.role === 'admin' && (
            <AdminPanel tab={adminTab} onSelectTab={handleSelectAdminTab} />
          )}
        </div>
      </div>
    </div>
  );
}
