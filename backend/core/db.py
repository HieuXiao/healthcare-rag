"""Khởi tạo SQLite + session + seed dữ liệu ban đầu."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.models import Base, User, Document

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = _BACKEND_ROOT / "data" / "app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Thư mục lưu file tài liệu người dùng upload.
UPLOAD_DIR = _BACKEND_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Sentinel cho khối Vector DB gốc (các node phác đồ có sẵn, không có doc_key).
BASE_INDEX_MARKER = "__base_index__"


def to_stored_path(path: Path) -> str:
    """Giá trị lưu vào Document.stored_path: đường dẫn TƯƠNG ĐỐI so với UPLOAD_DIR."""
    return Path(path).resolve().relative_to(UPLOAD_DIR.resolve()).as_posix()


def is_legacy_absolute(stored_path: str) -> bool:
    """Dữ liệu cũ lưu đường dẫn tuyệt đối (vd. D:\\Project\\...\\uploads\\u3_x.txt)."""
    return PureWindowsPath(stored_path).is_absolute() or PurePosixPath(stored_path).is_absolute()


def legacy_file_name(stored_path: str) -> str:
    """Lấy tên file từ đường dẫn cũ (chấp nhận cả dấu \\ của Windows)."""
    return PureWindowsPath(stored_path).name


def resolve_stored_path(stored_path: Optional[str]) -> Optional[Path]:
    """
    Đổi Document.stored_path thành đường dẫn file thật trong UPLOAD_DIR.
    Trả None cho khối tài liệu gốc, giá trị rỗng hoặc đường dẫn thoát khỏi UPLOAD_DIR.
    """
    if not stored_path or stored_path == BASE_INDEX_MARKER:
        return None
    if is_legacy_absolute(stored_path):
        # Tương thích dữ liệu chưa migrate: thử đường dẫn cũ, sau đó tìm theo tên file.
        p = Path(stored_path)
        if p.exists():
            return p
        return UPLOAD_DIR / legacy_file_name(stored_path)
    root = UPLOAD_DIR.resolve()
    p = (root / stored_path).resolve()
    if root not in p.parents:
        return None  # chặn path traversal ("../..") và trỏ vào chính thư mục
    return p


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from core import auth  # import trễ để tránh vòng import (auth cần get_db)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Seed admin mặc định.
        admin_email = os.getenv("ADMIN_EMAIL", "admin@medrag.local")
        if not db.query(User).filter(User.email == admin_email).first():
            admin = User(
                email=admin_email,
                username="Administrator",
                password_hash=auth.hash_password(os.getenv("ADMIN_PASSWORD", "admin123")),
                role="admin",
                full_name="Quản trị hệ thống",
                title="Admin",
            )
            db.add(admin)
            db.commit()
            print(f"[DB] Seed admin: {admin_email} (mật khẩu mặc định: admin123 — hãy đổi)")

        # Seed tài liệu hệ thống gốc (khối Vector DB có sẵn: phác đồ ĐTĐ).
        if not db.query(Document).filter(Document.stored_path == BASE_INDEX_MARKER).first():
            base_doc = Document(
                scope="system",
                owner_id=None,
                filename="phac-do-dai-thao-duong.pdf",
                stored_path=BASE_INDEX_MARKER,
                num_chunks=48,
                active=True,
                indexed=True,
                note="Phác đồ Đái tháo đường típ 2 (Bộ Y tế) — tài liệu gốc hệ thống",
            )
            db.add(base_doc)
            db.commit()
            print("[DB] Seed tài liệu hệ thống gốc: phac-do-dai-thao-duong.pdf")
    finally:
        db.close()
