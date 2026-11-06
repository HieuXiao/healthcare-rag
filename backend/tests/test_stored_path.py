"""Test đường dẫn tài liệu upload lưu dạng tương đối (C-0.1)."""

from core.db import (
    BASE_INDEX_MARKER, UPLOAD_DIR, is_legacy_absolute, legacy_file_name,
    resolve_stored_path, to_stored_path,
)


def test_to_stored_path_is_relative():
    assert to_stored_path(UPLOAD_DIR / "u3_123.txt") == "u3_123.txt"


def test_resolve_relative():
    assert resolve_stored_path("u3_123.txt") == (UPLOAD_DIR / "u3_123.txt").resolve()


def test_resolve_marker_and_empty():
    assert resolve_stored_path(BASE_INDEX_MARKER) is None
    assert resolve_stored_path("") is None
    assert resolve_stored_path(None) is None


def test_resolve_blocks_traversal():
    assert resolve_stored_path("../app.db") is None
    assert resolve_stored_path("a/../../app.db") is None
    assert resolve_stored_path(".") is None


def test_legacy_windows_path_falls_back_to_upload_dir():
    old = r"D:\Project\biomedical-rag\backend\data\uploads\u3_1791910382687.txt"
    assert is_legacy_absolute(old)
    assert legacy_file_name(old) == "u3_1791910382687.txt"
    assert resolve_stored_path(old) == UPLOAD_DIR / "u3_1791910382687.txt"


def test_relative_name_is_not_legacy():
    assert not is_legacy_absolute("u3_1.txt")
