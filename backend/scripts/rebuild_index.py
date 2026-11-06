"""
Bảo trì Vector DB (backend/vector_db).

Cách chạy (từ thư mục backend):
    # Xoá node của tài liệu không còn trong bảng documents (không cần tải model)
    python scripts/rebuild_index.py --purge-orphans --dry-run
    python scripts/rebuild_index.py --purge-orphans

    # Xoá hẳn tài liệu theo id: node trong index + file upload + bản ghi DB
    python scripts/rebuild_index.py --remove-doc 2 --remove-doc 3 --dry-run

    # Build lại toàn bộ index từ tài liệu hệ thống
    # (file *.pdf/*.txt trong backend/data + tài liệu scope=system có file upload)
    python scripts/rebuild_index.py --from-scratch --dry-run
    python scripts/rebuild_index.py --from-scratch [--include-user-docs]

Nên tắt backend trước khi chạy để tránh hai tiến trình cùng ghi index.
"""

from __future__ import annotations

import argparse
import errno
import shutil
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Cho phép import package `core` khi chạy trực tiếp.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

from core import index_store
from core.db import BASE_INDEX_MARKER, SessionLocal, engine, resolve_stored_path
from core.models import Base, Document


def _print_counts(title: str, counts) -> None:
    total = sum(counts.values())
    print(f"{title}: {total} node")
    for key, n in sorted(counts.items(), key=lambda kv: (kv[0] is not None, kv[0] or "")):
        print(f"  - {key or '(tài liệu gốc, không có doc_key)'}: {n}")


def _require_vector_dir() -> Path:
    vector_dir = index_store.find_vector_store_dir()
    if vector_dir is None:
        print("Chưa có Vector DB. Chạy: python scripts/rebuild_index.py --from-scratch")
        sys.exit(1)
    return vector_dir


def _delete_keys(vector_dir: Path, keys, dry_run: bool) -> int:
    if dry_run or not keys:
        return 0
    index = index_store.open_index_for_maintenance(vector_dir)
    n = index_store.delete_nodes_by_doc_keys(index, keys)
    index.storage_context.persist(persist_dir=str(vector_dir))
    return n


# ---------------------------------------------------------------------------
def purge_orphans(db, dry_run: bool) -> int:
    vector_dir = _require_vector_dir()
    counts = index_store.read_doc_key_counts(vector_dir)
    _print_counts(f"Index hiện tại ({vector_dir})", counts)

    doc_ids = [i for (i,) in db.query(Document.id).all()]
    orphans = index_store.find_orphan_doc_keys(counts, doc_ids)
    if not orphans:
        print("Không có node mồ côi.")
        return 0
    print("Node mồ côi (doc_key không có trong bảng documents):")
    for k, n in sorted(orphans.items()):
        print(f"  - {k}: {n}")
    if dry_run:
        print("[dry-run] Không ghi gì.")
        return 0
    n = _delete_keys(vector_dir, orphans.keys(), dry_run=False)
    print(f"Đã xoá {n} node.")
    _print_counts("Index sau khi dọn", index_store.read_doc_key_counts(vector_dir))
    return n


def remove_docs(db, doc_ids, dry_run: bool) -> None:
    vector_dir = index_store.find_vector_store_dir()
    counts = index_store.read_doc_key_counts(vector_dir) if vector_dir else {}
    docs = []
    for doc_id in doc_ids:
        doc = db.get(Document, doc_id)
        if doc is None:
            print(f"  - id={doc_id}: không có trong DB (dùng --purge-orphans nếu còn node).")
            continue
        if doc.stored_path == BASE_INDEX_MARKER:
            print(f"  - id={doc_id}: là khối tài liệu gốc, bỏ qua (dùng --from-scratch).")
            continue
        path = resolve_stored_path(doc.stored_path)
        print(f"  - id={doc.id} [{doc.scope}] {doc.filename}: "
              f"{counts.get(doc.retrieval_key, 0)} node, file={path}")
        docs.append((doc, path))
    if dry_run or not docs:
        if dry_run:
            print("[dry-run] Không ghi gì.")
        return
    if vector_dir:
        n = _delete_keys(vector_dir, [d.retrieval_key for d, _ in docs], dry_run=False)
        print(f"Đã xoá {n} node khỏi index.")
    for doc, path in docs:
        if path is not None and path.exists():
            path.unlink()
        db.delete(doc)
    db.commit()
    print(f"Đã xoá {len(docs)} tài liệu (DB + file).")


def _swap_index_dir(target: Path, tmp_dir: Path, bak_dir: Path) -> None:
    """Thay `target` bằng `tmp_dir`, giữ bản cũ ở `bak_dir`."""
    if not target.exists():
        tmp_dir.rename(target)
        return
    if bak_dir.exists():
        shutil.rmtree(bak_dir)
    try:
        target.rename(bak_dir)
    except OSError as exc:
        # Trong Docker, target là bind mount: không đổi tên được chính mount point (EBUSY),
        # hoặc tmp/bak nằm khác filesystem (EXDEV) -> chuyển nội dung bên trong thay vì đổi tên.
        if exc.errno not in (errno.EBUSY, errno.EXDEV):
            raise
        bak_dir.mkdir()
        for p in target.iterdir():
            shutil.move(str(p), str(bak_dir / p.name))
        for p in tmp_dir.iterdir():
            shutil.move(str(p), str(target / p.name))
        tmp_dir.rmdir()
        return
    tmp_dir.rename(target)


