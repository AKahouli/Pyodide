"""What an admin can set for reading an e-mail archive: mail and attachment sizes, nesting, how much of a
file is read, and how much text is kept. Every limit reaches the parser through its environment (as
``maxArchiveEmails`` already does), and a changed limit reads the archive again."""

from __future__ import annotations

import io
import zipfile
from email.message import EmailMessage
from pathlib import Path

import openpyxl
import pytest

from app.datasource.attachment_text import attachment_text
from app.datasource.email_archive import read_messages
from app.datasource.parser_sandbox import _child_environment, limit_environment
from app.population.run_limits import DEFAULT_RUN_LIMITS, run_limits

from test_email_archive import SOURCE, ZIP, _archive, _reply, _with_attached_email, run

MB = 1024 * 1024
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

# Limit -> (built-in value, environment variable of the parser).
LIMITS = {
    "maxEmlMb": (100, "SEMANTIC_EMAIL_MAX_EML_MB"),
    "maxAttachmentMb": (50, "SEMANTIC_EMAIL_MAX_ATTACHMENT_MB"),
    "maxNesting": (3, "SEMANTIC_EMAIL_MAX_NESTING"),
    "maxPdfPages": (300, "SEMANTIC_EMAIL_MAX_PDF_PAGES"),
    "maxSheetCells": (50000, "SEMANTIC_EMAIL_MAX_SHEET_CELLS"),
    "maxSlides": (500, "SEMANTIC_EMAIL_MAX_SLIDES"),
    "maxAttachmentChars": (100000, "SEMANTIC_EMAIL_MAX_ATTACHMENT_CHARS"),
    "maxBodyChars": (100000, "SEMANTIC_EMAIL_MAX_BODY_CHARS"),
    "maxInflatedMb": (50, "SEMANTIC_EMAIL_MAX_INFLATED_MB"),
}


def _pdf(*pages: str) -> bytes:
    """A PDF with one page per text, written with a standard font."""
    objects: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    font = 3 + 2 * len(pages)
    kids = []
    for number, text in enumerate(pages):
        page, contents = 3 + 2 * number, 4 + 2 * number
        kids.append(f"{page} 0 R")
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {contents} 0 R"
                       f" /Resources << /Font << /F1 {font} 0 R >> >> >>".encode())
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode()
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def _docx_of(text: str) -> bytes:
    document = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>")
    out = io.BytesIO()
    # Deflated: a few bytes in the file, megabytes once read (a decompression bomb in miniature).
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document)
    return out.getvalue()


def _pptx(slides: int) -> bytes:
    ns = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for number in range(1, slides + 1):
            archive.writestr(f"ppt/slides/slide{number}.xml",
                             f"<p:sld {ns}><a:p><a:r><a:t>Diapo {number}</a:t></a:r></a:p></p:sld>")
    return out.getvalue()


def _xlsx(rows: int) -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for number in range(1, rows + 1):
        sheet.append([f"Ligne {number}", number])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def _mail_with(payload: bytes, filename: str, maintype: str = "text", subtype: str = "plain") -> bytes:
    message = EmailMessage()
    message["From"] = "a@b.fr"
    message["Message-ID"] = f"<{filename}@b.fr>"
    message.set_content("Voir la pièce jointe.")
    message.add_attachment(payload, maintype=maintype, subtype=subtype, filename=filename)
    return bytes(message)


# ---------------------------------------------------------------- the admin's run limits

def test_the_extraction_limits_are_run_limits_with_their_built_in_values_and_ranges():
    assert {key: DEFAULT_RUN_LIMITS.get(key) for key in LIMITS} == {key: built_in for key, (built_in, _) in LIMITS.items()}
    assert run_limits({"limits": {"maxPdfPages": 12, "maxNesting": 0}})["maxPdfPages"] == 12
    assert run_limits({"limits": {"maxNesting": 0}})["maxNesting"] == 0
    # Out of range or not a whole number: the built-in value stays.
    assert run_limits({"limits": {"maxPdfPages": 10**6, "maxSlides": True}})["maxPdfPages"] == 300
    assert run_limits({"limits": {"maxSlides": True}})["maxSlides"] == 500


