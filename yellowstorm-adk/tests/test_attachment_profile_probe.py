"""Threshold probes for conversation attachments (early stop, fail closed)."""

import csv
import importlib.util

import pytest

from src.modules.attachment_profile import extractors, probe
from src.modules.attachment_profile.models import AttachmentProfileRequest
from src.modules.attachment_profile.service import AttachmentProfileService

HAS_OPENPYXL = importlib.util.find_spec("openpyxl") is not None
HAS_XLRD = importlib.util.find_spec("xlrd") is not None
HAS_FITZ = importlib.util.find_spec("fitz") is not None


def _write_csv(path, rows: int) -> str:
    with open(path, "w", newline="", encoding="utf-8") as file_obj:
        writer = csv.writer(file_obj)
        for index in range(rows):
            writer.writerow([f"id-{index}", f"name-{index}"])
    return str(path)


def test_csv_counts_nonempty_rows(tmp_path):
    path = _write_csv(tmp_path / "nonempty.csv", 10)
    with open(path, "r", newline="", encoding="utf-8-sig") as file_obj:
        count, columns, exceeded = probe.probe_csv(file_obj, 100)
    assert count == 10
    assert columns == ["id-0", "name-0"]
    assert exceeded is False


def test_csv_stops_at_threshold_plus_one(tmp_path):
    """A file with far more rows than the threshold must not be read past it."""
    path = _write_csv(tmp_path / "early_stop.csv", 10_000)
    with open(path, "r", newline="", encoding="utf-8-sig") as file_obj:
        count, _, exceeded = probe.probe_csv(file_obj, 5)
    assert exceeded is True
    assert count == 6  # threshold + 1, then the reader stopped


def test_csv_threshold_5000_boundary(tmp_path):
    path = _write_csv(tmp_path / "boundary.csv", 5001)
    with open(path, "r", newline="", encoding="utf-8-sig") as file_obj:
        count, _, exceeded = probe.probe_csv(file_obj, 5000)
    assert (count, exceeded) == (5001, True)


@pytest.mark.skipif(not HAS_OPENPYXL, reason="openpyxl not installed")
def test_xlsx_counts_cumulative_rows_across_sheets(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    path = tmp_path / "multi.xlsx"
    workbook = openpyxl.Workbook()
    first = workbook.active
    for index in range(4):
        first.append([f"a{index}", f"b{index}"])
    second = workbook.create_sheet("Sheet2")
    for index in range(3):
        second.append([f"c{index}"])
    workbook.save(path)

    total, columns, sheet_count, exceeded = probe.probe_xlsx(str(path), 100)

    assert total == 7
    assert columns == ["a0", "b0"]
    assert sheet_count == 2
    assert exceeded is False


@pytest.mark.skipif(not HAS_OPENPYXL, reason="openpyxl not installed")
def test_xlsx_early_stops_across_sheets(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    path = tmp_path / "heavy.xlsx"
    workbook = openpyxl.Workbook()
    first = workbook.active
    for index in range(4):
        first.append([index])
    second = workbook.create_sheet("Sheet2")
    for index in range(10_000):
        second.append([index])
    workbook.save(path)

    total, _, _, exceeded = probe.probe_xlsx(str(path), 5)

    assert exceeded is True
    assert total == 6


@pytest.mark.skipif(not HAS_OPENPYXL, reason="openpyxl not installed")
def test_corrupt_xlsx_raises_probe_error(tmp_path):
    path = tmp_path / "corrupt.xlsx"
    path.write_bytes(b"PK\xff\xff not a real zip file")
    with pytest.raises(probe.ProbeError):
        probe.probe_xlsx(str(path), 10)


@pytest.mark.skipif(not HAS_XLRD, reason="xlrd not installed")
def test_xls_probe_rejects_non_xls(tmp_path):
    path = _write_csv(tmp_path / "fake.xls", 5)
    with pytest.raises(probe.ProbeError):
        probe.probe_xls(path, 10)


def test_service_tabular_profile_has_no_content_above_threshold(tmp_path):
    path = _write_csv(tmp_path / "big.csv", 40)
    service = AttachmentProfileService(helpers=object())  # download bypassed: _build_sync only
    request = AttachmentProfileRequest(
        document_id="doc-1", path=path, filename="big.csv", mime_type="text/csv",
        max_indexed_tabular_rows=10,
    )

    profile = service._build_sync(request, path, ".csv")

    assert profile.tabular.total_rows == 11  # threshold + 1
    assert profile.content is None  # heavy dataset never enters the profile


def test_service_small_csv_profile_keeps_sample(tmp_path):
    path = _write_csv(tmp_path / "small.csv", 5)
    service = AttachmentProfileService(helpers=object())
    request = AttachmentProfileRequest(
        document_id="doc-2", path=path, filename="small.csv", mime_type="text/csv",
        max_indexed_tabular_rows=10,
    )

    profile = service._build_sync(request, path, ".csv")

    assert profile.tabular.total_rows == 5
    assert profile.content is not None
    assert "id-0" in profile.content


def test_service_failed_extraction_reports_status_failed(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-broken")
    service = AttachmentProfileService(helpers=object())
    request = AttachmentProfileRequest(
        document_id="doc-3", path=str(path), filename="broken.pdf", mime_type="application/pdf",
    )

    profile = service._build_sync(request, path, ".pdf")

    assert profile.extraction.status == "failed"


@pytest.mark.skipif(not HAS_FITZ, reason="pymupdf not installed")
def test_pdf_extraction_produces_page_markers(tmp_path):
    fitz = pytest.importorskip("fitz")
    path = tmp_path / "doc.pdf"
    document = fitz.open()
    for text in ("first page", "second page"):
        page = document.new_page()
        page.insert_text((72, 72), text)
    document.save(path)
    document.close()

    text, extractor, _ = extractors.extract_text(str(path), ".pdf")

    assert extractor == "pymupdf"
    assert "--- Page 1 ---" in text
    assert "--- Page 2 ---" in text
    assert "second page" in text


def test_plaintext_normalization(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_bytes(b"line one\r\nline two\x00\n\n\n\nline three")

    text, extractor, _ = extractors.extract_text(str(path), ".txt")

    assert extractor == "plaintext"
    assert "\x00" not in text
    assert "\r" not in text
    assert "\n\n\n" not in text
