"""
RAG Pipeline orchestrator — "bộ não" nối toàn bộ kiến trúc Medical RAG.

Luồng xử lý một truy vấn:
  1. De-identify (ẩn danh PHI)                     [core.deidentify]
  2. Intent Router (Phác đồ / Bệnh án)             [core.intent_router]
  3. Graph context (Entity→Traversal→Textualize)  [core.graph_store]
  4. Hybrid retrieve (Vector+BM25+RRF→Rerank)      [core.hybrid_retriever]
  5. Build citation-enforced prompt
  6. LLM generate (stream / non-stream)            [Gemini]
  7. Med-FactCheck (grounding)                     [core.factcheck]
  8. Re-identify (khôi phục PHI, chỉ ở local)      [core.deidentify]

Cung cấp cả API non-stream (run) và stream (SSE) cho routes.
"""

from __future__ import annotations

import os
import time
import warnings
from pathlib import Path
from typing import Dict, Iterator, List, Optional

from dotenv import load_dotenv

warnings.filterwarnings(
    "ignore", category=FutureWarning, module=r"llama_index\.embeddings\.gemini\.base"
)

from llama_index.llms.google_genai import GoogleGenAI

from core import config
from core import deidentify, factcheck, intent_router
from core.graph_store import get_graph_store
from core.hybrid_retriever import get_retriever
from core import index_store

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")


# ---------------------------------------------------------------------------
# API key helpers
# ---------------------------------------------------------------------------
def get_default_api_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()


# Lỗi tạm thời (Gemini quá tải / hết hạn ngạch) -> nên retry với backoff.
_TRANSIENT_MARKERS = ("503", "unavailable", "high demand", "overload", "429", "resource exhausted")


def _is_transient(err: Exception) -> bool:
    s = str(err).lower()
    return any(m in s for m in _TRANSIENT_MARKERS)


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------
SYSTEM_RULES = (
    "Bạn là trợ lý y khoa hỗ trợ bác sĩ, trả lời bằng tiếng Việt, chính xác và thận trọng.\n"
    "QUY TẮC BẮT BUỘC:\n"
    "1. CHỈ sử dụng thông tin trong phần NGỮ CẢNH và TRI THỨC KG bên dưới. Tuyệt đối không bịa.\n"
    "2. Sau mỗi ý/khẳng định, trích dẫn nguồn dạng [số] tương ứng với tài liệu đã cho.\n"
    "3. Nếu ngữ cảnh không đủ để trả lời, hãy nói rõ 'Không đủ thông tin trong tài liệu' thay vì suy đoán.\n"
    "4. Khi đề cập liều lượng/thuốc/chống chỉ định, kèm khuyến cáo bác sĩ xác minh trước khi áp dụng.\n"
    "5. Trình bày rõ ràng, có cấu trúc, ưu tiên gạch đầu dòng khi phù hợp.\n"
)

CHITCHAT_SYSTEM_RULES = (
    "Bạn là Trợ lý Y tế AI (Healthcare RAG) chuyên nghiệp, đồng hành cùng bác sĩ và nhân viên y tế.\n"
    "Người dùng đang gửi lời chào hỏi, cảm ơn, hoặc hỏi về bản thân và khả năng hỗ trợ của bạn.\n"
    "HÃY TUÂN THỦ CÁC QUY TẮC:\n"
    "1. Trả lời bằng tiếng Việt, giọng điệu thân thiện, chuẩn mực, tôn trọng người dùng.\n"
    "2. Xưng hô: Gọi người dùng là 'Bác sĩ' (hoặc 'Anh/Chị'), xưng 'Tôi' hoặc 'Trợ lý Y tế'.\n"
    "3. Khi được hỏi 'bạn là ai / bạn là gì / bạn có thể làm được gì', hãy giới thiệu rõ ràng 3 năng lực cốt lõi:\n"
    "   - 📚 Tra cứu phác đồ điều trị chuẩn của Bộ Y tế và y văn lâm sàng.\n"
    "   - 🕸️ Đối chiếu chỉ định, chống chỉ định và tương tác thuốc dựa trên Knowledge Graph.\n"
    "   - 📋 Phân tích, tóm tắt hồ sơ bệnh án (SOAP) và tài liệu cá nhân trong Save box.\n"
    "4. KHÔNG tự bịa các số trích dẫn nguồn [1], [2] vì đây là hội thoại chào hỏi, không có tài liệu y văn đi kèm.\n"
    "5. Giữ câu trả lời súc tích, ngắn gọn (tối đa 3-4 câu), kết thúc bằng lời mời Bác sĩ nhập câu hỏi hoặc ca bệnh cần tra cứu."
)

