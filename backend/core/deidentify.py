"""
Lớp Khử định danh (De-identification) & Giải mã danh tính (Re-identification) PHI.

Mục tiêu: ẩn danh hoá thông tin định danh bệnh nhân (PHI) trong văn bản TRƯỚC khi
đưa vào LLM/Cloud, rồi khôi phục lại token về giá trị gốc khi trả kết quả cho bác
sĩ (chỉ diễn ra ở môi trường local). Dùng regex/pattern tối ưu cho tiếng Việt,
không phụ thuộc dịch vụ ngoài, chi phí ~0.

Cách dùng:
    deid = PHIDeidentifier()
    clean_text, mapping = deid.deidentify(raw_text)
    ... gửi clean_text cho LLM ...
    final_text = deid.reidentify(llm_output, mapping)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Tuple


# Mỗi pattern -> (nhãn token, regex). Thứ tự quan trọng: pattern cụ thể trước.
# Token format: __PHI_<LOẠI>_<n>__  (khó trùng với nội dung y văn thật).
_PATTERNS: List[Tuple[str, re.Pattern]] = [
    # Căn cước / CMND (9 hoặc 12 số)
    ("CCCD", re.compile(r"\b\d{12}\b|\b\d{9}\b")),
    # Số điện thoại VN
    ("PHONE", re.compile(r"\b(?:0|\+84)(?:\d[\s.-]?){8,9}\d\b")),
    # Email
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    # Mã bệnh nhân / mã hồ sơ: BN12345, HS-2023-001, MR123...
    ("MRN", re.compile(r"\b(?:BN|HS|MR|MA|MÃ)[\s:_-]?\d{3,}\b", re.IGNORECASE)),
    # Ngày tháng: 01/02/2023, 01-02-2023, 2023/02/01, ngày 1 tháng 2 năm 2023
    ("DATE", re.compile(
        r"\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b"
        r"|\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b"
        r"|\bngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}\b",
        re.IGNORECASE,
    )),
    # Địa chỉ: số nhà "số 12 ..." hoặc đơn vị hành chính "phường/quận/huyện/xã ...".
    # Cố ý KHÔNG bắt "đường/phố" đứng một mình để tránh đụng thuật ngữ y khoa
    # (vd: "đái tháo đường").
    ("ADDRESS", re.compile(
        r"\bsố\s+\d+[^,\n]{0,50}"
        r"|\b(?:phường|quận|huyện|xã)\s+[^\s,\.\n]+(?:\s+[^\s,\.\n]+){0,2}",
        re.IGNORECASE,
    )),
]

# Họ tên người Việt viết hoa chữ cái đầu, đi sau các "dấu hiệu" họ tên.
# Chỉ bắt khi có ngữ cảnh rõ ràng để tránh ẩn nhầm thuật ngữ y khoa.
_NAME_CONTEXT = re.compile(
    r"(?i:\b(?:bệnh nhân|bn|người bệnh|họ tên|họ và tên|tên|bác sĩ|bs|ông|bà|anh|chị|cháu|em)\b)"
    r"[\s:.]*"
    r"((?:[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]"
    r"[a-zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+)"
    r"(?:\s+(?:[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴĐ]"
    r"[a-zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+)){1,3})",
    re.UNICODE,
)


@dataclass
class DeidResult:
    text: str
    mapping: Dict[str, str] = field(default_factory=dict)
    counts: Dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return len(self.mapping)


class PHIDeidentifier:
    """Ẩn danh hoá & khôi phục PHI theo bản đồ token nội bộ."""

    def deidentify(self, text: str) -> DeidResult:
        if not text:
            return DeidResult(text=text or "")

        mapping: Dict[str, str] = {}
        counts: Dict[str, int] = {}
        counters: Dict[str, int] = {}

        def _token_for(label: str, value: str) -> str:
            # Tái sử dụng token nếu giá trị đã gặp (ổn định tham chiếu).
            for tok, val in mapping.items():
                if val == value and tok.startswith(f"__PHI_{label}_"):
                    return tok
            counters[label] = counters.get(label, 0) + 1
            tok = f"__PHI_{label}_{counters[label]}__"
            mapping[tok] = value
            counts[label] = counts.get(label, 0) + 1
            return tok

        result = text

        # 1) Họ tên (ưu tiên trước để không bị các pattern khác cắt mất).
        def _name_sub(m: re.Match) -> str:
            full = m.group(0)
            name = m.group(1)
            tok = _token_for("NAME", name)
            return full.replace(name, tok)

        result = _NAME_CONTEXT.sub(_name_sub, result)

        # 2) Các pattern còn lại.
        for label, pattern in _PATTERNS:
            def _sub(m: re.Match, _label=label) -> str:
                return _token_for(_label, m.group(0))

            result = pattern.sub(_sub, result)

        return DeidResult(text=result, mapping=mapping, counts=counts)

    def reidentify(self, text: str, mapping: Dict[str, str]) -> str:
        """Khôi phục token PHI về giá trị gốc. Gọi ở môi trường local."""
        if not text or not mapping:
            return text
        restored = text
        # Thay token dài trước để tránh prefix đụng nhau.
        for token in sorted(mapping, key=len, reverse=True):
            restored = restored.replace(token, mapping[token])
        return restored

    def redact_for_admin(self, text: str) -> Tuple[str, int]:
        """
        Masking & Redaction dành riêng cho nhật ký Admin (Security by Design):
        Giữ nguyên câu hỏi lâm sàng để Admin đánh giá chất lượng RAG (RAG Eval),
        nhưng tự động thay mọi thông tin định danh cá nhân (PII/PHI) thành nhãn
        [REDACTED_NAME], [REDACTED_PHONE], [REDACTED_CCCD], [REDACTED_EMAIL], v.v.
        Trả về: (redacted_text, phi_count).
        """
        if not text:
            return "", 0
        res = self.deidentify(text)
        out = res.text
        # Chuyển __PHI_<LOẠI>_<n>__ thành [REDACTED_<LOẠI>] dễ đọc cho Admin
        out = re.sub(r"__PHI_([A-Z]+)_(\d+)__", r"[REDACTED_\1]", out)
        return out, res.total


# Singleton tiện dùng khắp nơi.
default_deidentifier = PHIDeidentifier()
