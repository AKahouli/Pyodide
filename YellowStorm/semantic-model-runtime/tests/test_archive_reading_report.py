"""What reading a mail archive left out or cut is counted, reported with the model's health, and logged once."""

from __future__ import annotations

from email.message import EmailMessage
from pathlib import Path

import pytest

from app.datasource.datasets import prepare_email_tables
from app.population.row_health import ConceptHealth

from test_archive_extraction_limits import Cache, _command, _pdf
from test_email_archive import ZIP, _archive, run

TEXT_LIMIT = "SEMANTIC_EMAIL_MAX_ATTACHMENT_CHARS"


def _mail(subject: str, *attachments: tuple[bytes, str, str, str], inline_logo: bool = False) -> bytes:
    message = EmailMessage()
    message["From"] = "a@b.fr"
    message["Subject"] = subject
    message["Message-ID"] = f"<{subject}@b.fr>"
    message.set_content("Voir les pièces jointes.")
    for payload, maintype, subtype, filename in attachments:
        message.add_attachment(payload, maintype=maintype, subtype=subtype, filename=filename)
    if inline_logo:
        message.add_attachment(b"\x89PNG", maintype="image", subtype="png", filename="logo.png",
                               disposition="inline", cid="<logo@b.fr>")
    return bytes(message)


def _mailbox() -> bytes:
    return _archive({
        "one.eml": _mail("un", (b"a" * 6000, "text", "plain", "long.txt"), (b"court", "text", "plain", "court.txt"),
                         (_pdf(""), "application", "pdf", "scan.pdf"), (b"\x89PNG", "image", "png", "photo.png"),
                         inline_logo=True),
        "two.eml": _mail("deux", (b"b" * 10, "text", "plain", "autre.txt")),
    })


def test_the_tables_count_what_the_reading_left_out_or_cut(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv(TEXT_LIMIT, "5000")
    tables = prepare_email_tables(_mailbox(), ZIP, tmp_path)
    # The inline logo is no attachment a person looks for; the photo is one with no text to read.
    assert tables["attachments"]["reading"] == {"total": 5, "extracted": 2, "truncated": 1, "scanned": 1, "unsupported": 1}
    assert tables["messages"]["reading"] == {"total": 2}
    assert "reading" not in tables["participants"]


def test_a_mail_over_the_size_limit_counts_as_a_limit_not_as_an_unreadable_mail(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    big = _mail("gros", (b"A" * (3 * 1024 * 1024), "application", "octet-stream", "gros.bin"))
    monkeypatch.setenv("SEMANTIC_EMAIL_MAX_EML_MB", "1")
    tables = prepare_email_tables(_archive({"gros.eml": big, "petit.eml": _mail("petit")}), ZIP, tmp_path)
    assert tables["messages"]["reading"] == {"total": 2, "emlTooLarge": 1}


def test_a_reading_that_left_nothing_out_reports_no_finding():
    health = ConceptHealth("c1")
    health.begin_source("boite.zip", sheet="attachments")
    health.set_reading({"total": 3, "extracted": 3}, {"maxAttachmentChars": 100000})
    assert health.report(records=3)["findings"] == []


def test_a_cut_reading_is_a_finding_that_survives_a_cached_reading_and_adds_up_across_sources():
    first = ConceptHealth("c1")
    first.begin_source("boite.zip", sheet="attachments")
    first.set_reading({"total": 10, "extracted": 6, "truncated": 3, "scanned": 1}, {"maxAttachmentChars": 5000})
    # The same reading, stored in the extraction cache and absorbed into a later run.
    restored = ConceptHealth.restore(first.snapshot())
    assert restored is not None
    second = ConceptHealth("c1")
    second.begin_source("autre.zip", sheet="attachments")
    second.set_reading({"total": 5, "extracted": 5}, {"maxAttachmentChars": 5000})
    total = ConceptHealth("c1")
    total.absorb(restored)
    total.absorb(second)
    (finding,) = total.report(records=15)["findings"]
    assert finding == {"kind": "archive_reading", "sheet": "attachments", "total": 15, "limits": {"maxAttachmentChars": 5000},
                       "counts": {"total": 15, "extracted": 11, "truncated": 3, "scanned": 1}, "examples": []}


@pytest.mark.asyncio
async def test_a_run_reports_the_cut_reading_logs_it_once_and_keeps_the_report_when_reused(monkeypatch: pytest.MonkeyPatch):
    import app.workers.population_tasks as tasks

    logged: list[tuple[str, dict]] = []
    monkeypatch.setattr(tasks.events, "info", lambda name, **attributes: logged.append((name, attributes)))
    archive = _mailbox()

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(archive)
        return target

    command = _command(archive, {"maxAttachmentChars": 5000}, sheet="attachments")
    cache = Cache()
    for _ in range(2):
        outcome = await run(command, fetch, None, cache)
        assert outcome["ok"] is True, outcome
        (finding,) = outcome["health"]["concepts"]["c1"]["findings"]
        assert finding["kind"] == "archive_reading" and finding["sheet"] == "attachments"
        assert finding["counts"]["truncated"] == 1 and finding["counts"]["scanned"] == 1 and finding["limits"]["maxAttachmentChars"] == 5000
    # Read once, reused once: the summary is told when the archive is read.
    (name, attributes), = logged
    assert name == "semantic.email_archive.read"
    assert (attributes["scope"], attributes["count"], attributes["outcome"]) == ("tables", 2, "cut")
    assert "truncated=1" in attributes["detail"] and isinstance(attributes["duration_ms"], int)
