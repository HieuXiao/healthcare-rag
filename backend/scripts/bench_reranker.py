"""
So sánh tốc độ & chất lượng xếp hạng giữa các cấu hình reranker.

Với mỗi câu hỏi mẫu, lấy cùng một tập ứng viên từ Hybrid retrieve (Vector + BM25
+ RRF, chưa rerank), rồi chấm lại bằng từng cấu hình "backend:max_length". Cấu
hình đầu tiên là chuẩn để đối chiếu (mặc định bản gốc torch:512).

Cách chạy:
    cd backend
    pip install onnxruntime
    python scripts/bench_reranker.py
    python scripts/bench_reranker.py --variants torch:512,onnx:512,onnx:256 --runs 3
    python scripts/bench_reranker.py --query "Liều khởi đầu insulin nền?"

Chỉ số:
    ms/query : thời gian trung bình chấm hết ứng viên của 1 câu hỏi (sau 1 lượt làm nóng)
    top1     : số câu có tài liệu hạng 1 trùng với cấu hình chuẩn
    overlap@k: tỉ lệ tài liệu trong top-k trùng với cấu hình chuẩn (không xét thứ tự)
"""

import argparse
import gc
import sys
import time
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

from core import config, reranker
from core.hybrid_retriever import get_retriever

DEFAULT_QUERIES = [
    "Phác đồ điều trị đái tháo đường týp 2 dùng thuốc gì đầu tiên?",
    "Liều khởi đầu insulin nền cho bệnh nhân đái tháo đường týp 2?",
    "Chống chỉ định của metformin là gì?",
    "Mục tiêu HbA1c ở người cao tuổi là bao nhiêu?",
    "Khi nào cần phối hợp thuốc GLP-1 RA hoặc SGLT2i?",
    "Tiêu chuẩn chẩn đoán đái tháo đường theo Bộ Y tế?",
    "Xử trí hạ glucose huyết như thế nào?",
    "Mục tiêu huyết áp ở bệnh nhân đái tháo đường?",
]


def _candidates(query: str):
    """Ứng viên sau RRF, chưa rerank (tắt reranker tạm thời)."""
    config.ENABLE_RERANKER = False
    try:
        result = get_retriever().retrieve(query, final_top_k=config.FUSED_TOP_K)
    finally:
        config.ENABLE_RERANKER = True
    return [n["text"] for n in result.nodes]


def _rank(model, query, texts):
    scores = model.predict([(query, t) for t in texts])
    return sorted(range(len(texts)), key=lambda i: scores[i], reverse=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variants", default="torch:512,onnx:512,onnx:256",
                    help="Danh sách backend:max_length, cái đầu là chuẩn đối chiếu")
    ap.add_argument("--runs", type=int, default=2, help="Số lượt đo mỗi câu hỏi")
    ap.add_argument("--top-k", type=int, default=config.FINAL_TOP_K)
    ap.add_argument("--query", action="append", help="Câu hỏi riêng (lặp lại được)")
    args = ap.parse_args()

    variants = []
    for item in args.variants.split(","):
        backend, _, length = item.strip().partition(":")
        variants.append((backend.strip(), int(length or config.RERANKER_MAX_LENGTH)))

    queries = args.query or DEFAULT_QUERIES
    print(f"Lấy ứng viên (FUSED_TOP_K={config.FUSED_TOP_K}) cho {len(queries)} câu hỏi...")
    cands = {q: _candidates(q) for q in queries}

    rankings, rows = {}, []
    for backend, length in variants:
        t = time.perf_counter()
        model = reranker.load_backend(backend, length)
        load_s = time.perf_counter() - t
        _rank(model, queries[0], cands[queries[0]])  # làm nóng
        total, ranks = 0.0, {}
        for q in queries:
            t = time.perf_counter()
            for _ in range(args.runs):
                ranks[q] = _rank(model, q, cands[q])
            total += (time.perf_counter() - t) / args.runs
        rankings[model.label] = ranks
        rows.append((model.label, load_s, total / len(queries) * 1000))
        print(f"  ✓ {model.label}: nạp {load_s:.1f}s, {rows[-1][2]:.0f} ms/query")
        del model
        gc.collect()

    base_label = rows[0][0]
    base = rankings[base_label]
    k = args.top_k
    print(f"\nChuẩn đối chiếu: {base_label} | top-k={k} | {len(queries)} câu hỏi\n")
    print(f"{'cấu hình':<18}{'nạp (s)':>9}{'ms/query':>10}{'nhanh hơn':>11}{'top1':>8}{'overlap@k':>11}")
    for label, load_s, ms in rows:
        r = rankings[label]
        top1 = sum(r[q][0] == base[q][0] for q in queries if r[q] and base[q])
        overlap = sum(len(set(r[q][:k]) & set(base[q][:k])) / max(1, min(k, len(base[q])))
                      for q in queries) / len(queries)
        speedup = rows[0][2] / ms if ms else float("inf")
        print(f"{label:<18}{load_s:>9.1f}{ms:>10.0f}{speedup:>10.1f}x"
              f"{f'{top1}/{len(queries)}':>8}{overlap:>10.0%}")


if __name__ == "__main__":
    main()
