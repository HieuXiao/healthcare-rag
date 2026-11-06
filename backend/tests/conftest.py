"""Cấu hình pytest chung: cho phép import package `core` từ thư mục backend."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