def test_the_sandbox_hands_every_extraction_limit_to_the_parser():
    given = {key: index + 7 for index, key in enumerate(LIMITS)}
    expected = {variable: str(given[key]) for key, (_, variable) in LIMITS.items()}
    assert limit_environment(given) == expected
    # Only a fixed list of variables crosses into the child: each limit must be on it.
    assert expected.items() <= _child_environment(True, expected).items()


# ---------------------------------------------------------------- what is read of a file

def test_the_text_of_an_attachment_is_cut_at_the_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxAttachmentChars"][1], "5000")
    text, status = attachment_text("text/plain", b"a" * 6000)
    assert text == "a" * 5000 + "…" and status == "tronqué à 5000 caractères"


def test_a_pdf_is_read_up_to_the_page_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxPdfPages"][1], "1")
    text, status = attachment_text(PDF_MIME, _pdf("Premiere page", "Seconde page"))
    assert text == "Premiere page" and status == "extrait"


def test_a_workbook_is_read_up_to_the_cell_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxSheetCells"][1], "1000")
    text, _ = attachment_text(XLSX_MIME, _xlsx(600))
    assert "Ligne 1\t1" in text and "Ligne 500" in text and "Ligne 600" not in text


def test_a_presentation_is_read_up_to_the_slide_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxSlides"][1], "1")
    text, _ = attachment_text(PPTX_MIME, _pptx(3))
    assert text == "## Slide 1\nDiapo 1"


def test_a_file_that_inflates_past_the_limit_is_not_read(monkeypatch: pytest.MonkeyPatch):
    bomb = _docx_of("a" * (3 * MB))
    assert len(bomb) < MB
    monkeypatch.setenv(LIMITS["maxInflatedMb"][1], "1")
    assert attachment_text(DOCX_MIME, bomb) == (None, "trop volumineux une fois décompressé")


