import hashlib

import fitz  # PyMuPDF

UPLOAD_DIR = "/app/uploads"


def extract_text(pdf_bytes: bytes) -> str:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
