"""
Tầng nạp Vector Index & Embedding model dùng chung cho toàn hệ thống.

Tách riêng để Hybrid Retriever, Generator và các script cùng tái sử dụng một
instance index (tránh load nhiều lần tốn RAM). Giữ nguyên embedding tiếng Việt
để tương thích Vector DB đã build sẵn.
"""

from __future__ import annotations

import json
import threading
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from llama_index.core import StorageContext, load_index_from_storage
from llama_index.core.settings import Settings

from core import config

_embed_model = None
_index = None
_nodes_cache: List = []
_generation = 0  # tăng mỗi khi tập node thay đổi (để BM25 build lại)
# RLock (reentrant) vì get_index() giữ lock rồi gọi get_embed_model()/get_all_nodes()
# vốn cũng cần lock — dùng Lock thường sẽ tự khoá chính mình (deadlock).
_lock = threading.RLock()

DOCSTORE_FILE = "docstore.json"


def default_vector_store_dir() -> Path:
    """Thư mục mặc định để ghi Vector DB mới (backend/vector_db)."""
    return Path(config.VECTOR_STORE_CANDIDATES[-1])


def find_vector_store_dir() -> Optional[Path]:
    """Trả về thư mục Vector DB đang có (có docstore.json), hoặc None nếu chưa build."""
    for path in config.VECTOR_STORE_CANDIDATES:
        p = Path(path)
        if (p / DOCSTORE_FILE).exists():
            return p
    return None


def resolve_vector_store_dir() -> Path:
    p = find_vector_store_dir()
    if p is None:
        raise FileNotFoundError(
            "Không tìm thấy Vector DB. Đã kiểm tra: "
            + ", ".join(config.VECTOR_STORE_CANDIDATES)
            + ". Hãy build index: cd backend && python scripts/rebuild_index.py --from-scratch"
        )
    return p


def get_embed_model():
    global _embed_model
    if _embed_model is None:
        with _lock:
            if _embed_model is None:
                # Import trễ: script bảo trì index (purge) không cần tải model.
                from llama_index.embeddings.huggingface import HuggingFaceEmbedding

                print(f"[Index] Nạp embedding: {config.EMBEDDING_MODEL_NAME}...")
                _embed_model = HuggingFaceEmbedding(
                    model_name=config.EMBEDDING_MODEL_NAME,
                    trust_remote_code=True,
                )
    return _embed_model


def get_index():
    """Nạp (một lần) VectorStoreIndex từ đĩa."""
    global _index
    if _index is None:
        with _lock:
            if _index is None:
                Settings.embed_model = get_embed_model()
                # Tắt LLM mặc định (OpenAI) của LlamaIndex để tránh treo/đòi
                # OPENAI_API_KEY khi load index. Pipeline dùng Gemini trực tiếp
                # qua self.llm nên không cần Settings.llm.
                Settings.llm = None
                vector_dir = resolve_vector_store_dir()
                print(f"[Index] Nạp Vector Index từ: {vector_dir}")
                storage_context = StorageContext.from_defaults(persist_dir=str(vector_dir))
                _index = load_index_from_storage(storage_context)
    return _index


def get_all_nodes() -> List:
    """Trả về toàn bộ node (chunk) trong docstore để dựng corpus BM25."""
    global _nodes_cache
    if not _nodes_cache:
        index = get_index()
        docstore = index.storage_context.docstore
        _nodes_cache = list(docstore.docs.values())
    return _nodes_cache


def get_generation() -> int:
    return _generation


def invalidate_nodes_cache():
    """Xoá cache node (gọi sau khi thêm/xoá tài liệu để BM25 build lại)."""
    global _nodes_cache, _generation
    _nodes_cache = []
    _generation += 1


def add_nodes(nodes: List, persist: bool = True):
    """Chèn thêm node vào index (dùng khi user upload tài liệu) và lưu đĩa."""
    if not nodes:
        return
    with _lock:
        index = get_index()
        index.insert_nodes(nodes)
        if persist:
            vector_dir = resolve_vector_store_dir()
            index.storage_context.persist(persist_dir=str(vector_dir))
        invalidate_nodes_cache()


def delete_nodes_by_doc_keys(index, doc_keys: Iterable[str]) -> int:
    """
    Xoá mọi node có metadata doc_key thuộc ``doc_keys`` khỏi vector store,
    index struct VÀ docstore (docstore là nguồn corpus BM25). Không persist.
    """
    keys = set(doc_keys)
    if not keys:
        return 0
    docstore = index.storage_context.docstore
    target_ids = [nid for nid, n in docstore.docs.items()
                  if n.metadata.get("doc_key") in keys]
    if target_ids:
        # delete_from_docstore=True: mặc định LlamaIndex chỉ xoá embedding, để
        # lại text trong docstore -> BM25 vẫn thấy chunk của tài liệu đã xoá.
        index.delete_nodes(target_ids, delete_from_docstore=True)
    return len(target_ids)


def delete_nodes_by_doc_key(doc_key: str, persist: bool = True):
    """Xoá mọi node thuộc 1 tài liệu (theo metadata doc_key)."""
    with _lock:
        index = get_index()
        n = delete_nodes_by_doc_keys(index, [doc_key])
        if persist and n:
            vector_dir = resolve_vector_store_dir()
            index.storage_context.persist(persist_dir=str(vector_dir))
        invalidate_nodes_cache()
        return n


# ---------------------------------------------------------------------------
# Bảo trì index (dùng cho kiểm tra khi khởi động và scripts/rebuild_index.py)
# ---------------------------------------------------------------------------
def read_doc_key_counts(vector_dir: Optional[Path] = None) -> Counter:
    """
    Đếm số node theo doc_key bằng cách đọc thẳng docstore.json (không tải
    embedding model). Node của khối tài liệu gốc không có doc_key -> key None.
    """
    vector_dir = Path(vector_dir) if vector_dir else resolve_vector_store_dir()
    raw = json.loads((vector_dir / DOCSTORE_FILE).read_text(encoding="utf-8"))
    counts: Counter = Counter()
    for item in raw.get("docstore/data", {}).values():
        data = item.get("__data__", {})
        if isinstance(data, str):
            data = json.loads(data)
        counts[(data.get("metadata") or {}).get("doc_key")] += 1
    return counts


def find_orphan_doc_keys(doc_key_counts: Dict[Optional[str], int],
                         valid_doc_ids: Iterable[int]) -> Dict[str, int]:
    """Trả về {doc_key: số node} của các doc_key không còn tài liệu tương ứng trong DB."""
    valid: Set[str] = {f"doc:{i}" for i in valid_doc_ids}
    return {k: n for k, n in doc_key_counts.items() if k is not None and k not in valid}


def open_index_for_maintenance(vector_dir: Path):
    """
    Nạp index từ đĩa chỉ để xoá/sửa node: dùng MockEmbedding nên không tải
    model. KHÔNG dùng index này để truy vấn hay chèn node mới.
    """
    from llama_index.core.embeddings import MockEmbedding

    storage_context = StorageContext.from_defaults(persist_dir=str(vector_dir))
    return load_index_from_storage(storage_context, embed_model=MockEmbedding(embed_dim=1))
