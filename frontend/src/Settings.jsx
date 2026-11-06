import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import {
  eventToShortcutString,
  getDefaultShortcuts,
  getOrderedTabsForRole,
  resetShortcuts,
  saveShortcuts,
} from './shortcuts.js';

const PRESET_KEYS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9',
];

export default function Settings({ shortcuts, onUpdateShortcuts }) {
  const { user } = useAuth();
  const role = user?.role || 'user';
  const tabs = getOrderedTabsForRole(role);
  const defaults = getDefaultShortcuts(role);

  const [recordingKeyId, setRecordingKeyId] = useState(null);
  const [notice, setNotice] = useState('');

  const assignShortcut = (targetKeyId, newShortcut) => {
    const updated = { ...shortcuts };
    let swapMsg = '';

    if (newShortcut) {
      // Nếu phím tắt mới đang được gán cho một tab khác -> tự động hoán đổi để tránh trùng lặp
      const conflictEntry = Object.entries(updated).find(
        ([k, val]) => k !== targetKeyId && val && val.toUpperCase() === newShortcut.toUpperCase()
      );
      if (conflictEntry) {
        const [conflictKeyId] = conflictEntry;
        const oldTargetKey = updated[targetKeyId] || '';
        updated[conflictKeyId] = oldTargetKey;
        const conflictTab = tabs.find((t) => t.keyId === conflictKeyId);
        if (conflictTab) {
          swapMsg = ` (Đã hoán đổi với "${conflictTab.label}")`;
        }
      }
    }

    updated[targetKeyId] = newShortcut;
    saveShortcuts(role, updated);
    onUpdateShortcuts(updated);

    const targetTab = tabs.find((t) => t.keyId === targetKeyId);
    setNotice(
      newShortcut
        ? `✅ Đã gán phím tắt [${newShortcut}] cho "${targetTab?.label}"${swapMsg}.`
        : `ℹ️ Đã tắt phím tắt của "${targetTab?.label}".`
    );
  };

  useEffect(() => {
    if (!recordingKeyId) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingKeyId(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        assignShortcut(recordingKeyId, '');
        setRecordingKeyId(null);
        return;
      }

      const str = eventToShortcutString(e);
      if (!str) return;

      assignShortcut(recordingKeyId, str);
      setRecordingKeyId(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingKeyId, shortcuts]);

  const handleReset = () => {
    const fresh = resetShortcuts(role);
    onUpdateShortcuts(fresh);
    setRecordingKeyId(null);
    setNotice(`✅ Đã khôi phục phím tắt mặc định theo thứ tự từ trên xuống (F1 → F${tabs.length}).`);
  };

  return (
    <div className="page-pad">
      <div className="panel" style={{ maxWidth: 880 }}>
        <div className="panel-head">
          <div>
            <h3>⌨️ Cài đặt Phím tắt Điều hướng Sidebar</h3>
            <p className="panel-sub">
              Nhấn trực tiếp các phím <code>F1</code>, <code>F2</code>,... ở bất kỳ đâu để chuyển nhanh giữa các tab trên Sidebar.
              Mặc định phím tắt được đánh số tự động theo thứ tự từ trên xuống dưới.
            </p>
          </div>
          <button type="button" className="mini-btn" onClick={handleReset} title="Đặt lại theo thứ tự từ trên xuống">
            ↺ Khôi phục mặc định (F1 → F{tabs.length})
          </button>
        </div>

        {notice && (
          <div className="save-ok" style={{ marginBottom: 16 }}>
            {notice}
          </div>
        )}

        <div className="shortcut-table">
          <div className="shortcut-head">
            <span>TT</span>
            <span>Tên Tab trên Sidebar</span>
            <span>Nhóm</span>
            <span>Phím tắt hiện tại</span>
            <span>Tuỳ chỉnh</span>
          </div>

          {tabs.map((tab, idx) => {
            const currentKey = shortcuts[tab.keyId] ?? defaults[tab.keyId] ?? '';
            const isRecording = recordingKeyId === tab.keyId;

            return (
              <div key={tab.keyId} className={`shortcut-row ${isRecording ? 'recording' : ''}`}>
                <span className="shortcut-idx">#{idx + 1}</span>
                <div className="shortcut-info">
                  <span className="shortcut-label">{tab.label}</span>
                  <span className="shortcut-default-hint">Mặc định: {defaults[tab.keyId]}</span>
                </div>
                <span className="shortcut-group-tag">{tab.group}</span>

                <div>
                  {currentKey ? (
                    <kbd className="kbd-badge large">{currentKey}</kbd>
                  ) : (
                    <span className="shortcut-none">Đã tắt</span>
                  )}
                </div>

                <div className="shortcut-actions">
                  <button
                    type="button"
                    className={`record-key-btn ${isRecording ? 'active' : ''}`}
                    onClick={() => setRecordingKeyId(isRecording ? null : tab.keyId)}
                  >
                    {isRecording ? '🔴 Nhấn 1 phím... (Esc huỷ)' : '⌨️ Nhấn phím mới'}
                  </button>

                  <select
                    className="ctl shortcut-select"
                    value={PRESET_KEYS.includes(currentKey) ? currentKey : currentKey ? '__custom__' : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') return;
                      assignShortcut(tab.keyId, val);
                    }}
                    title="Chọn nhanh phím tắt"
                  >
                    <option value="">-- Tắt --</option>
                    {PRESET_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                    {currentKey && !PRESET_KEYS.includes(currentKey) && (
                      <option value="__custom__">{currentKey} (Tuỳ chỉnh)</option>
                    )}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="shortcut-tips">
          <strong>💡 Mẹo sử dụng:</strong>
          <ul>
            <li>Bạn có thể bấm nút <strong>"⌨️ Nhấn phím mới"</strong> rồi bấm trực tiếp phím trên bàn phím (hỗ trợ <code>F1</code>–<code>F12</code> hoặc tổ hợp như <code>Alt+1</code>, <code>Ctrl+1</code>).</li>
            <li>Nếu bạn chọn một phím đã được dùng ở tab khác, hệ thống sẽ <strong>tự động hoán đổi</strong> phím giữa 2 tab để không bao giờ bị xung đột.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