def from_scratch(db, dry_run: bool, include_user_docs: bool) -> None:
    from llama_index.core import StorageContext, VectorStoreIndex

    from core import ingestion, services

    base_files = ingestion.list_base_files()
    print(f"Tài liệu gốc trong {ingestion.DATA_DIR}:")
    for p in base_files:
        print(f"  - {p.name}")
    base_docs = ingestion.load_base_documents()
    base_nodes, soap_docs = ingestion.build_nodes(base_docs)
    print(f"  => {len(base_nodes)} chunk ({soap_docs} tài liệu dạng SOAP)")

    scopes = ["system", "user"] if include_user_docs else ["system"]
    candidates = db.query(Document).filter(
        Document.stored_path != BASE_INDEX_MARKER, Document.scope.in_(scopes)
    ).order_by(Document.id).all()
    doc_nodes = {}
    print("Tài liệu upload được nạp:")
    for doc in candidates:
        path = resolve_stored_path(doc.stored_path)
        if path is None or not path.exists():
            print(f"  - id={doc.id} {doc.filename}: THIẾU FILE ({doc.stored_path}), bỏ qua")
            continue
        nodes = services.build_document_nodes(doc)
        doc_nodes[doc.id] = nodes
        print(f"  - id={doc.id} [{doc.scope}] {doc.filename}: {len(nodes)} chunk")

    excluded = db.query(Document).filter(
        Document.stored_path != BASE_INDEX_MARKER, ~Document.id.in_(list(doc_nodes))
    ).all()
    if excluded:
        print("Tài liệu KHÔNG có trong index mới (sẽ đánh dấu indexed=False):")
        for d in excluded:
            print(f"  - id={d.id} [{d.scope}] {d.filename}")

    all_nodes = list(base_nodes) + [n for ns in doc_nodes.values() for n in ns]
    print(f"Tổng: {len(all_nodes)} chunk.")
    if dry_run:
        print("[dry-run] Không ghi gì.")
        return
    if base_files and not base_nodes:
        # Thường do thiếu Tesseract/gói ngôn ngữ 'vie' -> không ghi đè để khỏi mất khối gốc.
        print("LỖI: có file tài liệu gốc nhưng không đọc được chunk nào (kiểm tra OCR). "
              "Dừng, giữ nguyên index cũ.")
        sys.exit(1)
    if not all_nodes:
        print("Không có chunk nào, dừng (giữ nguyên index cũ).")
        sys.exit(1)

    # Build vào thư mục tạm rồi mới thay thế, để lỗi giữa chừng không làm hỏng index cũ.
    target = index_store.find_vector_store_dir() or index_store.default_vector_store_dir()
    tmp_dir = target.with_name(target.name + ".tmp")
    bak_dir = target.with_name(target.name + ".bak")
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    index = VectorStoreIndex(
        all_nodes,
        storage_context=StorageContext.from_defaults(),
        embed_model=index_store.get_embed_model(),
        show_progress=True,
    )
    index.storage_context.persist(persist_dir=str(tmp_dir))
    _swap_index_dir(target, tmp_dir, bak_dir)
    print(f"Đã ghi index mới vào {target}" + (f" (bản cũ: {bak_dir})" if bak_dir.exists() else ""))

    # Đồng bộ trạng thái trong DB với index mới.
    base_row = db.query(Document).filter(Document.stored_path == BASE_INDEX_MARKER).first()
    if base_row is not None:
        base_row.num_chunks = len(base_nodes)
        base_row.indexed = len(base_nodes) > 0
    for doc in candidates:
        if doc.id in doc_nodes:
            doc.num_chunks = len(doc_nodes[doc.id])
            doc.indexed = doc.num_chunks > 0
    for doc in excluded:
        doc.num_chunks = 0
        doc.indexed = False
    db.commit()
    _print_counts("Index mới", index_store.read_doc_key_counts(target))


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Bảo trì Vector DB của Healthcare RAG.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--purge-orphans", action="store_true",
                      help="Xoá node có doc_key không tồn tại trong bảng documents.")
    mode.add_argument("--from-scratch", action="store_true",
                      help="Build lại index từ tài liệu hệ thống.")
    mode.add_argument("--remove-doc", type=int, action="append", metavar="ID",
                      help="Xoá hẳn tài liệu theo id (index + file + DB). Lặp lại được.")
    parser.add_argument("--include-user-docs", action="store_true",
                        help="(--from-scratch) Nạp lại cả tài liệu riêng của người dùng.")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ in thống kê, không ghi.")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if args.purge_orphans:
            purge_orphans(db, args.dry_run)
        elif args.remove_doc:
            remove_docs(db, args.remove_doc, args.dry_run)
        else:
            from_scratch(db, args.dry_run, args.include_user_docs)


if __name__ == "__main__":
    main()
