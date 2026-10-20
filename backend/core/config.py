"""
Cấu hình trung tâm cho hệ thống Medical RAG nâng cao.

Mọi tham số điều khiển pipeline (bật/tắt từng tầng, model, ngưỡng) đều gom về
đây để dễ tinh chỉnh và tiết kiệm chi phí. Tất cả đều có thể override qua biến
môi trường (.env) để không phải sửa code khi deploy.
"""

import os


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "y"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# LLM models
# ---------------------------------------------------------------------------
# Danh sách model theo thứ tự ưu tiên. Model đầu được thử trước; hết quota thì
# frontend/backend tự rơi xuống model kế tiếp.
# Lưu ý: họ gemini-2.5-* đã bị Google chặn với tài khoản mới (404). Dùng họ 3.x.
# gemini-3.5-flash đã xác nhận hoạt động; các bản -lite/-latest có thể 503 tạm thời.
AVAILABLE_MODELS = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]

DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemini-3.5-flash")

# Hạn mức gọi/ngày cho phần theo dõi usage (chỉ mang tính minh hoạ free-tier).
MODEL_LIMITS = {
    "gemini-3.5-flash": _env_int("LIMIT_FLASH", 20),
    "gemini-3.5-flash-lite": _env_int("LIMIT_FLASH_LITE", 20),
}

# ---------------------------------------------------------------------------
# Embedding / Retrieval
# ---------------------------------------------------------------------------
# Giữ nguyên embedding tiếng Việt đang dùng để tái sử dụng Vector DB có sẵn,
# không phải re-embed (tiết kiệm thời gian & tài nguyên).
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "keepitreal/vietnamese-sbert")

# Hybrid search: trộn Vector (ngữ nghĩa) + BM25 (từ khoá) bằng RRF.
VECTOR_TOP_K = _env_int("VECTOR_TOP_K", 8)
BM25_TOP_K = _env_int("BM25_TOP_K", 8)
RRF_K = _env_int("RRF_K", 60)              # hằng số làm mượt của Reciprocal Rank Fusion
FUSED_TOP_K = _env_int("FUSED_TOP_K", 8)   # số ứng viên sau khi fuse, trước rerank
FINAL_TOP_K = _env_int("FINAL_TOP_K", 5)   # số tài liệu cuối đưa vào prompt

# ---------------------------------------------------------------------------
# Reranker (cross-encoder)
# ---------------------------------------------------------------------------
ENABLE_RERANKER = _env_bool("ENABLE_RERANKER", True)
RERANKER_MODEL_NAME = os.getenv("RERANKER_MODEL_NAME", "BAAI/bge-reranker-v2-m3")

# ---------------------------------------------------------------------------
# Knowledge Graph (Neo4j / Mock)
# ---------------------------------------------------------------------------
ENABLE_GRAPH = _env_bool("ENABLE_GRAPH", True)
# GRAPH_BACKEND: "neo4j" (mặc định cho dev/prod chuẩn) | "mock" (in-memory cho unit test / offline) | "none"
GRAPH_BACKEND = os.getenv("GRAPH_BACKEND", "neo4j").strip().lower()
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "medicalrag")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")
GRAPH_MAX_TRIPLES = _env_int("GRAPH_MAX_TRIPLES", 12)
# Mặc định False: không tự động fallback ngầm để tránh che giấu lỗi hạ tầng.
GRAPH_INMEMORY_FALLBACK = _env_bool("GRAPH_INMEMORY_FALLBACK", False)

# ---------------------------------------------------------------------------
# PHI De-identification
# ---------------------------------------------------------------------------
ENABLE_DEID = _env_bool("ENABLE_DEID", True)

# ---------------------------------------------------------------------------
# Med-FactCheck (grounding)
# ---------------------------------------------------------------------------
ENABLE_FACTCHECK = _env_bool("ENABLE_FACTCHECK", True)
FACTCHECK_MIN_OVERLAP = _env_float("FACTCHECK_MIN_OVERLAP", 0.25)

# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------
LLM_TEMPERATURE = _env_float("LLM_TEMPERATURE", 0.1)

# Vị trí Vector DB (hỗ trợ cả cấu trúc cũ & mới).
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VECTOR_STORE_CANDIDATES = [
    os.path.join(_BACKEND_ROOT, "data", "vector_db"),
    os.path.join(_BACKEND_ROOT, "vector_db"),
]
