"""Test dọn index (C-0.1): đếm doc_key, tìm node mồ côi, xoá node khỏi cả docstore."""

import json

import pytest
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.core.embeddings import MockEmbedding
from llama_index.core.schema import TextNode

from core import index_store


@pytest.fixture()
def vector_dir(tmp_path):
    """Index tổng hợp nhỏ: 2 node gốc, 1 node doc:1 hợp lệ, 1 node doc:99 mồ côi."""
    nodes = [
        TextNode(text="Phác đồ đái tháo đường đoạn một", metadata={"file_name": "base.pdf"}),
        TextNode(text="Phác đồ đái tháo đường đoạn hai", metadata={"file_name": "base.pdf"}),
        TextNode(text="Tài liệu người dùng hợp lệ", metadata={"doc_key": "doc:1"}),
        TextNode(text="Thuốc Zelorphan giả lập", metadata={"doc_key": "doc:99"}),
    ]
    index = VectorStoreIndex(nodes, storage_context=StorageContext.from_defaults(),
                             embed_model=MockEmbedding(embed_dim=8))
    out = tmp_path / "vector_db"
    index.storage_context.persist(persist_dir=str(out))
    return out


def test_read_doc_key_counts(vector_dir):
    counts = index_store.read_doc_key_counts(vector_dir)
    assert counts == {None: 2, "doc:1": 1, "doc:99": 1}


def test_find_orphan_doc_keys():
    counts = {None: 48, "doc:2": 1, "doc:3": 2, "doc:5": 4}
    assert index_store.find_orphan_doc_keys(counts, [1, 5]) == {"doc:2": 1, "doc:3": 2}
    assert index_store.find_orphan_doc_keys(counts, [2, 3, 5]) == {}


def test_delete_removes_from_docstore_and_vector_store(vector_dir):
    index = index_store.open_index_for_maintenance(vector_dir)
    assert index_store.delete_nodes_by_doc_keys(index, ["doc:99"]) == 1
    index.storage_context.persist(persist_dir=str(vector_dir))

    assert index_store.read_doc_key_counts(vector_dir) == {None: 2, "doc:1": 1}
    for name in ("docstore.json", "default__vector_store.json", "index_store.json"):
        assert "Zelorphan" not in (vector_dir / name).read_text(encoding="utf-8")

    # Số embedding và số node trong index struct phải khớp docstore.
    vs = json.loads((vector_dir / "default__vector_store.json").read_text(encoding="utf-8"))
    assert len(vs["embedding_dict"]) == 3
    reloaded = index_store.open_index_for_maintenance(vector_dir)
    assert len(reloaded.index_struct.nodes_dict) == 3
    assert len(reloaded.storage_context.docstore.docs) == 3


def test_delete_unknown_key_is_noop(vector_dir):
    index = index_store.open_index_for_maintenance(vector_dir)
    assert index_store.delete_nodes_by_doc_keys(index, ["doc:404"]) == 0
    assert index_store.delete_nodes_by_doc_keys(index, []) == 0
