# Healthcare RAG — Clinical Medical RAG

Trợ lý y tế cấp lâm sàng dựa trên kiến trúc **Medical RAG nâng cao**: khử định danh
PHI, định tuyến truy vấn, **GraphRAG** (Knowledge Graph) + **Hybrid Search**
(Vector + BM25 + RRF + Cross-encoder Reranker), sinh câu trả lời có **trích dẫn
nguồn** và **kiểm tra bám nguồn (Med-FactCheck)**, trả về qua **SSE streaming**.

## Kiến trúc & Luồng xử lý

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

So với kiến trúc gốc, phiên bản này **lược bỏ các phần tốn chi phí không cần
thiết** (đã trao đổi): dùng **đồ thị y khoa tự curate** (ICD-10 miễn phí, tránh
bản quyền SNOMED/UMLS), **de-id bằng regex tiếng Việt** thay cho Presidio, giữ
Vector DB `vietnamese-sbert` sẵn có thay vì re-embed BGE-M3 + Qdrant. Tất cả hạ
tầng đều **self-host $0** (khoản tốn tiền duy nhất là API Gemini).

## Thành phần chính

| Khối | File | Công nghệ |
|---|---|---|
| Khử định danh PHI | [backend/core/deidentify.py](backend/core/deidentify.py) | Regex/pattern tiếng Việt |
| Intent Router | [backend/core/intent_router.py](backend/core/intent_router.py) | Heuristic từ khoá |
| Knowledge Graph | [backend/core/graph_store.py](backend/core/graph_store.py) · [seed](backend/core/graph_seed.py) | Neo4j Community / Mock seed |
| Hybrid Retrieval | [backend/core/hybrid_retriever.py](backend/core/hybrid_retriever.py) | BM25 + Vector + RRF |
| Reranker | [backend/core/reranker.py](backend/core/reranker.py) | Cross-encoder `bge-reranker-v2-m3` |
| Pipeline / LLM | [backend/core/generator.py](backend/core/generator.py) | Gemini (google-genai) |
| Med-FactCheck | [backend/core/factcheck.py](backend/core/factcheck.py) | Grounding overlap |
| Ingestion (SOAP-aware) | [backend/core/ingestion.py](backend/core/ingestion.py) | OCR + SOAP chunking |
| API Backend | [backend/api/routes.py](backend/api/routes.py) · [admin_routes.py](backend/api/admin_routes.py) | FastAPI + SSE + Admin Analytics |
| Frontend & Admin Portal | [frontend/src/App.jsx](frontend/src/App.jsx) · [AdminPanel.jsx](frontend/src/AdminPanel.jsx) | React 19, Vite, SVG Charts, URL Hash Routing |

## Yêu cầu

- Python 3.10+ (khuyến nghị 3.11+), Node.js 18+ và npm
- Tesseract OCR (ngôn ngữ `vie`) + Poppler — chỉ cần khi chạy lại ingestion cho PDF ảnh
- Docker Desktop — chạy Neo4j Community (hoặc cấu hình `GRAPH_BACKEND=mock` nếu chạy offline / test nhanh)
- RAM ≥ 8GB khuyến nghị (reranker `bge-reranker-v2-m3` ~2.3GB)

## Cấu hình (.env)

Tạo `backend/.env` từ mẫu [backend/.env.example](backend/.env.example). Tối thiểu:

```env
GEMINI_API_KEY=your_key_here
```

Các feature flag và cấu hình Knowledge Graph backend:

```env
ENABLE_DEID=true
ENABLE_GRAPH=true

# ============================================
# Knowledge Graph Backend:
# "neo4j" : Kết nối Neo4j qua Docker (chuẩn Production / Dev nghiêm ngặt, fail-fast nếu mất kết nối)
# "mock"  : Dùng đồ thị in-memory từ seed y khoa (phù hợp Unit Test, CI/CD, hoặc dev offline không cần Docker)
# "none"  : Tắt hoàn toàn tầng GraphRAG
# ============================================
GRAPH_BACKEND=neo4j
# Mặc định false: không tự fallback ngầm để tránh che giấu lỗi hạ tầng
GRAPH_INMEMORY_FALLBACK=false

ENABLE_RERANKER=true          # tắt (false) nếu máy yếu / không muốn tải reranker 2.3GB
ENABLE_FACTCHECK=true
DEFAULT_MODEL=gemini-3.5-flash
```

> **Lưu ý model**: họ `gemini-2.5-*` đã bị Google chặn với tài khoản mới (404).
> Dự án dùng họ **`gemini-3.x`** (mặc định `gemini-3.5-flash`). Khi một model quá
> tải (503) hoặc hết quota, backend tự retry và frontend tự fallback sang model kế.

## Chạy project

### 1) Khởi động Neo4j (Khuyến nghị cho Production & Dev chuẩn)

```powershell
docker compose up -d neo4j      # từ thư mục gốc dự án
cd backend
python scripts/build_graph.py   # nạp đồ thị y khoa seed vào Neo4j
```

