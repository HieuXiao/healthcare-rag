import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export default function AdminPanel({ tab = 'dashboard', onSelectTab }) {
  const currentTab = tab || 'dashboard';

  return (
    <div className="page-pad admin-container">
      {/* Top tabs đồng bộ với AdminSidebar */}
      <div className="admin-tabs">
        <button
          className={currentTab === 'dashboard' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('dashboard')}
        >
          📊 Tổng quan Dashboard
        </button>
        <button
          className={currentTab === 'chats' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('chats')}
        >
          💬 Nhật ký Hỏi đáp & Bám nguồn
        </button>
        <button
          className={currentTab === 'auth-logs' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('auth-logs')}
        >
          🔐 Xác thực & Kiểm toán
        </button>
        <button
          className={currentTab === 'docs' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('docs')}
        >
          🏛️ Tài liệu gốc
        </button>
        <button
          className={currentTab === 'users' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('users')}
        >
          👥 Người dùng
        </button>
      </div>

      {currentTab === 'dashboard' && <Dashboard onNavigateTab={onSelectTab} />}
      {currentTab === 'chats' && <ChatLogsView />}
      {currentTab === 'auth-logs' && <AuthLogsView />}
      {currentTab === 'docs' && <SystemDocs />}
      {currentTab === 'users' && <Users />}
    </div>
  );
}

/* ==========================================================================
   1. DASHBOARD CHÍNH: KPI + 4 BIỂU ĐỒ Y KHOA + HOẠT ĐỘNG TÁCH BẠCH
   ========================================================================== */
