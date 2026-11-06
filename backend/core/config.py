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
# "onnx"  : bge-reranker-v2-m3 lượng tử hoá int8 chạy bằng onnxruntime (nhanh trên CPU)
# "torch" : bản gốc fp32 qua sentence-transformers (chậm trên CPU, dùng để so sánh)
RERANKER_BACKEND = os.getenv("RERANKER_BACKEND", "onnx").strip().lower()
RERANKER_MODEL_NAME = os.getenv("RERANKER_MODEL_NAME", "BAAI/bge-reranker-v2-m3")
# Bản int8 của chính bge-reranker-v2-m3 (Apache-2.0). Ghim revision để không tự
# tải về phiên bản khác khi repo thay đổi.
RERANKER_ONNX_REPO = os.getenv("RERANKER_ONNX_REPO", "onebrain-ai/onebrain-rerank-v1")
RERANKER_ONNX_FILE = os.getenv("RERANKER_ONNX_FILE", "model_int8.onnx")
RERANKER_ONNX_REVISION = os.getenv(
    "RERANKER_ONNX_REVISION", "c39c772d8c2b1fe9c9b838bb430c5294516505a7"
)
# Số token tối đa mỗi cặp (câu hỏi, đoạn văn). Chi phí tăng ~tuyến tính tới bậc hai
# theo độ dài: 512 -> 256 nhanh hơn ~2-3 lần, đổi lại chỉ chấm phần đầu đoạn văn.
RERANKER_MAX_LENGTH = _env_int("RERANKER_MAX_LENGTH", 256)
# Số luồng CPU cho onnxruntime (0 = để onnxruntime tự chọn theo số nhân).
RERANKER_THREADS = _env_int("RERANKER_THREADS", 0)

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

# Mức "suy nghĩ" của Gemini 3.x: minimal | low | medium | high. Không đặt thì
# Gemini 3 mặc định "high" -> token đầu tiên đến chậm hơn đáng kể.
# Để trống / "off" để không gửi tham số (dùng mặc định của model).
THINKING_LEVEL = os.getenv("THINKING_LEVEL", "low").strip().lower()
THINKING_LEVEL_CHITCHAT = os.getenv("THINKING_LEVEL_CHITCHAT", "minimal").strip().lower()

# ---------------------------------------------------------------------------
# Hiệu năng
# ---------------------------------------------------------------------------
# Nạp sẵn embedding + reranker + BM25 lúc khởi động để request đầu không phải chờ.
ENABLE_WARMUP = _env_bool("ENABLE_WARMUP", True)
# In một dòng thời gian từng tầng ra log cho mỗi câu hỏi.
LOG_TIMINGS = _env_bool("LOG_TIMINGS", True)

# Vị trí Vector DB (hỗ trợ cả cấu trúc cũ & mới).
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VECTOR_STORE_CANDIDATES = [
    os.path.join(_BACKEND_ROOT, "data", "vector_db"),
    os.path.join(_BACKEND_ROOT, "vector_db"),
]
