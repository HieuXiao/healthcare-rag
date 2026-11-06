// Quản lý phím tắt điều hướng Sidebar (Mặc định F1 -> Fn từ trên xuống)

export const ADMIN_TABS_META = [
  { keyId: 'admin:dashboard', view: 'admin', adminTab: 'dashboard', label: 'Tổng quan & Biểu đồ', group: 'Quản trị hệ thống' },
  { keyId: 'admin:chats', view: 'admin', adminTab: 'chats', label: 'Truy vấn & Bám nguồn', group: 'Quản trị hệ thống' },
  { keyId: 'admin:auth-logs', view: 'admin', adminTab: 'auth-logs', label: 'Xác thực & Kiểm toán', group: 'Quản trị hệ thống' },
  { keyId: 'admin:docs', view: 'admin', adminTab: 'docs', label: 'Tài liệu gốc hệ thống', group: 'Quản trị hệ thống' },
  { keyId: 'admin:users', view: 'admin', adminTab: 'users', label: 'Người dùng & RBAC', group: 'Quản trị hệ thống' },
];

export const PERSONAL_TABS_META = [
  { keyId: 'view:chat', view: 'chat', label: 'Phòng khám (Chat)', group: 'Lâm sàng & Cá nhân' },
  { keyId: 'view:savebox', view: 'savebox', label: 'Save box của tôi', group: 'Lâm sàng & Cá nhân' },
  { keyId: 'view:profile', view: 'profile', label: 'Hồ sơ cá nhân', group: 'Lâm sàng & Cá nhân' },
  { keyId: 'view:settings', view: 'settings', label: 'Cài đặt hệ thống', group: 'Lâm sàng & Cá nhân' },
];

export function getOrderedTabsForRole(role) {
  if (role === 'admin') {
    return [...ADMIN_TABS_META, ...PERSONAL_TABS_META];
  }
  return [...PERSONAL_TABS_META];
}

export function getDefaultShortcuts(role) {
  const tabs = getOrderedTabsForRole(role);
  const map = {};
  tabs.forEach((t, index) => {
    map[t.keyId] = `F${index + 1}`;
  });
  return map;
}

function getStorageKey(role) {
  return `medrag-sidebar-shortcuts-${role || 'user'}`;
}

export function loadShortcuts(role) {
  const defaults = getDefaultShortcuts(role);
  try {
    const raw = localStorage.getItem(getStorageKey(role));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { ...defaults, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function saveShortcuts(role, shortcutMap) {
  try {
    localStorage.setItem(getStorageKey(role), JSON.stringify(shortcutMap));
  } catch {
    /* ignore */
  }
}

export function resetShortcuts(role) {
  const defaults = getDefaultShortcuts(role);
  saveShortcuts(role, defaults);
  return defaults;
}

/**
 * Chuẩn hoá sự kiện bàn phím thành chuỗi phím tắt (VD: "F1", "Alt+1", "Ctrl+K")
 */
export function eventToShortcutString(e) {
  const ignoredKeys = ['Control', 'Alt', 'Shift', 'Meta'];
  if (ignoredKeys.includes(e.key)) return null;

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let mainKey = e.key;
  if (/^F([1-9]|1[0-2])$/i.test(mainKey)) {
    mainKey = mainKey.toUpperCase();
  } else if (mainKey === ' ') {
    mainKey = 'Space';
  } else if (mainKey.length === 1) {
    mainKey = mainKey.toUpperCase();
  }

  parts.push(mainKey);
  return parts.join('+');
}
