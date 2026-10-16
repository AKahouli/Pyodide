"""Build a complete email table server-side and hand it back as a file.

The report requested here — one row per mail, with the *full* body and the first
page of every attachment — is far too large for one chat message (a single body is
often several KB; dozens of mails blow past the model's output budget). Assembling
it here keeps those bodies out of the model's context entirely: the tool writes a
CSV into the run storage and the agent delivers that file with send_file_to_user.

Only the first page of an attachment is extracted, per the requirement. A PDF has
real pages, so page 1 is read directly. A Word file stores no pagination at all —
page breaks only exist once a renderer lays the document out — so the .docx is
rendered to PDF with LibreOffice first and page 1 is read from that. When
LibreOffice is unavailable the cell says the first page could not be rendered,
rather than passing the leading text off as an exact page.
"""
from __future__ import annotations

import csv
import html as _html
import io
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from typing import Any, Mapping, Sequence

COLUMNS = (
    "Réception (UTC)",
    "Expéditeur",
    "Objet",
    "Contenu intégral",
    "Résumé du mail",
    "Pièce jointe",
    "Contenu de la première page de la pièce jointe",
)

NO_ATTACHMENT = "Aucune"
DEFAULT_FIRST_PAGE_CHARS = 8000
# LibreOffice has to cold-start and lay the whole document out; a large report
# can take a few seconds. Cap it so one file cannot stall the whole export.
DOCX_RENDER_TIMEOUT_SECONDS = 120
DOCX_RENDER_UNAVAILABLE = (
    "[première page indisponible : rendu Word impossible (LibreOffice)]"
)
DOCX_RENDER_EMPTY = "[première page indisponible : rendu Word vide]"

_SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_BLOCK_RE = re.compile(r"</(?:p|div|tr|li|h[1-6]|table|ul|ol)\s*>", re.IGNORECASE)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_INLINE_WS_RE = re.compile(r"[ \t\r\f\v]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")
_FILENAME_BAD = re.compile(r"[^A-Za-z0-9._-]+")


def html_to_text(value: str) -> str:
    """Graph bodies arrive as HTML; the table needs readable plain text."""
    if not value:
        return ""
    text = _SCRIPT_RE.sub(" ", value)
    text = _BLOCK_RE.sub("\n", text)
    text = _BR_RE.sub("\n", text)
    text = _TAG_RE.sub("", text)
    text = _html.unescape(text)
    text = _INLINE_WS_RE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _MULTI_NL_RE.sub("\n\n", text).strip()