SAFETY_FOOTER = (
    "⚠️ Thông tin mang tính hỗ trợ tham khảo cho nhân viên y tế, không thay thế chẩn đoán "
    "và chỉ định trực tiếp của bác sĩ điều trị."
)


def _build_context_block(nodes: List[dict]) -> str:
    blocks = []
    for i, n in enumerate(nodes, start=1):
        src = n.get("file_name", "Tài liệu")
        page = n.get("page")
        section = n.get("section")
        meta = f"Nguồn: {src}"
        if page:
            meta += f", trang {page}"
        if section:
            meta += f", mục {section}"
        blocks.append(f"[{i}] ({meta})\n{n.get('text', '').strip()}")
    return "\n\n".join(blocks)


def _build_prompt(query: str, context_block: str, graph_text: str, profile_text: str = "") -> str:
    parts = [SYSTEM_RULES]
    if profile_text:
        parts += ["\n===== HỒ SƠ NGƯỜI DÙNG (để cá nhân hoá cách trả lời) =====\n", profile_text]
    parts += ["\n===== NGỮ CẢNH (tài liệu truy xuất) =====\n", context_block or "(trống)"]
    if graph_text:
        parts += ["\n\n===== TRI THỨC KG =====\n", graph_text]
    parts += ["\n\n===== CÂU HỎI =====\n", query, "\n\n===== TRẢ LỜI =====\n"]
    return "".join(parts)


def _build_chitchat_prompt(query: str, profile_text: str = "") -> str:
    parts = [CHITCHAT_SYSTEM_RULES]
    if profile_text:
        parts += ["\n\n===== HỒ SƠ NGƯỜI DÙNG HIỆN TẠI =====\n", profile_text]
    parts += ["\n\n===== TIN NHẮN CỦA BÁC SĨ =====\n", query, "\n\n===== PHẢN HỒI =====\n"]
    return "".join(parts)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
