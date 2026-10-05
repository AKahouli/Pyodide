"""Plain text of an e-mail attachment, so its content becomes a field of the record.

Reads the formats the Email Reader marks as readable (PDF, Word, Excel, text). A file that
yields no text (a scanned PDF, a damaged file) gives ``None``: the record keeps its other
fields and says why in ``statut_contenu``.
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

CONTENT_CHARS = 100_000
MAX_PDF_PAGES = 300
MAX_SHEET_CELLS = 50_000

_WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _pdf(payload: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(payload))
    pages = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def _docx(payload: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for paragraph in root.iter(f"{_WORD}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{_WORD}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{_WORD}tab":
                parts.append("\t")
            elif node.tag in (f"{_WORD}br", f"{_WORD}cr"):
                parts.append("\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def _xlsx(payload: bytes) -> str:
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    try:
        lines, cells = [], 0
        for sheet in workbook.worksheets:
            lines.append(f"## {sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                values = ["" if value is None else str(value) for value in row]
                while values and not values[-1]:
                    values.pop()
                if values:
                    lines.append("\t".join(values))
                cells += len(values)
                if cells >= MAX_SHEET_CELLS:
                    return "\n".join(lines)
        return "\n".join(lines)
    finally:
        workbook.close()


def _plain(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("latin-1")


_READERS = {
    "application/pdf": _pdf,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": _docx,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": _xlsx,
    "text/plain": _plain,
}


def _tidy(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def attachment_text(content_type: str, payload: bytes | None) -> tuple[str | None, str]:
    """The file's text (cut at ``CONTENT_CHARS``) and what happened, as a short French status."""
    reader = _READERS.get(content_type)
    if reader is None or payload is None:
        return None, "non extrait"
    try:
        text = _tidy(reader(payload))
    except ImportError:
        return None, "lecteur indisponible"
    except Exception:  # noqa: BLE001 - a damaged file must not stop the archive
        return None, "illisible"
    if not text:
        return None, "sans texte (image ou scan ?)"
    if len(text) > CONTENT_CHARS:
        return text[:CONTENT_CHARS].rstrip() + "…", f"tronqué à {CONTENT_CHARS} caractères"
    return text, "extrait"


def is_extractable(content_type: str) -> bool:
    return content_type in _READERS


__all__ = ["attachment_text", "is_extractable", "CONTENT_CHARS"]
