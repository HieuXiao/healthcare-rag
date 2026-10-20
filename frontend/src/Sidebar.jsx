import { useAuth } from './auth.jsx';

export default function Sidebar({
  conversations, activeConvId, view,
  onNewChat, onSelectConv, onDeleteConv, onNavigate, collapsed, onToggleCollapse,
}) {
  const { user } = useAuth();

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <span className="brand-mark small" aria-hidden="true">✚</span>
          {!collapsed && <span className="sidebar-title">Trợ lý Y tế RAG</span>}
        </div>
        <button className="icon-btn" onClick={onToggleCollapse} title={collapsed ? 'Mở rộng' : 'Thu gọn'}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Banner Cổng Quản trị nổi bật cho Admin */}
      {user?.role === 'admin' && (
        <div className="admin-portal-launcher">
          <button
            className="admin-launcher-btn"
            onClick={() => onNavigate('admin')}
            title="Mở Cổng Quản trị Hệ thống"
          >
            <div className="launcher-badge">ADMIN</div>
            <div className="launcher-main">
              <span className="launcher-icon">🛡️</span>
              {!collapsed && (
                <div className="launcher-text">
                  <span className="launcher-title">Cổng Quản trị Hệ thống</span>
                  <span className="launcher-sub">Dashboard · Users · Tri thức</span>
                </div>
              )}
            </div>
            {!collapsed && <span className="launcher-arrow">➔</span>}
          </button>
        </div>
      )}

      <button className="new-chat-btn" onClick={onNewChat} title="Cuộc trò chuyện mới">
        <span>＋</span>{!collapsed && <span>Cuộc trò chuyện mới</span>}
      </button>

      {!collapsed && (
        <div className="conv-list">
          <div className="conv-list-head">Lịch sử trò chuyện</div>
          {conversations.length === 0 && <div className="conv-empty">Chưa có cuộc trò chuyện nào.</div>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${view === 'chat' && c.id === activeConvId ? 'active' : ''}`}
              onClick={() => onSelectConv(c.id)}
            >
              <span className="conv-icon" aria-hidden="true">💬</span>
              <span className="conv-title">{c.title || 'Cuộc trò chuyện'}</span>
              <button
                className="conv-del"
                title="Xoá"
                onClick={(e) => { e.stopPropagation(); onDeleteConv(c.id); }}
              >🗑</button>
            </div>
          ))}
        </div>
      )}

      <nav className="sidebar-nav">
        <NavBtn icon="💬" label="Trò chuyện" active={view === 'chat'} collapsed={collapsed} onClick={() => onNavigate('chat')} />
        <NavBtn icon="📁" label="Save box" active={view === 'savebox'} collapsed={collapsed} onClick={() => onNavigate('savebox')} />
        <NavBtn icon="👤" label="Hồ sơ" active={view === 'profile'} collapsed={collapsed} onClick={() => onNavigate('profile')} />
        {user?.role === 'admin' && (
          <NavBtn icon="🛡️" label="Quản trị" active={view === 'admin'} collapsed={collapsed} onClick={() => onNavigate('admin')} />
        )}
      </nav>
    </aside>
  );
}

function NavBtn({ icon, label, active, collapsed, onClick }) {
  return (
    <button className={`nav-btn ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      <span className="nav-icon" aria-hidden="true">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