def _clip(value: str, max_chars: int) -> str:
    text = (value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + " … [tronqué]"


def _pdf_first_page(data: bytes, max_chars: int) -> str:
    try:
        from pypdf import PdfReader
    except Exception:
        return "[pypdf absent : lecture PDF indisponible]"
    try:
        reader = PdfReader(io.BytesIO(data))
        if not reader.pages:
            return ""
        text = reader.pages[0].extract_text() or ""
    except Exception as exc:  # malformed or encrypted PDF
        return f"[lecture PDF impossible : {exc}]"
    return _clip(text, max_chars)


def _libreoffice_binary() -> str | None:
    """Path to a LibreOffice launcher, or None. Checked on PATH first, then the
    usual install locations of the platforms the MCP runs on."""
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    for candidate in (
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        if os.path.exists(candidate):
            return candidate
    return None


def render_docx_to_pdf(data: bytes) -> bytes | None:
    """Render a Word file to PDF with LibreOffice, so real page boundaries exist.

    A .docx carries no pagination of its own — pages only exist once a renderer
    lays the document out. Isolated per call via a throwaway `UserInstallation`
    profile so concurrent conversions never share state. Returns the PDF bytes, or
    None when LibreOffice is missing or the conversion fails.
    """
    binary = _libreoffice_binary()
    if not binary:
        return None
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, "source.docx")
        with open(source, "wb") as handle:
            handle.write(data)
        profile = pathlib.Path(workdir, "profile").as_uri()
        command = [
            binary,
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation={profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            workdir,
            source,
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                timeout=DOCX_RENDER_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        output = os.path.join(workdir, "source.pdf")
        if result.returncode != 0 or not os.path.exists(output):
            return None
        with open(output, "rb") as handle:
            return handle.read()


def _docx_first_page(data: bytes, max_chars: int) -> str:
    """Page 1 of a Word file, read from a LibreOffice render.

    Rendering is the only way to know where page 1 ends, so when it is not
    possible the cell says so rather than showing the leading text as if it were
    the page.
    """
    pdf = render_docx_to_pdf(data)
    if pdf is None:
        return DOCX_RENDER_UNAVAILABLE
    text = _pdf_first_page(pdf, max_chars)
    if text.startswith("[lecture PDF impossible") or text.startswith("[pypdf absent"):
        return text
    return text or DOCX_RENDER_EMPTY


def first_page_of(
    data: bytes,
    content_type: str | None,
    filename: str | None,
    max_chars: int = DEFAULT_FIRST_PAGE_CHARS,
) -> str:
    """First-page text for a supported attachment, or a short note otherwise."""
    content_type = (content_type or "").lower()
    name = (filename or "").lower()
    if "pdf" in content_type or name.endswith(".pdf"):
        return _pdf_first_page(data, max_chars)
    if "word" in content_type or name.endswith((".docx", ".doc")):
        return _docx_first_page(data, max_chars)
    return f"[aperçu non extrait ({content_type or 'type inconnu'})]"


def body_to_text(body: Mapping[str, Any] | None) -> str:
    body = body or {}
    content = body.get("content") or ""
    if (body.get("contentType") or "").lower() == "html":
        return html_to_text(content)
    return content.strip()


def row_for(
    message: Mapping[str, Any],
    attachment_names: Sequence[str],
    attachment_first_page: str,
    sender_field: str,
) -> dict[str, str]:
    return {
        "Réception (UTC)": message.get("receivedDateTime") or "",
        "Expéditeur": sender_field,
        "Objet": message.get("subject") or "",
        "Contenu intégral": body_to_text(message.get("body")),
        "Résumé du mail": message.get("bodyPreview") or "",
        "Pièce jointe": ", ".join(attachment_names) if attachment_names else NO_ATTACHMENT,
        "Contenu de la première page de la pièce jointe": attachment_first_page or NO_ATTACHMENT,
    }


def build_csv(rows: Iterable[Mapping[str, str]], columns: Sequence[str] = COLUMNS) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(columns), extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in columns})
    # A UTF-8 BOM makes Excel open accented text correctly on Windows.
    return ("\ufeff" + buffer.getvalue()).encode("utf-8")


def _md_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def _md_line(row: Mapping[str, str], columns: Sequence[str]) -> str:
    return "| " + " | ".join(_md_cell(row.get(column, "")) for column in columns) + " |"


def build_markdown(rows: Iterable[Mapping[str, str]], columns: Sequence[str] = COLUMNS) -> str:
    """The whole table as one Markdown table."""
    lines = [
        "| " + " | ".join(columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    lines.extend(_md_line(row, columns) for row in rows)
    return "\n".join(lines)


def build_markdown_parts(
    rows: Iterable[Mapping[str, str]],
    columns: Sequence[str] = COLUMNS,
    max_chars: int = 18_000,
) -> list[str]:
    """The table split into Markdown chunks no longer than `max_chars`.

    The platform bounds every string value at 20 000 characters, so a single
    Markdown blob for a large mailbox would arrive truncated. A list of short
    strings is not: each part survives intact. Part 0 carries the header; the
    rest carry rows only, so concatenating them in order rebuilds one table."""
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    parts: list[str] = []
    current: list[str] = [header, separator]
    size = len(header) + len(separator) + 2
    for row in rows:
        line = _md_line(row, columns)
        if size + len(line) + 1 > max_chars and len(current) > 2:
            parts.append("\n".join(current))
            current = []
            size = 0
        current.append(line)
        size += len(line) + 1
    parts.append("\n".join(current))
    return parts


def safe_filename(value: str, fallback: str = "emails") -> str:
    cleaned = _FILENAME_BAD.sub("_", (value or "").strip()).strip("._-")
    cleaned = cleaned[:80]
    return cleaned or fallback
