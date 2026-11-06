"""
Reranking bằng Cross-Encoder (bge-reranker-v2-m3).

Chấm lại độ liên quan y khoa giữa câu hỏi và từng tài liệu ứng viên, đưa tài liệu
quan trọng nhất lên đầu trước khi nạp vào prompt. Model được nạp lười (lazy) ở lần
dùng đầu tiên (main.py có warmup lúc khởi động); nếu không tải được (thiếu lib/
mạng) thì tự bỏ qua rerank, hệ thống vẫn chạy bằng điểm fusion.

Hai backend (chọn qua RERANKER_BACKEND):
  - onnx  : bản int8 của bge-reranker-v2-m3 chạy bằng onnxruntime, ~569MB, nhanh
            hơn nhiều trên CPU, thứ tự xếp hạng gần như trùng bản gốc.
  - torch : bản gốc fp32 qua sentence-transformers (~2.3GB), giữ để so sánh.
Cả hai đều trả điểm sigmoid trong [0, 1] nên ngưỡng/hiển thị không đổi.
"""

from __future__ import annotations

import threading
from typing import List, Optional, Sequence, Tuple

from core import config

_model = None
_load_failed = False
_lock = threading.Lock()


class _TorchReranker:
    def __init__(self, max_length: int):
        from sentence_transformers import CrossEncoder

        self.label = f"torch-fp32/{max_length}"
        # CrossEncoder 1 nhãn mặc định áp sigmoid -> điểm [0, 1].
        self._model = CrossEncoder(config.RERANKER_MODEL_NAME, max_length=max_length)

    def predict(self, pairs: Sequence[Tuple[str, str]]) -> List[float]:
        return [float(s) for s in self._model.predict(list(pairs))]


class _OnnxReranker:
    def __init__(self, max_length: int):
        import numpy as np
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from transformers import AutoTokenizer

        repo, rev = config.RERANKER_ONNX_REPO, config.RERANKER_ONNX_REVISION
        model_path = hf_hub_download(repo, config.RERANKER_ONNX_FILE, revision=rev)
        self._tokenizer = AutoTokenizer.from_pretrained(repo, revision=rev)

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if config.RERANKER_THREADS > 0:
            opts.intra_op_num_threads = config.RERANKER_THREADS
        self._session = ort.InferenceSession(
            model_path, sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self._input_names = {i.name for i in self._session.get_inputs()}
        self._np = np
        self._max_length = max_length
        self.label = f"onnx-int8/{max_length}"

    def predict(self, pairs: Sequence[Tuple[str, str]]) -> List[float]:
        np = self._np
        queries = [q for q, _ in pairs]
        passages = [p for _, p in pairs]
        # Chỉ cắt đoạn văn (only_second) để câu hỏi luôn được giữ nguyên.
        enc = self._tokenizer(
            queries, passages, padding=True, truncation="only_second",
            max_length=self._max_length, return_tensors="np",
        )
        feeds = {k: v.astype(np.int64) for k, v in enc.items() if k in self._input_names}
        logits = self._session.run(None, feeds)[0].reshape(-1)
        # Model trả logit thô -> sigmoid để cùng thang điểm với bản torch.
        return [float(s) for s in 1.0 / (1.0 + np.exp(-logits))]


def load_backend(backend: Optional[str] = None, max_length: Optional[int] = None):
    """Tạo một reranker mới (không cache). Dùng trực tiếp trong script benchmark."""
    backend = (backend or config.RERANKER_BACKEND).strip().lower()
    max_length = max_length or config.RERANKER_MAX_LENGTH
    if backend == "onnx":
        return _OnnxReranker(max_length)
    if backend == "torch":
        return _TorchReranker(max_length)
    raise ValueError(f"RERANKER_BACKEND không hợp lệ: {backend!r} (chọn 'onnx' hoặc 'torch')")


def _get_model():
    global _model, _load_failed
    if _model is not None or _load_failed:
        return _model
    with _lock:
        if _model is not None or _load_failed:
            return _model
        try:
            print(f"[Reranker] Đang nạp backend '{config.RERANKER_BACKEND}' "
                  f"(max_length={config.RERANKER_MAX_LENGTH}, lần đầu có thể phải tải model)...")
            _model = load_backend()
            print(f"[Reranker] ✅ Sẵn sàng: {_model.label}.")
        except Exception as exc:  # pragma: no cover - phụ thuộc môi trường
            hint = " Cài: pip install onnxruntime" if isinstance(exc, ImportError) else ""
            print(f"[Reranker] ⚠️ Không nạp được reranker ({exc}).{hint} Bỏ qua bước rerank.")
            _load_failed = True
            _model = None
    return _model


def is_available() -> bool:
    if not config.ENABLE_RERANKER:
        return False
    return _get_model() is not None


def backend_label() -> Optional[str]:
    """Nhãn backend đang dùng (vd 'onnx-int8/256'), None nếu chưa nạp/không có."""
    return _model.label if _model is not None else None


def rerank(
    query: str,
    docs: List[dict],
    top_k: Optional[int] = None,
    text_key: str = "text",
) -> Tuple[List[dict], bool]:
    """
    Sắp xếp lại ``docs`` theo điểm cross-encoder.

    Trả về (docs_đã_xếp, đã_rerank?). Mỗi doc được gắn thêm khoá ``rerank_score``.
    Nếu reranker không khả dụng thì trả nguyên thứ tự đầu vào.
    """
    if not docs:
        return docs, False

    if not config.ENABLE_RERANKER:
        return (docs[:top_k] if top_k else docs), False

    model = _get_model()
    if model is None:
        return (docs[:top_k] if top_k else docs), False

    pairs = [(query, d.get(text_key, "")) for d in docs]
    try:
        scores = model.predict(pairs)
    except Exception as exc:  # pragma: no cover
        print(f"[Reranker] ⚠️ Lỗi khi rerank ({exc}). Giữ nguyên thứ tự.")
        return (docs[:top_k] if top_k else docs), False

    for d, s in zip(docs, scores):
        d["rerank_score"] = float(s)

    ranked = sorted(docs, key=lambda d: d.get("rerank_score", 0.0), reverse=True)
    return (ranked[:top_k] if top_k else ranked), True
