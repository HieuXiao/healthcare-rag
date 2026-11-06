"""
Router Admin: Thiết kế theo mô hình Security by Design (Bảo mật theo thiết kế)
vừa bảo vệ quyền riêng tư của User (GDPR / Nghị định 13/2023/NĐ-CP / HIPAA),
vừa giữ trọn vẹn năng lực quản trị, theo dõi vận hành và đánh giá RAG (RAG Eval) cho Admin:

1. Masking & Redaction (PII/PHI): Admin xem được nội dung câu hỏi trong Query Logs để đánh giá RAG,
   nhưng mọi tên người, SĐT, CCCD, Email, Địa chỉ đều tự động được thay bằng [REDACTED_NAME], [REDACTED_PHONE]...
2. Băm định danh trong Logs (Anonymized Logs): Trong nhật ký truy vấn và phản hồi, tài khoản người hỏi
   được hiển thị dưới dạng ID ẩn danh (ví dụ: User_89421) thay vì tên thật/avatar để tránh soi mói cá nhân.
3. Phân vùng không gian dữ liệu (Data Isolation): Tài liệu riêng trong Save box thuộc Namespace riêng của User,
   Admin chỉ quản lý tài liệu hệ thống dùng chung (scope='system').
4. Tách biệt vai trò (Separation of Duties / RBAC): Hỗ trợ phân quyền Admin Hệ thống, Admin Dữ liệu (Data Steward),
   Kiểm toán viên (Auditor) và Người dùng (Bác sĩ).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import date
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from api import usage
from core import auth, deidentify, graph_seed, index_store, ingestion, services
from core.db import BASE_INDEX_MARKER, UPLOAD_DIR, get_db, to_stored_path
from core.models import ActivityLog, Conversation, Document, User

router = APIRouter(prefix="/admin", tags=["admin"])

ALLOWED_EXT = {".pdf", ".txt", ".md"}
MAX_BYTES = 30 * 1024 * 1024

_INTENT_META_RE = re.compile(r"^intent=([a-zA-Z0-9_-]+)\|phi_redacted=(\d+)$")


# ---- Security by Design Helpers -------------------------------------------
def _anonymize_user_id(user_id: int | None) -> str:
    """
    Chiến lược 4: Băm log (Anonymized Logs).
    Hiển thị ID ngẫu nhiên ổn định dạng User_98723 trong Query Logs thay vì tên thật/email của User.
    """
    if not user_id:
        return "User_00000"
    digest = hashlib.sha256(f"medrag-anon-salt:{user_id}".encode("utf-8")).hexdigest()
    num = int(digest[:8], 16) % 90000 + 10000
    return f"User_{num}"


def _mask_email(email: str) -> str:
    """Che một phần email để bảo vệ PII (ví dụ: bs***@benhvien.vn)."""
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "***" if local else "***"
    else:
        masked_local = local[:2] + "***"
    return f"{masked_local}@{domain}"


def _format_redacted_query(raw_detail: str | None) -> Tuple[str, int]:
    """
    Chiến lược 1: Masking & Redaction (PII/PHI).
    Đảm bảo mọi câu hỏi hiển thị trên màn hình Admin đều giữ nguyên câu chữ y khoa
    nhưng đã che mờ thông tin nhạy cảm thành [REDACTED_NAME], [REDACTED_PHONE], [REDACTED_CCCD]...
    """
    detail = (raw_detail or "").strip()
    if not detail:
        return "—", 0
    if _INTENT_META_RE.match(detail):
        return "[Câu hỏi y khoa đã xử lý ẩn danh]", 0
    redacted, count = deidentify.default_deidentifier.redact_for_admin(detail)
    # Đếm cả các nhãn [REDACTED_...] đã được thay thế từ lúc ghi log
    existing_tags = len(re.findall(r"\[REDACTED_[A-Z]+\]", redacted))
    return redacted, max(count, existing_tags)


def _sanitize_auth_detail(action: str, raw_detail: str | None) -> str:
    """Làm sạch chi tiết nhật ký bảo mật: che một phần email và ẩn tên file cá nhân trong Save box."""
    detail = (raw_detail or "").strip()
    if action in ("login", "register"):
        if "@" in detail and "***" not in detail:
            return f"Xác thực tài khoản ({_mask_email(detail)})"
        return detail or "Xác thực hệ thống"
    if action == "upload":
        if "Tài liệu cá nhân" in detail or "Namespace" in detail:
            return detail
        chunk_match = re.search(r"\((\d+\s*chunk|\d+\s*đoạn)\)", detail)
        suffix = f" ({chunk_match.group(1)})" if chunk_match else ""
        return f"Nạp file riêng vào Namespace cá nhân [Đã ẩn tên file]{suffix}"
    return detail or "—"


def _doc_out(d: Document):
    status, error = services.ingest_status(d)
    return {
        "id": d.id, "scope": d.scope, "filename": d.filename,
        "num_chunks": d.num_chunks, "active": d.active, "indexed": d.indexed,
        "note": d.note or "", "is_base": d.stored_path == BASE_INDEX_MARKER,
        "status": status, "error": error,
        "created_at": d.created_at.isoformat() if d.created_at else "",
    }


def _get_system_doc(db: Session, doc_id: int) -> Document:
    doc = db.query(Document).filter(Document.id == doc_id, Document.scope == "system").first()
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    return doc


def _ensure_not_processing(doc: Document) -> None:
    if services.is_processing(doc.id):
        raise HTTPException(status_code=409, detail="Tài liệu đang được phân tích, vui lòng thử lại sau.")


# ---- System documents (Chiến lược 3: Data Isolation - Chỉ quản lý file chung) ----
@router.get("/documents")
def list_system_docs(admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.scope == "system") \
        .order_by(Document.created_at.asc()).all()
    return {"documents": [_doc_out(d) for d in docs]}


@router.post("/documents/upload")
def upload_system_doc(background: BackgroundTasks, file: UploadFile = File(...), note: str = Form(""),
                      admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """
    Lưu file rồi trả về ngay; việc phân tích (OCR -> chunk -> embed -> chèn index ->
    build lại BM25) chạy nền. UI theo dõi qua trường `status` của GET /admin/documents.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Chỉ hỗ trợ: {', '.join(sorted(ALLOWED_EXT))}")
    data = file.file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 30MB).")
    path = UPLOAD_DIR / f"sys_{int(time.time()*1000)}{ext}"
    path.write_bytes(data)

    doc = Document(scope="system", owner_id=None, uploaded_by=admin.id,
                   filename=Path(file.filename).name, stored_path=to_stored_path(path),
                   note=note.strip()[:300], active=True, indexed=False, num_chunks=0)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    services.mark_processing(doc.id)
    background.add_task(services.run_ingest_job, doc.id, admin.id)
    return _doc_out(doc)