class RAGPipeline:
    def __init__(self, api_key: str, model_name: str = None):
        if not api_key or not api_key.strip():
            raise ValueError("API key is empty.")
        self.api_key = api_key.strip()
        self.model_name = (model_name or config.DEFAULT_MODEL).strip()
        self.llm = GoogleGenAI(
            model=self.model_name,
            api_key=self.api_key,
            temperature=config.LLM_TEMPERATURE,
        )

    # -- stage helpers ---------------------------------------------------
    def _prepare(self, query: str, allowed_keys=None, base_allowed: bool = True,
                 profile_text: str = "") -> Dict:
        """Chạy các tầng trước LLM, trả về mọi dữ liệu cần để sinh câu trả lời."""
        t0 = time.perf_counter()

        # 1. De-identify
        if config.ENABLE_DEID:
            deid = deidentify.default_deidentifier.deidentify(query)
            clean_query, phi_map, phi_counts = deid.text, deid.mapping, deid.counts
        else:
            clean_query, phi_map, phi_counts = query, {}, {}

        # 2. Route
        decision = intent_router.route(clean_query)

        # 3. Phân luồng: Nếu là CHITCHAT (chào hỏi, hỏi danh tính) -> Bỏ qua truy xuất y văn và KG
        if decision.intent == intent_router.CHITCHAT:
            from core.graph_store import GraphContext
            from core.hybrid_retriever import RetrievalResult
            prompt = _build_chitchat_prompt(clean_query, profile_text)
            return {
                "clean_query": clean_query,
                "phi_map": phi_map,
                "phi_counts": phi_counts,
                "route": decision,
                "graph": GraphContext(available=False, backend="none"),
                "retrieval": RetrievalResult(nodes=[], method="none", reranked=False, stats={}),
                "context_block": "",
                "prompt": prompt,
                "prep_seconds": round(time.perf_counter() - t0, 3),
            }

        # 4. Graph context (cho luồng lâm sàng)
        graph_ctx = get_graph_store().query(clean_query)

        # 5. Retrieve (có lọc theo quyền truy cập tài liệu của user)
        retrieval = get_retriever().retrieve(
            clean_query, allowed_keys=allowed_keys, base_allowed=base_allowed
        )
        context_block = _build_context_block(retrieval.nodes)

        prompt = _build_prompt(clean_query, context_block, graph_ctx.text, profile_text)

        return {
            "clean_query": clean_query,
            "phi_map": phi_map,
            "phi_counts": phi_counts,
            "route": decision,
            "graph": graph_ctx,
            "retrieval": retrieval,
            "context_block": context_block,
            "prompt": prompt,
            "prep_seconds": round(time.perf_counter() - t0, 3),
        }

    # -- LLM calls with retry on transient errors -----------------------
    def _complete_with_retry(self, prompt: str, attempts: int = 3):
        last = None
        for i in range(attempts):
            try:
                return self.llm.complete(prompt)
            except Exception as exc:
                last = exc
                if not _is_transient(exc) or i == attempts - 1:
                    raise
                time.sleep(1.5 * (i + 1))
        raise last

    def _stream_with_retry(self, prompt: str, attempts: int = 3):
        """Bắt đầu stream, retry nếu lỗi tạm thời xảy ra TRƯỚC token đầu tiên."""
        last = None
        for i in range(attempts):
            try:
                gen = self.llm.stream_complete(prompt)
                first = next(gen)  # ép gọi để lộ lỗi khởi tạo stream sớm

                def _chain(_first=first, _gen=gen):
                    yield _first
                    yield from _gen

                return _chain()
            except StopIteration:
                return iter(())
            except Exception as exc:
                last = exc
                if not _is_transient(exc) or i == attempts - 1:
                    raise
                time.sleep(1.5 * (i + 1))
        raise last

    @staticmethod
    def _sources_payload(retrieval) -> List[dict]:
        out = []
        for i, n in enumerate(retrieval.nodes, start=1):
            snippet = (n.get("text", "") or "").strip().replace("\n", " ")
            out.append({
                "index": i,
                "file_name": n.get("file_name"),
                "page": n.get("page"),
                "section": n.get("section"),
                "score": n.get("rerank_score", n.get("fusion_score")),
                "snippet": snippet[:240] + ("..." if len(snippet) > 240 else ""),
            })
        return out

    def _pipeline_meta(self, prep: Dict) -> Dict:
        decision = prep["route"]
        graph_ctx = prep["graph"]
        retrieval = prep["retrieval"]
        return {
            "deid": {
                "enabled": config.ENABLE_DEID,
                "removed": prep["phi_counts"],
                "total": sum(prep["phi_counts"].values()),
            },
            "route": {
                "intent": decision.intent,
                "confidence": decision.confidence,
                "reason": decision.reason,
            },
            "graph": {
                "backend": graph_ctx.backend,
                "available": graph_ctx.available,
                "entities": graph_ctx.entities,
                "triples": [list(t) for t in graph_ctx.triples],
            },
            "retrieval": {
                "method": retrieval.method,
                "reranked": retrieval.reranked,
                "stats": retrieval.stats,
            },
            "model": self.model_name,
            "prep_seconds": prep["prep_seconds"],
        }

    # -- public: non-stream ---------------------------------------------
    def run(self, query: str, allowed_keys=None, base_allowed: bool = True,
            profile_text: str = "") -> Dict:
        prep = self._prepare(query, allowed_keys, base_allowed, profile_text)
        resp = self._complete_with_retry(prep["prompt"])
        answer = str(resp).strip()

        is_chitchat = prep["route"].intent == intent_router.CHITCHAT
        if is_chitchat:
            fc = factcheck.FactCheckResult(grounded_ratio=None, passed=True, note="Hội thoại chào hỏi / xã giao", unsupported=[])
        else:
            ctx_texts = [n.get("text", "") for n in prep["retrieval"].nodes]
            fc = factcheck.check(answer, ctx_texts)

        # Re-identify
        if config.ENABLE_DEID and prep["phi_map"]:
            answer = deidentify.default_deidentifier.reidentify(answer, prep["phi_map"])

        final_answer = answer if is_chitchat else (answer + "\n\n" + SAFETY_FOOTER)

        meta = self._pipeline_meta(prep)
        meta["factcheck"] = None if is_chitchat else {
            "grounded_ratio": fc.grounded_ratio,
            "passed": fc.passed,
            "note": fc.note,
            "unsupported": fc.unsupported,
        }

        return {
            "answer": final_answer,
            "sources": [] if is_chitchat else self._sources_payload(prep["retrieval"]),
            "pipeline": meta,
        }

    # -- public: stream (for SSE) ---------------------------------------
    def stream(self, query: str, allowed_keys=None, base_allowed: bool = True,
               profile_text: str = "") -> Iterator[Dict]:
        """
        Yield các event dict:
          {type: 'pipeline', data: {...}}   -> metadata các tầng trước LLM
          {type: 'token', data: '...'}      -> từng mảnh văn bản
          {type: 'done', data: {...}}       -> sources + factcheck + answer đầy đủ
          {type: 'error', data: '...'}
        """
        try:
            prep = self._prepare(query, allowed_keys, base_allowed, profile_text)
        except Exception as exc:
            yield {"type": "error", "data": f"Lỗi chuẩn bị ngữ cảnh: {exc}"}
            return

        yield {"type": "pipeline", "data": self._pipeline_meta(prep)}

        is_chitchat = prep["route"].intent == intent_router.CHITCHAT
        collected: List[str] = []
        try:
            for chunk in self._stream_with_retry(prep["prompt"]):
                delta = getattr(chunk, "delta", None)
                if delta is None:
                    # một số phiên bản trả text tích luỹ
                    delta = getattr(chunk, "text", "")
                if not delta:
                    continue
                collected.append(delta)
                # Re-identify theo từng mảnh để không rò token PHI ra UI.
                out_delta = delta
                if config.ENABLE_DEID and prep["phi_map"]:
                    out_delta = deidentify.default_deidentifier.reidentify(out_delta, prep["phi_map"])
                yield {"type": "token", "data": out_delta}
        except Exception as exc:
            yield {"type": "error", "data": f"Lỗi khi sinh câu trả lời: {exc}"}
            return

        full_answer = "".join(collected).strip()
        if is_chitchat:
            fc = factcheck.FactCheckResult(grounded_ratio=None, passed=True, note="Hội thoại chào hỏi / xã giao", unsupported=[])
        else:
            ctx_texts = [n.get("text", "") for n in prep["retrieval"].nodes]
            fc = factcheck.check(full_answer, ctx_texts)

        if config.ENABLE_DEID and prep["phi_map"]:
            full_answer = deidentify.default_deidentifier.reidentify(full_answer, prep["phi_map"])

        final_answer = full_answer if is_chitchat else (full_answer + "\n\n" + SAFETY_FOOTER)

        yield {
            "type": "done",
            "data": {
                "answer": final_answer,
                "safety_footer": "" if is_chitchat else SAFETY_FOOTER,
                "sources": [] if is_chitchat else self._sources_payload(prep["retrieval"]),
                "factcheck": None if is_chitchat else {
                    "grounded_ratio": fc.grounded_ratio,
                    "passed": fc.passed,
                    "note": fc.note,
                    "unsupported": fc.unsupported,
                },
            },
        }


