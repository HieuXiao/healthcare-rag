import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

export default function AdminPanel({ tab = 'dashboard', onSelectTab }) {
  const currentTab = tab || 'dashboard';
  const isDashboard = currentTab === 'dashboard';
  const isLogs = currentTab === 'chats';

  return (
    <div className={`page-pad admin-container ${isDashboard || isLogs ? 'admin-viewport-mode' : ''} ${isLogs ? 'logs-mode' : ''}`}>
      {/* Top tabs đồng bộ với AdminSidebar (chỉ hiển thị trên màn hình nhỏ) */}
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
          💬 Nhật ký Truy vấn &amp; Đánh giá RAG
        </button>
        <button
          className={currentTab === 'auth-logs' ? 'active' : ''}
          onClick={() => onSelectTab && onSelectTab('auth-logs')}
        >
          🔐 Xác thực &amp; Kiểm toán
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
          👥 Người dùng &amp; Phân quyền
        </button>
      </div>

      {currentTab === 'dashboard' && <Dashboard onNavigateTab={onSelectTab} />}
      {currentTab === 'chats' && <ChatLogsView onNavigateTab={onSelectTab} />}
      {currentTab === 'auth-logs' && <AuthLogsView />}
      {currentTab === 'docs' && <SystemDocs />}
      {currentTab === 'users' && <Users />}
    </div>
  );
}

/* ==========================================================================
   1. DASHBOARD QUẢN TRỊ — đọc theo thứ tự trái → phải, trên → dưới:
      (1) Hệ thống có ổn không?  → dải chỉ số tổng quan
      (2) Chuyện gì đang xảy ra? → lưu lượng theo ngày + chất lượng câu trả lời
      (3) Cần làm gì?            → danh sách việc cần xử lý
      (4) Xem chi tiết ở đâu?    → nhật ký hoạt động (được lọc bởi mọi thành phần phía trên)
   ========================================================================== */

const QUALITY_META = {
  high: { label: 'Đạt chuẩn', range: '≥70%' },
  medium: { label: 'Cần đối chiếu', range: '40–69%' },
  low: { label: 'Thiếu nguồn', range: '<40%' },
  review: { label: 'Cần xem lại', range: '<70%' },
};

const EMPTY = [];

function matchQuality(ratio, tier) {
  const r = ratio ?? 0;
  if (tier === 'high') return r >= 0.7;
  if (tier === 'medium') return r >= 0.4 && r < 0.7;
  if (tier === 'low') return r < 0.4;
  if (tier === 'review') return r < 0.7;
  return true;
}

