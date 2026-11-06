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

        sync_base_document(db)
    finally:
        db.close()


# Giá trị seed cũ (bản đầu hard-code phác đồ ĐTĐ) — dùng để nhận ra bản ghi chưa được đồng bộ.
LEGACY_BASE_FILENAME = "phac-do-dai-thao-duong.pdf"
LEGACY_BASE_NOTE = "Phác đồ Đái tháo đường típ 2 (Bộ Y tế) — tài liệu gốc hệ thống"
BASE_NOTE = "Khối tài liệu gốc hệ thống (backend/data)"


def base_display_name(files) -> str:
    """Tên hiển thị của khối gốc = tên các file *.pdf/*.txt đang nằm trong backend/data."""
    return ", ".join(Path(p).name for p in files)


def _base_chunk_count() -> Optional[int]:
    """Số node không có doc_key (khối gốc) trong Vector DB, None nếu chưa build index."""
    from core import index_store  # import trễ: tránh nạp llama_index khi không cần

    vector_dir = index_store.find_vector_store_dir()
    if vector_dir is None:
        return None
    try:
        return index_store.read_doc_key_counts(vector_dir).get(None, 0)
    except Exception:
        return None


def sync_base_document(db) -> None:
    """
    Bản ghi `documents` của khối gốc phải phản ánh file thật trong backend/data:
      - Chưa có bản ghi + có file gốc -> seed theo tên file thật.
      - Bản ghi còn mang tên seed cũ (phác đồ ĐTĐ) mà file đó không còn -> đổi theo file thật.
    Tên do Admin tự đặt (khác tên seed cũ) được giữ nguyên.
    """
    from core.ingestion import list_base_files  # import trễ (module có OCR reader)

    files = list_base_files()
    names = {p.name for p in files}
    row = db.query(Document).filter(Document.stored_path == BASE_INDEX_MARKER).first()

    if row is None:
        if not files:
            return  # không có tài liệu gốc (hoặc Admin đã xoá khối gốc)
        n = _base_chunk_count()
        db.add(Document(
            scope="system", owner_id=None, filename=base_display_name(files),
            stored_path=BASE_INDEX_MARKER, num_chunks=n or 0, active=True,
            indexed=bool(n), note=BASE_NOTE,
        ))
        db.commit()
        print(f"[DB] Seed khối tài liệu gốc: {base_display_name(files)}")
        return

    changed = False
    if row.filename == LEGACY_BASE_FILENAME and LEGACY_BASE_FILENAME not in names and files:
        row.filename = base_display_name(files)
        changed = True
    if row.note == LEGACY_BASE_NOTE:
        row.note = BASE_NOTE
        changed = True
    n = _base_chunk_count()
    if n is not None and row.num_chunks != n:
        row.num_chunks = n
        row.indexed = n > 0
        changed = True
    if changed:
        db.commit()
        print(f"[DB] Đồng bộ khối tài liệu gốc: {row.filename} ({row.num_chunks} chunk)")