# ---------------------------------------------------------------------------
# Factory / cache
# ---------------------------------------------------------------------------
_pipeline_cache: Dict[str, RAGPipeline] = {}


def build_pipeline(api_key: str, model_name: str = None) -> RAGPipeline:
    key = f"{(api_key or '')[:12]}::{model_name or config.DEFAULT_MODEL}"
    pipe = _pipeline_cache.get(key)
    if pipe is None:
        pipe = RAGPipeline(api_key=api_key, model_name=model_name)
        _pipeline_cache[key] = pipe
    return pipe


def initialize_default_pipeline() -> Optional[RAGPipeline]:
    api_key = get_default_api_key()
    if not api_key:
        print("Cảnh báo: chưa set GEMINI_API_KEY/GOOGLE_API_KEY. Pipeline mặc định không khả dụng.")
        return None
    try:
        # Làm nóng index để request đầu tiên nhanh hơn.
        index_store.get_index()
        return build_pipeline(api_key, config.DEFAULT_MODEL)
    except Exception as exc:
        print(f"Không khởi tạo được pipeline mặc định: {exc}")
        return None


# ---------------------------------------------------------------------------
# Backward-compat: get_query_engine (một số script cũ có thể còn gọi)
# ---------------------------------------------------------------------------
def initialize_default_query_engine():
    return initialize_default_pipeline()


def get_query_engine(api_key: str, model_name: str = None):
    return build_pipeline(api_key=api_key, model_name=model_name)
