from __future__ import annotations

import io
import struct
import zipfile
from email.message import EmailMessage
from pathlib import Path

import pytest

from app.datasource.dataset_query import query_parquet
from app.datasource.datasets import prepare_parquet
from app.datasource.discovery import discover, preview_source
from app.datasource.email_archive import (iter_derived_files, iter_sheet_rows, read_messages,
                                          read_tnef, split_new_text)

ZIP = "application/zip"
SOURCE = {
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "assetId": "6512f0a1c9e77a001234bbb2",
    "mimeType": ZIP,
    "contentHash": "0123456789abcdef0123456789abcdef",
    "uploadedAt": "2026-09-20T12:00:00.000Z",
    "indexingStatus": "pending",
}
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _reply() -> bytes:
    message = EmailMessage()
    message["From"] = "Jeanne Martin <Jeanne.Martin@Client.fr>"
    message["To"] = "support@yellowsys.fr, Paul <paul@client.fr>"
    message["Cc"] = "chef@yellowsys.fr"
    message["Subject"] = "RE: Livraison du lot 2"
    message["Date"] = "Tue, 03 Mar 2026 09:15:00 +0100"
    message["Message-ID"] = "<reply-1@client.fr>"
    message["In-Reply-To"] = "<origin-1@yellowsys.fr>"
    message["References"] = "<root-0@yellowsys.fr> <origin-1@yellowsys.fr>"
    message["Received"] = "from mx.yellowsys.fr by mail.yellowsys.fr; Tue, 03 Mar 2026 09:16:30 +0100"
    message.set_content(
        "Bonjour,\n\nLa livraison du lot 2 est reportée au 15 mars.\n\nCordialement,\nJeanne\n\n"
        "De : Support <support@yellowsys.fr>\nEnvoyé : lundi 2 mars 2026 18:00\n"
        "À : Jeanne Martin\nObjet : Livraison du lot 2\n\nLe lot 2 part demain.\n")
    message.add_attachment(PDF, maintype="application", subtype="pdf", filename="planning lot 2.pdf")
    message.add_attachment(b"\x89PNG fake", maintype="image", subtype="png", filename="logo.png",
                           disposition="inline", cid="<logo@client.fr>")
    return bytes(message)


def _with_attached_email() -> bytes:
    inner = EmailMessage()
    inner["From"] = "fournisseur@acme.com"
    inner["To"] = "jeanne.martin@client.fr"
    inner["Subject"] = "Bon de commande"
    inner["Date"] = "Mon, 02 Mar 2026 08:00:00 +0000"
    inner["Message-ID"] = "<po-9@acme.com>"
    inner.set_content("Commande 4512 confirmée.")
    outer = EmailMessage()
    outer["From"] = "jeanne.martin@client.fr"
    outer["To"] = "support@yellowsys.fr"
    outer["Subject"] = "TR: Bon de commande"
    outer.set_content("Pour info, voir le message joint.")
    outer.add_attachment(inner)
    return bytes(outer).replace(b"MIME-Version", b"Date: not a date\nMIME-Version", 1)


def _tnef(files: list[tuple[str, bytes]], body: str) -> bytes:
    def attribute(level: int, attr_id: int, value: bytes) -> bytes:
        return (bytes([level]) + struct.pack("<II", attr_id, len(value)) + value
                + struct.pack("<H", sum(value) & 0xFFFF))

    stream = struct.pack("<IH", 0x223E9F78, 1)
    stream += attribute(1, 0x0001800C, body.encode("latin-1") + b"\x00")
    for name, payload in files:
        stream += attribute(2, 0x00069002, b"\x00" * 14)
        stream += attribute(2, 0x00018010, name.encode("latin-1") + b"\x00")
        stream += attribute(2, 0x0006800F, payload)
    return stream


def _with_winmail() -> bytes:
    message = EmailMessage()
    message["From"] = "outlook@client.fr"
    message["To"] = "support@yellowsys.fr"
    message["Subject"] = "Contrat"
    message["Date"] = "Wed, 04 Mar 2026 10:00:00 +0000"
    message.set_content("")
    message.add_attachment(_tnef([("contrat.pdf", PDF)], "Voici le contrat signé."),
                           maintype="application", subtype="ms-tnef", filename="winmail.dat")
    return bytes(message)


