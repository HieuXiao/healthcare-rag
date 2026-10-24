"""
Migrate một lần: Document.stored_path từ đường dẫn tuyệt đối (máy cũ) sang tên
file tương đối so với backend/data/uploads.

Cách chạy (từ thư mục backend):
    python scripts/migrate_stored_paths.py --dry-run
    python scripts/migrate_stored_paths.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Cho phép import package `core` khi chạy trực tiếp.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.db import (
    BASE_INDEX_MARKER, UPLOAD_DIR, SessionLocal, is_legacy_absolute, legacy_file_name,
)
from core.models import Document


def migrate(db, dry_run: bool) -> int:
    changed = 0
    for doc in db.query(Document).order_by(Document.id).all():
        old = doc.stored_path or ""
        if old == BASE_INDEX_MARKER or not is_legacy_absolute(old):
            continue
        new = legacy_file_name(old)
        status = "có file" if (UPLOAD_DIR / new).exists() else "THIẾU FILE trong uploads/"
        print(f"  - id={doc.id}: {old} -> {new} ({status})")
        if not dry_run:
            doc.stored_path = new
        changed += 1
    if dry_run:
        print(f"[dry-run] {changed} bản ghi cần migrate, chưa ghi gì.")
    else:
        db.commit()
        print(f"Đã migrate {changed} bản ghi.")
    return changed


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Chuyển stored_path sang đường dẫn tương đối.")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ in thay đổi, không ghi.")
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        migrate(db, args.dry_run)


if __name__ == "__main__":
    main()
