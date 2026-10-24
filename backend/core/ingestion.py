"""
Ingestion pipeline: OCR tài liệu -> chunking -> node cho Vector DB.

Nâng cấp: chunking nhận biết cấu trúc bệnh án SOAP (Subjective/Objective/
Assessment/Plan). Với tài liệu có cấu trúc SOAP, mỗi chunk được gắn metadata
``soap_section`` để bảo toàn bệnh cảnh; với tài liệu y văn/phác đồ thông thường,
tự rơi về SentenceSplitter như trước. Giữ embedding tiếng Việt để tương thích.

Việc build/ghi index nằm ở scripts/rebuild_index.py; module này chỉ đọc file và chunk.
"""

import re
from pathlib import Path
from typing import List, Tuple

from dotenv import load_dotenv
from llama_index.core import SimpleDirectoryReader
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode

from core.ocr_reader import OcrPdfReader

load_dotenv()

# Đường dẫn tuyệt đối theo vị trí file, không phụ thuộc thư mục đang chạy.
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
BASE_EXTS = [".pdf", ".txt"]

# Tham số chunk dùng chung cho tài liệu gốc và tài liệu upload (không đổi giá trị).
CHUNK_SIZE = 1024
CHUNK_OVERLAP = 100
MIN_CHUNK_CHARS = 20


def make_splitter() -> SentenceSplitter:
    return SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)


# Tiêu đề các mục SOAP (tiếng Việt + Anh). Dùng để phát hiện cấu trúc bệnh án.
SOAP_PATTERNS = [
    ("S", r"^\s*(?:S\s*[:\-.]|subjective|chủ quan|bệnh sử|lý do (?:vào|nhập) viện|than phiền)"),
    ("O", r"^\s*(?:O\s*[:\-.]|objective|khách quan|khám (?:lâm sàng|bệnh)|cận lâm sàng|sinh hiệu)"),
    ("A", r"^\s*(?:A\s*[:\-.]|assessment|đánh giá|chẩn đoán)"),
    ("P", r"^\s*(?:P\s*[:\-.]|plan|kế hoạch|hướng (?:điều trị|xử trí)|điều trị)"),
]
_SOAP_COMPILED = [(tag, re.compile(pat, re.IGNORECASE)) for tag, pat in SOAP_PATTERNS]


def _detect_soap_section(line: str):
    for tag, pat in _SOAP_COMPILED:
        if pat.match(line):
            return tag
    return None


def _has_soap_structure(text: str) -> bool:
    found = set()
    for line in text.splitlines():
        tag = _detect_soap_section(line)
        if tag:
            found.add(tag)
    # Coi là bệnh án SOAP nếu xuất hiện >= 3/4 mục.
    return len(found) >= 3


def _soap_aware_nodes(document, splitter: SentenceSplitter):
    """Chia 1 document theo mục SOAP, mỗi mục lại chia nhỏ bằng splitter."""
    text = document.get_content()
    base_meta = dict(document.metadata or {})

    if not _has_soap_structure(text):
        nodes = splitter.get_nodes_from_documents([document])
        return nodes

    # Gom dòng vào từng mục SOAP.
    sections = []
    current_tag = "GEN"
    buffer = []
    for line in text.splitlines():
        tag = _detect_soap_section(line)
        if tag:
            if buffer:
                sections.append((current_tag, "\n".join(buffer)))
                buffer = []
            current_tag = tag
        buffer.append(line)
    if buffer:
        sections.append((current_tag, "\n".join(buffer)))

    soap_label = {"S": "Chủ quan", "O": "Khách quan", "A": "Đánh giá", "P": "Kế hoạch", "GEN": "Chung"}
    nodes = []
    for tag, seg_text in sections:
        if len(seg_text.strip()) < 10:
            continue
        for chunk in splitter.split_text(seg_text):
            meta = dict(base_meta)
            meta["soap_section"] = soap_label.get(tag, tag)
            nodes.append(TextNode(text=chunk, metadata=meta))
    return nodes


def list_base_files(data_dir: Path = DATA_DIR) -> List[Path]:
    """File tài liệu gốc hệ thống: *.pdf / *.txt nằm trực tiếp trong backend/data."""
    data_dir = Path(data_dir)
    if not data_dir.is_dir():
        return []
    return sorted(p for p in data_dir.iterdir() if p.is_file() and p.suffix.lower() in BASE_EXTS)


def load_base_documents(data_dir: Path = DATA_DIR) -> List:
    """Đọc (OCR nếu cần) toàn bộ tài liệu gốc trong backend/data."""
    if not list_base_files(data_dir):
        return []
    reader = SimpleDirectoryReader(
        str(data_dir),
        required_exts=BASE_EXTS,
        file_extractor={".pdf": OcrPdfReader(tesseract_lang="vie")},
    )
    return reader.load_data()


def build_nodes(documents: List, splitter: SentenceSplitter = None) -> Tuple[List, int]:
    """Chunk (SOAP-aware) và lọc nhiễu. Trả về (nodes, số tài liệu dạng SOAP)."""
    splitter = splitter or make_splitter()
    raw_nodes = []
    soap_docs = 0
    for doc in documents:
        if _has_soap_structure(doc.get_content()):
            soap_docs += 1
        raw_nodes.extend(_soap_aware_nodes(doc, splitter))
    nodes = [n for n in raw_nodes if len(n.get_content().strip()) > MIN_CHUNK_CHARS]
    return nodes, soap_docs


if __name__ == "__main__":
    print("Build index: cd backend && python scripts/rebuild_index.py --from-scratch --dry-run")
