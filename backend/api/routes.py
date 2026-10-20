"""Router meta: health, models, pipeline info (không cần auth)."""

from fastapi import APIRouter, Request

from api import usage
from core import config

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(request: Request):
    from core.graph_store import get_graph_store
    store = get_graph_store()
    return {
        "status": "ok",
        "pipeline_ready": getattr(request.app.state, "pipeline", None) is not None,
        "features": {
            "deid": config.ENABLE_DEID,
            "graph": config.ENABLE_GRAPH,
            "graph_backend": store._backend,
            "reranker": config.ENABLE_RERANKER,
            "factcheck": config.ENABLE_FACTCHECK,
        },
    }


@router.get("/pipeline/info")
def pipeline_info():
    return {
        "stages": [
            {"id": "deid", "name": "Khử định danh PHI", "enabled": config.ENABLE_DEID,
             "desc": "Ẩn danh Tên, ID, Ngày, SĐT (regex tiếng Việt)"},
            {"id": "route", "name": "Intent Router", "enabled": True,
             "desc": "Phân luồng Phác đồ (GraphRAG) / Bệnh án (Hybrid)"},
            {"id": "graph", "name": "Knowledge Graph", "enabled": config.ENABLE_GRAPH,
             "desc": f"Entity Matching → Traversal → Triple Textualization ({config.GRAPH_BACKEND})"},
            {"id": "retrieve", "name": "Hybrid Retrieval", "enabled": True,
             "desc": "Vector + BM25 → RRF → Rerank (bge-reranker-v2-m3)"},
            {"id": "generate", "name": "LLM Generation", "enabled": True,
             "desc": "Gemini + citation-enforced prompting (SSE streaming)"},
            {"id": "factcheck", "name": "Med-FactCheck", "enabled": config.ENABLE_FACTCHECK,
             "desc": "Grounding check phát hiện ảo giác y khoa"},
            {"id": "reid", "name": "Re-identification", "enabled": config.ENABLE_DEID,
             "desc": "Khôi phục token PHI về giá trị gốc (local)"},
        ],
        "models": config.AVAILABLE_MODELS,
    }


@router.get("/models")
def get_models():
    return usage.snapshot()