> **Mẹo (Offline / Quick Dev)**: Nếu muốn test nhanh UI hoặc chạy trên máy không cài Docker, bạn chỉ cần đặt `GRAPH_BACKEND=mock` trong file `backend/.env`. Backend sẽ tự nạp đồ thị tri thức in-memory mà không báo lỗi kết nối.

Neo4j Browser: `http://localhost:7474` (user `neo4j` / pass `medicalrag`).

### 2) Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

API mặc định: `http://127.0.0.1:8001`. Lần chạy đầu sẽ tải embedding
`vietnamese-sbert` (~500MB) và (nếu bật) reranker (~2.3GB). Khi khởi động, backend sẽ kiểm tra kết nối Knowledge Graph ngay lập tức (fail-fast).

#### Build index lần đầu

Vector DB (`backend/vector_db/`) **không còn được commit** — mỗi máy tự build từ tài liệu gốc.
Cần Tesseract OCR có gói tiếng Việt (`vie`) vì phác đồ mẫu là PDF dạng ảnh.

```powershell
cd backend
python scripts/rebuild_index.py --from-scratch --dry-run   # xem trước số chunk, chưa ghi
python scripts/rebuild_index.py --from-scratch             # build và ghi backend/vector_db
```

`--from-scratch` nạp file `*.pdf`/`*.txt` nằm trực tiếp trong `backend/data/` cùng các tài liệu hệ thống (admin upload) còn file; thêm `--include-user-docs` để nạp lại cả tài liệu riêng của người dùng. Index cũ được giữ lại ở `backend/vector_db.bak/`. Nếu OCR không đọc được tài liệu gốc, script dừng và không ghi đè index cũ.

Bảo trì index (nên tắt backend trước khi chạy):

| Lệnh | Tác dụng |
|---|---|
| `python scripts/rebuild_index.py --purge-orphans [--dry-run]` | Xoá node có `doc_key` không còn trong bảng `documents` (không cần tải model) |
| `python scripts/rebuild_index.py --remove-doc ID [--remove-doc ID ...] [--dry-run]` | Xoá hẳn tài liệu: node trong index, file upload và bản ghi DB |
| `python scripts/migrate_stored_paths.py [--dry-run]` | Migrate một lần: đổi `stored_path` dạng tuyệt đối (máy cũ) sang tên file trong `data/uploads/` |

Khi khởi động, backend cảnh báo nếu chưa có Vector DB hoặc index chứa node của tài liệu không còn trong DB (không tự xoá).

> Repo đã từng commit `backend/vector_db/` có 2 node dữ liệu test giả (`doc:2`, `doc:3`). Sau khi pull bản này, thư mục đó sẽ bị git xoá khỏi máy — chạy `--from-scratch` để build lại; nếu còn giữ bản cũ thì chạy `--purge-orphans`.

### 3) Frontend

```powershell
cd frontend
npm install
npm run dev
```

UI theo URL Vite in ra (thường `http://127.0.0.1:5173`).

## Giao diện & Tính năng Ứng dụng

- **Xác thực người dùng**: Đăng nhập/Đăng ký với JWT và bcrypt. Tài khoản Admin mặc định: `admin@medrag.local` / `admin123` (cần đổi trong `.env`).
- **Phòng khám Bác sĩ (Chat RAG)**: SSE streaming câu trả lời kèm pipeline trace 7 tầng, hiển thị tỷ lệ bám nguồn (Med-FactCheck) và cảnh báo nguy cơ ảo giác theo thời gian thực.
- **Lịch sử hội thoại**: Tự động lưu theo từng tài khoản trên SQLite, quản lý danh sách chat tại left sidebar.
- **Save box (Hộp tài liệu cá nhân)**: Bác sĩ tự tải lên tài liệu riêng (PDF/TXT/MD), hệ thống tự động băm nhỏ và nhúng vector. Bác sĩ có thể linh hoạt bật/tắt từng tài liệu để phục vụ ca bệnh cụ thể mà vẫn bảo đảm tính cô lập dữ liệu.
- **Hồ sơ cá nhân (Profile)**: Cấu hình thông tin chuyên khoa và ngữ cảnh làm việc để hệ thống cá nhân hóa câu trả lời.
- **Điều hướng URL Hash**: Hỗ trợ đồng bộ URL và duy trì trạng thái khi refresh trình duyệt (`#chat`, `#savebox`, `#profile`, `#admin/dashboard`, `#admin/chats`, `#admin/auth-logs`, `#admin/docs`, `#admin/users`).

### Cổng Quản trị Hệ thống Y tế (Admin Portal)

Dành riêng cho Super Admin (`role: admin`) với thanh điều hướng `AdminSidebar` chuyên biệt và nút chuyển đổi nhanh về Phòng khám:

