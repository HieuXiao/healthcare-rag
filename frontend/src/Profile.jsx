import { useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [form, setForm] = useState({
    username: user.username || '',
    full_name: user.full_name || '',
    title: user.title || '',
    specialty: user.specialty || '',
    workplace: user.workplace || '',
    personalization: user.personalization || '',
  });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      const updated = await api.updateProfile(form);
      setUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Lỗi lưu hồ sơ');
    } finally {
      setBusy(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    setError('');
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medrag-personal-data-${user.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Không thể trích xuất dữ liệu');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm(
      '⚠️ XÁC NHẬN XOÁ VĨNH VIỄN TÀI KHOẢN (GDPR Art. 17):\n\n' +
      'Toàn bộ hồ sơ cá nhân, lịch sử hội thoại và tài liệu trong mục Lưu trữ sẽ bị xoá vĩnh viễn khỏi hệ thống và Vector DB. Bạn có chắc chắn muốn tiếp tục?'
    )) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteMyAccount();
      logout();
    } catch (err) {
      setError(err.message || 'Không thể xoá tài khoản');
      setBusy(false);
    }
  };

  return (
    <div className="page-pad">
      <div className="panel narrow">
        <div className="panel-head">
          <div>
            <h3>👤 Hồ sơ cá nhân</h3>
            <p className="panel-sub">Thông tin này giúp trợ lý cá nhân hoá câu trả lời theo chuyên khoa và sở thích của bạn.</p>
          </div>
        </div>

        <form onSubmit={save} className="profile-form">
          <div className="form-grid">
            <Field label="Email" value={user.email} disabled />
            <Field label="Vai trò" value={user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'} disabled />
            <Field label="Tên hiển thị" value={form.username} onChange={set('username')} />
            <Field label="Họ tên đầy đủ" value={form.full_name} onChange={set('full_name')} />
            <Field label="Chức danh" value={form.title} onChange={set('title')} placeholder="Bác sĩ, Điều dưỡng…" />
            <Field label="Chuyên khoa" value={form.specialty} onChange={set('specialty')} placeholder="Nội tiết, Tim mạch…" />
            <Field label="Nơi công tác" value={form.workplace} onChange={set('workplace')} full />
          </div>
          <label className="field full">
            <span>Yêu cầu riêng về cách trả lời (cá nhân hoá)</span>
            <textarea rows={3} value={form.personalization} onChange={set('personalization')}
                      placeholder="Ví dụ: Trả lời ngắn gọn, ưu tiên liều dùng và chống chỉ định, kèm cảnh báo tương tác thuốc." />
          </label>

          {error && <div className="auth-error">⚠️ {error}</div>}
          {saved && <div className="save-ok">✅ Đã lưu hồ sơ. Câu trả lời tiếp theo sẽ được cá nhân hoá.</div>}

          <button type="submit" className="auth-submit" disabled={busy} style={{ maxWidth: 220 }}>
            {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </form>
      </div>

      {/* Quyền Dữ liệu Cá nhân theo chuẩn GDPR & Nghị định 13/2023/NĐ-CP */}
      <div className="panel narrow">
        <div className="panel-head">
          <div>
            <h3>🛡️ Quyền Riêng tư &amp; Kiểm soát Dữ liệu Cá nhân (GDPR / NĐ 13/2023)</h3>
            <p className="panel-sub">
              Dữ liệu hội thoại và tài liệu trong mục Lưu trữ được cô lập hoàn toàn; ngay cả Quản trị viên hệ thống cũng không có quyền đọc nội dung. Bạn toàn quyền trích xuất hoặc xoá vĩnh viễn dữ liệu của mình.
            </p>
          </div>
        </div>

        <div className="gdpr-actions-row">
          <button type="button" className="mini-btn" onClick={handleExportData} disabled={exporting}>
            {exporting ? 'Đang xuất JSON…' : '📥 Tải xuống toàn bộ dữ liệu cá nhân (GDPR Art. 15 & 20)'}
          </button>
          <button type="button" className="mini-btn danger" onClick={handleDeleteAccount} disabled={busy}>
            🗑️ Xoá vĩnh viễn tài khoản &amp; dữ liệu (GDPR Art. 17)
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder, full }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      <input type="text" value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} />
    </label>
  );
}
