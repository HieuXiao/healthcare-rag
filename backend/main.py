from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
import os

from contextlib import asynccontextmanager
from core.generator import initialize_default_pipeline
from core.db import init_db

from api.routes import router as meta_router
from api.auth_routes import router as auth_router
from api.chat_routes import router as chat_router
from api.doc_routes import router as doc_router
from api.admin_routes import router as admin_router

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi tạo database (tạo bảng, seed admin + tài liệu gốc).
    print("Khởi tạo database...")
    init_db()
    # Cảnh báo nếu Vector DB thiếu hoặc chứa node của tài liệu không còn trong DB.
    from core.db import SessionLocal
    from core.services import warn_if_index_inconsistent
    with SessionLocal() as db:
        warn_if_index_inconsistent(db)
    # Khởi tạo Knowledge Graph (fail-fast nếu backend=neo4j nhưng không kết nối được)
    print("Khởi tạo Knowledge Graph...")
    from core.graph_store import get_graph_store
    get_graph_store().initialize()
    # Khởi động RAG pipeline mặc định với API key hệ thống.
    print("Khởi động Medical RAG Pipeline mặc định...")
    app.state.pipeline = initialize_default_pipeline()
    if app.state.pipeline:
        print("✅ Medical RAG Pipeline mặc định đã sẵn sàng!")
    else:
        print("⚠️ Pipeline mặc định chưa sẵn sàng. API key chưa được set (GEMINI_API_KEY hoặc GOOGLE_API_KEY). "
              "Người dùng vẫn có thể dán API key trên UI để dùng.")
    yield
    # Dọn dẹp tài nguyên.
    print("Dọn dẹp và tắt RAG Pipeline...")
    try:
        from core.graph_store import get_graph_store
        get_graph_store().close()
    except Exception:
        pass
    app.state.pipeline = None

app = FastAPI(
    title="Clinical RAG API",
    description="API cung cấp dịch vụ trợ lý y khoa AI",
    version="1.0.0",
    lifespan=lifespan
)

# Cáº¥u hÃ¬nh CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(doc_router, prefix="/api")
app.include_router(admin_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    reload_enabled = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
    backend_host = os.getenv("BACKEND_HOST", "127.0.0.1")
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    browser_host = "127.0.0.1" if backend_host == "0.0.0.0" else backend_host
    print(f"BE listening on: http://{browser_host}:{backend_port}")
    print(f"Health/models URL: http://{browser_host}:{backend_port}/api/models")
    uvicorn.run("main:app", host=backend_host, port=backend_port, reload=reload_enabled)
