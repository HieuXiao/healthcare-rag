import { useAuth } from './auth.jsx';
import { NAV_LABELS } from './shortcuts.js';

const ICONS = {
  brand: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  factCheck: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  collapseLeft: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  collapseRight: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

const ADMIN_NAV_ITEMS = [
  { id: 'dashboard', keyId: 'admin:dashboard', label: NAV_LABELS['admin:dashboard'], icon: ICONS.dashboard },
  { id: 'chats', keyId: 'admin:chats', label: NAV_LABELS['admin:chats'], icon: ICONS.factCheck },
  { id: 'auth-logs', keyId: 'admin:auth-logs', label: NAV_LABELS['admin:auth-logs'], icon: ICONS.security },
  { id: 'docs', keyId: 'admin:docs', label: NAV_LABELS['admin:docs'], icon: ICONS.docs },
  { id: 'users', keyId: 'admin:users', label: NAV_LABELS['admin:users'], icon: ICONS.users },
];

export default function Sidebar({
  conversations = [],
  activeConvId,
  view,
  adminTab,
  shortcuts = {},
  onNewChat,
  onSelectConv,
  onDeleteConv,
  onNavigate,
  onSelectAdminTab,
  collapsed,
  onToggleCollapse,
}) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Header thương hiệu đồng nhất */}
      <div className="sidebar-top">
        <div
          className="sidebar-brand"
          onClick={() => onNavigate(isAdmin ? 'admin' : 'chat')}
          title="MedRAG Portal"
        >
          <span className="brand-mark small" aria-hidden="true">
            {ICONS.brand}
          </span>
          {!collapsed && (
            <div className="sidebar-brand-text">
              <span className="sidebar-title">MedRAG Portal</span>
              <span className="sidebar-subtitle">Hệ thống Y tế Lâm sàng</span>
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {collapsed ? ICONS.collapseRight : ICONS.collapseLeft}
        </button>
      </div>

      {/* Khu vực điều hướng cuộn mượt mà */}
      <div className="sidebar-scroll">
        {/* Nhóm 1: Quản trị Hệ thống (dành cho Admin) */}
        {isAdmin && (
          <div className="nav-group">
            {!collapsed && <div className="nav-group-label">Quản trị</div>}
            <div className="nav-list">
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcut={shortcuts[item.keyId]}
                  active={view === 'admin' && adminTab === item.id}
                  collapsed={collapsed}
                  onClick={() => onSelectAdminTab(item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Nhóm 2: Cá nhân */}
        <div className="nav-group">
          {!collapsed && <div className="nav-group-label">Cá nhân</div>}
          <div className="nav-list">
            <NavItem
              icon={ICONS.chat}
              label={NAV_LABELS['view:chat']}
              shortcut={shortcuts['view:chat']}
              active={view === 'chat'}
              collapsed={collapsed}
              onClick={() => onNavigate('chat')}
              extraAction={
                !collapsed && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="quick-add-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewChat();
                    }}
                    title="Cuộc trò chuyện mới"
                  >
                    {ICONS.plus}
                  </span>
                )
              }
            />

            {/* Lịch sử hội thoại gọn gàng ngay dưới mục Trò chuyện khi đang ở Chat */}
            {!collapsed && view === 'chat' && (
              <div className="conv-sublist">
                <button className="conv-new-inline" onClick={onNewChat}>
                  {ICONS.plus}
                  <span>Cuộc trò chuyện mới</span>
                </button>
                {conversations.length === 0 ? (
                  <div className="conv-empty">Chưa có lịch sử hỏi đáp</div>
                ) : (
                  conversations.slice(0, 10).map((c) => (
                    <div
                      key={c.id}
                      className={`conv-item ${c.id === activeConvId ? 'active' : ''}`}
                      onClick={() => onSelectConv(c.id)}
                      title={c.title || 'Cuộc trò chuyện'}
                    >
                      <span className="conv-dot" />
                      <span className="conv-title">{c.title || 'Cuộc trò chuyện'}</span>
                      <button
                        className="conv-del"
                        title="Xoá"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConv(c.id);
                        }}
                      >
                        {ICONS.trash}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            <NavItem
              icon={ICONS.folder}
              label={NAV_LABELS['view:savebox']}
              shortcut={shortcuts['view:savebox']}
              active={view === 'savebox'}
              collapsed={collapsed}
              onClick={() => onNavigate('savebox')}
            />
            <NavItem
              icon={ICONS.user}
              label={NAV_LABELS['view:profile']}
              shortcut={shortcuts['view:profile']}
              active={view === 'profile'}
              collapsed={collapsed}
              onClick={() => onNavigate('profile')}
            />
            <NavItem
              icon={ICONS.settings}
              label={NAV_LABELS['view:settings']}
              shortcut={shortcuts['view:settings']}
              active={view === 'settings'}
              collapsed={collapsed}
              onClick={() => onNavigate('settings')}
            />
          </div>
        </div>
      </div>

      {/* Footer tài khoản đồng nhất */}
      <div className="sidebar-footer">
        <div
          className="sidebar-user"
          onClick={() => onNavigate('profile')}
          title="Xem hồ sơ cá nhân"
        >
          <span className="sidebar-avatar">
            {(user?.username || 'U').charAt(0).toUpperCase()}
          </span>
          {!collapsed && (
            <div className="sidebar-user-meta">
              <span className="sidebar-user-name">{user?.username}</span>
              <span className="sidebar-user-role">
                {isAdmin ? 'Quản trị viên' : user?.specialty || 'Bác sĩ'}
              </span>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            className="sidebar-logout-btn"
            onClick={logout}
            title="Đăng xuất"
            aria-label="Đăng xuất"
          >
            {ICONS.logout}
          </button>
        )}
      </div>
    </aside>
  );
}

function NavItem({ icon, label, shortcut, active, collapsed, onClick, extraAction }) {
  const tooltip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      className={`sidebar-nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={tooltip}
    >
      <span className="sidebar-nav-icon" aria-hidden="true">
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="sidebar-nav-label">{label}</span>
          {extraAction && <span className="sidebar-nav-right">{extraAction}</span>}
        </>
      )}
    </button>
  );
}
