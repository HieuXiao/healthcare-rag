"""Router: đăng ký, đăng nhập, thông tin, cập nhật hồ sơ & Quyền dữ liệu cá nhân (GDPR Art. 15, 17, 20)."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.schemas import LoginRequest, ProfileUpdate, RegisterRequest, TokenResponse, UserOut
from core import auth, services
from core.db import get_db
from core.models import ActivityLog, Conversation, Document, Message, User

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _mask_email(email: str) -> str:
    """Che một phần email trong log bảo mật để giảm thiểu dữ liệu định danh (GDPR Data Minimization)."""
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "***" if local else "***"
    else:
        masked_local = local[:2] + "***"
    return f"{masked_local}@{domain}"


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Email không hợp lệ")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email đã được đăng ký")

    user = User(
        email=email,
        username=req.username.strip(),
        password_hash=auth.hash_password(req.password),
        role="user",
        full_name=req.username.strip(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(ActivityLog(user_id=user.id, action="register", detail=f"Đăng ký mới ({_mask_email(email)})"))
    db.commit()

    token = auth.create_token(user.id, user.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not auth.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")

    db.add(ActivityLog(user_id=user.id, action="login", detail=f"Xác thực JWT thành công ({_mask_email(email)})"))
    db.commit()

    token = auth.create_token(user.id, user.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(auth.get_current_user)):
    return UserOut.model_validate(user)


@router.put("/me", response_model=UserOut)
def update_profile(req: ProfileUpdate, user: User = Depends(auth.get_current_user),
                   db: Session = Depends(get_db)):
    fields = ["username", "full_name", "title", "specialty", "workplace", "personalization"]
    for f in fields:
        val = getattr(req, f)
        if val is not None:
            setattr(user, f, val)
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


# ---- GDPR Art. 15 & Art. 20: Right of Access & Data Portability -----------
@router.get("/me/export")
def export_my_data(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Cho phép người dùng trích xuất toàn bộ dữ liệu cá nhân của chính họ (GDPR Art. 15 & 20)."""
    convs = db.query(Conversation).filter(Conversation.user_id == user.id).all()
    conv_list = []
    for c in convs:
        msgs = [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else "",
            }
            for m in c.messages
        ]
        conv_list.append({
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat() if c.created_at else "",
            "messages": msgs,
        })

    docs = db.query(Document).filter(Document.owner_id == user.id).all()
    doc_list = [
        {
            "id": d.id,
            "filename": d.filename,
            "num_chunks": d.num_chunks,
            "note": d.note or "",
            "created_at": d.created_at.isoformat() if d.created_at else "",
        }
        for d in docs
    ]

    return {
        "compliance_standard": "GDPR Art. 15 & Art. 20 / Vietnam Decree 13/2023/ND-CP",
        "profile": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "role": user.role,
            "full_name": user.full_name,
            "title": user.title,
            "specialty": user.specialty,
            "workplace": user.workplace,
            "personalization": user.personalization,
            "created_at": user.created_at.isoformat() if user.created_at else "",
        },
        "conversations": conv_list,
        "personal_documents": doc_list,
    }


# ---- GDPR Art. 17: Right to Erasure ("Right to be Forgotten") --------------
@router.delete("/me")
def delete_my_account(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Xoá vĩnh viễn tài khoản, hội thoại, tài liệu cá nhân khỏi DB & Vector Index (GDPR Art. 17)."""
    if user.role == "admin":
        admin_count = db.query(User).filter(User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Không thể xoá tài khoản Quản trị viên duy nhất của hệ thống."
            )

    # 1. Xoá toàn bộ tài liệu riêng trong Save box (cả Vector Index lẫn file vật lý)
    user_docs = db.query(Document).filter(Document.owner_id == user.id).all()
    for d in user_docs:
        services.delete_document_data(d)
        db.delete(d)

    # 2. Xoá nhật ký hoạt động liên quan đến user_id
    db.query(ActivityLog).filter(ActivityLog.user_id == user.id).delete()

    # 3. Xoá user (cascade xoá toàn bộ Conversations và Messages)
    db.delete(user)
    db.commit()
    return {"ok": True, "detail": "Tài khoản và toàn bộ dữ liệu cá nhân đã được xoá vĩnh viễn."}
