"""
Bộ định tuyến ý định (Intent Router).

Phân loại truy vấn của bác sĩ/người dùng thành 3 luồng:
  - CHITCHAT  : Chào hỏi, cảm ơn, tạm biệt, hỏi danh tính / năng lực của trợ lý
                -> Phản hồi trực tiếp, thân thiện, BỎ QUA truy xuất RAG và Knowledge Graph.
  - GUIDELINE : Hỏi về phác đồ, hướng dẫn, tương tác thuốc, liều dùng, chẩn đoán
                chuẩn -> ưu tiên GraphRAG + Hybrid Search trên y văn.
  - EHR       : Hỏi/tóm tắt hồ sơ bệnh án của 1 bệnh nhân cụ thể
                -> ưu tiên Hybrid Search SOAP-aware trên bệnh án.

Dùng heuristic đối sánh từ khóa & mẫu câu (tức thì ~0.001s, không tốn phí LLM).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List


CHITCHAT = "chitchat"
GUIDELINE = "guideline"
EHR = "ehr"

_GUIDELINE_KEYWORDS = [
    "phác đồ", "hướng dẫn", "guideline", "điều trị", "liều", "liều dùng",
    "tương tác thuốc", "chống chỉ định", "chỉ định", "tác dụng phụ",
    "chẩn đoán", "khuyến cáo", "tiêu chuẩn", "icd", "thuốc", "phối hợp thuốc",
    "cơ chế", "biến chứng", "tầm soát", "mục tiêu điều trị", "bệnh",
    "insulin", "metformin", "huyết áp", "đái tháo đường", "tiểu đường",
    "xét nghiệm", "triệu chứng", "kháng sinh",
]

_EHR_KEYWORDS = [
    "bệnh án", "hồ sơ", "bệnh nhân", "ca bệnh", "tóm tắt", "diễn tiến",
    "tiền sử", "nhập viện", "xuất viện", "điều dưỡng", "cận lâm sàng",
    "báo cáo mổ", "khám lâm sàng", "soap", "ghi chú", "theo dõi",
]

_NAME_LIKE = re.compile(r"\b(?:bệnh nhân|bn|ông|bà)\b\s+[A-ZĐ]", re.IGNORECASE)

# Các mẫu câu nhận diện chào hỏi, cảm ơn, hỏi năng lực (chitchat)
_CHITCHAT_PATTERNS = [
    # Chào hỏi
    r"^(?:xin\s+)?chào(?:\s+(?:bạn|bác\s*sĩ|bs|ad|admin|em|anh|chị|mọi\s*người|healthcare|medrag|bot))?[\s.!?,~]*$",
    r"^(?:hello|hi|alo|hế\s*lô|hey|good\s+(?:morning|afternoon|evening))[\s.!?,~]*$",
    # Hỏi danh tính / chức năng / năng lực
    r"^(?:bạn|em|mày|hệ\s*thống|bot)\s+(?:là\s+(?:ai|gì|con\s*gì|cái\s*gì)|tên\s+(?:là\s+)?gì)[\s.?]*$",
    r"^who\s+are\s+you[\s.?]*$",
    r"^(?:bạn|em|hệ\s*thống)\s+(?:có\s+(?:thể\s+)?làm\s+(?:được\s+)?gì|giúp\s+(?:gì|được\s+gì)|chức\s*năng\s+(?:là\s+)?gì)[\s.?]*$",
    r"^what\s+can\s+you\s+do[\s.?]*$",
    r"^(?:giới\s*thiệu(?:\s+về)?\s+(?:bản\s*thân|bạn|hệ\s*thống))[\s.?]*$",
    r"^(?:hướng\s*dẫn\s+sử\s*dụng(?:\s+hệ\s*thống)?)[\s.?]*$",
    # Cảm ơn / Đánh giá
    r"^(?:cảm\s*ơn|cám\s*ơn)(?:\s+(?:bạn|nhiều|nhé|nha|em|bs|ad))?[\s.!?,~]*$",
    r"^(?:thank\s*you|thanks|tuyệt\s*vời|tốt\s*lắm|ok\s+cảm\s*ơn|ok\s+thank)[\s.!?,~]*$",
    # Tạm biệt
    r"^(?:tạm\s*biệt|bye(?:\s*bye)?|hẹn\s*gặp\s*lại|chúc\s*ngủ\s*ngon)[\s.!?,~]*$",
    # Xã giao
    r"^(?:bạn\s+)?(?:có\s+)?khỏe\s+không[\s.?]*$",
    r"^how\s+are\s+you[\s.?]*$",
]

_COMPILED_CHITCHAT = [re.compile(p, re.IGNORECASE) for p in _CHITCHAT_PATTERNS]

_CHITCHAT_KEYWORDS = [
    "xin chào", "chào bạn", "chào bác sĩ", "chào em", "chào anh", "chào chị",
    "hello", "bạn là ai", "bạn là gì", "bạn tên gì", "bạn có thể làm gì",
    "giúp được gì", "chức năng của bạn", "giới thiệu bản thân", "hướng dẫn sử dụng",
    "cảm ơn", "cám ơn", "thank you", "thanks", "tạm biệt", "bye bye",
]


@dataclass
class RouteDecision:
    intent: str
    confidence: float
    reason: str
    scores: dict


def route(query: str) -> RouteDecision:
    raw = (query or "").strip()
    text = raw.lower()

    g_hits: List[str] = [k for k in _GUIDELINE_KEYWORDS if k in text]
    e_hits: List[str] = [k for k in _EHR_KEYWORDS if k in text]

    g_score = len(g_hits)
    e_score = len(e_hits)

    # Nếu nhắc đến tên bệnh nhân cụ thể -> thiên về EHR.
    if _NAME_LIKE.search(raw):
        e_score += 1
        e_hits.append("tên bệnh nhân")

    # 1. Nhận diện hội thoại Chitchat (Chào hỏi, cảm ơn, hỏi danh tính)
    # Khớp mẫu câu chính xác HOẶC có từ khóa chitchat đồng thời không chứa từ khóa y khoa
    is_pattern_chitchat = any(p.match(raw) for p in _COMPILED_CHITCHAT)
    has_chitchat_kw = any(k in text for k in _CHITCHAT_KEYWORDS)

    if is_pattern_chitchat or (has_chitchat_kw and g_score == 0 and e_score == 0):
        return RouteDecision(
            intent=CHITCHAT,
            confidence=0.98,
            reason="Hội thoại chào hỏi / Giới thiệu năng lực (Bỏ qua RAG y văn)",
            scores={"guideline": g_score, "ehr": e_score, "chitchat": 1},
        )

    # 2. Phân luồng Bệnh án (EHR) vs Phác đồ (Guideline)
    if e_score > g_score:
        intent = EHR
        chosen, other = e_score, g_score
        reason = f"Phát hiện ngữ cảnh bệnh án: {', '.join(e_hits[:4])}"
    else:
        intent = GUIDELINE
        chosen, other = g_score, e_score
        if g_hits:
            reason = f"Phát hiện ngữ cảnh y văn/phác đồ: {', '.join(g_hits[:4])}"
        else:
            reason = "Truy vấn lâm sàng tổng quát — truy xuất y văn/phác đồ chuẩn"

    total = chosen + other
    confidence = 0.6 if total == 0 else min(0.99, 0.5 + 0.5 * (chosen / max(total, 1)))

    return RouteDecision(
        intent=intent,
        confidence=round(confidence, 2),
        reason=reason,
        scores={"guideline": g_score, "ehr": e_score, "chitchat": 0},
    )