@router.post("/documents/{doc_id}/reindex")
def reindex_system_doc(doc_id: int, background: BackgroundTasks,
                       admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Phân tích lại 1 tài liệu upload (vd. lần trước lỗi OCR hoặc server tắt giữa chừng)."""
    doc = _get_system_doc(db, doc_id)
    _ensure_not_processing(doc)
    if doc.stored_path == BASE_INDEX_MARKER:
        raise HTTPException(status_code=400, detail="Khối gốc được build lại bằng: "
                            "cd backend && python scripts/rebuild_index.py --from-scratch")
    services.mark_processing(doc.id)
    background.add_task(services.run_ingest_job, doc.id, admin.id, True)
    return _doc_out(doc)


@router.put("/documents/{doc_id}")
def update_system_doc(doc_id: int, payload: dict,
                      admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Đổi tên hiển thị / ghi chú. Tên mới cũng được cập nhật vào nguồn trích dẫn trong index."""
    doc = _get_system_doc(db, doc_id)
    _ensure_not_processing(doc)
    is_base = doc.stored_path == BASE_INDEX_MARKER

    if "filename" in payload:
        name = str(payload.get("filename") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tên tài liệu không được để trống.")
        if len(name) > 300:
            raise HTTPException(status_code=400, detail="Tên tài liệu tối đa 300 ký tự.")
        if not is_base:
            # Giữ đuôi file gốc nếu Admin gõ tên không có đuôi.
            ext = Path(doc.filename).suffix
            if ext and Path(name).suffix.lower() not in ALLOWED_EXT:
                name += ext
        if name != doc.filename:
            try:
                if not is_base:
                    index_store.rename_doc_nodes(doc.retrieval_key, name)
                elif len(ingestion.list_base_files()) == 1:
                    # Khối gốc 1 file: đổi luôn nguồn trích dẫn. Nhiều file thì chỉ đổi tên hiển thị.
                    index_store.rename_doc_nodes(None, name)
            except FileNotFoundError:
                pass  # chưa có Vector DB: chỉ đổi tên trong DB
            old = doc.filename
            doc.filename = name
            db.add(ActivityLog(user_id=admin.id, action="admin_rename", detail=f"{old} → {name}"))
            services.refresh_retrieval_cache()

    if "note" in payload:
        doc.note = str(payload.get("note") or "").strip()[:300]

    db.commit()
    return _doc_out(doc)


@router.put("/documents/{doc_id}/toggle")
def toggle_system_doc(doc_id: int, admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    doc = _get_system_doc(db, doc_id)
    doc.active = not doc.active
    db.commit()
    return _doc_out(doc)


@router.delete("/documents/{doc_id}")
def delete_system_doc(doc_id: int, admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    doc = _get_system_doc(db, doc_id)
    _ensure_not_processing(doc)
    detail = doc.filename
    if doc.stored_path == BASE_INDEX_MARKER:
        moved = services.delete_base_block(doc)
        if moved:
            detail += f" (file gốc chuyển sang backend/data/removed/: {', '.join(moved)})"
    else:
        services.delete_document_data(doc)
    services.forget_job(doc.id)
    db.delete(doc)
    db.add(ActivityLog(user_id=admin.id, action="admin_delete", detail=detail))
    db.commit()
    services.refresh_retrieval_cache()
    return {"ok": True}


# ---- Users & Separation of Duties (RBAC) ----------------------------------
@router.get("/users")
def list_users(admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    out = []
    for u in users:
        n_conv = db.query(func.count(Conversation.id)).filter(Conversation.user_id == u.id).scalar()
        n_chat = db.query(func.count(ActivityLog.id)).filter(
            ActivityLog.user_id == u.id, ActivityLog.action == "chat").scalar()
        out.append({
            "id": u.id,
            "anon_id": _anonymize_user_id(u.id),
            "email": _mask_email(u.email),
            "username": u.username,
            "role": u.role,
            "admin_subrole": u.title if u.role == "admin" and u.title in ("System Admin", "Data Steward", "Auditor") else ("System Admin" if u.role == "admin" else "Bác sĩ / User"),
            "specialty": u.specialty or "Đa khoa",
            "conversations": n_conv,
            "chats": n_chat,
            "created_at": u.created_at.isoformat() if u.created_at else "",
        })
    return {"users": out}


@router.put("/users/{user_id}/role")
def update_user_role(user_id: int, payload: dict,
                     admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """
    Chiến lược 2: Tách biệt nhiệm vụ (Separation of Duties / Least Privilege).
    Cho phép gán các vai trò chuyên biệt:
    - 'user': Bác sĩ / Người dùng
    - 'system_admin': Admin hệ thống (Hạ tầng, model LLM, thông số)
    - 'data_steward': Admin dữ liệu (Quản lý Knowledge Base chung)
    - 'auditor': Kiểm toán viên (Thanh tra logs bảo mật)
    """
    requested = (payload.get("role") or "").strip()
    role_map = {
        "user": ("user", "Bác sĩ"),
        "admin": ("admin", "System Admin"),
        "system_admin": ("admin", "System Admin"),
        "data_steward": ("admin", "Data Steward"),
        "auditor": ("admin", "Auditor"),
    }
    if requested not in role_map:
        raise HTTPException(status_code=400, detail="Vai trò không hợp lệ.")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")
    new_db_role, subrole_title = role_map[requested]
    if target.id == admin.id and new_db_role != "admin":
        raise HTTPException(status_code=400, detail="Không thể tự hạ quyền Quản trị viên của chính mình.")

    target.role = new_db_role
    target.title = subrole_title
    db.add(ActivityLog(
        user_id=admin.id,
        action="role_change",
        detail=f"Phân quyền {_anonymize_user_id(target.id)} → {subrole_title}",
    ))
    db.commit()
    return {"ok": True, "id": target.id, "role": target.role, "admin_subrole": subrole_title}


# ---- Activity dashboard (Anonymized Logs + PII Redaction) -----------------
@router.get("/activity")
def activity(admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    total_users = db.query(func.count(User.id)).scalar()
    total_chats = db.query(func.count(ActivityLog.id)).filter(ActivityLog.action == "chat").scalar()
    total_docs = db.query(func.count(Document.id)).scalar()
    system_docs = db.query(func.count(Document.id)).filter(Document.scope == "system").scalar()
    user_docs = db.query(func.count(Document.id)).filter(Document.scope == "user").scalar()

    today = date.today().isoformat()
    chats_today = db.query(func.count(ActivityLog.id)).filter(
        ActivityLog.action == "chat",
        func.substr(ActivityLog.created_at, 1, 10) == today,
    ).scalar()

    avg_ground = db.query(func.avg(ActivityLog.grounded_ratio)).filter(
        ActivityLog.action == "chat", ActivityLog.grounded_ratio.isnot(None)).scalar()

    # Usage theo model (từ log chat) kèm điểm bám nguồn TB từng model.
    per_model = db.query(
        ActivityLog.model,
        func.count(ActivityLog.id),
        func.avg(ActivityLog.grounded_ratio),
    ).filter(ActivityLog.action == "chat").group_by(ActivityLog.model).all()

    total_chunks = db.query(func.coalesce(func.sum(Document.num_chunks), 0)).scalar() or 0
    quota_snap = usage.snapshot()

    # Phân bổ bám nguồn lâm sàng (Fact-Check Distribution)
    all_chat_grounding = db.query(ActivityLog.grounded_ratio).filter(
        ActivityLog.action == "chat", ActivityLog.grounded_ratio.isnot(None)).all()
    grounding_dist = {"high": 0, "medium": 0, "low": 0}
    for (gr,) in all_chat_grounding:
        if gr >= 0.7:
            grounding_dist["high"] += 1
        elif gr >= 0.4:
            grounding_dist["medium"] += 1
        else:
            grounding_dist["low"] += 1

    # Xu hướng theo ngày (Timeline) — 14 ngày GẦN NHẤT, kèm số câu theo từng mức chất lượng
    is_chat = ActivityLog.action == "chat"
    gr = ActivityLog.grounded_ratio
    daily_stats = db.query(
        func.substr(ActivityLog.created_at, 1, 10).label("day"),
        func.count(ActivityLog.id).label("total"),
        func.sum(case((is_chat, 1), else_=0)).label("chats"),
        func.avg(gr).label("avg_ground"),
        func.sum(case((is_chat & (gr >= 0.7), 1), else_=0)).label("high"),
        func.sum(case((is_chat & (gr >= 0.4) & (gr < 0.7), 1), else_=0)).label("medium"),
        func.sum(case((is_chat & (gr < 0.4), 1), else_=0)).label("low"),
    ).group_by("day").order_by(func.substr(ActivityLog.created_at, 1, 10).desc()).limit(14).all()

    timeline = []
    for d, total, chats, ag, hi, med, lo in reversed(daily_stats):
        chats = chats or 0
        hi, med, lo = hi or 0, med or 0, lo or 0
        timeline.append({
            "date": d,
            "total_actions": total,
            "chats": chats,
            "avg_grounded": round(float(ag) * 100, 1) if ag is not None else None,
            "high": hi,
            "medium": med,
            "low": lo,
            "unrated": max(0, chats - hi - med - lo),
        })

    # Phân loại thực thể Knowledge Graph kèm chi tiết ICD-10 & Triples
    entity_groups: dict[str, list[dict]] = {}
    for name, meta in graph_seed.ENTITIES.items():
        t = meta.get("type", "Khác")
        related_triples = [
            {"subject": s, "relation": rel, "object": o}
            for (s, rel, o) in graph_seed.TRIPLES
            if s == name or o == name
        ]
        entity_groups.setdefault(t, []).append({
            "name": name,
            "icd10": meta.get("icd10", ""),
            "synonyms": meta.get("synonyms", []),
            "triples": related_triples,
        })

    graph_stats = {
        "total_entities": len(graph_seed.ENTITIES),
        "total_triples": len(graph_seed.TRIPLES),
        "entity_types": [
            {"type": k, "count": len(v), "entities": v}
            for k, v in entity_groups.items()
        ],
    }

    # 1. Nhật ký Truy vấn (Query Logs):
    # - Ẩn danh người hỏi thành User_98723 (Anonymized Logs)
    # - Hiển thị nội dung câu hỏi nhưng đã che PII/PHI thành [REDACTED_NAME], [REDACTED_PHONE]...
    chat_logs_query = db.query(ActivityLog).filter(
        ActivityLog.action == "chat"
    ).order_by(ActivityLog.created_at.desc()).limit(50).all()

    chat_logs = []
    for r in chat_logs_query:
        redacted_query, phi_count = _format_redacted_query(r.detail)
        chat_logs.append({
            "id": r.id,
            "user": _anonymize_user_id(r.user_id),
            "query": redacted_query,
            "phi_redacted": phi_count,
            "model": r.model or "—",
            "grounded_ratio": r.grounded_ratio,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    # 2. Phản hồi ẩn danh do User chủ động gửi (Opt-in Feedback)
    feedback_query = db.query(ActivityLog).filter(
        ActivityLog.action == "feedback"
    ).order_by(ActivityLog.created_at.desc()).limit(30).all()

    feedback_logs = []
    for r in feedback_query:
        try:
            fb = json.loads(r.detail or "{}")
        except Exception:
            fb = {"query": r.detail or "—", "answer": "", "reason": "Báo lỗi"}
        feedback_logs.append({
            "id": r.id,
            "user": _anonymize_user_id(r.user_id),
            "query": fb.get("query") or "—",
            "answer": fb.get("answer") or "—",
            "reason": fb.get("reason") or "Báo lỗi",
            "model": r.model or "—",
            "grounded_ratio": r.grounded_ratio,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    # 3. Nhật ký Xác thực & Kiểm toán bảo mật (Auditor Logs)
    auth_logs_query = db.query(ActivityLog).filter(
        ActivityLog.action.notin_(["chat", "feedback"])
    ).order_by(ActivityLog.created_at.desc()).limit(50).all()

    auth_logs = []
    for r in auth_logs_query:
        auth_logs.append({
            "id": r.id,
            "action": r.action,
            "user": _anonymize_user_id(r.user_id),
            "detail": _sanitize_auth_detail(r.action, r.detail),
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    total_phi_redacted = sum(item.get("phi_redacted", 0) for item in chat_logs)

    # 4. Danh sách tài liệu hệ thống & tóm tắt hoạt động người dùng cho Trung tâm Vận hành
    sys_docs_rows = db.query(Document).filter(Document.scope == "system").order_by(Document.created_at.asc()).all()
    system_docs_list = [_doc_out(d) for d in sys_docs_rows]

    users_rows = db.query(User).order_by(User.created_at.asc()).all()
    users_summary = []
    for u in users_rows:
        n_conv = db.query(func.count(Conversation.id)).filter(Conversation.user_id == u.id).scalar() or 0
        n_chat = db.query(func.count(ActivityLog.id)).filter(
            ActivityLog.user_id == u.id, ActivityLog.action == "chat"
        ).scalar() or 0
        last_act = db.query(func.max(ActivityLog.created_at)).filter(ActivityLog.user_id == u.id).scalar()
        users_summary.append({
            "id": u.id,
            "anon_id": _anonymize_user_id(u.id),
            "username": u.username,
            "role": u.role,
            "admin_subrole": u.title if u.role == "admin" and u.title in ("System Admin", "Data Steward", "Auditor") else ("System Admin" if u.role == "admin" else "Bác sĩ"),
            "specialty": u.specialty or "Đa khoa",
            "conversations": n_conv,
            "chats": n_chat,
            "last_active": last_act.isoformat() if hasattr(last_act, "isoformat") else (str(last_act) if last_act else ""),
        })
    users_summary.sort(key=lambda x: (x["chats"], x["conversations"]), reverse=True)

    return {
        "stats": {
            "total_users": total_users,
            "total_chats": total_chats,
            "total_documents": total_docs,
            "system_documents": system_docs,
            "user_documents": user_docs,
            "total_chunks": int(total_chunks),
            "chats_today": chats_today,
            "total_phi_redacted": total_phi_redacted,
            "avg_grounded_ratio": round(float(avg_ground), 3) if avg_ground is not None else None,
        },
        "per_model": [
            {
                "model": m or "—",
                "count": c,
                "avg_grounded": round(float(ag) * 100, 1) if ag is not None else 0,
            }
            for m, c, ag in per_model
        ],
        "model_quotas": quota_snap.get("models", []),
        "grounding_dist": grounding_dist,
        "timeline": timeline,
        "graph_stats": graph_stats,
        "system_docs": system_docs_list,
        "users_summary": users_summary,
        "chat_logs": chat_logs,
        "feedback_logs": feedback_logs,
        "auth_logs": auth_logs,
    }
