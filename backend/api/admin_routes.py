"""Router Admin: quản lý tài liệu gốc hệ thống, người dùng, dashboard đánh giá."""

from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core import auth, graph_seed, services
from core.db import BASE_INDEX_MARKER, UPLOAD_DIR, get_db, to_stored_path
from core.models import ActivityLog, Conversation, Document, Message, User

router = APIRouter(prefix="/admin", tags=["admin"])

ALLOWED_EXT = {".pdf", ".txt", ".md"}
MAX_BYTES = 30 * 1024 * 1024


def _doc_out(d: Document):
    return {
        "id": d.id, "scope": d.scope, "filename": d.filename,
        "num_chunks": d.num_chunks, "active": d.active, "indexed": d.indexed,
        "note": d.note or "", "is_base": d.stored_path == BASE_INDEX_MARKER,
        "created_at": d.created_at.isoformat() if d.created_at else "",
    }


# ---- System documents -----------------------------------------------------
@router.get("/documents")
def list_system_docs(admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.scope == "system") \
        .order_by(Document.created_at.asc()).all()
    return {"documents": [_doc_out(d) for d in docs]}


@router.post("/documents/upload")
def upload_system_doc(file: UploadFile = File(...), note: str = Form(""),
                      admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Chỉ hỗ trợ: {', '.join(sorted(ALLOWED_EXT))}")
    data = file.file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 30MB).")
    path = UPLOAD_DIR / f"sys_{int(time.time()*1000)}{ext}"
    path.write_bytes(data)

    doc = Document(scope="system", owner_id=None, uploaded_by=admin.id,
                   filename=file.filename, stored_path=to_stored_path(path), note=note, active=True)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    try:
        n = services.ingest_document(doc)
        doc.num_chunks = n
        doc.indexed = n > 0
        db.commit()
    except Exception as e:
        doc.indexed = False
        db.commit()
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý tài liệu: {e}")

    db.add(ActivityLog(user_id=admin.id, action="admin_upload", detail=f"{file.filename} ({doc.num_chunks} chunk)"))
    db.commit()
    return _doc_out(doc)


@router.put("/documents/{doc_id}/toggle")
def toggle_system_doc(doc_id: int, admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.scope == "system").first()
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    doc.active = not doc.active
    db.commit()
    return _doc_out(doc)


@router.delete("/documents/{doc_id}")
def delete_system_doc(doc_id: int, admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.scope == "system").first()
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if doc.stored_path == BASE_INDEX_MARKER:
        raise HTTPException(status_code=400, detail="Không thể xoá khối tài liệu gốc (chỉ có thể bật/tắt).")
    services.delete_document_data(doc)
    db.delete(doc)
    db.commit()
    return {"ok": True}


# ---- Users ----------------------------------------------------------------
@router.get("/users")
def list_users(admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    out = []
    for u in users:
        n_conv = db.query(func.count(Conversation.id)).filter(Conversation.user_id == u.id).scalar()
        n_chat = db.query(func.count(ActivityLog.id)).filter(
            ActivityLog.user_id == u.id, ActivityLog.action == "chat").scalar()
        out.append({
            "id": u.id, "email": u.email, "username": u.username, "role": u.role,
            "specialty": u.specialty or "", "conversations": n_conv, "chats": n_chat,
            "created_at": u.created_at.isoformat() if u.created_at else "",
        })
    return {"users": out}


# ---- Activity dashboard ---------------------------------------------------
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

    # Usage theo model (từ log chat).
    per_model = db.query(ActivityLog.model, func.count(ActivityLog.id)).filter(
        ActivityLog.action == "chat").group_by(ActivityLog.model).all()

    # Phân bổ bám nguồn lâm sàng (Fact-Check Distribution)
    # High (>= 0.7: Đạt chuẩn y văn), Medium (0.4 - 0.69: Cần lưu ý), Low (< 0.4: Cảnh báo ảo giác)
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

    # Xu hướng theo ngày (Timeline)
    daily_stats = db.query(
        func.substr(ActivityLog.created_at, 1, 10).label("day"),
        func.count(ActivityLog.id).label("total"),
        func.sum(case((ActivityLog.action == "chat", 1), else_=0)).label("chats"),
        func.avg(ActivityLog.grounded_ratio).label("avg_ground")
    ).group_by("day").order_by("day").limit(14).all()

    timeline = []
    for d, total, chats, ag in daily_stats:
        timeline.append({
            "date": d,
            "total_actions": total,
            "chats": chats or 0,
            "avg_grounded": round(float(ag) * 100, 1) if ag is not None else 0,
        })

    # Phân loại thực thể Knowledge Graph
    entity_types = {}
    for meta in graph_seed.ENTITIES.values():
        t = meta.get("type", "Khác")
        entity_types[t] = entity_types.get(t, 0) + 1

    graph_stats = {
        "total_entities": len(graph_seed.ENTITIES),
        "total_triples": len(graph_seed.TRIPLES),
        "entity_types": [{"type": k, "count": v} for k, v in entity_types.items()],
    }

    # 1. Tách riêng Chat logs (Truy vấn lâm sàng)
    chat_logs_query = db.query(ActivityLog).filter(
        ActivityLog.action == "chat"
    ).order_by(ActivityLog.created_at.desc()).limit(50).all()

    chat_logs = []
    for r in chat_logs_query:
        u = db.query(User).filter(User.id == r.user_id).first()
        chat_logs.append({
            "id": r.id,
            "user": u.username if u else "—",
            "user_email": u.email if u else "—",
            "query": r.detail or "—",
            "model": r.model or "—",
            "grounded_ratio": r.grounded_ratio,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    # 2. Tách riêng Auth & Security logs (Đăng nhập, đăng ký, upload)
    auth_logs_query = db.query(ActivityLog).filter(
        ActivityLog.action != "chat"
    ).order_by(ActivityLog.created_at.desc()).limit(50).all()

    auth_logs = []
    for r in auth_logs_query:
        u = db.query(User).filter(User.id == r.user_id).first()
        auth_logs.append({
            "id": r.id,
            "action": r.action,
            "user": u.username if u else "—",
            "user_email": u.email if u else "—",
            "detail": r.detail or "—",
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    # Toàn bộ recent (để tương thích ngược)
    recent = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(30).all()
    recent_out = []
    for r in recent:
        u = db.query(User).filter(User.id == r.user_id).first()
        recent_out.append({
            "id": r.id, "action": r.action,
            "user": u.username if u else "—",
            "detail": (r.detail or "")[:120], "model": r.model or "",
            "grounded_ratio": r.grounded_ratio,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        })

    return {
        "stats": {
            "total_users": total_users,
            "total_chats": total_chats,
            "total_documents": total_docs,
            "system_documents": system_docs,
            "user_documents": user_docs,
            "chats_today": chats_today,
            "avg_grounded_ratio": round(float(avg_ground), 3) if avg_ground is not None else None,
        },
        "per_model": [{"model": m or "—", "count": c} for m, c in per_model],
        "grounding_dist": grounding_dist,
        "timeline": timeline,
        "graph_stats": graph_stats,
        "chat_logs": chat_logs,
        "auth_logs": auth_logs,
        "recent": recent_out,
    }

