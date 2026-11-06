import pytesseract
try:
    import pymupdf as fitz
except ImportError:
    import fitz  # PyMuPDF fallback
from PIL import Image
from pdf2image import convert_from_path
from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document
from typing import List, Optional
import io
import os

class OcrPdfReader(BaseReader):
    """
    Một class Reader tùy chỉnh cho LlamaIndex, có khả năng:
    1. Kiểm tra xem file PDF có chứa text hay không.
    2. Nếu có text, sử dụng PyMuPDF để đọc trực tiếp (nhanh).
    3. Nếu không có text (PDF dạng ảnh), sử dụng Tesseract OCR để trích xuất (chậm hơn).
    """
    def __init__(self, tesseract_lang: str = "vie", poppler_path: Optional[str] = None):
        """
        Khởi tạo Reader.
        Args:
            tesseract_lang (str): Ngôn ngữ cho Tesseract OCR (ví dụ: 'vie' cho tiếng Việt).
            poppler_path (str, optional): Đường dẫn đến thư mục bin của Poppler. 
                                          Nếu là None, Poppler cần phải có trong PATH hệ thống.
        """
        self.tesseract_lang = tesseract_lang
        self.poppler_path = poppler_path

    def _is_text_based_pdf(self, file_path: str) -> bool:
        """Kiểm tra xem file PDF có chứa lớp văn bản (text layer) hay không."""
        try:
            doc = fitz.open(file_path)
            for page in doc:
                if page.get_text().strip():
                    return True
            return False
        except Exception:
            return False

    def _ocr_pdf_to_text(self, file_path: str) -> str:
        """Chuyển đổi PDF dạng ảnh sang text bằng OCR."""
        try:
            images = convert_from_path(file_path, poppler_path=self.poppler_path)
            full_text = ""
            for i, image in enumerate(images):
                text = pytesseract.image_to_string(image, lang=self.tesseract_lang)
                full_text += f"--- Trang {i+1} ---\n{text}\n\n"
            return full_text
        except Exception as e:
            print(f"Lỗi OCR trên file {os.path.basename(file_path)}: {e}")
            return ""

    def _read_text_pdf(self, file_path: str) -> str:
        """Đọc text từ PDF dạng văn bản."""
        try:
            doc = fitz.open(file_path)
            full_text = ""
            for i, page in enumerate(doc):
                full_text += f"--- Trang {i+1} ---\n{page.get_text()}\n\n"
            return full_text
        except Exception as e:
            print(f"Lỗi đọc file PDF text {os.path.basename(file_path)}: {e}")
            return ""

    def load_data(self, file_path: str, **kwargs) -> List[Document]:
        """
        Load dữ liệu từ một file PDF.
        Tự động quyết định dùng OCR hay không.
        """
        file_name = os.path.basename(file_path)
        
        if self._is_text_based_pdf(file_path):
            print(f"'{file_name}' là PDF dạng văn bản. Đang đọc trực tiếp...")
            text = self._read_text_pdf(file_path)
        else:
            print(f"'{file_name}' là PDF dạng ảnh. Đang tiến hành OCR (có thể mất vài phút)...")
            text = self._ocr_pdf_to_text(file_path)

        if text:
            return [Document(text=text, metadata={"file_name": file_name})]
        else:
            print(f"Không thể trích xuất nội dung từ file: {file_name}")
            return []