function Dashboard({ onNavigateTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activityTab, setActivityTab] = useState('chats'); // 'chats' | 'auth'

  useEffect(() => {
    api.adminActivity().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="auth-error">⚠️ Lỗi tải dữ liệu: {error}</div>;
  if (!data) return <div className="conv-empty">Đang tổng hợp dữ liệu lâm sàng và kiểm toán…</div>;

  const s = data.stats || {};
  const avgGrounded = s.avg_grounded_ratio != null ? `${Math.round(s.avg_grounded_ratio * 100)}%` : '—';
  const graphStats = data.graph_stats || { total_entities: 15, total_triples: 17, entity_types: [] };
  const groundingDist = data.grounding_dist || { high: 0, medium: 0, low: 0 };
  const chatLogs = data.chat_logs || [];
  const authLogs = data.auth_logs || [];

  return (
    <>
      {/* 1. Dải thẻ chỉ số KPI cốt lõi */}
      <div className="stat-grid admin-kpi-grid">
        <StatCard icon="👥" label="Người dùng" value={s.total_users || 0} hint="Tài khoản trong hệ thống" />
        <StatCard icon="💬" label="Tổng lượt hỏi RAG" value={s.total_chats || 0} hint={`${s.chats_today || 0} câu hỏi hôm nay`} />
        <StatCard icon="📄" label="Tài liệu tri thức" value={s.total_documents || 0} hint={`${s.system_documents || 1} gốc · ${s.user_documents || 0} Save box`} />
        <StatCard
          icon="🎯"
          label="Bám nguồn TB"
          value={avgGrounded}
          hint={s.avg_grounded_ratio >= 0.7 ? '🟢 Đạt chuẩn lâm sàng' : s.avg_grounded_ratio >= 0.4 ? '🟡 Cần đối chiếu thêm' : '🔴 Cảnh báo ảo giác'}
          highlight
        />
        <StatCard
          icon="🕸️"
          label="Knowledge Graph"
          value={`${graphStats.total_entities} thực thể`}
          hint={`${graphStats.total_triples} quan hệ (Triples)`}
        />
      </div>

      {/* 2. Lưới biểu đồ phân tích chuyên sâu cho Healthcare RAG */}
      <div className="charts-grid">
        {/* Biểu đồ 1: Med-FactCheck Phân bổ Bám nguồn */}
        <div className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h3>🎯 Kiểm tra bám nguồn (Med-FactCheck)</h3>
              <p className="panel-sub">Độ tin cậy trích dẫn y văn & phát hiện ảo giác câu trả lời</p>
            </div>
          </div>
          <FactCheckDonutChart dist={groundingDist} avg={avgGrounded} total={s.total_chats || 0} />
        </div>

        {/* Biểu đồ 2: Cấu trúc Tri thức Knowledge Graph */}
        <div className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h3>🕸️ Cấu trúc Tri thức Y khoa</h3>
              <p className="panel-sub">Phân bổ thực thể theo bệnh, thuốc & tác dụng phụ trong đồ thị</p>
            </div>
          </div>
          <KnowledgeGraphBarChart entityTypes={graphStats.entity_types} />
        </div>

        {/* Biểu đồ 3: Xu hướng Truy vấn theo ngày */}
        <div className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h3>📈 Xu hướng truy vấn & Điểm bám nguồn</h3>
              <p className="panel-sub">Số lượng câu hỏi y khoa và điểm trung thực theo ngày</p>
            </div>
          </div>
          <TimelineTrendChart timeline={data.timeline || []} />
        </div>

        {/* Biểu đồ 4: Tỉ lệ gọi Model AI */}
        <div className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h3>⚡ Tần suất sử dụng Model AI</h3>
              <p className="panel-sub">Phân bổ tải giữa các phiên bản Gemini LLM</p>
            </div>
          </div>
          <ModelUsageBars perModel={data.per_model || []} />
        </div>
      </div>

      {/* 3. Hoạt động gần đây: ĐÃ TÁCH BIỆT RÕ RÀNG GIỮA CHAT VÀ AUTH */}
      <div className="panel activity-section-panel">
        <div className="panel-head activity-head-tabs">
          <div>
            <h3>📋 Nhật ký hoạt động gần đây</h3>
            <p className="panel-sub">Dữ liệu được phân tách rõ ràng giữa hỏi đáp chuyên môn và xác thực hệ thống</p>
          </div>
          <div className="activity-tabs-switch">
            <button
              className={`act-tab-btn ${activityTab === 'chats' ? 'active' : ''}`}
              onClick={() => setActivityTab('chats')}
            >
              💬 Truy vấn lâm sàng ({chatLogs.length})
            </button>
            <button
              className={`act-tab-btn ${activityTab === 'auth' ? 'active' : ''}`}
              onClick={() => setActivityTab('auth')}
            >
              🔐 Đăng nhập & Đăng ký ({authLogs.length})
            </button>
          </div>
        </div>

        {/* BẢNG 1: TRUY VẤN LÂM SÀNG & BÁM NGUỒN */}
        {activityTab === 'chats' && (
          <div className="activity-tab-content">
            {chatLogs.length === 0 ? (
              <div className="conv-empty">Chưa có câu hỏi nào từ người dùng.</div>
            ) : (
              <div className="log-table chat-activity-table">
                <div className="log-head">
                  <span>Thời gian</span>
                  <span>Bác sĩ / Người hỏi</span>
                  <span>Câu hỏi lâm sàng</span>
                  <span>Model AI</span>
                  <span>Bám nguồn</span>
                </div>
                {chatLogs.slice(0, 10).map((r) => (
                  <div key={r.id} className="log-row">
                    <span className="log-time">{fmt(r.created_at)}</span>
                    <span className="log-user" title={r.user_email}>{r.user}</span>
                    <span className="log-detail query-text" title={r.query}>{r.query}</span>
                    <span className="log-mono">{r.model}</span>
                    <span><GroundingBadge ratio={r.grounded_ratio} /></span>
                  </div>
                ))}
              </div>
            )}
            <div className="activity-footer">
              <button className="link-action-btn" onClick={() => onNavigateTab && onNavigateTab('chats')}>
                Xem toàn bộ lịch sử hỏi đáp lâm sàng & Fact-Check →
              </button>
            </div>
          </div>
        )}

        {/* BẢNG 2: XÁC THỰC & BẢO MẬT */}
        {activityTab === 'auth' && (
          <div className="activity-tab-content">
            {authLogs.length === 0 ? (
              <div className="conv-empty">Chưa có bản ghi xác thực nào.</div>
            ) : (
              <div className="log-table auth-activity-table">
                <div className="log-head">
                  <span>Thời gian</span>
                  <span>Tài khoản</span>
                  <span>Hành động</span>
                  <span>Chi tiết sự kiện</span>
                </div>
                {authLogs.slice(0, 10).map((r) => (
                  <div key={r.id} className="log-row auth-row">
                    <span className="log-time">{fmt(r.created_at)}</span>
                    <span className="log-user" title={r.user_email}>{r.user}</span>
                    <span><ActionBadge action={r.action} /></span>
                    <span className="log-detail" title={r.detail}>{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="activity-footer">
              <button className="link-action-btn" onClick={() => onNavigateTab && onNavigateTab('auth-logs')}>
                Xem toàn bộ nhật ký xác thực & kiểm toán bảo mật →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ==========================================================================
   2. TRANG CHI TIẾT 1: NHẬT KÝ HỎI ĐÁP & BÁM NGUỒN (CHATS VIEW)
   ========================================================================== */
function ChatLogsView() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'high' | 'medium' | 'low'
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminActivity()
      .then((d) => setLogs(d.chat_logs || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((item) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const match = (item.query || '').toLowerCase().includes(q) ||
                    (item.user || '').toLowerCase().includes(q) ||
                    (item.model || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    const r = item.grounded_ratio ?? 0;
    if (filter === 'high') return r >= 0.7;
    if (filter === 'medium') return r >= 0.4 && r < 0.7;
    if (filter === 'low') return r < 0.4;
    return true;
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>💬 Nhật ký Truy vấn Lâm sàng & Đánh giá Bám nguồn (Med-FactCheck)</h3>
          <p className="panel-sub">Toàn bộ câu hỏi của bác sĩ, mô hình ngôn ngữ phản hồi và tỉ lệ bám nguồn tri thức</p>
        </div>
      </div>

      {/* Bộ lọc và tìm kiếm */}
      <div className="filter-bar">
        <input
          type="text"
          className="ctl filter-search"
          placeholder="🔍 Tìm câu hỏi, tên bác sĩ, model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-pill-group">
          <button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            Tất cả ({logs.length})
          </button>
          <button className={`filter-pill pill-high ${filter === 'high' ? 'active' : ''}`} onClick={() => setFilter('high')}>
            🟢 An toàn (≥70%)
          </button>
          <button className={`filter-pill pill-med ${filter === 'medium' ? 'active' : ''}`} onClick={() => setFilter('medium')}>
            🟡 Cần lưu ý (40-69%)
          </button>
          <button className={`filter-pill pill-low ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>
            🔴 Ảo giác (&lt;40%)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="conv-empty">Đang tải danh sách câu hỏi…</div>
      ) : filtered.length === 0 ? (
        <div className="conv-empty">Không tìm thấy truy vấn nào phù hợp.</div>
      ) : (
        <div className="log-table chat-activity-table full-table">
          <div className="log-head">
            <span>Thời gian</span>
            <span>Người hỏi</span>
            <span>Nội dung câu hỏi lâm sàng</span>
            <span>Model AI</span>
            <span>Fact-Check Overlap</span>
          </div>
          {filtered.map((r) => (
            <div key={r.id} className="log-row">
              <span className="log-time">{fmt(r.created_at)}</span>
              <span className="log-user" title={r.user_email}>{r.user}</span>
              <span className="log-detail query-text expanded" title={r.query}>{r.query}</span>
              <span className="log-mono">{r.model}</span>
              <span><GroundingBadge ratio={r.grounded_ratio} showDetail /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   3. TRANG CHI TIẾT 2: LỊCH SỬ XÁC THỰC & BẢO MẬT (AUTH LOGS VIEW)
   ========================================================================== */
function AuthLogsView() {
  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminActivity()
      .then((d) => setLogs(d.auth_logs || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((item) => {
    if (actionFilter !== 'all' && item.action !== actionFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match = (item.user || '').toLowerCase().includes(q) ||
                    (item.detail || '').toLowerCase().includes(q) ||
                    (item.user_email || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>🔐 Nhật ký Xác thực & Kiểm toán Bảo mật (Audit Log)</h3>
          <p className="panel-sub">Theo dõi các lượt Đăng nhập, Đăng ký tài khoản và hoạt động tải lên tài liệu y khoa</p>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          className="ctl filter-search"
          placeholder="🔍 Tìm người dùng, email, sự kiện..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-pill-group">
          <button className={`filter-pill ${actionFilter === 'all' ? 'active' : ''}`} onClick={() => setActionFilter('all')}>
            Tất cả ({logs.length})
          </button>
          <button className={`filter-pill ${actionFilter === 'login' ? 'active' : ''}`} onClick={() => setActionFilter('login')}>
            🔵 Đăng nhập
          </button>
          <button className={`filter-pill ${actionFilter === 'register' ? 'active' : ''}`} onClick={() => setActionFilter('register')}>
            🟣 Đăng ký
          </button>
          <button className={`filter-pill ${actionFilter === 'upload' ? 'active' : ''}`} onClick={() => setActionFilter('upload')}>
            🟢 Upload Save box
          </button>
          <button className={`filter-pill ${actionFilter === 'admin_upload' ? 'active' : ''}`} onClick={() => setActionFilter('admin_upload')}>
            🛡️ Upload Tài liệu gốc
          </button>
        </div>
      </div>

      {loading ? (
        <div className="conv-empty">Đang tải nhật ký bảo mật…</div>
      ) : filtered.length === 0 ? (
        <div className="conv-empty">Không có nhật ký nào phù hợp.</div>
      ) : (
        <div className="log-table auth-activity-table full-table">
          <div className="log-head">
            <span>Thời gian</span>
            <span>Tài khoản</span>
            <span>Hành động</span>
            <span>Chi tiết sự kiện / Địa chỉ</span>
          </div>
          {filtered.map((r) => (
            <div key={r.id} className="log-row auth-row">
              <span className="log-time">{fmt(r.created_at)}</span>
              <span className="log-user" title={r.user_email}>{r.user}</span>
              <span><ActionBadge action={r.action} /></span>
              <span className="log-detail" title={r.detail}>{r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   4. CÁC BIỂU ĐỒ Y KHOA SVG THUẦN (MODERN CLINICAL SVG CHARTS)
   ========================================================================== */

/** Biểu đồ Donut: Phân bổ Bám nguồn (Fact-Check) */
function FactCheckDonutChart({ dist, avg, total }) {
  const high = dist.high || 0;
  const med = dist.medium || 0;
  const low = dist.low || 0;
  const sum = high + med + low;

  // Nếu chưa có dữ liệu, hiển thị placeholder thân thiện
  const pHigh = sum ? (high / sum) * 100 : 0;
  const pMed = sum ? (med / sum) * 100 : 0;
  const pLow = sum ? (low / sum) * 100 : 0;

  // Tính chu vi SVG circle (r = 45 -> C ≈ 282.74)
  const C = 282.74;
  const lenHigh = (pHigh / 100) * C;
  const lenMed = (pMed / 100) * C;
  const lenLow = (pLow / 100) * C;

  return (
    <div className="donut-chart-container">
      <div className="donut-visual">
        <svg viewBox="0 0 120 120" className="donut-svg">
          <circle cx="60" cy="60" r="45" className="donut-bg" />
          {sum > 0 ? (
            <>
              {/* Vạch High (Green) */}
              <circle
                cx="60" cy="60" r="45"
                className="donut-segment segment-high"
                strokeDasharray={`${lenHigh} ${C - lenHigh}`}
                strokeDashoffset="0"
              />
              {/* Vạch Med (Yellow) */}
              <circle
                cx="60" cy="60" r="45"
                className="donut-segment segment-med"
                strokeDasharray={`${lenMed} ${C - lenMed}`}
                strokeDashoffset={-lenHigh}
              />
              {/* Vạch Low (Red) */}
              <circle
                cx="60" cy="60" r="45"
                className="donut-segment segment-low"
                strokeDasharray={`${lenLow} ${C - lenLow}`}
                strokeDashoffset={-(lenHigh + lenMed)}
              />
            </>
          ) : (
            <circle cx="60" cy="60" r="45" className="donut-segment segment-empty" strokeDasharray={`${C} 0`} />
          )}
        </svg>
        <div className="donut-center-text">
          <span className="donut-val">{avg}</span>
          <span className="donut-sub">Bám nguồn TB</span>
        </div>
      </div>

      <div className="donut-legend">
        <div className="legend-item">
          <span className="legend-dot dot-high" />
          <div className="legend-info">
            <span className="legend-title">Bám nguồn cao (≥70%)</span>
            <span className="legend-desc">Khớp y văn · An toàn lâm sàng</span>
          </div>
          <span className="legend-val">{high}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-med" />
          <div className="legend-info">
            <span className="legend-title">Cần lưu ý (40-69%)</span>
            <span className="legend-desc">Khớp 1 phần · Cần đối chiếu</span>
          </div>
          <span className="legend-val">{med}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-low" />
          <div className="legend-info">
            <span className="legend-title">Cảnh báo ảo giác (&lt;40%)</span>
            <span className="legend-desc">Thiếu trích dẫn · Rủi ro y khoa</span>
          </div>
          <span className="legend-val">{low}</span>
        </div>
      </div>
    </div>
  );
}

/** Biểu đồ Thanh ngang: Knowledge Graph Ontology Coverage */
function KnowledgeGraphBarChart({ entityTypes = [] }) {
  const max = Math.max(...entityTypes.map((t) => t.count), 1);

  return (
    <div className="kg-chart-container">
      {entityTypes.length === 0 ? (
        <div className="conv-empty">Chưa có dữ liệu thực thể đồ thị.</div>
      ) : (
        <div className="kg-bar-list">
          {entityTypes.map((t, idx) => {
            const p = Math.round((t.count / max) * 100);
            return (
              <div key={t.type} className="kg-bar-row">
                <span className="kg-label">
                  <span className="kg-icon">{getOntologyIcon(t.type)}</span>
                  {t.type}
                </span>
                <div className="kg-track">
                  <div
                    className={`kg-fill fill-theme-${idx % 5}`}
                    style={{ width: `${p}%` }}
                  />
                </div>
                <span className="kg-val">{t.count} mục</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="kg-footer-hint">
        <span>ICD-10 Ontology · Phác đồ Đái tháo đường & Thuốc thiết yếu WHO</span>
      </div>
    </div>
  );
}

/** Biểu đồ Xu hướng Hoạt động & Điểm Bám nguồn theo ngày */
function TimelineTrendChart({ timeline = [] }) {
  if (!timeline || timeline.length === 0) {
    return <div className="conv-empty">Chưa đủ dữ liệu mốc thời gian.</div>;
  }

  const maxTotal = Math.max(...timeline.map((t) => t.total_actions || 1), 1);

  return (
    <div className="timeline-chart-wrap">
      <div className="timeline-bars">
        {timeline.map((item) => {
          const hPercent = Math.max(Math.round((item.total_actions / maxTotal) * 100), 12);
          const shortDate = item.date ? item.date.slice(5) : '—';
          return (
            <div key={item.date} className="t-col">
              <div className="t-col-track" title={`${item.date}: ${item.chats} câu hỏi (${item.total_actions} sự kiện), Bám nguồn: ${item.avg_grounded}%`}>
                <div className="t-col-fill" style={{ height: `${hPercent}%` }}>
                  <span className="t-col-val">{item.chats || item.total_actions}</span>
                </div>
              </div>
              <span className="t-col-date">{shortDate}</span>
              <span className="t-col-ground" title="Điểm bám nguồn TB">{item.avg_grounded ? `${item.avg_grounded}%` : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="timeline-legend">
        <span>📊 Chiều cao: Số lượt truy vấn</span>
        <span>🎯 % bên dưới: Điểm bám nguồn TB theo ngày</span>
      </div>
    </div>
  );
}

/** Biểu đồ Model Usage */
function ModelUsageBars({ perModel = [] }) {
  if (!perModel || perModel.length === 0) {
    return <div className="conv-empty">Chưa có lượt truy vấn model nào.</div>;
  }
  const max = Math.max(...perModel.map((m) => m.count), 1);

  return (
    <div className="model-chart-wrap">
      <div className="bar-list">
        {perModel.map((m) => (
          <div key={m.model} className="bar-row">
            <span className="bar-label">{m.model}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(m.count / max) * 100}%` }} />
            </span>
            <span className="bar-val">{m.count}</span>
          </div>
        ))}
      </div>
      <div className="model-tip-banner">
        <span>⚡ Hệ thống kích hoạt Gemini 3.5 Flash với cơ chế Retry 503 & Failover tự động.</span>
      </div>
    </div>
  );
}

/* ==========================================================================
   5. CÁC COMPONENT GỐC ĐÃ NÂNG CẤP: SYSTEM DOCS & USERS
   ========================================================================== */
function SystemDocs() {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  const load = () =>
    api.adminDocuments()
      .then((d) => setDocs(d.documents || []))
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await api.adminUploadDocument(file, note);
      setNote('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onToggle = async (id) => {
    try {
      await api.adminToggleDocument(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm('Xoá tài liệu gốc này khỏi hệ thống tri thức dùng chung?')) return;
    try {
      await api.adminDeleteDocument(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>🏛️ Quản lý Tài liệu gốc Hệ thống</h3>
          <p className="panel-sub">
            Tri thức nền tảng dùng chung cho tất cả bác sĩ. Tài liệu nạp ở đây sẽ được cắt đoạn (Chunking),
            tính vector nhúng (Embedding) và đưa vào Hybrid Search.
          </p>
        </div>
      </div>

      <div className="upload-row">
        <input
          type="text"
          className="ctl"
          placeholder="Ghi chú tài liệu (ví dụ: Phác đồ BYT 2024)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <label className={`upload-btn ${uploading ? 'disabled' : ''}`}>
          {uploading ? 'Đang nhúng vector…' : '⬆️ Nạp tài liệu hệ thống'}
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={onUpload} disabled={uploading} hidden />
        </label>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}

      {docs.length === 0 ? (
        <div className="conv-empty">Chưa có tài liệu gốc nào được nạp.</div>
      ) : (
        <div className="doc-table">
          {docs.map((d) => (
            <div key={d.id} className="doc-row">
              <span className="doc-icon">{d.is_base ? '📘' : '📄'}</span>
              <div className="doc-main">
                <div className="doc-name">
                  {d.filename} {d.is_base && <span className="base-tag">gốc</span>}
                </div>
                <div className="doc-meta">
                  {d.num_chunks} đoạn (chunks){d.note ? ` · ${d.note}` : ''}
                </div>
              </div>
              <span className={`doc-status ${d.active ? 'on' : 'off'}`}>
                {d.active ? 'Đang truy xuất' : 'Đã tạm dừng'}
              </span>
              <div className="doc-actions">
                <button className="mini-btn" onClick={() => onToggle(d.id)}>
                  {d.active ? 'Tắt' : 'Bật'}
                </button>
                {!d.is_base && (
                  <button className="mini-btn danger" onClick={() => onDelete(d.id)}>
                    Xoá
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminUsers()
      .then((d) => setUsers(d.users || []))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="auth-error">⚠️ {error}</div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>👥 Quản lý Người dùng ({users.length})</h3>
          <p className="panel-sub">Danh sách tài khoản bác sĩ, chuyên khoa điều trị và khối lượng truy vấn</p>
        </div>
      </div>
      <div className="log-table users-table">
        <div className="log-head">
          <span>ID</span>
          <span>Tên bác sĩ</span>
          <span>Email</span>
          <span>Vai trò</span>
          <span>Chuyên khoa</span>
          <span>Hội thoại</span>
          <span>Lượt hỏi</span>
        </div>
        {users.map((u) => (
          <div key={u.id} className="log-row">
            <span>{u.id}</span>
            <span className="log-user font-bold">{u.username}</span>
            <span className="log-detail">{u.email}</span>
            <span>
              <span className={`tag ${u.role === 'admin' ? 'tag-admin' : ''}`}>
                {u.role === 'admin' ? 'Quản trị' : 'Bác sĩ'}
              </span>
            </span>
            <span>{u.specialty || 'Đa khoa'}</span>
            <span>{u.conversations}</span>
            <span>{u.chats}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
   6. CÁC HELPER VÀ BADGES
   ========================================================================== */
function StatCard({ icon, label, value, hint, highlight }) {
  return (
    <div className={`stat-card ${highlight ? 'card-highlight' : ''}`}>
      <div className="stat-card-top">
        <span className="stat-icon">{icon}</span>
        {highlight && <span className="stat-kpi-badge">Chỉ số an toàn</span>}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function GroundingBadge({ ratio, showDetail }) {
  if (ratio == null) return <span className="ground-pill pill-none">—</span>;
  const p = Math.round(ratio * 100);
  if (ratio >= 0.7) {
    return (
      <span className="ground-pill pill-safe" title={`Tỉ lệ bám nguồn: ${p}%`}>
        🟢 {p}% {showDetail && '· An toàn'}
      </span>
    );
  }
  if (ratio >= 0.4) {
    return (
      <span className="ground-pill pill-warn" title={`Tỉ lệ bám nguồn: ${p}%`}>
        🟡 {p}% {showDetail && '· Cần lưu ý'}
      </span>
    );
  }
  return (
    <span className="ground-pill pill-danger" title={`Tỉ lệ bám nguồn: ${p}%`}>
      🔴 {p}% {showDetail && '· Nguy cơ ảo giác'}
    </span>
  );
}

function ActionBadge({ action }) {
  const map = {
    login: { label: 'Đăng nhập', cls: 'tag-login' },
    register: { label: 'Đăng ký', cls: 'tag-register' },
    upload: { label: 'Save box', cls: 'tag-upload' },
    admin_upload: { label: 'Upload gốc', cls: 'tag-admin_upload' },
  };
  const item = map[action] || { label: action, cls: 'tag-other' };
  return <span className={`tag ${item.cls}`}>{item.label}</span>;
}

function getOntologyIcon(type) {
  if (type.includes('Bệnh')) return '🩺';
  if (type.includes('Nhóm thuốc')) return '💊';
  if (type.includes('Thuốc')) return '🧪';
  if (type.includes('Tác dụng phụ')) return '⚠️';
  if (type.includes('Biến chứng')) return '🧬';
  if (type.includes('Xét nghiệm')) return '🔬';
  return '📌';
}

function fmt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return iso;
  }
}