1. **Dashboard Phân tích Toàn diện & Biểu đồ Trực quan**:
   - **Thẻ KPI an toàn**: Tổng người dùng, tài liệu hệ thống vs tài liệu bác sĩ, tổng truy vấn lâm sàng và Tỷ lệ bám nguồn trung bình.
   - **Biểu đồ Donut Fact-Check**: Phân bổ mức độ bám nguồn y văn theo 3 ngưỡng an toàn:
     - 🟢 **Đạt chuẩn y văn (≥ 70%)**: Câu trả lời bám sát tài liệu nguồn.
     - 🟡 **Cần lưu ý (40% - 69%)**: Một số luận điểm cần đối chiếu thêm.
     - 🔴 **Nguy cơ ảo giác (< 40%)**: Cảnh báo cần rà soát lại thông tin.
   - **Biểu đồ Phân bổ Tri thức (Knowledge Graph Ontology)**: Thống kê số lượng thực thể theo chuyên mục y khoa (Bệnh lý, Nhóm thuốc, Thuốc, Tác dụng phụ, Biến chứng, Xét nghiệm).
   - **Biểu đồ Cột Xu hướng 14 ngày**: Theo dõi khối lượng truy vấn lâm sàng hàng ngày và diễn biến tỷ lệ bám nguồn trung bình.
   - **Biểu đồ Tải & Hạn mức Mô hình**: Giám sát phân bổ lưu lượng giữa các model LLM.
2. **Giám sát Truy vấn Lâm sàng & Lọc Ảo giác (Fact-Check Logs)**:
   - Theo dõi chi tiết từng câu hỏi của bác sĩ, mô hình xử lý, nhãn bám nguồn và thời gian.
   - Bộ lọc nhanh theo mức độ an toàn (Tất cả, Đạt chuẩn ≥70%, Cần lưu ý, Nguy cơ ảo giác <40%) cùng ô tìm kiếm từ khóa.
3. **Nhật ký Xác thực & Bảo mật (Auth & Security Audit Logs)**:
   - Giám sát các sự kiện đăng nhập, đăng ký tài khoản và nạp tài liệu với đầy đủ dấu vết thời gian.
4. **Quản lý Tài liệu Gốc Hệ thống (System Documents)**:
   - Nạp các phác đồ điều trị Bộ Y tế dùng chung cho toàn bộ hệ thống; hỗ trợ bật/tắt tạm dừng truy xuất hoặc xoá tài liệu.
5. **Quản lý Bác sĩ & Người dùng (User Management)**:
   - Danh sách tài khoản, vai trò, chuyên khoa công tác, số lượng hội thoại và tổng số lượt hỏi đáp lâm sàng.

## API Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái hệ thống, pipeline và backend Knowledge Graph đang dùng (`neo4j` / `mock` / `none`) |
| GET | `/api/models` | Danh sách model Gemini và hạn mức sử dụng trong ngày |
| GET | `/api/pipeline/info` | Thông tin 7 tầng xử lý trong kiến trúc RAG |
| POST | `/api/chat` | Hỏi đáp RAG non-streaming (JSON: answer, citations, pipeline trace, factcheck) |
| POST | `/api/chat/stream` | Hỏi đáp RAG thời gian thực qua **SSE** (events: `pipeline` → `token` → `done`) |
| GET | `/api/admin/activity` | Thống kê KPI, biểu đồ Donut grounding, timeline 14 ngày, ontology KG, log truy vấn và log xác thực |
| GET | `/api/admin/docs` | Danh sách tài liệu gốc hệ thống |
| POST | `/api/admin/docs` | Upload tài liệu gốc hệ thống (.pdf, .txt, .md) |
| PATCH | `/api/admin/docs/{id}/toggle` | Bật/tắt tài liệu hệ thống |
| DELETE | `/api/admin/docs/{id}` | Xoá tài liệu hệ thống |
| GET | `/api/admin/users` | Danh sách người dùng, vai trò và chuyên khoa |

## Thư mục Dữ liệu

| Đường dẫn | Nội dung | Git |
|---|---|---|
| `backend/data/*.pdf`, `*.txt` | Tài liệu gốc hệ thống (nguồn của `--from-scratch`) | commit |
| `backend/data/app.db` | SQLite: người dùng, hội thoại, tài liệu | bỏ qua |
| `backend/data/uploads/` | File tài liệu upload; `Document.stored_path` lưu **tên file tương đối** so với thư mục này | bỏ qua |
| `backend/data/model_usage.json` | Bộ đếm lượt gọi model theo ngày | bỏ qua |
| `backend/vector_db/` | Vector DB (LlamaIndex JSON), build bằng `scripts/rebuild_index.py` | bỏ qua |

## Bảo mật & Khử định danh

- `backend/.env` nằm trong `.gitignore` — **tuyệt đối không commit API key**.
- Toàn bộ thông tin định danh y tế (PHI) của bệnh nhân được khử định danh bằng regex/pattern tiếng Việt tại local trước khi gửi tới LLM, và chỉ khôi phục token ở môi trường nội bộ.

