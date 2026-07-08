import hashlib
import io

import fitz  # PyMuPDF

UPLOAD_DIR = "/app/uploads"

SUPPORTED_PROJECT_UPLOAD_EXTENSIONS = {"pdf", "docx", "txt"}


def extract_text(file_bytes: bytes, filename: str | None = None) -> str:
    """Defaults to PDF (the only format the original /documents/upload
    endpoint ever needed) when no filename is given, so that call site's
    behavior is unchanged. Project document uploads (see
    POST /projects/{id}/documents/upload) pass filename to dispatch on
    extension for DOCX/TXT support too."""
    ext = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else "pdf"

    if ext == "docx":
        from docx import Document as DocxDocument

        docx_doc = DocxDocument(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in docx_doc.paragraphs)

    if ext == "txt":
        return file_bytes.decode("utf-8", errors="replace")

    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
