# Cùng phiên bản Python với môi trường dev (.venv 3.13)
FROM python:3.13-slim

# Ngăn Python tạo bytecode .pyc và bật stdout/stderr không đệm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# Cài đặt các gói hệ thống cần thiết:
# - poppler-utils: cho pdf2image
# - tesseract-ocr + tesseract-ocr-vie: cho OCR PDF tiếng Việt
# - build-essential, curl: hỗ trợ biên dịch và healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-vie \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài torch bản CPU trước, để sentence-transformers không kéo bản CUDA (nặng vài GB)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Copy requirements và cài đặt python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code backend
COPY . .

# Tạo cấu trúc thư mục dữ liệu nếu chưa có
RUN mkdir -p /app/data/uploads /app/vector_db

EXPOSE 8001

ENV BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