def _archive(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


@pytest.fixture()
def archive() -> bytes:
    return _archive({"boite/2026/reply.eml": _reply(), "boite/fwd.eml": _with_attached_email(),
                     "boite/winmail.eml": _with_winmail(), "copie/reply.eml": _reply(),
                     "__MACOSX/boite/._reply.eml": b"junk", "notes.txt": b"ignored"})


def test_split_new_text_cuts_outlook_and_reply_markers():
    new, quoted = split_new_text("Merci.\n\nDe : A <a@b.fr>\nEnvoyé : hier\nObjet : x\n\nancien")
    assert new == "Merci." and quoted.startswith("De : A")
    assert split_new_text("Ok\n\nLe 2 mars 2026, Paul a écrit :\n> avant")[0] == "Ok"
    assert split_new_text("Ok\n-----Original Message-----\nFrom: x")[0] == "Ok"
    assert split_new_text("De : rien ne suit\nTexte normal")[0].startswith("De : rien")


def test_messages_are_read_once_with_headers_dates_and_thread(archive: bytes):
    messages = list(read_messages(archive, ZIP))
    rows = {m.row["objet"]: m.row for m in messages}
    assert len(messages) == 4  # duplicate reply read once; attached e-mail read as its own message
    reply = rows["RE: Livraison du lot 2"]
    assert reply["adresse_expediteur"] == "jeanne.martin@client.fr"
    assert reply["domaine_expediteur"] == "client.fr"
    assert reply["nom_expediteur"] == "Jeanne Martin"
    assert reply["date_envoi"] == "2026-03-03T08:15:00Z"
    assert reply["date_reception"] == "2026-03-03T08:16:30Z"
    assert reply["source_date_reception"] == "en-tête Received"
    assert reply["message_id"] == "reply-1@client.fr"
    assert reply["en_reponse_a"] == "origin-1@yellowsys.fr"
    assert reply["fil"] == "root-0@yellowsys.fr"
    assert "reportée au 15 mars" in reply["apercu"] and "part demain" not in reply["apercu"]
    assert reply["nombre_pieces_jointes"] == 1
    assert reply["chemin_archive"] == "boite/2026/reply.eml"

    forward = rows["TR: Bon de commande"]
    assert forward["date_envoi"] is None and "date d'envoi illisible" in forward["anomalies"]
    attached = rows["Bon de commande"]
    assert attached["cle_message_parent"] == forward["cle_message"]
    assert attached["chemin_archive"] == "boite/fwd.eml#1"


def test_participants_and_attachments_tables(archive: bytes):
    participants = list(iter_sheet_rows(archive, ZIP, "participants"))
    roles = {(p["role"], p["adresse"]) for p in participants}
    assert ("destinataire", "paul@client.fr") in roles and ("copie", "chef@yellowsys.fr") in roles
    attachments = {a["nom_fichier"]: a for a in iter_sheet_rows(archive, ZIP, "attachments")}
    assert attachments["planning lot 2.pdf"]["statut_lecture"] == "lue"
    assert attachments["planning lot 2.pdf"]["empreinte"].startswith("sha256:")
    assert attachments["logo.png"]["integree"] is True
    assert attachments["logo.png"]["statut_lecture"] == "non prise en charge"
    assert attachments["contrat.pdf"]["type_fichier"] == "application/pdf"
    assert any(a["email_joint"] for a in attachments.values())


def test_winmail_body_and_files_are_recovered():
    files, body = read_tnef(_tnef([("a.pdf", PDF), ("b.txt", b"hello")], "Corps TNEF"))
    assert files == [("a.pdf", PDF), ("b.txt", b"hello")] and body == "Corps TNEF"
    message = next(read_messages(_with_winmail(), "message/rfc822"))
    assert message.row["apercu"] == "Voici le contrat signé."


def test_derived_files_are_keyed_by_message_and_attachment(archive: bytes):
    derived = list(iter_derived_files(archive, ZIP))
    texts = [d for d in derived if d.file_name.endswith("-message.txt")]
    assert len(texts) == 4
    reply_text = next(d.payload.decode() for d in texts if b"lot 2" in d.payload)
    assert "Objet : RE: Livraison du lot 2" in reply_text and "---- Messages cités ----" in reply_text
    pdfs = [d for d in derived if d.mime_type == "application/pdf"]
    assert sorted(d.file_name.split("-", 2)[2] for d in pdfs) == ["contrat.pdf", "planning lot 2.pdf"]
    assert all(d.file_name.startswith(f"{d.message_key}-{d.attachment_key}-") for d in pdfs)
    assert not any(d.file_name.endswith(".png") for d in derived)


def test_discovery_preview_and_preparation_present_three_tables(archive: bytes, tmp_path: Path):
    source = {**SOURCE, "sizeBytes": len(archive)}
    profile = discover(source)
    assert profile["status"] == "ready" and profile["structure"]["kind"] == "email_archive"

    preview = preview_source(source, {"sheetName": "attachments"}, archive)
    structure = preview["profile"]["structure"]
    assert [sheet["name"] for sheet in structure["sheets"]] == ["messages", "participants", "attachments"]
    assert structure["selectedSheet"] == "attachments" and structure["emailCount"] == 4
    assert preview["ingestionPlan"]["decision"] == "prepare_dataset"

    output = tmp_path / "messages.parquet"
    manifest = prepare_parquet(source, {"sheetName": "messages"}, io.BytesIO(archive), output)
    assert manifest["rowCount"] == 4
    rows = query_parquet(output, columns=["objet", "nombre_pieces_jointes"],
                         filters=[{"column": "domaine_expediteur", "op": "eq", "value": "client.fr"}])
    assert {"objet": "RE: Livraison du lot 2", "nombre_pieces_jointes": "1"} in rows["rows"]


def test_bad_archives_fail_with_codes():
    with pytest.raises(ValueError, match="archive_has_no_emails"):
        list(read_messages(_archive({"a.txt": b"x"}), ZIP))
    with pytest.raises(ValueError, match="unreadable_source"):
        list(read_messages(b"not a zip", ZIP))
    with pytest.raises(ValueError, match="archive_path_traversal"):
        list(read_messages(_archive({"../evil.eml": _reply()}), ZIP))
    with pytest.raises(ValueError, match="sheet_not_found"):
        list(iter_sheet_rows(_archive({"a.eml": _reply()}), ZIP, "nope"))


def test_sandbox_previews_prepares_and_derives_from_a_file(archive: bytes, tmp_path: Path):
    from app.datasource.parser_sandbox import (derive_files_subprocess, prepare_dataset_subprocess,
                                               run_preview_subprocess)

    source = {**SOURCE, "sizeBytes": len(archive)}
    on_disk = tmp_path / "archive.zip"
    on_disk.write_bytes(archive)

    preview = run_preview_subprocess(source, {"sheetName": "participants"}, on_disk)
    assert preview["profile"]["structure"]["selectedSheet"] == "participants"
    output = tmp_path / "attachments.parquet"
    result = prepare_dataset_subprocess(source, {"sheetName": "attachments"}, on_disk, output)
    assert result["dataset"]["rowCount"] == 4 and output.is_file()

    derived = tmp_path / "derived"
    files = derive_files_subprocess(source, on_disk, derived)
    assert len([f for f in files if f["fileName"].endswith("-message.txt")]) == 4
    assert all((derived / f["stored"]).stat().st_size == f["size"] for f in files)


@pytest.mark.asyncio
async def test_population_downloads_an_archive_once_and_derives_its_files_once(archive: bytes, tmp_path: Path):
    from test_population_task import command

    source = {**SOURCE, "sizeBytes": len(archive)}
    sources = [{"conceptId": "c1", "source": dict(source), "options": {"sheetName": sheet},
                "columnMapping": {key: "customer_id", "nom_fichier" if sheet == "attachments" else "objet": "name"},
                "mappingVersion": "map-v1"}
               for sheet, key in (("messages", "cle_message"), ("attachments", "cle_piece_jointe"))]
    downloads: list[str] = []
    uploads: list[str] = []

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        downloads.append(src["assetId"])
        target.write_bytes(archive)
        return target

    async def upload(src: dict, actor: str, entry: dict, path: Path) -> dict:
        assert path.read_bytes()[:0] == b"" and path.stat().st_size == entry["size"]
        uploads.append(entry["fileName"])
        return {"documentId": "d", "created": True}

    class Cache:
        def __init__(self) -> None:
            self.rows: dict[str, dict] = {}

        async def get(self, key: str) -> dict | None:
            return self.rows.get(key)

        async def put(self, key: str, *, concept_id: str, asset_id: str, output: dict) -> None:
            self.rows[key] = output

    cache = Cache()
    first = await run(command(sources=sources), fetch, upload, cache)
    assert first["ok"] is True, first
    assert downloads == [SOURCE["assetId"]]
    assert first["counts"]["materialized"] == 4 + 4
    assert len(uploads) == 6  # 4 message texts + 2 PDFs
    second = await run(command(sources=sources), fetch, upload, cache)
    assert second["ok"] is True and len(uploads) == 6


async def run(cmd: dict, fetch, upload, cache) -> dict:  # type: ignore[no-untyped-def]
    from app.workers.population_tasks import run_population_for_task

    return await run_population_for_task(cmd, fetch=fetch, upload_derived=upload, extraction_cache=cache)


def test_a_message_whose_body_is_a_single_file_has_that_attachment():
    import base64

    message = EmailMessage()
    message["From"] = "scan@client.fr"
    message["Subject"] = "Scan"
    message.set_content(PDF, maintype="application", subtype="pdf", filename="scan.pdf", disposition=None)
    message = next(read_messages(bytes(message), "message/rfc822"))
    assert [a.row["nom_fichier"] for a in message.attachments] == ["scan.pdf"]
    assert message.attachments[0].row["statut_lecture"] == "lue"


def test_run_limits_fall_back_to_built_in_values_and_stay_in_range():
    from app.population.run_limits import DEFAULT_RUN_LIMITS, run_limits

    assert run_limits({}) == DEFAULT_RUN_LIMITS
    assert run_limits({"limits": {"maxRecordsPerRun": 50000, "maxValuesPerRun": 10**9,
                                  "maxRunSources": True}}) == {**DEFAULT_RUN_LIMITS, "maxRecordsPerRun": 50000}


@pytest.mark.asyncio
async def test_admin_limits_cap_records_per_source_and_per_run(archive: bytes):
    from test_population_task import command

    big = _archive({f"m{index}.eml": _numbered(index) for index in range(250)})
    source = {**SOURCE, "sizeBytes": len(big)}
    sources = [{"conceptId": "c1", "source": dict(source), "options": {"sheetName": "messages"},
                "columnMapping": {"cle_message": "customer_id", "objet": "name"}, "mappingVersion": "map-v1"}]

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(big)
        return target

    async def upload(src: dict, actor: str, entry: dict, path: Path) -> dict:
        return {"documentId": "d", "created": True}

    from app.workers.population_tasks import run_population_for_task

    plain = await run_population_for_task(command(sources=sources), fetch=fetch, upload_derived=upload)
    assert plain["counts"]["materialized"] == 250
    limited_command = command(sources=sources)
    limited_command["payload"]["limits"] = {"maxRecordsPerRun": 120}
    limited = await run_population_for_task(limited_command, fetch=fetch, upload_derived=upload)
    assert limited["counts"]["materialized"] == 120
    assert "materialization_cap" in {gap["kind"] for gap in limited["gaps"]}


def _numbered(index: int) -> bytes:
    message = EmailMessage()
    message["From"] = f"user{index}@client.fr"
    message["Subject"] = f"Message {index}"
    message["Message-ID"] = f"<m{index}@client.fr>"
    message.set_content("Bonjour")
    return bytes(message)


@pytest.mark.asyncio
async def test_admin_limit_on_records_per_source_stops_reading_that_source():
    from test_population_task import command
    from app.workers.population_tasks import run_population_for_task

    big = _archive({f"m{index}.eml": _numbered(index) for index in range(250)})
    sources = [{"conceptId": "c1", "source": {**SOURCE, "sizeBytes": len(big)}, "options": {"sheetName": "messages"},
                "columnMapping": {"cle_message": "customer_id", "objet": "name"}, "mappingVersion": "map-v1"}]

    async def fetch(src: dict, actor: str, *, target: Path) -> Path:
        target.write_bytes(big)
        return target

    async def upload(src: dict, actor: str, entry: dict, path: Path) -> dict:
        return {"documentId": "d", "created": True}

    limited = command(sources=sources)
    limited["payload"]["limits"] = {"maxRecordsPerSource": 100}
    outcome = await run_population_for_task(limited, fetch=fetch, upload_derived=upload)
    assert outcome["counts"]["materialized"] == 100 and outcome["completeEnumeration"] is False