function Dashboard({ onNavigateTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Bộ lọc chéo: mọi thành phần phía trên đều lọc bảng Nhật ký phía dưới
  const [qualityFilter, setQualityFilter] = useState(null); // null | 'high' | 'medium' | 'low' | 'review'
  const [selectedDate, setSelectedDate] = useState(null); // null | 'YYYY-MM-DD'
  const [selectedUserAnon, setSelectedUserAnon] = useState(null); // null | 'User_XXXXX'
  const [activityTab, setActivityTab] = useState('chats'); // 'chats' | 'feedback' | 'auth'
  const [selectedLog, setSelectedLog] = useState(null);
  const [quickSearch, setQuickSearch] = useState('');
  const [busyDocId, setBusyDocId] = useState(null);

  const fetchDashboard = () => {
    setRefreshing(true);
    api.adminActivity()
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const chatLogs = data?.chat_logs || EMPTY;
  const authLogs = data?.auth_logs || EMPTY;
  const feedbackLogs = data?.feedback_logs || EMPTY;
  const systemDocs = data?.system_docs || EMPTY;
  const modelQuotas = data?.model_quotas || EMPTY;

  const filteredChats = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    return chatLogs.filter((item) => {
      if (qualityFilter && !matchQuality(item.grounded_ratio, qualityFilter)) return false;
      if (selectedDate && (item.created_at || '').slice(0, 10) !== selectedDate) return false;
      if (selectedUserAnon && item.user !== selectedUserAnon) return false;
      if (q) {
        const hit =
          (item.query || '').toLowerCase().includes(q) ||
          (item.user || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [chatLogs, qualityFilter, selectedDate, selectedUserAnon, quickSearch]);

  // Các vấn đề hệ thống tự phát hiện, sắp theo mức ưu tiên
  const issues = useMemo(() => {
    const list = [];
    modelQuotas
      .filter((q) => (q.usage_percent || 0) >= 80)
      .forEach((q) =>
        list.push({
          key: `quota-${q.name}`,
          level: (q.usage_percent || 0) >= 95 ? 'danger' : 'warn',
          kind: 'quota',
          title: `${q.name} đã dùng ${q.usage_percent}% hạn mức hôm nay`,
          meta: `Còn ${Math.max(0, (q.limit || 0) - (q.used || 0))} lượt gọi trong ngày`,
        })
      );
    systemDocs
      .filter((d) => !d.active || !d.indexed)
      .forEach((d) =>
        list.push({
          key: `doc-${d.id}`,
          level: 'warn',
          kind: 'doc',
          doc: d,
          title: `Tài liệu đang tắt: ${d.filename}`,
          meta: 'AI không dùng tài liệu này để trả lời câu hỏi',
        })
      );
    feedbackLogs.forEach((fb) =>
      list.push({
        key: `fb-${fb.id}`,
        level: 'danger',
        kind: 'feedback',
        log: fb,
        title: `Người dùng báo lỗi: ${fb.reason}`,
        meta: `${fb.user} · ${fmt(fb.created_at)}`,
      })
    );
    chatLogs
      .filter((c) => c.grounded_ratio != null && c.grounded_ratio < 0.4)
      .forEach((c) =>
        list.push({
          key: `low-${c.id}`,
          level: 'danger',
          kind: 'low',
          log: c,
          title: c.query,
          meta: `Thiếu nguồn (${Math.round((c.grounded_ratio || 0) * 100)}%) · ${c.user} · ${fmt(c.created_at)}`,
        })
      );
    return list;
  }, [modelQuotas, systemDocs, feedbackLogs, chatLogs]);

  if (error) return <div className="auth-error">Lỗi tải dữ liệu: {error}</div>;
  if (!data) return <div className="conv-empty">Đang tải dữ liệu tổng quan…</div>;

  const s = data.stats || {};
  const dist = data.grounding_dist || { high: 0, medium: 0, low: 0 };
  const usersSummary = data.users_summary || [];

  const rated = (dist.high || 0) + (dist.medium || 0) + (dist.low || 0);
  const pHigh = rated ? Math.round(((dist.high || 0) / rated) * 100) : null;
  const needReview = (dist.medium || 0) + (dist.low || 0);
  const mediumCount = chatLogs.filter((c) => c.grounded_ratio != null && c.grounded_ratio >= 0.4 && c.grounded_ratio < 0.7).length;

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const active7 = usersSummary.filter((u) => {
    if (!u.last_active) return false;
    const t = Date.parse(u.last_active + (u.last_active.endsWith('Z') ? '' : 'Z'));
    return !Number.isNaN(t) && t >= weekAgo;
  }).length;

  const topQuota = modelQuotas.reduce((best, q) => (!best || (q.usage_percent || 0) > (best.usage_percent || 0) ? q : best), null);
  const quotaPct = topQuota ? topQuota.usage_percent || 0 : null;

  const issueSummary = (() => {
    const parts = [];
    const nLow = issues.filter((i) => i.kind === 'low').length;
    const nFb = issues.filter((i) => i.kind === 'feedback').length;
    const nDoc = issues.filter((i) => i.kind === 'doc').length;
    const nQuota = issues.filter((i) => i.kind === 'quota').length;
    if (nLow) parts.push(`${nLow} câu thiếu nguồn`);
    if (nFb) parts.push(`${nFb} báo lỗi`);
    if (nDoc) parts.push(`${nDoc} tài liệu tắt`);
    if (nQuota) parts.push(`${nQuota} model sắp hết hạn mức`);
    return parts.length ? parts.slice(0, 2).join(' · ') : 'Hệ thống hoạt động ổn định';
  })();

  const hasActiveFilter = Boolean(qualityFilter || selectedDate || selectedUserAnon || quickSearch.trim());

  const clearAllFilters = () => {
    setQualityFilter(null);
    setSelectedDate(null);
    setSelectedUserAnon(null);
    setQuickSearch('');
  };
  const focusChats = () => setActivityTab('chats');
  const toggleQuality = (tier) => {
    focusChats();
    setQualityFilter((prev) => (prev === tier ? null : tier));
  };
  const toggleDate = (d) => {
    focusChats();
    setSelectedDate((prev) => (prev === d ? null : d));
  };
  const toggleUser = (anon) => {
    focusChats();
    setSelectedUserAnon((prev) => (prev === anon ? null : anon));
  };

  const handleToggleDoc = async (docId) => {
    setBusyDocId(docId);
    try {
      await api.adminToggleDocument(docId);
      fetchDashboard();
    } catch {
      /* ignore */
    } finally {
      setBusyDocId(null);
    }
  };

  const tone = (v, okAt, warnAt) => (v == null ? 'neutral' : v >= okAt ? 'ok' : v >= warnAt ? 'warn' : 'danger');

  return (
    <div className="dash-onepage">
      {/* (1) TRẠNG THÁI TỔNG QUAN */}
      <div className="dash-kpi-strip">
        <StatTile
          label="Cần xử lý"
          info="Số vấn đề hệ thống tự phát hiện: câu trả lời thiếu nguồn (<40%), báo lỗi từ người dùng, tài liệu bị tắt và model sắp hết hạn mức. Chi tiết ở khung “Việc cần xử lý” bên dưới."
          value={issues.length}
          sub={issueSummary}
          status={issues.length ? 'danger' : 'ok'}
        />
        <StatTile
          label="Truy vấn hôm nay"
          info="Số câu hỏi người dùng gửi tới hệ thống trong ngày hôm nay. Nhấn để mở trang nhật ký truy vấn đầy đủ."
          value={s.chats_today || 0}
          sub={`Tổng cộng ${s.total_chats || 0} truy vấn`}
          onClick={() => onNavigateTab && onNavigateTab('chats')}
        />
        <StatTile
          label="Câu trả lời đạt chuẩn"
          info="Tỉ lệ câu trả lời có từ 70% nội dung trở lên khớp với tài liệu nguồn. Câu dưới mức này nên được kiểm tra lại. Nhấn để lọc nhật ký chỉ còn các câu cần xem lại."
          value={pHigh == null ? '—' : `${pHigh}%`}
          sub={rated ? `${needReview} / ${rated} câu cần xem lại` : 'Chưa có câu nào được đánh giá'}
          status={tone(pHigh, 70, 40)}
          active={qualityFilter === 'review'}
          onClick={() => toggleQuality('review')}
        />
        <StatTile
          label="Người dùng hoạt động"
          info="Số tài khoản có hoạt động trong 7 ngày qua trên tổng số tài khoản. Nhấn để mở trang quản lý người dùng."
          value={`${active7} / ${s.total_users || 0}`}
          sub="Trong 7 ngày qua"
          onClick={() => onNavigateTab && onNavigateTab('users')}
        />
        <StatTile
          label="Hạn mức API hôm nay"
          info="Mức sử dụng hạn mức gọi API cao nhất trong các model AI hôm nay. Hạn mức được đặt lại mỗi ngày; nên theo dõi khi vượt 80%."
          value={quotaPct == null ? '—' : `${quotaPct}%`}
          sub={topQuota ? `${topQuota.used}/${topQuota.limit} lượt · ${shortModelName(topQuota.name)}` : 'Không có dữ liệu'}
          status={quotaPct == null ? 'neutral' : quotaPct >= 95 ? 'danger' : quotaPct >= 80 ? 'warn' : 'ok'}
        />
      </div>

      <div className="dash-bento-grid">
        {/* (2a) LƯU LƯỢNG THEO NGÀY */}
        <section className="dash-card bento-traffic">
          <CardHead
            title="Lưu lượng truy vấn theo ngày"
            info="Mỗi cột là số câu hỏi trong một ngày có hoạt động (tối đa 14 ngày gần nhất), chia màu theo chất lượng câu trả lời. Di chuột để xem số liệu, nhấn vào cột để lọc nhật ký theo ngày đó."
          >
            {selectedDate && (
              <button className="dash-chip" onClick={() => setSelectedDate(null)}>
                Ngày {fmtDay(selectedDate)} ✕
              </button>
            )}
          </CardHead>
          <DailyQualityChart timeline={data.timeline || []} selectedDate={selectedDate} onSelectDate={toggleDate} />
        </section>

        {/* (2b) CHẤT LƯỢNG CÂU TRẢ LỜI */}
        <section className="dash-card bento-quality">
          <CardHead
            title="Chất lượng câu trả lời"
            info="Mức độ câu trả lời của AI khớp với tài liệu nguồn. Đạt chuẩn: ≥70%. Cần đối chiếu: 40–69%. Thiếu nguồn: <40% — có nguy cơ AI tự suy diễn. Nhấn vào một mức để lọc nhật ký."
          >
            {qualityFilter && (
              <button className="dash-chip" onClick={() => setQualityFilter(null)}>
                Bỏ lọc ✕
              </button>
            )}
          </CardHead>
          <QualityDonut dist={dist} activeTier={qualityFilter} onSelectTier={toggleQuality} />
        </section>

        {/* (3) VIỆC CẦN XỬ LÝ */}
        <section className="dash-card bento-issues">
          <CardHead
            title="Việc cần xử lý"
            count={issues.length}
            info="Các vấn đề hệ thống tự phát hiện, sắp theo mức ưu tiên — xử lý từ trên xuống. Câu trả lời thiếu nguồn thường cần bổ sung tài liệu cho chủ đề đó."
          />
          <div className="issue-list">
            {issues.map((it) => (
              <div key={it.key} className={`issue-row level-${it.level}`}>
                <span className="issue-dot" />
                <div className="issue-body">
                  <div className="issue-title" title={it.kind === 'low' || it.kind === 'feedback' ? undefined : it.title}>
                    {it.kind === 'low' ? <RedactedText text={it.title} /> : it.title}
                  </div>
                  <div className="issue-meta">{it.meta}</div>
                </div>
                <div className="issue-actions">
                  {it.kind === 'low' && (
                    <>
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={() => {
                          focusChats();
                          setQualityFilter('low');
                          setSelectedLog(it.log);
                        }}
                      >
                        Xem
                      </button>
                      <button type="button" className="dash-btn" onClick={() => onNavigateTab && onNavigateTab('docs')}>
                        Bổ sung tài liệu
                      </button>
                    </>
                  )}
                  {it.kind === 'feedback' && (
                    <button type="button" className="dash-btn" onClick={() => setActivityTab('feedback')}>
                      Xem
                    </button>
                  )}
                  {it.kind === 'doc' && (
                    <button
                      type="button"
                      className="dash-btn primary"
                      disabled={busyDocId === it.doc.id}
                      onClick={() => handleToggleDoc(it.doc.id)}
                    >
                      {busyDocId === it.doc.id ? 'Đang bật…' : 'Bật lại'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {mediumCount > 0 && (
              <div className="issue-row level-info">
                <span className="issue-dot" />
                <div className="issue-body">
                  <div className="issue-title">{mediumCount} câu trả lời cần đối chiếu</div>
                  <div className="issue-meta">Khớp một phần tài liệu (40–69%) — nên xem lại khi rảnh</div>
                </div>
                <div className="issue-actions">
                  <button type="button" className="dash-btn" onClick={() => toggleQuality('medium')}>
                    Lọc xem
                  </button>
                </div>
              </div>
            )}

            {issues.length === 0 && mediumCount === 0 && (
              <div className="dash-empty-box">Không có vấn đề nào cần xử lý.</div>
            )}
          </div>
        </section>

        {/* (4) NHẬT KÝ HOẠT ĐỘNG */}
        <section className="dash-card bento-logs">
          <CardHead
            title="Nhật ký hoạt động"
            info="Người gửi được ẩn danh thành mã User_xxxxx và thông tin cá nhân (tên, SĐT, …) được tự động che. Nhấn vào mã người dùng để lọc theo người đó, nhấn vào một dòng để xem chi tiết."
          >
            {activityTab === 'chats' && (
              <input
                type="search"
                className="dash-search"
                placeholder="Tìm câu hỏi hoặc mã người dùng"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
              />
            )}
            <button
              className="dash-icon-btn"
              onClick={fetchDashboard}
              disabled={refreshing}
              title="Làm mới dữ liệu"
              aria-label="Làm mới dữ liệu"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={refreshing ? 'spin' : ''}>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M12.3 1.8v2.6H9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </CardHead>

          <div className="dash-tabs" role="tablist">
            <button className={activityTab === 'chats' ? 'active' : ''} onClick={() => setActivityTab('chats')}>
              Truy vấn <span className="dash-tab-count">{filteredChats.length}</span>
            </button>
            <button className={activityTab === 'feedback' ? 'active' : ''} onClick={() => setActivityTab('feedback')}>
              Báo lỗi <span className="dash-tab-count">{feedbackLogs.length}</span>
            </button>
            <button className={activityTab === 'auth' ? 'active' : ''} onClick={() => setActivityTab('auth')}>
              Đăng nhập &amp; bảo mật <span className="dash-tab-count">{authLogs.length}</span>
            </button>
          </div>

          {activityTab === 'chats' && hasActiveFilter && (
            <div className="dash-filter-bar">
              <span className="dash-filter-label">Đang lọc:</span>
              {qualityFilter && (
                <button className="dash-chip" onClick={() => setQualityFilter(null)}>
                  {QUALITY_META[qualityFilter].label} ({QUALITY_META[qualityFilter].range}) ✕
                </button>
              )}
              {selectedDate && (
                <button className="dash-chip" onClick={() => setSelectedDate(null)}>
                  Ngày {fmtDay(selectedDate)} ✕
                </button>
              )}
              {selectedUserAnon && (
                <button className="dash-chip" onClick={() => setSelectedUserAnon(null)}>
                  {selectedUserAnon} ✕
                </button>
              )}
              {quickSearch.trim() && (
                <button className="dash-chip" onClick={() => setQuickSearch('')}>
                  “{quickSearch.trim()}” ✕
                </button>
              )}
              <button className="dash-link" onClick={clearAllFilters}>
                Xoá tất cả
              </button>
            </div>
          )}

          <div className="dash-log-body">
            {activityTab === 'chats' &&
              (filteredChats.length === 0 ? (
                <div className="dash-empty-box">
                  <span>Không có truy vấn nào khớp bộ lọc.</span>
                  {hasActiveFilter && (
                    <button className="dash-link" onClick={clearAllFilters}>
                      Xem lại toàn bộ ({chatLogs.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="dash-table">
                  <div className="dash-t-head chat-cols">
                    <span>Thời gian</span>
                    <span>Người dùng</span>
                    <span>Câu hỏi</span>
                    <span>Chất lượng</span>
                  </div>
                  <div className="dash-t-rows">
                    {filteredChats.map((r) => {
                      const isSel = selectedLog?.id === r.id;
                      return (
                        <div
                          key={r.id}
                          className={`dash-t-row chat-cols ${isSel ? 'selected' : ''}`}
                          onClick={() => setSelectedLog(isSel ? null : r)}
                        >
                          <span className="log-time">{fmt(r.created_at)}</span>
                          <span>
                            <button
                              type="button"
                              className="user-anon-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleUser(r.user);
                              }}
                              title="Lọc các câu hỏi của người dùng này"
                            >
                              {r.user}
                            </button>
                          </span>
                          <span className="log-detail" title={r.query}>
                            <RedactedText text={r.query} />
                          </span>
                          <span>
                            <GroundingBadge ratio={r.grounded_ratio} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

            {activityTab === 'feedback' &&
              (feedbackLogs.length === 0 ? (
                <div className="dash-empty-box">Chưa có báo lỗi nào từ người dùng.</div>
              ) : (
                <div className="dash-table">
                  <div className="dash-t-head fb-cols">
                    <span>Thời gian</span>
                    <span>Người dùng</span>
                    <span>Lý do</span>
                    <span>Câu hỏi được báo lỗi</span>
                  </div>
                  <div className="dash-t-rows">
                    {feedbackLogs.map((fb) => (
                      <div key={fb.id} className="dash-t-row fb-cols static">
                        <span className="log-time">{fmt(fb.created_at)}</span>
                        <span className="log-mono">{fb.user}</span>
                        <span className="log-detail" title={fb.reason}>{fb.reason}</span>
                        <span className="log-detail" title={fb.query}>
                          <RedactedText text={fb.query} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {activityTab === 'auth' &&
              (authLogs.length === 0 ? (
                <div className="dash-empty-box">Chưa có bản ghi đăng nhập hoặc bảo mật.</div>
              ) : (
                <div className="dash-table">
                  <div className="dash-t-head fb-cols">
                    <span>Thời gian</span>
                    <span>Người dùng</span>
                    <span>Sự kiện</span>
                    <span>Chi tiết</span>
                  </div>
                  <div className="dash-t-rows">
                    {authLogs.map((r) => (
                      <div key={r.id} className="dash-t-row fb-cols static">
                        <span className="log-time">{fmt(r.created_at)}</span>
                        <span className="log-mono">{r.user}</span>
                        <span>
                          <ActionBadge action={r.action} />
                        </span>
                        <span className="log-detail" title={r.detail}>{r.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {activityTab === 'chats' && selectedLog ? (
            <div className="dash-detail">
              <div className="dash-detail-meta">
                <span className="log-mono">{selectedLog.user}</span>
                <span>{fmt(selectedLog.created_at)}</span>
                <GroundingBadge ratio={selectedLog.grounded_ratio} showDetail />
                {selectedLog.phi_redacted > 0 && <span>Đã che {selectedLog.phi_redacted} thông tin cá nhân</span>}
              </div>
              <div className="dash-detail-query">
                <RedactedText text={selectedLog.query} />
              </div>
              <button className="dash-detail-close" onClick={() => setSelectedLog(null)} aria-label="Đóng chi tiết">
                ✕
              </button>
            </div>
          ) : (
            <div className="dash-card-foot">
              <button
                className="dash-link"
                onClick={() => onNavigateTab && onNavigateTab(activityTab === 'auth' ? 'auth-logs' : 'chats')}
              >
                Mở trang nhật ký đầy đủ →
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. THÀNH PHẦN DÙNG CHUNG CỦA DASHBOARD
   ========================================================================== */

/** Biểu tượng "i" khoanh tròn — di chuột / focus để xem chú thích. Tooltip render qua portal để không bị thẻ cắt mất. */
function InfoTip({ text, label = 'Xem chú thích' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    const openUp = r.bottom + 170 > window.innerHeight;
    setPos(
      openUp
        ? { left, width, bottom: window.innerHeight - r.top + 8 }
        : { left, width, top: r.bottom + 8 }
    );
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        className="info-tip"
        tabIndex={0}
        role="button"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') hide();
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.9" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
          <path d="M8 7.2v4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      {pos &&
        createPortal(
          <div className="info-tip-pop" role="tooltip" style={pos}>
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

function CardHead({ title, info, count, children }) {
  return (
    <header className="dash-card-head">
      <div className="dash-card-title-row">
        <h3 className="dash-card-title">{title}</h3>
        {count != null && count > 0 && <span className="dash-count">{count}</span>}
        {info && <InfoTip text={info} />}
      </div>
      {children && <div className="dash-card-actions">{children}</div>}
    </header>
  );
}

function StatTile({ label, info, value, sub, status = 'neutral', active, onClick }) {
  const clickable = Boolean(onClick);
  return (
    <div
      className={`stat-tile status-${status} ${clickable ? 'clickable' : ''} ${active ? 'active' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="stat-tile-head">
        <span className="stat-tile-label">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className="stat-tile-value">{value}</div>
      <div className="stat-tile-sub">{sub}</div>
    </div>
  );
}

/** Cột chồng theo ngày: mỗi cột = số câu hỏi, chia màu theo mức chất lượng (cùng bảng màu với biểu đồ tròn). */
function DailyQualityChart({ timeline = [], selectedDate, onSelectDate }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const days = timeline.slice(-14);

  if (days.length === 0) {
    return <div className="dash-empty-box">Chưa có dữ liệu theo ngày.</div>;
  }

  const maxChats = Math.max(...days.map((d) => d.chats || 0), 1);
  const top = maxChats <= 4 ? 4 : Math.ceil(maxChats / 2) * 2;
  const ticks = [top, top / 2, 0];

  const fallback = [...days].reverse().find((d) => (d.chats || 0) > 0) || days[days.length - 1];
  const focus =
    hoverIdx != null ? days[hoverIdx] : selectedDate ? days.find((d) => d.date === selectedDate) || fallback : fallback;

  const parts = (d) => {
    const chats = d.chats || 0;
    // Dữ liệu cũ chưa có phân mức → coi toàn bộ là "chưa đánh giá"
    const hasTiers = d.high != null || d.medium != null || d.low != null;
    return {
      high: hasTiers ? d.high || 0 : 0,
      medium: hasTiers ? d.medium || 0 : 0,
      low: hasTiers ? d.low || 0 : 0,
      unrated: hasTiers ? d.unrated ?? Math.max(0, chats - (d.high || 0) - (d.medium || 0) - (d.low || 0)) : chats,
    };
  };

  const fp = focus ? parts(focus) : null;

  return (
    <div className="daily-chart">
      {focus && (
        <div className="daily-readout">
          <strong>{fmtDay(focus.date)}</strong>
          <span>{focus.chats || 0} câu hỏi</span>
          {(focus.chats || 0) > 0 && (
            <span className="daily-readout-split">
              <span className="q-high">{fp.high} đạt chuẩn</span>
              <span className="q-medium">{fp.medium} cần đối chiếu</span>
              <span className="q-low">{fp.low} thiếu nguồn</span>
              {fp.unrated > 0 && <span className="q-none">{fp.unrated} chưa đánh giá</span>}
            </span>
          )}
        </div>
      )}

      <div className="daily-stage">
        <div className="daily-y">
          <div className="daily-layer">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>{t}</span>
            ))}
          </div>
        </div>
        <div className="daily-plot">
          <div className="daily-layer">
            {ticks.map((t) => (
              <div key={t} className={`daily-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>
          <div className="daily-cols" onMouseLeave={() => setHoverIdx(null)}>
            {days.map((d, idx) => {
              const p = parts(d);
              const chats = d.chats || 0;
              const h = (n) => `${(n / top) * 100}%`;
              return (
                <button
                  type="button"
                  key={d.date}
                  className={`daily-col ${selectedDate === d.date ? 'selected' : ''} ${
                    selectedDate && selectedDate !== d.date ? 'dimmed' : ''
                  }`}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onFocus={() => setHoverIdx(idx)}
                  onClick={() => onSelectDate && onSelectDate(d.date)}
                  aria-label={`${fmtDay(d.date)}: ${chats} câu hỏi`}
                >
                  <span className="daily-bar-track">
                    <span className="daily-stack" style={{ height: h(chats) }}>
                      {chats > 0 && <span className="daily-total">{chats}</span>}
                      <span className="seg seg-none" style={{ flexGrow: p.unrated }} />
                      <span className="seg seg-low" style={{ flexGrow: p.low }} />
                      <span className="seg seg-medium" style={{ flexGrow: p.medium }} />
                      <span className="seg seg-high" style={{ flexGrow: p.high }} />
                    </span>
                  </span>
                  <span className="daily-x">{fmtDay(d.date)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="q-legend">
        <span><i className="sw seg-high" />Đạt chuẩn</span>
        <span><i className="sw seg-medium" />Cần đối chiếu</span>
        <span><i className="sw seg-low" />Thiếu nguồn</span>
        <span><i className="sw seg-none" />Chưa đánh giá</span>
      </div>
    </div>
  );
}

/** Biểu đồ tròn chất lượng câu trả lời — nhấn vào một mức để lọc nhật ký. */
function QualityDonut({ dist, activeTier, onSelectTier }) {
  const [hover, setHover] = useState(null);
  const counts = { high: dist.high || 0, medium: dist.medium || 0, low: dist.low || 0 };
  const sum = counts.high + counts.medium + counts.low;
  const pct = (n) => (sum ? Math.round((n / sum) * 100) : 0);

  const C = 2 * Math.PI * 42;
  let offset = 0;
  const focus = hover || (activeTier && activeTier !== 'review' ? activeTier : null);
  const tiers = ['high', 'medium', 'low'];

  return (
    <div className="quality-wrap">
      <div className="quality-donut">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" className="donut-track" />
          {sum > 0 &&
            tiers.map((t) => {
              const len = (counts[t] / sum) * C;
              const el = (
                <circle
                  key={t}
                  cx="50"
                  cy="50"
                  r="42"
                  className={`donut-seg seg-${t} ${focus && focus !== t ? 'dimmed' : ''}`}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHover(t)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelectTier && onSelectTier(t)}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="donut-center">
          <span className="donut-big">{sum ? `${pct(counts[focus || 'high'])}%` : '—'}</span>
          <span className="donut-small">{sum ? QUALITY_META[focus || 'high'].label.toLowerCase() : 'chưa có dữ liệu'}</span>
        </div>
      </div>

      <div className="quality-legend">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            className={`quality-row ${activeTier === t ? 'active' : ''}`}
            onMouseEnter={() => setHover(t)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelectTier && onSelectTier(t)}
          >
            <i className={`sw seg-${t}`} />
            <span className="quality-name">
              {QUALITY_META[t].label} <small>{QUALITY_META[t].range}</small>
            </span>
            <span className="quality-num">
              <strong>{counts[t]}</strong> câu
            </span>
          </button>
        ))}
        <div className="quality-total">Tổng {sum} câu đã đánh giá</div>
      </div>
    </div>
  );
}

function fmtDay(d) {
  if (!d || d.length < 10) return d || '—';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/* ==========================================================================
   3. TRANG CHI TIẾT 1: NHẬT KÝ TRUY VẤN (ẨN DANH) & ĐÁNH GIÁ BÁM NGUỒN
      (1) Tổng quan nhanh  → dải chỉ số (nhấn để lọc)
      (2) Lọc & sắp xếp    → tìm kiếm, mức bám nguồn, model, thứ tự
      (3) Nhật ký          → nhóm theo ngày, nhấn một dòng để xem chi tiết
   ========================================================================== */

const TIER_ORDER = ['high', 'medium', 'low', 'none'];
const TIER_META = {
  high: { label: 'Đạt chuẩn', range: '≥70%' },
  medium: { label: 'Cần đối chiếu', range: '40–69%' },
  low: { label: 'Thiếu nguồn', range: '<40%' },
  none: { label: 'Chưa đánh giá', range: '' },
  review: { label: 'Cần xem lại', range: '<70%' },
};
const TIER_HINT = {
  high: 'Câu trả lời khớp tốt với tài liệu nguồn.',
  medium: 'Chỉ một phần câu trả lời khớp tài liệu — nên đối chiếu lại nội dung.',
  low: 'Phần lớn câu trả lời không tìm thấy trong tài liệu — có nguy cơ AI tự suy diễn. Nên bổ sung tài liệu cho chủ đề này.',
  none: 'Câu này không được chấm điểm (thường là câu chào hỏi hoặc không cần tra cứu tài liệu).',
};
const SORT_OPTIONS = [
  { id: 'newest', label: 'Mới nhất trước' },
  { id: 'oldest', label: 'Cũ nhất trước' },
  { id: 'score', label: 'Bám nguồn thấp → cao' },
];

function tierOf(ratio) {
  if (ratio == null) return 'none';
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}

function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function localDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(d) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = localDayKey(d);
  if (key === localDayKey(today)) return 'Hôm nay';
  if (key === localDayKey(yesterday)) return 'Hôm qua';
  const s = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtClock(d) {
  return d ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtFull(d) {
  return d
    ? d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
}

/** Thanh đo mức bám nguồn: màu + % (nhãn chữ nằm trong tooltip và phần chi tiết). */
function GroundMeter({ ratio }) {
  const t = tierOf(ratio);
  if (t === 'none') {
    return (
      <span className="ql-meter t-none" title={TIER_HINT.none}>
        Chưa đánh giá
      </span>
    );
  }
  const p = Math.round(ratio * 100);
  return (
    <span className={`ql-meter t-${t}`} title={`Bám nguồn ${p}% · ${TIER_META[t].label}`}>
      <span className="ql-meter-track" aria-hidden="true">
        <span className="ql-meter-fill" style={{ width: `${Math.max(p, 4)}%` }} />
      </span>
      <span className="ql-meter-val">{p}%</span>
      <span className="sr-only">{TIER_META[t].label}</span>
    </span>
  );
}

function ChatLogsView({ onNavigateTab }) {
  const [logs, setLogs] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);

  const [subMode, setSubMode] = useState('query-logs'); // 'query-logs' | 'feedback'
  const [tier, setTier] = useState('all'); // 'all' | 'high' | 'medium' | 'low' | 'none' | 'review'
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('all');
  const [sort, setSort] = useState('newest');
  const [userFilter, setUserFilter] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [openAnswers, setOpenAnswers] = useState(() => new Set());

  const load = () => {
    setRefreshing(true);
    api.adminActivity()
      .then((d) => {
        setLogs(d.chat_logs || []);
        setFeedbacks(d.feedback_logs || []);
        setLoadedAt(new Date());
        setError('');
      })
      .catch((e) => setError(e.message || 'Không tải được dữ liệu'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(load, []);

  // Chuẩn hoá một lần: gắn sẵn Date & mức bám nguồn cho mỗi dòng
  const rows = useMemo(
    () => logs.map((r) => ({ ...r, _date: parseIso(r.created_at), _tier: tierOf(r.grounded_ratio) })),
    [logs]
  );

  const stats = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, none: 0 };
    let sum = 0;
    let pii = 0;
    const users = new Set();
    const models = new Map();
    rows.forEach((r) => {
      counts[r._tier] += 1;
      if (r._tier !== 'none') sum += r.grounded_ratio;
      pii += r.phi_redacted || 0;
      if (r.user) users.add(r.user);
      if (r.model && r.model !== '—') models.set(r.model, (models.get(r.model) || 0) + 1);
    });
    const rated = counts.high + counts.medium + counts.low;
    return {
      counts,
      rated,
      avg: rated ? Math.round((sum / rated) * 100) : null,
      pHigh: rated ? Math.round((counts.high / rated) * 100) : null,
      review: counts.medium + counts.low,
      pii,
      users: users.size,
      models: [...models.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (userFilter && r.user !== userFilter) return false;
      if (model !== 'all' && r.model !== model) return false;
      if (tier === 'review' ? !(r._tier === 'medium' || r._tier === 'low') : tier !== 'all' && r._tier !== tier) return false;
      if (q) {
        const hay = `${r.query || ''} ${r.user || ''} ${r.model || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const time = (r) => (r._date ? r._date.getTime() : 0);
    if (sort === 'oldest') out.sort((a, b) => time(a) - time(b));
    else if (sort === 'score') out.sort((a, b) => (a.grounded_ratio ?? 2) - (b.grounded_ratio ?? 2) || time(b) - time(a));
    else out.sort((a, b) => time(b) - time(a));
    return out;
  }, [rows, userFilter, model, tier, q, sort]);

  // Nhóm theo ngày khi sắp theo thời gian; sắp theo điểm thì hiển thị một danh sách phẳng
  const grouped = sort !== 'score';
  const groups = useMemo(() => {
    if (!grouped) return [{ key: 'all', label: null, items: filtered }];
    const out = [];
    filtered.forEach((r) => {
      const key = r._date ? localDayKey(r._date) : 'unknown';
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: r._date ? dayLabel(r._date) : 'Không rõ ngày', items: [] };
        out.push(g);
      }
      g.items.push(r);
    });
    return out;
  }, [filtered, grouped]);

  const filteredFeedbacks = useMemo(() => {
    if (!q) return feedbacks;
    return feedbacks.filter((fb) =>
      `${fb.query || ''} ${fb.answer || ''} ${fb.reason || ''} ${fb.user || ''}`.toLowerCase().includes(q)
    );
  }, [feedbacks, q]);

  const hasFilter = tier !== 'all' || model !== 'all' || Boolean(userFilter) || Boolean(q);
  const clearFilters = () => {
    setTier('all');
    setModel('all');
    setUserFilter(null);
    setSearch('');
  };
  const pickUser = (u) => {
    setSubMode('query-logs');
    setUserFilter((cur) => (cur === u ? null : u));
    setExpandedId(null);
  };
  const toggleRow = (id) => setExpandedId((cur) => (cur === id ? null : id));
  const toggleAnswer = (id) =>
    setOpenAnswers((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tone = (v, okAt, warnAt) => (v == null ? 'neutral' : v >= okAt ? 'ok' : v >= warnAt ? 'warn' : 'danger');

  if (loading) {
    return (
      <div className="logs-page">
        <div className="dash-card logs-card">
          <div className="dash-empty-box">Đang tải nhật ký truy vấn…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="logs-page">
      {/* (1) TỔNG QUAN NHANH */}
      <div className="dash-kpi-strip">
        <StatTile
          label="Truy vấn"
          info="Số câu hỏi trong nhật ký đang hiển thị (tối đa 50 câu gần nhất) và số người dùng ẩn danh đã gửi."
          value={rows.length}
          sub={`Từ ${stats.users} người dùng`}
        />
        <StatTile
          label="Bám nguồn trung bình"
          info="Trung bình tỉ lệ nội dung câu trả lời khớp với tài liệu nguồn, chỉ tính các câu đã được chấm điểm."
          value={stats.avg == null ? '—' : `${stats.avg}%`}
          sub={stats.rated ? `${stats.pHigh}% câu đạt chuẩn (≥70%)` : 'Chưa có câu nào được chấm'}
          status={tone(stats.avg, 70, 40)}
        />
        <StatTile
          label="Cần xem lại"
          info="Các câu trả lời bám nguồn dưới 70%. Nhấn để lọc danh sách chỉ còn những câu này, sắp theo điểm thấp nhất trước."
          value={stats.review}
          sub={`${stats.counts.low} thiếu nguồn · ${stats.counts.medium} cần đối chiếu`}
          status={stats.counts.low ? 'danger' : stats.counts.medium ? 'warn' : 'ok'}
          active={subMode === 'query-logs' && tier === 'review'}
          onClick={() => {
            setSubMode('query-logs');
            if (tier === 'review') {
              setTier('all');
            } else {
              setTier('review');
              setSort('score');
            }
          }}
        />
        <StatTile
          label="Báo lỗi từ người dùng"
          info="Số câu trả lời người dùng chủ động báo lỗi và đồng ý chia sẻ đoạn hội thoại (đã ẩn danh). Nhấn để xem."
          value={feedbacks.length}
          sub={feedbacks.length ? 'Nhấn để xem chi tiết' : 'Chưa có báo lỗi'}
          status={feedbacks.length ? 'warn' : 'ok'}
          active={subMode === 'feedback'}
          onClick={() => setSubMode(subMode === 'feedback' ? 'query-logs' : 'feedback')}
        />
        <StatTile
          label="Thông tin cá nhân đã che"
          info="Tổng số thông tin định danh (tên, số điện thoại, email, CCCD…) được hệ thống tự động che trong các câu hỏi đang hiển thị."
          value={stats.pii}
          sub="Tự động che trước khi lưu nhật ký"
        />
      </div>

      {error && (
        <div className="logs-error">
          Không tải được dữ liệu: {error}
          <button className="dash-link" onClick={load}>Thử lại</button>
        </div>
      )}

      {/* (2) + (3) NHẬT KÝ */}
      <section className="dash-card logs-card">
        <CardHead
          title="Nhật ký truy vấn"
          info="Người hỏi được ẩn danh thành mã User_xxxxx; tên, số điện thoại… trong câu hỏi được tự động che (ví dụ [REDACTED_NAME]). Hiển thị tối đa 50 truy vấn gần nhất. Nhấn vào mã người dùng để lọc theo người đó, nhấn vào một dòng để xem chi tiết."
        >
          {loadedAt && <span className="logs-updated">Cập nhật {fmtClock(loadedAt)}</span>}
          <input
            type="search"
            className="dash-search"
            placeholder={subMode === 'feedback' ? 'Tìm câu hỏi, câu trả lời, lý do…' : 'Tìm câu hỏi, mã người dùng, model…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm kiếm"
          />
          <button
            className="dash-icon-btn"
            onClick={load}
            disabled={refreshing}
            title="Làm mới dữ liệu"
            aria-label="Làm mới dữ liệu"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={refreshing ? 'spin' : ''}>
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M12.3 1.8v2.6H9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </CardHead>

        <div className="dash-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={subMode === 'query-logs'}
            className={subMode === 'query-logs' ? 'active' : ''}
            onClick={() => setSubMode('query-logs')}
          >
            Truy vấn <span className="dash-tab-count">{rows.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={subMode === 'feedback'}
            className={subMode === 'feedback' ? 'active' : ''}
            onClick={() => setSubMode('feedback')}
          >
            Báo lỗi từ người dùng <span className="dash-tab-count">{feedbacks.length}</span>
          </button>
        </div>

        {subMode === 'query-logs' ? (
          <>
            <div className="ql-toolbar">
              <div className="ql-seg" role="group" aria-label="Lọc theo mức bám nguồn">
                <button className={tier === 'all' ? 'active' : ''} onClick={() => setTier('all')}>
                  Tất cả <span className="ql-seg-n">{rows.length}</span>
                </button>
                {TIER_ORDER.map((t) => (
                  <button
                    key={t}
                    className={tier === t || (tier === 'review' && (t === 'medium' || t === 'low')) ? 'active' : ''}
                    onClick={() => setTier(tier === t ? 'all' : t)}
                    title={TIER_META[t].range ? `Bám nguồn ${TIER_META[t].range}` : TIER_HINT.none}
                  >
                    <i className={`ql-dot seg-${t}`} aria-hidden="true" />
                    {TIER_META[t].label} <span className="ql-seg-n">{stats.counts[t]}</span>
                  </button>
                ))}
              </div>
              <div className="ql-selects">
                {stats.models.length > 1 && (
                  <select className="ql-select" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Lọc theo model">
                    <option value="all">Mọi model</option>
                    {stats.models.map(([m, n]) => (
                      <option key={m} value={m}>
                        {shortModelName(m)} ({n})
                      </option>
                    ))}
                  </select>
                )}
                <select className="ql-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sắp xếp">
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {hasFilter && (
              <div className="dash-filter-bar">
                <span className="dash-filter-label">
                  Hiển thị {filtered.length}/{rows.length} ·
                </span>
                {tier !== 'all' && (
                  <button className="dash-chip" onClick={() => setTier('all')}>
                    {TIER_META[tier].label}
                    {TIER_META[tier].range && ` (${TIER_META[tier].range})`} ✕
                  </button>
                )}
                {userFilter && (
                  <button className="dash-chip" onClick={() => setUserFilter(null)}>
                    {userFilter} ✕
                  </button>
                )}
                {model !== 'all' && (
                  <button className="dash-chip" onClick={() => setModel('all')}>
                    {shortModelName(model)} ✕
                  </button>
                )}
                {q && (
                  <button className="dash-chip" onClick={() => setSearch('')}>
                    “{search.trim()}” ✕
                  </button>
                )}
                <button className="dash-link" onClick={clearFilters}>
                  Xoá tất cả
                </button>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="dash-empty-box">
                <span>{rows.length ? 'Không có truy vấn nào khớp bộ lọc.' : 'Chưa có truy vấn nào được ghi lại.'}</span>
                {hasFilter && (
                  <button className="dash-link" onClick={clearFilters}>
                    Xem lại toàn bộ ({rows.length})
                  </button>
                )}
              </div>
            ) : (
              <div className="ql-table">
                <div className="ql-head ql-cols">
                  <span>{grouped ? 'Giờ' : 'Thời gian'}</span>
                  <span>Người dùng</span>
                  <span>Câu hỏi</span>
                  <span>Model</span>
                  <span>Bám nguồn</span>
                </div>
                <div className="ql-rows">
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      {g.label && (
                        <div className="ql-day">
                          <span>{g.label}</span>
                          <span className="ql-day-n">{g.items.length} truy vấn</span>
                        </div>
                      )}
                      {g.items.map((r) => {
                        const open = expandedId === r.id;
                        return (
                          <Fragment key={r.id}>
                            <div
                              className={`ql-row ql-cols t-${r._tier} ${open ? 'open' : ''}`}
                              role="button"
                              tabIndex={0}
                              aria-expanded={open}
                              onClick={() => toggleRow(r.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleRow(r.id);
                                }
                              }}
                            >
                              <span className="log-time ql-time">
                                {grouped ? fmtClock(r._date) : fmt(r.created_at)}
                              </span>
                              <span className="ql-user">
                                <button
                                  type="button"
                                  className={`user-anon-link ${userFilter === r.user ? 'is-active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    pickUser(r.user);
                                  }}
                                  title={userFilter === r.user ? 'Bỏ lọc người dùng này' : 'Chỉ xem câu hỏi của người dùng này'}
                                >
                                  {r.user}
                                </button>
                              </span>
                              <span className="ql-q">
                                <span className="ql-q-text">
                                  <RedactedText text={r.query} />
                                </span>
                                {r.phi_redacted > 0 && (
                                  <span className="ql-pii" title={`Đã che ${r.phi_redacted} thông tin cá nhân`}>
                                    Che {r.phi_redacted}
                                  </span>
                                )}
                              </span>
                              <span className="ql-model" title={r.model}>
                                {shortModelName(r.model)}
                              </span>
                              <span className="ql-score">
                                <GroundMeter ratio={r.grounded_ratio} />
                              </span>
                            </div>
                            {open && (
                              <div className="ql-detail">
                                <dl className="ql-detail-meta">
                                  <div>
                                    <dt>Thời gian</dt>
                                    <dd>{fmtFull(r._date)}</dd>
                                  </div>
                                  <div>
                                    <dt>Người dùng</dt>
                                    <dd className="log-mono">{r.user}</dd>
                                  </div>
                                  <div>
                                    <dt>Model</dt>
                                    <dd className="log-mono">{r.model}</dd>
                                  </div>
                                  <div>
                                    <dt>Bám nguồn</dt>
                                    <dd>
                                      <GroundingBadge ratio={r.grounded_ratio} showDetail />
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Thông tin đã che</dt>
                                    <dd>{r.phi_redacted || 0}</dd>
                                  </div>
                                </dl>
                                <p className={`ql-detail-hint t-${r._tier}`}>{TIER_HINT[r._tier]}</p>
                                <div className="ql-detail-actions">
                                  <button type="button" className="dash-btn" onClick={() => pickUser(r.user)}>
                                    {userFilter === r.user ? 'Bỏ lọc người dùng' : `Xem mọi câu của ${r.user}`}
                                  </button>
                                  {(r._tier === 'low' || r._tier === 'medium') && onNavigateTab && (
                                    <button type="button" className="dash-btn primary" onClick={() => onNavigateTab('docs')}>
                                      Bổ sung tài liệu
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="ql-fb-list">
            {filteredFeedbacks.length === 0 ? (
              <div className="dash-empty-box">
                {feedbacks.length ? (
                  <>
                    <span>Không có báo lỗi nào khớp từ khoá.</span>
                    <button className="dash-link" onClick={() => setSearch('')}>
                      Xoá tìm kiếm
                    </button>
                  </>
                ) : (
                  <span>
                    Chưa có báo lỗi nào. Ở màn hình Chat, người dùng có thể bấm <strong>“Báo lỗi câu trả lời”</strong> để
                    gửi đoạn hội thoại (đã ẩn danh) cho quản trị viên kiểm tra.
                  </span>
                )}
              </div>
            ) : (
              filteredFeedbacks.map((fb) => {
                const hasAnswer = fb.answer && fb.answer !== '—';
                const ansOpen = openAnswers.has(fb.id);
                return (
                  <article key={fb.id} className="ql-fb">
                    <header className="ql-fb-head">
                      <span className="ql-fb-reason">{fb.reason}</span>
                      <button
                        type="button"
                        className="user-anon-link"
                        onClick={() => pickUser(fb.user)}
                        title="Xem các câu hỏi của người dùng này"
                      >
                        {fb.user}
                      </button>
                      <span className="log-time">{fmt(fb.created_at)}</span>
                      <span className="ql-fb-spacer" />
                      <span className="ql-model" title={fb.model}>
                        {shortModelName(fb.model)}
                      </span>
                      <GroundingBadge ratio={fb.grounded_ratio} showDetail />
                    </header>
                    <div className="ql-fb-block">
                      <div className="ql-fb-label">Câu hỏi</div>
                      <div className="ql-fb-q">
                        <RedactedText text={fb.query} />
                      </div>
                    </div>
                    {hasAnswer && (
                      <div className="ql-fb-block">
                        <div className="ql-fb-label">Câu trả lời của AI</div>
                        <div className={`ql-fb-a ${ansOpen ? '' : 'clamp'}`}>
                          <RedactedText text={fb.answer} />
                        </div>
                        {fb.answer.length > 220 && (
                          <button type="button" className="dash-link ql-fb-more" onClick={() => toggleAnswer(fb.id)}>
                            {ansOpen ? 'Thu gọn' : 'Xem đầy đủ'}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ==========================================================================
   4. TRANG CHI TIẾT 2: LỊCH SỬ XÁC THỰC & KIỂM TOÁN BẢO MẬT (AUDITOR VIEW)
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
      const match =
        (item.user || '').toLowerCase().includes(q) ||
        (item.detail || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>🔐 Nhật ký Xác thực &amp; Kiểm toán Bảo mật (Auditor Log)</h3>
          <p className="panel-sub">Theo dõi các lượt Đăng nhập, Đăng ký, Phân quyền RBAC và hoạt động nạp tài liệu hệ thống</p>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          className="ctl filter-search"
          placeholder="🔍 Tìm ID ẩn danh (User_...), sự kiện..."
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
            🟢 Upload Namespace riêng
          </button>
          <button className={`filter-pill ${actionFilter === 'admin_upload' ? 'active' : ''}`} onClick={() => setActionFilter('admin_upload')}>
            🛡️ Upload Tài liệu gốc
          </button>
          <button className={`filter-pill ${actionFilter === 'role_change' ? 'active' : ''}`} onClick={() => setActionFilter('role_change')}>
            ⚖️ Phân quyền RBAC
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
            <span>ID Ẩn danh</span>
            <span>Hành động</span>
            <span>Chi tiết sự kiện</span>
          </div>
          {filtered.map((r) => (
            <div key={r.id} className="log-row auth-row">
              <span className="log-time">{fmt(r.created_at)}</span>
              <span className="log-mono">{r.user}</span>
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
   5. SYSTEM DOCS (DATA ISOLATION) & USERS (SEPARATION OF DUTIES / RBAC)
   ========================================================================== */
const DOC_POLL_MS = 2500;

function DocStatus({ doc }) {
  if (doc.status === 'processing') {
    return <span className="doc-status busy">⏳ Đang phân tích…</span>;
  }
  if (doc.status === 'error') {
    return <span className="doc-status err" title={doc.error}>⚠️ Lỗi phân tích</span>;
  }
  if (doc.status === 'pending') {
    return <span className="doc-status off" title="Chưa có trong chỉ mục truy xuất">Chưa phân tích</span>;
  }
  return (
    <span className={`doc-status ${doc.active ? 'on' : 'off'}`}>
      {doc.active ? 'Đang truy xuất' : 'Đã tạm dừng'}
    </span>
  );
}

function SystemDocs() {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(null); // { id, filename, note }
  const [savingId, setSavingId] = useState(null);
  const fileRef = useRef(null);
  const prevStatus = useRef({});

  const load = () =>
    api.adminDocuments()
      .then((d) => {
        const list = d.documents || [];
        // Báo khi một tài liệu vừa phân tích xong (processing -> ready/error).
        list.forEach((doc) => {
          if (prevStatus.current[doc.id] !== 'processing') return;
          if (doc.status === 'ready') {
            setNotice(`Đã phân tích xong "${doc.filename}" (${doc.num_chunks} đoạn) — sẵn sàng cho chat.`);
          } else if (doc.status === 'error') {
            setError(`Phân tích "${doc.filename}" thất bại: ${doc.error}`);
          }
        });
        prevStatus.current = Object.fromEntries(list.map((doc) => [doc.id, doc.status]));
        setDocs(list);
      })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  // Tự làm mới khi còn tài liệu đang phân tích nền.
  const anyProcessing = docs.some((d) => d.status === 'processing');
  useEffect(() => {
    if (!anyProcessing) return undefined;
    const t = setTimeout(load, DOC_POLL_MS);
    return () => clearTimeout(t);
  }, [docs, anyProcessing]);

  const run = async (fn) => {
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await run(async () => {
      await api.adminUploadDocument(file, note);
      setNote('');
      setNotice(`Đã tải lên "${file.name}". Hệ thống đang tự phân tích (OCR, chia đoạn, nhúng vector)…`);
    });
    if (fileRef.current) fileRef.current.value = '';
    setUploading(false);
  };

  const onToggle = (id) => run(() => api.adminToggleDocument(id));

  const onReindex = (id) => run(() => api.adminReindexDocument(id));

  const onDelete = (d) => {
    const msg = d.is_base
      ? `Xoá khối tài liệu gốc "${d.filename}"?\n\nCác đoạn sẽ bị gỡ khỏi chỉ mục truy xuất và file gốc được chuyển sang backend/data/removed/ (khôi phục: chuyển file về rồi chạy rebuild_index.py --from-scratch).`
      : `Xoá "${d.filename}" khỏi hệ thống tri thức dùng chung?\n\nFile và toàn bộ đoạn đã phân tích sẽ bị xoá vĩnh viễn.`;
    if (!window.confirm(msg)) return;
    if (editing?.id === d.id) setEditing(null);
    run(async () => {
      await api.adminDeleteDocument(d.id);
      setNotice(`Đã xoá "${d.filename}".`);
    });
  };

  const startEdit = (d) => {
    setError('');
    setEditing({ id: d.id, filename: d.filename, note: d.note || '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editing.filename.trim();
    if (!name) {
      setError('Tên tài liệu không được để trống.');
      return;
    }
    setSavingId(editing.id);
    await run(async () => {
      await api.adminUpdateDocument(editing.id, { filename: name, note: editing.note });
      setEditing(null);
    });
    setSavingId(null);
  };

  const onEditKey = (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') setEditing(null);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>🏛️ Quản lý Tài liệu gốc Hệ thống (Data Steward — Knowledge Base chung)</h3>
          <p className="panel-sub">
            Phân vùng không gian dữ liệu (Data Isolation): Admin chỉ quản lý tài liệu y văn dùng chung toàn viện. Tài liệu riêng của User trong Save box được lưu ở Namespace riêng và chặn truy cập từ phía Backend.
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
          {uploading ? 'Đang tải lên…' : '⬆️ Nạp tài liệu hệ thống'}
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={onUpload} disabled={uploading} hidden />
        </label>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
      {notice && <div className="doc-notice">✅ {notice}</div>}

      {docs.length === 0 ? (
        <div className="conv-empty">Chưa có tài liệu gốc nào được nạp.</div>
      ) : (
        <div className="doc-table">
          {docs.map((d) => {
            const busy = d.status === 'processing';
            const isEditing = editing?.id === d.id;
            return (
              <div key={d.id} className="doc-row">
                <span className="doc-icon">{d.is_base ? '📘' : '📄'}</span>
                <div className="doc-main">
                  {isEditing ? (
                    <div className="doc-edit">
                      <input
                        className="ctl"
                        value={editing.filename}
                        onChange={(e) => setEditing({ ...editing, filename: e.target.value })}
                        onKeyDown={onEditKey}
                        placeholder="Tên tài liệu"
                        aria-label="Tên tài liệu"
                        maxLength={300}
                        autoFocus
                      />
                      <input
                        className="ctl"
                        value={editing.note}
                        onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                        onKeyDown={onEditKey}
                        placeholder="Ghi chú (tuỳ chọn)"
                        aria-label="Ghi chú"
                        maxLength={300}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="doc-name">
                        {d.filename} {d.is_base && <span className="base-tag">gốc</span>}
                      </div>
                      <div className="doc-meta">
                        {busy ? 'Đang OCR, chia đoạn và nhúng vector…' : `${d.num_chunks} đoạn (chunks)`}
                        {d.note ? ` · ${d.note}` : ''}
                      </div>
                      {d.status === 'error' && d.error && <div className="doc-error">{d.error}</div>}
                    </>
                  )}
                </div>
                <DocStatus doc={d} />
                <div className="doc-actions">
                  {isEditing ? (
                    <>
                      <button className="mini-btn primary" onClick={saveEdit} disabled={savingId === d.id}>
                        {savingId === d.id ? 'Đang lưu…' : 'Lưu'}
                      </button>
                      <button className="mini-btn" onClick={() => setEditing(null)} disabled={savingId === d.id}>
                        Huỷ
                      </button>
                    </>
                  ) : (
                    <>
                      {!d.is_base && (d.status === 'error' || d.status === 'pending') && (
                        <button className="mini-btn" onClick={() => onReindex(d.id)}>Phân tích lại</button>
                      )}
                      <button className="mini-btn" onClick={() => onToggle(d.id)} disabled={busy}>
                        {d.active ? 'Tắt' : 'Bật'}
                      </button>
                      <button className="mini-btn" onClick={() => startEdit(d)} disabled={busy}>
                        Sửa tên
                      </button>
                      <button className="mini-btn danger" onClick={() => onDelete(d)} disabled={busy}>
                        Xoá
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    api.adminUsers()
      .then((d) => setUsers(d.users || []))
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const handleChangeRole = async (u, newRoleKey) => {
    setError(''); setNotice('');
    try {
      const res = await api.adminUpdateUserRole(u.id, newRoleKey);
      setNotice(`✅ Đã cập nhật phân quyền cho ${u.username} (${u.anon_id}) → ${res.admin_subrole}.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>👥 Quản lý Người dùng &amp; Tách biệt Nhiệm vụ (Separation of Duties - RBAC) ({users.length})</h3>
          <p className="panel-sub">
            Phân chia quyền theo nguyên tắc Least Privilege: <strong>System Admin</strong> (Hạ tầng/Model), <strong>Data Steward</strong> (Duyệt tài liệu chung), <strong>Auditor</strong> (Kiểm toán logs) và <strong>Bác sĩ (User)</strong>.
          </p>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
      {notice && <div className="save-ok" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="log-table users-table">
        <div className="log-head">
          <span>ID Ẩn danh</span>
          <span>Tên bác sĩ</span>
          <span>Email (Đã che PII)</span>
          <span>Phân quyền RBAC</span>
          <span>Chuyên khoa</span>
          <span>Hội thoại / Lượt hỏi</span>
          <span>Thiết lập Vai trò</span>
        </div>
        {users.map((u) => {
          const isSelf = currentUser?.id === u.id;
          const currentRoleVal = u.role !== 'admin'
            ? 'user'
            : u.admin_subrole === 'Data Steward'
              ? 'data_steward'
              : u.admin_subrole === 'Auditor'
                ? 'auditor'
                : 'system_admin';
          return (
            <div key={u.id} className="log-row">
              <span className="log-mono">{u.anon_id}</span>
              <span className="log-user font-bold">{u.username}</span>
              <span className="log-mono">{u.email}</span>
              <span>
                <span className={`tag ${u.role === 'admin' ? 'tag-admin' : ''}`}>
                  {u.admin_subrole}
                </span>
              </span>
              <span>{u.specialty || 'Đa khoa'}</span>
              <span>{u.conversations} phiên · {u.chats} câu</span>
              <div>
                <select
                  className="ctl"
                  style={{ height: 32, fontSize: 12, padding: '0 8px' }}
                  disabled={isSelf}
                  value={currentRoleVal}
                  onChange={(e) => handleChangeRole(u, e.target.value)}
                  title={isSelf ? 'Không thể tự hạ quyền của chính mình' : 'Chọn vai trò RBAC'}
                >
                  <option value="user">Bác sĩ (User)</option>
                  <option value="system_admin">System Admin (Hạ tầng)</option>
                  <option value="data_steward">Data Steward (Tài liệu)</option>
                  <option value="auditor">Auditor (Kiểm toán)</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   6. CÁC HELPER VÀ BADGES
   ========================================================================== */

function RedactedText({ text }) {
  if (!text) return '—';
  const parts = String(text).split(/(\[REDACTED_[A-Z]+\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[REDACTED_[A-Z]+\]$/.test(part) ? (
          <span key={i} className="redacted-badge" title="Thông tin định danh nhạy cảm đã được hệ thống tự động che mờ">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function GroundingBadge({ ratio, showDetail }) {
  if (ratio == null) return <span className="ground-pill pill-none">—</span>;
  const p = Math.round(ratio * 100);
  if (ratio >= 0.7) {
    return (
      <span className="ground-pill pill-safe" title={`Tỉ lệ bám nguồn: ${p}%`}>
        <i className="pill-dot" />{p}%{showDetail && ' · Đạt chuẩn'}
      </span>
    );
  }
  if (ratio >= 0.4) {
    return (
      <span className="ground-pill pill-warn" title={`Tỉ lệ bám nguồn: ${p}%`}>
        <i className="pill-dot" />{p}%{showDetail && ' · Cần đối chiếu'}
      </span>
    );
  }
  return (
    <span className="ground-pill pill-danger" title={`Tỉ lệ bám nguồn: ${p}%`}>
      <i className="pill-dot" />{p}%{showDetail && ' · Thiếu nguồn'}
    </span>
  );
}

function ActionBadge({ action }) {
  const map = {
    login: { label: 'Đăng nhập', cls: 'tag-login' },
    register: { label: 'Đăng ký', cls: 'tag-register' },
    upload: { label: 'Namespace riêng', cls: 'tag-upload' },
    admin_upload: { label: 'Upload gốc', cls: 'tag-admin_upload' },
    admin_rename: { label: 'Đổi tên tài liệu gốc', cls: 'tag-admin_upload' },
    admin_delete: { label: 'Xoá tài liệu gốc', cls: 'tag-admin_upload' },
    role_change: { label: 'Phân quyền RBAC', cls: 'tag-login' },
  };
  const item = map[action] || { label: action, cls: 'tag-other' };
  return <span className={`tag ${item.cls}`}>{item.label}</span>;
}

function shortModelName(model) {
  if (!model) return '—';
  return model.replace(/^gemini-/, '');
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
