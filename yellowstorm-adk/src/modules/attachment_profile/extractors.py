"""Plain-text extraction for conversation attachments.

Text only: no image extraction, no visual interpretation, no chart/diagram/
SmartArt understanding. The output feeds an LLM prompt, so it is normalized
and bounded (MAX_CONTENT_CHARS).
"""

import csv
import io
from typing import List, Optional, Tuple

MAX_CONTENT_CHARS = 200_000
CSV_SAMPLE_ROWS = 50

TextResult = Tuple[str, str, bool]  # (text, extractor, truncated)


def extract_text(path: str, extension: str) -> TextResult:
    """Dispatch on file extension. Returns (text, extractor, truncated)."""
    extension = extension.lower()
    if extension == ".pdf":
        return _extract_pdf(path)
    if extension == ".docx":
        return _extract_docx(path)
    if extension == ".pptx":
        return _extract_pptx(path)
    if extension == ".csv":
        return _extract_csv(path)
    if extension == ".xlsx":
        return _extract_xlsx(path)
    if extension in (".txt", ".md", ".json", ".log"):
        return _extract_plaintext(path)
    raise LookupError(f"Unsupported extension: {extension}")


def _bounded(text: str) -> TextResult:
    truncated = len(text) > MAX_CONTENT_CHARS
    return (text[:MAX_CONTENT_CHARS] if truncated else text), "bounded", truncated


def _extract_pdf(path: str) -> TextResult:
    import fitz  # PyMuPDF

    parts: List[str] = []
    with fitz.open(path) as document:
        for page_number, page in enumerate(document, start=1):
            parts.append(f"--- Page {page_number} ---")
            parts.append(page.get_text("text", sort=True))
    text, _, truncated = _bounded("\n".join(parts).strip())
    return text, "pymupdf", truncated


def _extract_docx(path: str) -> TextResult:
    import docx  # python-docx

    document = docx.Document(path)
    parts: List[str] = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append("\t".join(cells))
    text, _, truncated = _bounded("\n".join(parts))
    return text, "python-docx", truncated


def _extract_pptx(path: str) -> TextResult:
    from pptx import Presentation  # python-pptx

    presentation = Presentation(path)
    parts: List[str] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        parts.append(f"--- Slide {slide_number} ---")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in paragraph.runs).strip()
                    if text:
                        parts.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        parts.append("\t".join(cells))
    text, _, truncated = _bounded("\n".join(parts))
    return text, "python-pptx", truncated


def _decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _extract_plaintext(path: str) -> TextResult:
    with open(path, "rb") as file_obj:
        raw = file_obj.read(MAX_CONTENT_CHARS + 1)
    text = normalize_text(_decode_bytes(raw))
    truncated = len(raw) > MAX_CONTENT_CHARS
    return text, "plaintext", truncated


def _extract_csv(path: str) -> TextResult:
    with open(path, "r", newline="", encoding="utf-8-sig", errors="replace") as file_obj:
        reader = csv.reader(file_obj)
        rows: List[str] = []
        for row in reader:
            rows.append("\t".join(str(cell) for cell in row))
            if len(rows) >= CSV_SAMPLE_ROWS:
                break
    text = "\n".join(rows)
    return text, "csv-sample", False


def _extract_xlsx(path: str) -> TextResult:
    openpyxl = __import__("openpyxl")
    workbook = openpyxl.load_workbook(filename=path, read_only=True, data_only=True)
    try:
        first_sheet = workbook.worksheets[0]
        rows: List[str] = []
        for row in first_sheet.iter_rows(values_only=True):
            if any(value is not None and str(value).strip() != "" for value in row):
                rows.append("\t".join("" if value is None else str(value) for value in row))
            if len(rows) >= CSV_SAMPLE_ROWS:
                break
    finally:
        workbook.close()
    return "\n".join(rows), "openpyxl-sample", False


def extension_of(filename: str) -> Optional[str]:
    dot = filename.rfind(".")
    if dot == -1 or dot == len(filename) - 1:
        return None
    return filename[dot:]
