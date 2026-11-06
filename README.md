# Healthcare RAG — Clinical Medical RAG

Trợ lý y tế cấp lâm sàng dựa trên kiến trúc **Medical RAG nâng cao**: khử định danh PHI, định tuyến truy vấn, **GraphRAG** (Knowledge Graph) + **Hybrid Search** (Vector + BM25 + RRF + Cross-encoder Reranker), sinh câu trả lời có **trích dẫn nguồn** và **kiểm tra bám nguồn (Med-FactCheck)**, trả về qua **SSE streaming**.

---

## Mục lục nhanh
1. [Bắt đầu từ đầu (Dành cho người mới clone repo)](#-1-bắt-đầu-từ-đầu-dành-cho-người-mới-clone-repo)
2. [Chạy lại dự án (Dành cho người đã cài đặt)](#-2-chạy-lại-dự-án-dành-cho-người-đã-cài-đặt)
3. [Cấu hình chi tiết (.env) & Mẹo chạy máy yếu](#️-3-cấu-hình-chi-tiết-env--mẹo-chạy-máy-yếu)
4. [Bảo trì & Quản lý dữ liệu Index](#-4-bảo-trì--quản-lý-dữ-liệu-index)
5. [Kiến trúc & Thành phần hệ thống](#-5-kiến-trúc--thành-phần-hệ-thống)
6. [Tính năng & API Endpoints](#-6-tính-năng--api-endpoints)

---

## 🚀 1. Bắt đầu từ đầu (Dành cho người mới clone repo)

Khi mới clone dự án về, máy bạn **chưa có sẵn file cấu hình `.env`, chưa có dữ liệu đồ thị Neo4j và chưa có Vector DB** (`backend/vector_db/` không được commit lên Git). Hãy chọn **1 trong 2 cách** dưới đây để thiết lập lần đầu:

### Yêu cầu chuẩn bị
- **Bắt buộc**: Có `GEMINI_API_KEY` (lấy tại Google AI Studio).
- **Nếu chạy bằng Docker (Cách A)**: Chỉ cần cài **Docker Desktop**.
- **Nếu chạy trực tiếp trên máy (Cách B)**:
  - Python 3.10+ (khuyến nghị 3.11+), Node.js 18+ và npm.
  - **Tesseract OCR** (có gói tiếng Việt `vie`) + **Poppler** (để đọc phác đồ PDF dạng scan khi build Vector DB lần đầu).
  - RAM khuyến nghị ≥ 8GB (embedding `vietnamese-sbert` ~500MB + reranker `bge-reranker-v2-m3` bản ONNX int8 mặc định ~570MB hoặc bản Torch fp32 ~2.3GB).

---

### Cách A: Thiết lập lần đầu bằng Docker (Nhanh & Đóng gói sẵn)

Mở PowerShell / Terminal tại thư mục gốc dự án:

```powershell
# Bước 1: Tạo file .env và mở file này lên điền GEMINI_API_KEY của bạn
copy backend\.env.example backend\.env

# Bước 2: Build và khởi chạy toàn bộ container (Neo4j + Backend + Frontend)
docker compose up -d --build

# Bước 3: Khởi tạo dữ liệu lần đầu (Nạp đồ thị y khoa & Build Vector DB)
docker compose exec backend python scripts/build_graph.py
docker compose exec backend python scripts/rebuild_index.py --from-scratch

# Bước 4: Khởi động lại backend để nhận diện Vector DB vừa build
docker compose restart backend
```

---

### Cách B: Thiết lập lần đầu trên máy (Local Development)

#### Bước 1: Tạo file môi trường `.env`
```powershell
copy backend\.env.example backend\.env
```
Mở `backend/.env` và điền `GEMINI_API_KEY=your_key_here`.
> 💡 **Không có Docker?** Hãy sửa `GRAPH_BACKEND=mock` trong `backend/.env` để dùng đồ thị y khoa trên RAM (bỏ qua được Bước 2).

#### Bước 2: Khởi chạy Neo4j và nạp đồ thị y khoa (Bỏ qua nếu dùng `GRAPH_BACKEND=mock`)
```powershell
docker compose up -d neo4j
```

#### Bước 3: Cài đặt thư viện Python & Khởi tạo dữ liệu Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Nạp đồ thị y khoa vào Neo4j (nếu dùng Neo4j ở Bước 2)
python scripts/build_graph.py

# Build Vector DB từ các tài liệu PDF/TXT gốc trong backend/data/
python scripts/rebuild_index.py --from-scratch

# Chạy thử Backend (Lần đầu sẽ tải model vietnamese-sbert ~500MB và reranker ONNX ~570MB)
python main.py
```

#### Bước 4: Cài đặt và chạy Frontend (Mở một cửa sổ Terminal mới)
```powershell
cd frontend
npm install
npm run dev
```

---

### 🌐 Địa chỉ truy cập & Tài khoản mặc định (Sau khi chạy xong)
- **Giao diện ứng dụng (Frontend)**: `http://localhost:5173`
- **Tài liệu API (Swagger)**: `http://localhost:8001/docs`
- **Neo4j Browser**: `http://localhost:7474` (User: `neo4j` / Pass: `medicalrag`)
- **Tài khoản Admin mặc định**: `admin@medrag.local` / Mật khẩu: `admin123`

---

## 🔄 2. Chạy lại dự án (Dành cho người đã cài đặt)

Nếu bạn đã làm xong phần **Thiết lập lần đầu** trước đó (đã có `.env`, `.venv`, `node_modules`, dữ liệu Neo4j và `backend/vector_db/`), mỗi lần mở máy lên làm việc lại bạn **chỉ cần chạy các lệnh ngắn gọn sau**:

### Nếu bạn dùng Docker (Cách A)
Từ thư mục gốc dự án:
```powershell
# Bật lại toàn bộ hệ thống (không cần build lại image hay nạp lại DB)
docker compose up -d

# Khi làm việc xong, muốn tắt hệ thống:
docker compose stop
```
*(Nếu bạn vừa sửa code của Backend/Frontend và muốn cập nhật vào Docker, dùng: `docker compose up -d --build`)*

### Nếu bạn chạy Local từng phần (Cách B)
Bạn cần bật lại các dịch vụ theo 3 bước nhanh:

**1. Bật Neo4j** *(Bỏ qua nếu trong `.env` đang để `GRAPH_BACKEND=mock`)*:
```powershell
docker compose start neo4j
```

**2. Bật Backend** (Terminal 1):
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python main.py
```

**3. Bật Frontend** (Terminal 2):
```powershell
cd frontend
npm run dev
```

---

## ⚙️ 3. Cấu hình chi tiết (.env) & Mẹo chạy máy yếu

File cấu hình nằm tại `backend/.env` (tạo từ mẫu [backend/.env.example](backend/.env.example)):

```env
GEMINI_API_KEY=your_key_here

ENABLE_DEID=true
ENABLE_GRAPH=true

# Chọn nơi lưu trữ Knowledge Graph:
# - "neo4j" : Kết nối Neo4j qua Docker (chuẩn Production/Dev nghiêm ngặt, báo lỗi ngay nếu mất kết nối)
# - "mock"  : Đồ thị in-memory từ seed y khoa (chạy nhẹ, không cần cài Docker)
# - "none"  : Tắt hoàn toàn tầng GraphRAG
GRAPH_BACKEND=neo4j
GRAPH_INMEMORY_FALLBACK=false

# Đặt false nếu máy ít RAM hoặc không muốn tải model reranker (ONNX int8 ~570MB / Torch fp32 ~2.3GB)
ENABLE_RERANKER=true
RERANKER_BACKEND=onnx
ENABLE_FACTCHECK=true

# Model mặc định (họ gemini-3.x; tự retry 503 và tự fallback khi hết hạn mức)
DEFAULT_MODEL=gemini-3.5-flash
```

> **Lưu ý về Model Gemini**: Họ `gemini-2.5-*` đã bị Google ngừng cấp cho tài khoản mới (lỗi 404). Dự án sử dụng họ **`gemini-3.x`** (mặc định `gemini-3.5-flash`). Khi một model quá tải (503) hoặc hết quota, backend tự retry và frontend tự chuyển sang model dự phòng.

---

## 🛠️ 4. Bảo trì & Quản lý dữ liệu Index

Khi khởi động, backend sẽ cảnh báo nếu chưa có Vector DB hoặc trong index có chứa các node của tài liệu đã bị xoá khỏi DB. Khi cần dọn dẹp hoặc cập nhật lại Vector DB (nên tắt backend trước khi chạy):

| Tình huống | Lệnh thực thi (chạy trong thư mục `backend/`) |
|---|---|
| **Xem trước (Dry-run)** số chunk sẽ tạo mà không ghi đè | `python scripts/rebuild_index.py --from-scratch --dry-run` |
| **Build lại toàn bộ Vector DB** từ `backend/data/` + tài liệu Admin | `python scripts/rebuild_index.py --from-scratch` |
| **Build lại kèm cả tài liệu riêng** của từng User | `python scripts/rebuild_index.py --from-scratch --include-user-docs` |
| **Dọn rác (Purge Orphans)**: Xoá các vector node không còn trong bảng `documents` (chạy nhanh, không cần tải model) | `python scripts/rebuild_index.py --purge-orphans` |
| **Xoá vĩnh viễn 1 tài liệu** (xoá khỏi Vector DB, xoá file và bản ghi SQLite) | `python scripts/rebuild_index.py --remove-doc <ID>` |
| **Migrate đường dẫn cũ**: Đổi `stored_path` tuyệt đối sang tên file tương đối | `python scripts/migrate_stored_paths.py` |

*(Bản sao lưu của Vector DB cũ luôn được giữ tự động tại `backend/vector_db.bak/` mỗi khi chạy `--from-scratch`)*.

### Cấu trúc thư mục dữ liệu
| Đường dẫn | Nội dung | Trạng thái Git |
|---|---|---|
| `backend/data/*.pdf`, `*.txt` | Tài liệu phác đồ gốc của hệ thống (nguồn của `--from-scratch`) | Được commit |
| `backend/data/app.db` | Cơ sở dữ liệu SQLite (người dùng, lịch sử chat, metadata tài liệu) | Bỏ qua (`.gitignore`) |
| `backend/data/uploads/` | File tài liệu do Admin và Bác sĩ tải lên qua giao diện web | Bỏ qua (`.gitignore`) |
| `backend/data/model_usage.json` | Bộ đếm lượt gọi model Gemini theo ngày | Bỏ qua (`.gitignore`) |
| `backend/vector_db/` | Vector DB (LlamaIndex JSON), sinh ra bởi `rebuild_index.py` | Bỏ qua (`.gitignore`) |

---

## 🧠 5. Kiến trúc & Thành phần hệ thống

```
Giao diện Bác sĩ (React, SSE)
        │
        ▼
1. Khử định danh PHI          core/deidentify.py     (regex tiếng Việt: Tên, ID, Ngày, SĐT, Địa chỉ)
2. Intent Router              core/intent_router.py  (phân luồng Phác đồ / Bệnh án)
        ├────────────── Luồng Phác đồ (GraphRAG) ──────────────┐
        │  3. Knowledge Graph   core/graph_store.py             │
        │     Entity Matching → Graph Traversal → Triple Text   │
        │     (Neo4j Community hoặc Mock in-memory có chủ đích) │
        │                                                        │
        └────────────── Luồng chung (Hybrid Search) ───────────┘
           4. Hybrid Retrieval  core/hybrid_retriever.py
              Vector (vietnamese-sbert) + BM25 → RRF → Rerank (bge-reranker-v2-m3)
        │
        ▼
5. LLM Generation             core/generator.py      (Gemini + citation-enforced prompt, retry 503)
6. Med-FactCheck              core/factcheck.py      (grounding, phát hiện ảo giác)
7. Re-identification          core/deidentify.py     (khôi phục token PHI ở local)
        │
        ▼
Phản hồi: answer + citations + pipeline trace  (SSE streaming / JSON)
```

Thiết kế tối ưu chi phí (**self-host $0**, chỉ tốn phí gọi API Gemini):
- Dùng **đồ thị y khoa tự curate** (ICD-10 miễn phí, tránh phí bản quyền SNOMED/UMLS).
- **Khử định danh bằng regex tiếng Việt** tại local thay cho Microsoft Presidio.
- Kết hợp `vietnamese-sbert` + BM25 + Cross-encoder Reranker.

| Khối chức năng | File mã nguồn | Công nghệ sử dụng |
|---|---|---|
| Khử định danh PHI | [backend/core/deidentify.py](backend/core/deidentify.py) | Regex / Pattern tiếng Việt |
| Intent Router | [backend/core/intent_router.py](backend/core/intent_router.py) | Heuristic từ khoá lâm sàng |
| Knowledge Graph | [backend/core/graph_store.py](backend/core/graph_store.py) · [graph_seed.py](backend/core/graph_seed.py) | Neo4j Community / Mock seed |
| Hybrid Retrieval | [backend/core/hybrid_retriever.py](backend/core/hybrid_retriever.py) | BM25 + Vector + Reciprocal Rank Fusion (RRF) |
| Reranker | [backend/core/reranker.py](backend/core/reranker.py) | Cross-encoder `bge-reranker-v2-m3` |
| Pipeline / LLM | [backend/core/generator.py](backend/core/generator.py) | Gemini (`google-genai`) |
| Med-FactCheck | [backend/core/factcheck.py](backend/core/factcheck.py) | Grounding overlap verification |
| Ingestion (SOAP-aware) | [backend/core/ingestion.py](backend/core/ingestion.py) | Tesseract OCR + SOAP chunking |
| API Backend | [backend/api/routes.py](backend/api/routes.py) · [admin_routes.py](backend/api/admin_routes.py) | FastAPI + SSE + Admin Analytics |
| Frontend & Admin Portal | [frontend/src/App.jsx](frontend/src/App.jsx) · [AdminPanel.jsx](frontend/src/AdminPanel.jsx) | React 19, Vite, SVG Charts, Hash Routing |

---

## 🖥️ 6. Tính năng & API Endpoints

### Phân hệ Bác sĩ (Clinical Workspace)
- **Xác thực JWT & bcrypt**: Quản lý phiên đăng nhập và lịch sử hội thoại riêng biệt trên SQLite.
- **Chat RAG thời gian thực (SSE)**: Hiển thị câu trả lời từng từ kèm **Pipeline Trace 7 tầng**, tỷ lệ bám nguồn (**Med-FactCheck**) và cảnh báo nguy cơ ảo giác.
- **Save box (Hộp tài liệu cá nhân)**: Bác sĩ tự tải lên tài liệu riêng (`.pdf`, `.txt`, `.md`), chủ động bật/tắt từng tài liệu cho từng ca bệnh mà vẫn cô lập dữ liệu với người dùng khác.
- **Hồ sơ chuyên khoa (Profile)**: Cá nhân hóa ngữ cảnh trả lời theo chuyên khoa của bác sĩ.

### Phân hệ Quản trị (Admin Portal)
- **Dashboard trực quan**: Thẻ KPI toàn hệ thống, biểu đồ Donut phân bổ tỷ lệ bám nguồn (🟢 Đạt chuẩn ≥70%, 🟡 Cần lưu ý 40–69%, 🔴 Nguy cơ ảo giác <40%), thống kê thực thể Knowledge Graph, xu hướng truy vấn 14 ngày và hạn mức sử dụng từng model.
- **Giám sát truy vấn & Lọc ảo giác (Fact-Check Logs)**: Tra cứu và lọc nhanh các câu trả lời có điểm bám nguồn thấp.
- **Nhật ký bảo mật (Auth & Security Audit Logs)**: Theo dõi lịch sử đăng nhập, đăng ký, tải tài liệu.
- **Quản lý Tài liệu hệ thống & Người dùng**: Upload/bật/tắt/xoá phác đồ Bộ Y tế dùng chung và quản lý danh sách bác sĩ.

### Danh sách API chính
| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/health` | Trạng thái hệ thống, pipeline và Knowledge Graph (`neo4j` / `mock` / `none`) |
| `GET` | `/api/models` | Danh sách model Gemini và hạn mức sử dụng trong ngày |
| `GET` | `/api/pipeline/info` | Thông tin 7 tầng xử lý trong kiến trúc RAG |
| `POST` | `/api/auth/register` · `/api/auth/login` | Đăng ký và Đăng nhập nhận JWT token |
| `GET/PUT` | `/api/auth/me` | Lấy và cập nhật hồ sơ chuyên khoa cá nhân |
| `GET/POST/PUT/DELETE` | `/api/conversations`, `/api/conversations/{id}` | Quản lý danh sách và lịch sử các cuộc hội thoại |
| `POST` | `/api/chat` | Hỏi đáp RAG non-streaming (trả về JSON) |
| `POST` | `/api/chat/stream` | Hỏi đáp RAG qua **SSE** (`conversation` → `pipeline` → `token` → `done`) |
| `GET/POST` | `/api/documents`, `/api/documents/upload` | Danh sách tài liệu và Upload tài liệu riêng vào Save box |
| `PUT/DELETE` | `/api/documents/{id}/toggle`, `/api/documents/{id}` | Bật/tắt hoặc xoá tài liệu cá nhân trong Save box |
| `GET` | `/api/admin/activity` | Thống kê KPI, biểu đồ Donut, timeline 14 ngày, KG ontology, log truy vấn & bảo mật |
| `GET/POST` | `/api/admin/documents`, `/api/admin/documents/upload` | Danh sách và Upload tài liệu gốc hệ thống |
| `PUT/DELETE` | `/api/admin/documents/{id}/toggle`, `/api/admin/documents/{id}` | Bật/tắt hoặc xoá tài liệu gốc hệ thống |
| `GET` | `/api/admin/users` | Danh sách bác sĩ/người dùng, vai trò và thống kê tương tác |
