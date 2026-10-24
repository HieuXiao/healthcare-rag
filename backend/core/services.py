"""Dịch vụ nghiệp vụ: ingest tài liệu upload, cá nhân hoá, phân quyền truy xuất."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Set, Tuple

from llama_index.core.schema import Document as LIDocument

from core import index_store
from core.db import BASE_INDEX_MARKER, resolve_stored_path
from core.models import Document, User
from core.ocr_reader import OcrPdfReader
from core.ingestion import MIN_CHUNK_CHARS, _soap_aware_nodes, make_splitter

logger = logging.getLogger(__name__)

_splitter = make_splitter()


def build_profile_text(user: User) -> str:
    """Tạo đoạn mô tả hồ sơ người dùng để chèn vào prompt (cá nhân hoá)."""
    bits = []
    if user.full_name:
        bits.append(f"Người dùng: {user.full_name}")
    if user.title:
        bits.append(f"Chức danh: {user.title}")
    if user.specialty:
        bits.append(f"Chuyên khoa: {user.specialty}")
    if user.workplace:
        bits.append(f"Nơi công tác: {user.workplace}")
    if user.personalization:
        bits.append(f"Yêu cầu riêng về cách trả lời: {user.personalization}")
    if not bits:
        return ""
    return ("Hãy điều chỉnh câu trả lời cho phù hợp với người dùng sau "
            "(không bịa thêm thông tin ngoài tài liệu):\n" + "\n".join(f"- {b}" for b in bits))


def allowed_doc_scope(db, user: User) -> Tuple[Optional[Set[str]], bool]:
    """
    Trả về (allowed_keys, base_allowed):
      - allowed_keys: tập doc_key (f"doc:{id}") của tài liệu user được phép truy xuất
        (tài liệu hệ thống đang bật + tài liệu riêng của user đang bật).
      - base_allowed: khối Vector DB gốc (phác đồ có sẵn) có đang bật không.
    """
    docs = db.query(Document).filter(
        Document.active == True,  # noqa: E712
        ((Document.scope == "system") | (Document.owner_id == user.id)),
    ).all()

    allowed: Set[str] = set()
    base_allowed = False
    for d in docs:
        if d.stored_path == BASE_INDEX_MARKER:
            base_allowed = True
        else:
            allowed.add(f"doc:{d.id}")
    return allowed, base_allowed


def _read_file_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = OcrPdfReader(tesseract_lang="vie")
        docs = reader.load_data(str(path))
        return "\n\n".join(d.get_content() for d in docs)
    # txt / md
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def build_document_nodes(doc: Document) -> List:
    """Đọc file của 1 Document, chunk (SOAP-aware) và gắn metadata doc_key."""
    path = resolve_stored_path(doc.stored_path)
    if path is None or not path.exists():
        return []

    text = _read_file_text(path)
    if not text or len(text.strip()) < MIN_CHUNK_CHARS:
        return []

    base_meta = {
        "file_name": doc.filename,
        "doc_key": f"doc:{doc.id}",
        "scope": doc.scope,
        "owner_id": doc.owner_id,
    }
    li_doc = LIDocument(text=text, metadata=base_meta)
    nodes = _soap_aware_nodes(li_doc, _splitter)
    nodes = [n for n in nodes if len(n.get_content().strip()) > MIN_CHUNK_CHARS]
    # Đảm bảo mọi node đều mang metadata doc_key (kể cả nhánh SOAP).
    for n in nodes:
        n.metadata.update(base_meta)
    return nodes


def ingest_document(doc: Document) -> int:
    """Chunk tài liệu và chèn vào index đang chạy. Trả về số chunk đã thêm."""
    nodes = build_document_nodes(doc)
    index_store.add_nodes(nodes)
    return len(nodes)


def remove_document_from_index(doc: Document) -> int:
    if doc.stored_path == BASE_INDEX_MARKER:
        return 0  # không cho xoá khối gốc khỏi index
    return index_store.delete_nodes_by_doc_key(f"doc:{doc.id}")


def delete_document_data(doc: Document) -> None:
    """
    Xoá node của tài liệu khỏi index rồi xoá file vật lý. Hai bước độc lập:
    lỗi ở index không được chặn việc xoá file (và ngược lại).
    """
    try:
        remove_document_from_index(doc)
    except Exception as e:
        logger.warning("Lỗi xoá node của tài liệu id=%s khỏi index: %s", doc.id, e)
    path = resolve_stored_path(doc.stored_path)
    if path is None:
        return
    try:
        if path.exists():
            path.unlink()
    except Exception as e:
        logger.warning("Lỗi xoá file của tài liệu id=%s: %s", doc.id, e)


def warn_if_index_inconsistent(db) -> List[str]:
    """
    Kiểm tra khi khởi động: index thiếu, hoặc chứa doc_key không có trong bảng
    documents. Chỉ cảnh báo, KHÔNG tự xoá. Trả về danh sách cảnh báo.
    """
    warnings: List[str] = []
    vector_dir = index_store.find_vector_store_dir()
    if vector_dir is None:
        warnings.append(
            "Chưa có Vector DB. Build index lần đầu: "
            "cd backend && python scripts/rebuild_index.py --from-scratch"
        )
    else:
        try:
            counts = index_store.read_doc_key_counts(vector_dir)
            doc_ids = [i for (i,) in db.query(Document.id).all()]
            orphans = index_store.find_orphan_doc_keys(counts, doc_ids)
            if orphans:
                detail = ", ".join(f"{k} ({n} node)" for k, n in sorted(orphans.items()))
                warnings.append(
                    f"Vector DB chứa node của tài liệu không còn trong DB: {detail}. "
                    "Các node này có thể bị 'thừa kế' bởi tài liệu mới cùng id. "
                    "Chạy: cd backend && python scripts/rebuild_index.py --purge-orphans --dry-run"
                )
        except Exception as e:
            warnings.append(f"Không kiểm tra được Vector DB ({vector_dir}): {e}")
    for w in warnings:
        print(f"[Index] ⚠️ CẢNH BÁO: {w}")
    return warnings
