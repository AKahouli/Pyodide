from __future__ import annotations

import io
import zipfile
from email.message import EmailMessage

import openpyxl

from app.datasource.attachment_text import CONTENT_CHARS, attachment_text
from app.datasource.email_archive import ATTACHMENT_COLUMNS, read_messages

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _pdf(text: str) -> bytes:
    """A one-page PDF that writes ``text`` with a standard font."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
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


def _docx(*paragraphs: str) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    document = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body>{body}</w:body></w:document>")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("word/document.xml", document)
    return out.getvalue()


def _xlsx() -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Prix"
    sheet.append(["Lot", "Montant"])
    sheet.append(["Lot 2", 1250])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _pptx(slides: list[list[str]], notes: dict[int, str] | None = None) -> bytes:
    ns = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
    def part(lines: list[str]) -> str:
        return f"<p:sld {ns}>" + "".join(f"<a:p><a:r><a:t>{line}</a:t></a:r></a:p>" for line in lines) + "</p:sld>"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for number, lines in enumerate(slides, start=1):
            archive.writestr(f"ppt/slides/slide{number}.xml", part(lines))
        for number, note in (notes or {}).items():
            archive.writestr(f"ppt/notesSlides/notesSlide{number}.xml", part([note]))
    return out.getvalue()


def test_reads_powerpoint_slides_in_order_with_their_notes():
    slides = [[f"Titre {n}", "Point cle"] for n in range(1, 11)]
    text, status = attachment_text(PPTX_MIME, _pptx(slides, {2: "Penser au budget"}))
    assert status == "extrait"
    assert text.index("## Slide 2") < text.index("## Slide 10")  # numeric, not alphabetical
    assert "## Slide 2\nTitre 2\nPoint cle\nNotes : Penser au budget" in text


def test_reads_csv_under_its_usual_types_and_by_extension():
    csv = "Lot;Montant\nLot 2;1250\n".encode("cp1252")
    for mime in ("text/csv", "application/csv", "text/comma-separated-values"):
        assert attachment_text(mime, csv) == ("Lot;Montant\nLot 2;1250", "extrait")
    message = EmailMessage()
    message["From"] = "achats@client.fr"
    message.set_content("Voir pieces jointes.")
    message.add_attachment(csv, maintype="application", subtype="octet-stream", filename="prix.csv")
    message.add_attachment(_pptx([["Plan"]]), maintype="application", subtype="octet-stream", filename="deck.pptx")
    rows = {a.row["nom_fichier"]: a.row for a in next(read_messages(bytes(message), "message/rfc822", with_text=True)).attachments}
    assert rows["prix.csv"]["type_fichier"] == "text/csv" and rows["prix.csv"]["contenu"] == "Lot;Montant\nLot 2;1250"
    assert rows["deck.pptx"]["statut_lecture"] == "lue" and rows["deck.pptx"]["contenu"] == "## Slide 1\nPlan"


def test_csv_and_powerpoint_are_not_copied_to_the_workspace():
    from app.datasource.email_archive import iter_derived_files
    message = EmailMessage()
    message["From"] = "achats@client.fr"
    message.set_content("Pieces jointes.")
    message.add_attachment(b"a;b\n1;2", maintype="text", subtype="csv", filename="t.csv")
    message.add_attachment(_pptx([["Plan"]]), maintype="application", subtype="vnd.openxmlformats-officedocument.presentationml.presentation", filename="d.pptx")
    assert [f.file_name.rsplit("-", 1)[-1] for f in iter_derived_files(bytes(message), "message/rfc822")] == ["message.txt"]


def test_reads_pdf_word_excel_and_text():
    assert attachment_text(PDF_MIME, _pdf("Penalites de retard 3 pourcent"))[0] == "Penalites de retard 3 pourcent"
    assert attachment_text(DOCX_MIME, _docx("Article 1", "Livraison le 12 mars")) == ("Article 1\nLivraison le 12 mars", "extrait")
    text, status = attachment_text(XLSX_MIME, _xlsx())
    assert status == "extrait" and "## Prix" in text and "Lot 2\t1250" in text
    assert attachment_text("text/plain", "Échéance : vendredi".encode("cp1252")) == ("Échéance : vendredi", "extrait")


def test_says_why_there_is_no_text():
    assert attachment_text(PDF_MIME, b"%PDF-1.4 broken") == (None, "illisible")
    assert attachment_text("text/plain", b"   \n ") == (None, "sans texte (image ou scan ?)")
    assert attachment_text("image/png", b"\x89PNG") == (None, "non extrait")


def test_long_text_is_cut_with_a_note():
    text, status = attachment_text("text/plain", b"a" * (CONTENT_CHARS + 10))
    assert len(text) == CONTENT_CHARS + 1 and text.endswith("…")
    assert status.startswith("tronqué")


def test_the_attachments_table_carries_the_file_text():
    message = EmailMessage()
    message["From"] = "achats@client.fr"
    message["Subject"] = "Contrat"
    message.set_content("Voir le contrat joint.")
    message.add_attachment(_docx("Clause de confidentialité"), maintype="application",
                           subtype="vnd.openxmlformats-officedocument.wordprocessingml.document",
                           filename="contrat.docx")
    message.add_attachment(b"\x89PNG", maintype="image", subtype="png", filename="logo.png")
    rows = {a.row["nom_fichier"]: a.row for a in next(read_messages(bytes(message), "message/rfc822", with_text=True)).attachments}

    assert {"contenu", "statut_contenu"} <= set(ATTACHMENT_COLUMNS)
    assert rows["contrat.docx"]["contenu"] == "Clause de confidentialité"
    assert rows["contrat.docx"]["statut_contenu"] == "extrait"
    assert rows["logo.png"]["contenu"] is None and rows["logo.png"]["statut_contenu"] == "non extrait"


def test_file_text_is_read_only_for_the_attachments_table():
    message = EmailMessage()
    message["From"] = "achats@client.fr"
    message.set_content("Voir pièce jointe.")
    message.add_attachment(b"Bon de commande 42", maintype="text", subtype="plain", filename="bon.txt")
    attachment = next(read_messages(bytes(message), "message/rfc822")).attachments[0]
    assert attachment.row["contenu"] is None and attachment.row["statut_contenu"] == "non extrait"
