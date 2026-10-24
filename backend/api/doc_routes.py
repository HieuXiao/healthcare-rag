"""Router: Save box của người dùng (tài liệu riêng đưa vào RAG)."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from core import auth, services
from core.db import UPLOAD_DIR, get_db, to_stored_path
from core.models import ActivityLog, Document, User

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXT = {".pdf", ".txt", ".md"}
MAX_BYTES = 15 * 1024 * 1024  # 15MB


def _doc_out(d: Document):
    return {
        "id": d.id, "scope": d.scope, "filename": d.filename,
        "num_chunks": d.num_chunks, "active": d.active, "indexed": d.indexed,
        "note": d.note or "", "owner_id": d.owner_id,
        "created_at": d.created_at.isoformat() if d.created_at else "",
    }


def _save_upload(file: UploadFile, owner_id: int) -> Path:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Chỉ hỗ trợ: {', '.join(sorted(ALLOWED_EXT))}")
    data = file.file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 15MB).")
    safe = f"u{owner_id}_{int(time.time()*1000)}{ext}"
    path = UPLOAD_DIR / safe
    path.write_bytes(data)
    return path


@router.get("")
def list_documents(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    mine = db.query(Document).filter(Document.owner_id == user.id) \
        .order_by(Document.created_at.desc()).all()
    system = db.query(Document).filter(Document.scope == "system") \
        .order_by(Document.created_at.asc()).all()
    return {
        "user_documents": [_doc_out(d) for d in mine],
        "system_documents": [_doc_out(d) for d in system],
    }


@router.post("/upload")
def upload_document(file: UploadFile = File(...), note: str = Form(""),
                    user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    path = _save_upload(file, user.id)
    doc = Document(scope="user", owner_id=user.id, uploaded_by=user.id,
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

    db.add(ActivityLog(user_id=user.id, action="upload", detail=f"{file.filename} ({doc.num_chunks} chunk)"))
    db.commit()
    return _doc_out(doc)


@router.put("/{doc_id}/toggle")
def toggle_document(doc_id: int, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.owner_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    doc.active = not doc.active
    db.commit()
    return _doc_out(doc)


@router.delete("/{doc_id}")
def delete_document(doc_id: int, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.owner_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    services.delete_document_data(doc)
    db.delete(doc)
    db.commit()
    return {"ok": True}