def _with_part(office: bytes, name: str, content: str) -> bytes:
    """The same zipped file with one more (or replaced) part, deflated."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(office)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            if item.filename != name:
                target.writestr(item, source.read(item))
        target.writestr(name, content)
    return out.getvalue()


def test_only_the_parts_a_workbook_reader_loads_whole_count_against_the_inflated_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxInflatedMb"][1], "1")
    padding = "<x>" + "a" * (3 * MB) + "</x>"
    # A big sheet is streamed and bounded by the cell limit: it is read.
    streamed = _with_part(_xlsx(3), "xl/worksheets/padding.xml", padding)
    text, status = attachment_text(XLSX_MIME, streamed)
    assert status == "extrait" and "Ligne 1	1" in text
    # Shared strings are loaded whole: a file that inflates them past the limit is refused.
    assert attachment_text(XLSX_MIME, _with_part(_xlsx(3), "xl/sharedStrings.xml", padding)) ==         (None, "trop volumineux une fois décompressé")


def test_a_presentation_that_inflates_past_the_limit_is_not_read(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxInflatedMb"][1], "1")
    bomb = _with_part(_pptx(1), "ppt/slides/slide1.xml",
                      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:p><a:r><a:t>'
                      + "a" * (3 * MB) + "</a:t></a:r></a:p></p:sld>")
    assert len(bomb) < MB
    assert attachment_text(PPTX_MIME, bomb) == (None, "trop volumineux une fois décompressé")


# ---------------------------------------------------------------- what is read of a mail

def test_a_body_is_cut_at_the_limit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(LIMITS["maxBodyChars"][1], "5000")
    message = EmailMessage()
    message["From"] = "a@b.fr"
    message.set_content("x" * 6000)
    row = next(read_messages(bytes(message), "message/rfc822")).row
    assert row["corps"] == "x" * 5000 + "…"
    assert "corps tronqué à 5000 caractères" in row["anomalies"]


def test_a_mail_over_the_size_limit_is_not_read(monkeypatch: pytest.MonkeyPatch):
    big = _mail_with(b"A" * int(1.5 * MB), "gros.bin", "application", "octet-stream")
    assert len(big) > MB
    monkeypatch.setenv(LIMITS["maxEmlMb"][1], "1")
    row = next(read_messages(_archive({"gros.eml": big}), ZIP)).row
    assert row["anomalies"] == "e-mail trop volumineux, non lu"


def test_a_single_mail_over_the_size_limit_is_refused(monkeypatch: pytest.MonkeyPatch):
    big = _mail_with(b"A" * int(1.5 * MB), "gros.bin", "application", "octet-stream")
    monkeypatch.setenv(LIMITS["maxEmlMb"][1], "1")
    with pytest.raises(ValueError, match="email_too_large"):
        list(read_messages(big, "message/rfc822"))


def test_an_attachment_over_the_size_limit_is_not_read(monkeypatch: pytest.MonkeyPatch):
    mail = _mail_with(b"a" * int(1.5 * MB), "gros.txt")
    monkeypatch.setenv(LIMITS["maxAttachmentMb"][1], "1")
    row = next(read_messages(mail, "message/rfc822", with_text=True)).attachments[0].row
    assert row["statut_lecture"] == "trop volumineuse" and row["contenu"] is None


def test_attached_mails_are_opened_down_to_the_nesting_limit(monkeypatch: pytest.MonkeyPatch):
    forwarded = _with_attached_email()
    assert len(list(read_messages(forwarded, "message/rfc822"))) == 2
    monkeypatch.setenv(LIMITS["maxNesting"][1], "0")
    messages = list(read_messages(forwarded, "message/rfc822"))
    # The attached mail is still listed as an attachment, but not read as a message of its own.
    assert len(messages) == 1 and messages[0].row["nombre_pieces_jointes"] == 1


# ---------------------------------------------------------------- a changed limit reads the archive again

class Cache:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    async def get(self, key: str) -> dict | None:
        return self.rows.get(key)

    async def put(self, key: str, *, concept_id: str, asset_id: str, output: dict) -> None:
        self.rows[key] = output


def _command(archive: bytes, limits: dict, *, index: bool = False) -> dict:
    from test_population_task import command

    source = {**SOURCE, "sizeBytes": len(archive), "indexInWorkspace": index}
    cmd = command(sources=[{"conceptId": "c1", "source": source, "options": {"sheetName": "messages"},
                            "columnMapping": {"cle_message": "customer_id", "objet": "name"},
                            "mappingVersion": "map-v1"}])
    cmd["payload"]["limits"] = limits
    return cmd


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [{"maxArchiveEmails": 200}, {"maxAttachmentChars": 7000}, {"maxNesting": 1}])
async def test_a_changed_limit_does_not_reuse_the_earlier_reading_of_a_sheet(changed: dict):
    archive = _archive({"boite/reply.eml": _reply(), "boite/fwd.eml": _with_attached_email()})

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(archive)
        return target

    cache = Cache()
    assert (await run(_command(archive, {}), fetch, None, cache))["ok"] is True
    assert len(cache.rows) == 1
    assert (await run(_command(archive, {}), fetch, None, cache))["ok"] is True
    assert len(cache.rows) == 1  # same limits: the reading is reused
    assert (await run(_command(archive, changed), fetch, None, cache))["ok"] is True
    assert len(cache.rows) == 2


@pytest.mark.asyncio
async def test_a_limit_set_to_its_built_in_value_keeps_the_earlier_reading_and_copy():
    archive = _archive({"boite/reply.eml": _reply()})
    uploads: list[str] = []

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(archive)
        return target

    async def upload(src: dict, actor: str, entry: dict, path: Path) -> dict:
        uploads.append(entry["fileName"])
        return {"documentId": "d", "created": True}

    cache = Cache()
    await run(_command(archive, {}, index=True), fetch, upload, cache)
    keys, copied = set(cache.rows), len(uploads)
    # An admin who saves the built-in values changes nothing: no new reading, no new copy.
    built_in = {key: built for key, (built, _) in LIMITS.items()}
    await run(_command(archive, built_in, index=True), fetch, upload, cache)
    assert set(cache.rows) == keys and len(uploads) == copied


@pytest.mark.asyncio
async def test_a_changed_file_limit_copies_the_archive_into_the_workspace_again():
    archive = _archive({"boite/reply.eml": _reply()})
    uploads: list[str] = []

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(archive)
        return target

    async def upload(src: dict, actor: str, entry: dict, path: Path) -> dict:
        uploads.append(entry["fileName"])
        return {"documentId": "d", "created": True}

    cache = Cache()
    await run(_command(archive, {}, index=True), fetch, upload, cache)
    copied = len(uploads)
    assert copied > 0
    await run(_command(archive, {}, index=True), fetch, upload, cache)
    assert len(uploads) == copied
    # What decides which files are copied (size of a mail or an attachment, nesting) copies them again.
    await run(_command(archive, {"maxAttachmentMb": 40}, index=True), fetch, upload, cache)
    assert len(uploads) == 2 * copied


@pytest.mark.asyncio
async def test_an_archive_limit_does_not_read_a_sheet_of_another_kind_again():
    from app.workers.population_tasks import run_population_for_task
    from test_population_task import MemoryCache, command, fake_fetch, fake_prepare, fake_query

    cache, prepared = MemoryCache(), []

    def counting_prepare(*args, **kwargs):  # type: ignore[no-untyped-def]
        prepared.append(1)
        return fake_prepare(*args, **kwargs)

    for limits in ({}, {"maxAttachmentChars": 7000, "maxNesting": 1}):
        cmd = command()
        cmd["payload"]["limits"] = limits
        await run_population_for_task(cmd, fetch=fake_fetch, prepare=counting_prepare, query=fake_query,
                                      extraction_cache=cache)
    assert prepared == [1]


# ---------------------------------------------------------------- the limits themselves

def test_the_limits_of_a_process_are_its_environment_in_range_else_the_built_in_values():
    from app.datasource.extraction_limits import MB, ExtractionLimits

    assert ExtractionLimits.from_environment({}) == ExtractionLimits()
    assert ExtractionLimits().eml_bytes == 100 * MB and ExtractionLimits().attachment_chars == 100_000
    read = ExtractionLimits.from_environment({"SEMANTIC_EMAIL_MAX_EML_MB": "7", "SEMANTIC_EMAIL_MAX_NESTING": "0"})
    assert read.eml_bytes == 7 * MB and read.nesting == 0
    # Not a number, or outside the admin's range: the built-in value.
    wrong = ExtractionLimits.from_environment({"SEMANTIC_EMAIL_MAX_PDF_PAGES": "many", "SEMANTIC_EMAIL_MAX_SLIDES": "0",
                                               "SEMANTIC_EMAIL_MAX_NESTING": "9"})
    assert (wrong.pdf_pages, wrong.slides, wrong.nesting) == (300, 500, 3)


def test_the_limits_given_to_the_sandbox_reach_the_files_it_reads(tmp_path: Path):
    from app.datasource.parser_sandbox import prepare_email_tables_subprocess
    from app.datasource.dataset_query import query_parquet

    archive = _archive({"a.eml": _mail_with(b"a" * 6000, "long.txt")})
    on_disk = tmp_path / "mailbox.zip"
    on_disk.write_bytes(archive)
    source = {**SOURCE, "sizeBytes": len(archive)}

    def attachment(limits: dict | None) -> dict:
        tables = prepare_email_tables_subprocess(source, on_disk, tmp_path / f"t{len(limits or {})}", limits=limits)
        return query_parquet(tables["attachments"]["path"], columns=["contenu", "statut_contenu"], limit=5)["rows"][0]

    assert attachment(None)["contenu"] == "a" * 6000
    cut = attachment({"maxAttachmentChars": 5000})
    assert cut["contenu"] == "a" * 5000 + "…" and cut["statut_contenu"] == "tronqué à 5000 caractères"
