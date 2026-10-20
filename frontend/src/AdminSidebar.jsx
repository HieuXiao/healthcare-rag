import { useAuth } from './auth.jsx';

export default function AdminSidebar({
  tab,
  onSelectTab,
  onSwitchToChat,
  onNavigate,
  collapsed,
  onToggleCollapse,
}) {
  const { user, logout } = useAuth();

  return (
    <aside className={`sidebar admin-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <span className="brand-mark admin-mark" aria-hidden="true">🛡️</span>
          {!collapsed && (
            <div className="admin-brand-info">
              <span className="sidebar-title">MedRAG Portal</span>
              <span className="admin-brand-sub">Quản trị Hệ thống Y tế</span>
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Nút chuyển chế độ nổi bật sang Bác sĩ / Chat */}
      <div className="admin-switch-wrap">
        <button
          className="switch-to-chat-btn"
          onClick={onSwitchToChat}
          title="Chuyển sang Giao diện Bác sĩ (Hỏi đáp RAG)"
        >
          <span className="switch-icon" aria-hidden="true">💬</span>
          {!collapsed && (
            <div className="switch-btn-text">
              <span className="switch-main">Vào Phòng khám (Chat)</span>
              <span className="switch-sub">Trợ lý y tế RAG lâm sàng</span>
            </div>
          )}
        </button>
      </div>

      {/* Menu Quản trị Chính */}
      <div className="admin-nav-section">
        {!collapsed && <div className="conv-list-head">Quản trị chính</div>}
        <nav className="admin-main-nav">
          <AdminNavBtn
            icon="📊"
            label="Tổng quan & Biểu đồ"
            badge="Dashboard"
            active={tab === 'dashboard'}
            collapsed={collapsed}
            onClick={() => onSelectTab('dashboard')}
          />
          <AdminNavBtn
            icon="💬"
            label="Truy vấn & Bám nguồn"
            badge="Fact-Check"
            active={tab === 'chats'}
            collapsed={collapsed}
            onClick={() => onSelectTab('chats')}
          />
          <AdminNavBtn
            icon="🔐"
            label="Xác thực & Bảo mật"
            badge="Auth Log"
            active={tab === 'auth-logs'}
            collapsed={collapsed}
            onClick={() => onSelectTab('auth-logs')}
          />
          <AdminNavBtn
            icon="🏛️"
            label="Tài liệu gốc hệ thống"
            badge="Docs"
            active={tab === 'docs'}
            collapsed={collapsed}
            onClick={() => onSelectTab('docs')}
          />
          <AdminNavBtn
            icon="👥"
            label="Quản lý người dùng"
            badge="Users"
            active={tab === 'users'}
            collapsed={collapsed}
            onClick={() => onSelectTab('users')}
          />
        </nav>
      </div>

      <div className="admin-sidebar-spacer" />

      {/* Lối tắt phụ */}
      <div className="admin-secondary-nav">
        {!collapsed && <div className="conv-list-head">Cá nhân</div>}
        <AdminNavBtn
          icon="📁"
          label="Save box của tôi"
          active={false}
          collapsed={collapsed}
          onClick={() => onNavigate('savebox')}
        />
        <AdminNavBtn
          icon="👤"
          label="Hồ sơ cá nhân"
          active={false}
          collapsed={collapsed}
          onClick={() => onNavigate('profile')}
        />
      </div>

      {/* Admin User Footer */}
      {!collapsed && (
        <div className="admin-sidebar-footer">
          <div className="admin-user-info">
            <span className="admin-avatar">{(user?.username || 'A').charAt(0).toUpperCase()}</span>
            <div className="admin-user-meta">
              <span className="admin-name">{user?.username}</span>
              <span className="admin-role-tag">Super Admin</span>
            </div>
          </div>
          <button className="admin-logout-btn" onClick={logout} title="Đăng xuất">
            🚪
          </button>
        </div>
      )}
    </aside>
  );
}

function AdminNavBtn({ icon, label, badge, active, collapsed, onClick }) {
  return (
    <button
      className={`admin-nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
    >
      <span className="nav-item-icon" aria-hidden="true">{icon}</span>
      {!collapsed && (
        <div className="nav-item-content">
          <span className="nav-item-label">{label}</span>
          {badge && <span className="nav-item-badge">{badge}</span>}
        </div>
      )}
    </button>
  );
}
