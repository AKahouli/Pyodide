"""E-mail archive reader: a .zip of .eml files (or one .eml) read as three tables.

Pure stdlib over explicit bytes. The archive is presented to the tabular
pipeline like a workbook with three sheets, so mapping and population need no
e-mail-specific code:

* ``messages``     one row per e-mail, attached e-mails included
* ``participants`` one row per (e-mail, role, address)
* ``attachments``  one row per attachment part

Message texts and attachment bytes are also exposed (``iter_derived_files``)
so they can be written back to the workspace and indexed like any upload.

Keys are stable: an e-mail is keyed by its Message-ID (by its bytes when it
has none), so re-reading the archive yields the same keys and an e-mail
that appears twice is read once.
"""

from __future__ import annotations

import hashlib
import html
import io
import re
import struct
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Iterator

EMAIL_ARCHIVE_MIMES = {"application/zip", "application/x-zip-compressed"}
EML_MIMES = {"message/rfc822"}

SHEET_MESSAGES = "messages"
SHEET_PARTICIPANTS = "participants"
SHEET_ATTACHMENTS = "attachments"
SHEETS = (SHEET_MESSAGES, SHEET_PARTICIPANTS, SHEET_ATTACHMENTS)

MESSAGE_COLUMNS = [
    "cle_message", "message_id", "objet", "date_envoi", "date_reception",
    "source_date_reception", "adresse_expediteur", "nom_expediteur", "domaine_expediteur",
    "destinataires", "en_reponse_a", "fil", "corps", "corps_complet", "nombre_pieces_jointes",
    "chemin_archive", "cle_message_parent", "anomalies",
]
# Columns an earlier reader produced, and the column that now holds their data.
# A mapping saved against the old name still reads (see ``resolve_column``).
LEGACY_COLUMNS = {"apercu": "corps"}
PARTICIPANT_COLUMNS = ["cle_message", "role", "adresse", "nom_affiche", "domaine"]
ATTACHMENT_COLUMNS = [
    "cle_piece_jointe", "cle_message", "nom_fichier", "type_fichier", "taille",
    "empreinte", "statut_lecture", "integree", "email_joint",
]
COLUMNS = {SHEET_MESSAGES: MESSAGE_COLUMNS, SHEET_PARTICIPANTS: PARTICIPANT_COLUMNS,
           SHEET_ATTACHMENTS: ATTACHMENT_COLUMNS}

# Archive bounds: far above the workbook ones, still finite.
MAX_ARCHIVE_EMAILS = 20000
MAX_ARCHIVE_ENTRIES = 50000
MAX_ARCHIVE_DECOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
MAX_EML_BYTES = 100 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
MAX_NESTING = 3
BODY_CHARS = 100_000

# Formats the workspace indexer reads; anything else is kept but not read.
_INDEXABLE = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/plain": ".txt",
}
_INDEXABLE_EXTENSIONS = {ext: mime for mime, ext in _INDEXABLE.items()}
_ENCRYPTED = {"application/pkcs7-mime", "application/x-pkcs7-mime", "application/pgp-encrypted"}
_SIGNATURES = {"application/pkcs7-signature", "application/x-pkcs7-signature", "application/pgp-signature"}


@dataclass
class Attachment:
    key: str
    filename: str
    content_type: str
    payload: bytes | None
    inline: bool
    is_email: bool
    status: str
    row: dict[str, Any] = field(default_factory=dict)


@dataclass
class Message:
    key: str
    path: str
    row: dict[str, Any]
    participants: list[dict[str, Any]]
    attachments: list[Attachment]
    text: str


# ---------------------------------------------------------------- archive

def _is_eml_entry(name: str) -> bool:
    lowered = name.replace("\\", "/").lower()
    return (lowered.endswith(".eml") and not lowered.startswith("__macosx/")
            and "/__macosx/" not in lowered and not lowered.rsplit("/", 1)[-1].startswith("._"))


def _safe_path(name: str) -> str:
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or ".." in normalized.split("/") or ":" in normalized:
        raise ValueError("archive_path_traversal")
    return normalized


def iter_raw_emails(data: bytes | str | Any, mime_type: str) -> Iterator[tuple[str, bytes]]:
    """Yield ``(path, raw bytes)`` for each .eml of a zip, or the one .eml."""
    if mime_type in EML_MIMES:
        raw = data if isinstance(data, (bytes, bytearray)) else open(data, "rb").read()
        if len(raw) > MAX_EML_BYTES:
            raise ValueError("email_too_large")
        yield "message.eml", bytes(raw)
        return
    if mime_type not in EMAIL_ARCHIVE_MIMES:
        raise ValueError("unsupported_format_for_dataset")
    handle = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    try:
        archive = zipfile.ZipFile(handle)
    except zipfile.BadZipFile as exc:
        raise ValueError("unreadable_source") from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise ValueError("archive_too_many_entries")
        if sum(info.file_size for info in infos) > MAX_ARCHIVE_DECOMPRESSED_BYTES:
            raise ValueError("source_too_large")
        emails = sorted((info for info in infos
                         if not info.is_dir() and _is_eml_entry(info.filename)),
                        key=lambda info: info.filename)
        if not emails:
            raise ValueError("archive_has_no_emails")
        if len(emails) > MAX_ARCHIVE_EMAILS:
            raise ValueError("archive_too_many_emails")
        for info in emails:
            path = _safe_path(info.filename)
            if info.flag_bits & 0x1:
                raise ValueError("archive_encrypted")
            if info.file_size > MAX_EML_BYTES:
                yield path, b""
                continue
            with archive.open(info) as entry:
                raw = entry.read(MAX_EML_BYTES + 1)
            yield path, raw[:MAX_EML_BYTES]


def read_messages(data: bytes | Any, mime_type: str, *, with_payloads: bool = False) -> Iterator[Message]:
    """Parse every e-mail once; copies of one e-mail (same key) are read once."""
    seen: set[str] = set()
    for path, raw in iter_raw_emails(data, mime_type):
        if not raw:
            key = "msg_" + hashlib.sha256(path.encode("utf-8")).hexdigest()[:24]
            yield _unreadable_message(key, path, "e-mail trop volumineux, non lu")
            continue
        key = _message_key(raw)
        if key in seen:
            continue
        seen.add(key)
        yield from _parse(raw, path, key, parent=None, depth=0, seen=seen, with_payloads=with_payloads)


def _message_key(raw: bytes) -> str:
    """From the Message-ID when there is one, so two copies of one e-mail share a key."""
    try:
        headers = BytesParser(policy=policy.default).parsebytes(raw[:256 * 1024], headersonly=True)
        message_id = _clean_id(headers.get("Message-ID"))
    except Exception:
        message_id = None
    if message_id:
        return "msg_" + hashlib.sha256(f"id:{message_id}".encode("utf-8")).hexdigest()[:24]
    return "msg_" + hashlib.sha256(raw).hexdigest()[:24]


def _unreadable_message(key: str, path: str, anomaly: str) -> Message:
    row = {column: None for column in MESSAGE_COLUMNS}
    row.update({"cle_message": key, "chemin_archive": path, "nombre_pieces_jointes": 0,
                "anomalies": anomaly})
    return Message(key, path, row, [], [], "")


# ---------------------------------------------------------------- headers

def _clean_id(value: Any) -> str | None:
    if value is None:
        return None
    found = re.findall(r"<([^<>\s]+)>", str(value))
    if found:
        return found[0].strip().lower()
    text = str(value).strip().strip("<>").strip()
    return text.lower() or None


def _all_ids(value: Any) -> list[str]:
    return [item.strip().lower() for item in re.findall(r"<([^<>\s]+)>", str(value or ""))]


def _iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_date(value: Any, anomalies: list[str], label: str) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(str(value))
    except (TypeError, ValueError, IndexError):
        anomalies.append(f"{label} illisible")
        return None


def _received_date(message: EmailMessage, anomalies: list[str]) -> datetime | None:
    """Top ``Received`` header: the last hop, i.e. when the mailbox got it."""
    for header in message.get_all("Received", []) or []:
        text = str(header)
        if ";" in text:
            moment = _parse_date(text.rsplit(";", 1)[1].strip(), [], "")
            if moment is not None:
                return moment
    return None


def _header(message: EmailMessage, name: str, anomalies: list[str]) -> str | None:
    try:
        value = message.get(name)
    except Exception:
        anomalies.append(f"en-tête {name} illisible")
        return None
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _addresses(message: EmailMessage, name: str, anomalies: list[str]) -> list[tuple[str, str]]:
    try:
        raw = [str(value) for value in message.get_all(name, []) or []]
    except Exception:
        anomalies.append(f"en-tête {name} illisible")
        return []
    result = []
    for display, address in getaddresses(raw):
        address = address.strip().strip("<>").lower()
        if "@" not in address:
            continue
        display = re.sub(r"\s+", " ", display).strip().strip("\"'")
        # Some clients repeat the address as the name ("agara@x.fr" <agara@x.fr>): that is no name.
        if display.strip("<>").lower() == address:
            display = ""
        result.append((display, address))
    return result


def _domain(address: str | None) -> str | None:
    return address.rsplit("@", 1)[1] if address and "@" in address else None


# ---------------------------------------------------------------- bodies

class _TextFromHtml(HTMLParser):
    _BLOCKS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "hr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("script", "style", "head"):
            self.skip += 1
        elif tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "head"):
            self.skip = max(0, self.skip - 1)
        elif tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _TextFromHtml()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:
        return html.unescape(re.sub(r"<[^>]+>", " ", markup))
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()


def _part_text(part: EmailMessage, anomalies: list[str]) -> str | None:
    try:
        content = part.get_content()
    except (LookupError, UnicodeError, AssertionError, ValueError):
        payload = part.get_payload(decode=True) or b""
        anomalies.append("encodage du texte inconnu, lu en latin-1")
        content = payload.decode("latin-1", errors="replace")
    return content if isinstance(content, str) else None


def _body_text(message: EmailMessage, anomalies: list[str]) -> str:
    try:
        part = message.get_body(preferencelist=("plain", "html"))
    except Exception:
        part = None
    if part is None:
        return ""
    content = _part_text(part, anomalies) or ""
    if part.get_content_subtype() == "html":
        content = html_to_text(content)
    return content.replace("\r\n", "\n").replace("\r", "\n").strip()


_QUOTE_STARTS = [
    re.compile(r"^-{2,}\s*(original message|message d'origine|mensaje original|ursprüngliche nachricht)\s*-{2,}", re.I),
    re.compile(r"^_{8,}\s*$"),
    re.compile(r"^(le|on)\s.{3,200}(a écrit|wrote)\s*:?\s*$", re.I),
    re.compile(r"^-{2,}\s*(forwarded message|message transféré)\s*-{2,}", re.I),
]
_HEADER_BLOCK = re.compile(r"^\*?(from|de|von)\s*\*?\s*:", re.I)
_HEADER_FOLLOW = re.compile(r"^\*?(sent|envoyé|date|gesendet|to|à|objet|subject)\s*\*?\s*:", re.I)


def split_new_text(text: str) -> tuple[str, str]:
    """Separate what this e-mail adds from the messages it quotes.

    Cuts at the first reply/forward marker: ``>`` quoted lines, Outlook's
    ``From:/Sent:`` (``De :/Envoyé :``) block, ``Le … a écrit :`` and the
    ``Original Message`` separators.
    """
    lines = text.split("\n")
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        cut = stripped.startswith(">") and all(
            not later.strip() or later.strip().startswith(">") for later in lines[index:index + 3])
        cut = cut or any(pattern.match(stripped) for pattern in _QUOTE_STARTS)
        if not cut and _HEADER_BLOCK.match(stripped):
            following = [later.strip() for later in lines[index + 1:index + 5] if later.strip()]
            cut = any(_HEADER_FOLLOW.match(later) for later in following[:3])
        if cut:
            return "\n".join(lines[:index]).strip(), "\n".join(lines[index:]).strip()
    return text.strip(), ""


# ---------------------------------------------------------------- attachments

def _filename(part: EmailMessage) -> str | None:
    try:
        name = part.get_filename()
    except Exception:
        name = None
    if name:
        return re.sub(r"[\x00-\x1f]", "", str(name)).strip() or None
    return None


def _guess_type(filename: str, declared: str) -> str:
    extension = ("." + filename.rsplit(".", 1)[1].lower()) if "." in filename else ""
    if declared in ("application/octet-stream", "application/x-octet-stream", "") and extension in _INDEXABLE_EXTENSIONS:
        return _INDEXABLE_EXTENSIONS[extension]
    return declared


def _status(content_type: str, payload: bytes | None, filename: str) -> str:
    if payload is None:
        return "illisible"
    if content_type in _ENCRYPTED or filename.lower().endswith((".p7m", ".pgp", ".gpg")):
        return "chiffrée"
    if len(payload) > MAX_ATTACHMENT_BYTES:
        return "trop volumineuse"
    if content_type == "application/pdf" and b"/Encrypt" in payload[:200000]:
        return "chiffrée"
    if content_type in _INDEXABLE or content_type == "message/rfc822":
        return "lue"
    return "non prise en charge"


def _attachment_key(message_key: str, index: int) -> str:
    return "pj_" + hashlib.sha256(f"{message_key}#{index}".encode()).hexdigest()[:24]


def _is_attachment(part: EmailMessage, body_part: EmailMessage | None) -> bool:
    if part is body_part or part.is_multipart():
        return False
    disposition = (part.get_content_disposition() or "").lower()
    if disposition == "attachment":
        return True
    if part.get_content_type() in _SIGNATURES:
        return False
    if _filename(part):
        return True
    return part.get_content_maintype() not in ("text", "multipart") and disposition == "inline"


# ---------------------------------------------------------------- TNEF (winmail.dat)

_TNEF_SIGNATURE = 0x223E9F78
_ATT_ATTACH_REND_DATA = 0x00069002
_ATT_ATTACH_TITLE = 0x00018010
_ATT_ATTACH_DATA = 0x0006800F
_ATT_BODY = 0x0001800C


def read_tnef(data: bytes) -> tuple[list[tuple[str, bytes]], str]:
    """Attachments and plain body of a ``winmail.dat`` (legacy attributes only).

    Returns what could be read; a malformed stream stops the walk without
    raising, so the rest of the e-mail is still read.
    """
    files: list[tuple[str, bytes]] = []
    body = ""
    if len(data) < 6 or struct.unpack_from("<I", data, 0)[0] != _TNEF_SIGNATURE:
        raise ValueError("not_tnef")
    offset = 6
    current: dict[str, Any] | None = None
    while offset + 9 <= len(data):
        attribute = struct.unpack_from("<I", data, offset + 1)[0]
        length = struct.unpack_from("<I", data, offset + 5)[0]
        start = offset + 9
        end = start + length
        if end + 2 > len(data):
            break
        value = data[start:end]
        if attribute == _ATT_ATTACH_REND_DATA:
            current = {"name": None, "data": None}
            files.append(("", b""))
        elif attribute == _ATT_ATTACH_TITLE and current is not None:
            current["name"] = value.split(b"\x00", 1)[0].decode("latin-1").strip()
            files[-1] = (current["name"] or "", files[-1][1])
        elif attribute == _ATT_ATTACH_DATA and current is not None:
            files[-1] = (files[-1][0], bytes(value))
        elif attribute == _ATT_BODY:
            body = value.split(b"\x00", 1)[0].decode("latin-1", errors="replace")
        offset = end + 2
    named = [(name or f"piece-{index + 1}", payload)
             for index, (name, payload) in enumerate(files) if payload]
    return named, body


# ---------------------------------------------------------------- one e-mail

def _parse(raw: bytes, path: str, key: str, *, parent: str | None, depth: int,
           seen: set[str], with_payloads: bool) -> Iterator[Message]:
    anomalies: list[str] = []
    try:
        message: EmailMessage = BytesParser(policy=policy.default).parsebytes(raw)  # type: ignore[assignment]
    except Exception:
        yield _unreadable_message(key, path, "e-mail illisible")
        return
    for defect in getattr(message, "defects", [])[:5]:
        anomalies.append(type(defect).__name__)
    if not message.keys():
        anomalies.append("aucun en-tête")

    # The raw header: the parsed one is emptied when the date is malformed.
    raw_date = next((str(value) for name, value in message.raw_items() if name.lower() == "date"), None)
    sent = _parse_date(raw_date.strip() if raw_date else None, anomalies, "date d'envoi")
    if not (raw_date or "").strip():
        anomalies.append("date d'envoi absente")
    received = _received_date(message, anomalies)
    senders = _addresses(message, "From", anomalies) or _addresses(message, "Sender", anomalies)
    sender_name, sender_address = senders[0] if senders else (None, None)
    if not senders:
        anomalies.append("expéditeur absent")

    participants: list[dict[str, Any]] = []
    seen_roles: set[tuple[str, str]] = set()
    for role, header in (("expéditeur", "From"), ("destinataire", "To"), ("copie", "Cc"),
                         ("copie cachée", "Bcc"), ("répondre à", "Reply-To")):
        for display, address in _addresses(message, header, anomalies):
            if (role, address) in seen_roles:
                continue
            seen_roles.add((role, address))
            participants.append({"cle_message": key, "role": role, "adresse": address,
                                 "nom_affiche": display or None, "domaine": _domain(address)})

    message_id = _clean_id(_header(message, "Message-ID", anomalies))
    in_reply_to = _clean_id(_header(message, "In-Reply-To", anomalies))
    references = _all_ids(_header(message, "References", anomalies))
    thread = references[0] if references else (in_reply_to or message_id)

    text = _body_text(message, anomalies)
    new_text, _quoted = split_new_text(text)

    try:
        body_part = message.get_body(preferencelist=("plain", "html"))
    except Exception:
        body_part = None
    attachments: list[Attachment] = []
    nested: list[tuple[bytes, str]] = []
    index = 0
    for part in _parts(message):
        if part.get_content_type() == "message/rfc822":
            inner = part.get_payload()
            inner_message = inner[0] if isinstance(inner, list) and inner else None
            payload = inner_message.as_bytes(policy=policy.default) if inner_message is not None else None
            index += 1
            filename = _filename(part) or (str(inner_message.get("Subject") or "e-mail joint") + ".eml"
                                           if inner_message is not None else "e-mail joint.eml")
            attachments.append(_attachment(key, index, filename, "message/rfc822", payload,
                                           inline=False, is_email=True, with_payloads=with_payloads))
            if payload and depth < MAX_NESTING:
                nested.append((payload, f"{path}#{index}"))
            continue
        if part is not message and not _is_attachment(part, body_part):
            continue
        filename = _filename(part) or f"piece-{index + 1}"
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            payload = None
        content_type = _guess_type(filename, part.get_content_type())
        inline = (part.get_content_disposition() or "").lower() == "inline" and bool(part.get("Content-ID")) \
            and part.get_content_maintype() == "image"
        if filename.lower() == "winmail.dat" or content_type == "application/ms-tnef":
            try:
                inner_files, tnef_body = read_tnef(payload or b"")
            except ValueError:
                inner_files, tnef_body = [], ""
                anomalies.append("winmail.dat illisible")
            if tnef_body and not new_text:
                new_text = split_new_text(tnef_body.strip())[0]
                text = text or tnef_body.strip()
            for inner_name, inner_payload in inner_files:
                index += 1
                attachments.append(_attachment(key, index, inner_name, _guess_type(inner_name, "application/octet-stream"),
                                               inner_payload, inline=False, is_email=False, with_payloads=with_payloads))
            continue
        index += 1
        attachments.append(_attachment(key, index, filename, content_type, payload,
                                       inline=inline, is_email=False, with_payloads=with_payloads))

    full_body = _bounded_body(text, anomalies, "corps complet")
    # A forward or reply that adds nothing of its own: its body is the quoted message.
    body = _bounded_body(new_text, anomalies, "corps") if new_text.strip() else full_body
    recipients = [p["adresse"] for p in participants if p["role"] in ("destinataire", "copie")]
    row = {
        "cle_message": key,
        "message_id": message_id,
        "objet": _header(message, "Subject", anomalies),
        "date_envoi": _iso(sent),
        "date_reception": _iso(received or sent),
        "source_date_reception": "en-tête Received" if received else ("date d'envoi" if sent else None),
        "adresse_expediteur": sender_address,
        "nom_expediteur": sender_name or None,
        "domaine_expediteur": _domain(sender_address),
        "destinataires": ", ".join(recipients) or None,
        "en_reponse_a": in_reply_to,
        "fil": thread,
        "corps": body,
        "corps_complet": full_body,
        "nombre_pieces_jointes": sum(1 for item in attachments if not item.inline),
        "chemin_archive": path,
        "cle_message_parent": parent,
        "anomalies": "; ".join(dict.fromkeys(anomalies)) or None,
    }
    yield Message(key, path, row, participants, attachments, _message_document(row, new_text, text))

    for payload, nested_path in nested:
        nested_key = _message_key(payload)
        if nested_key in seen:
            continue
        seen.add(nested_key)
        yield from _parse(payload, nested_path, nested_key, parent=key, depth=depth + 1,
                          seen=seen, with_payloads=with_payloads)


def _bounded_body(text: str, anomalies: list[str], label: str) -> str | None:
    """The body as written (line breaks kept), cut at ``BODY_CHARS`` with a note when longer."""
    body = re.sub(r"[ \t]+\n", "\n", text).strip()
    if len(body) > BODY_CHARS:
        anomalies.append(f"{label} tronqué à {BODY_CHARS} caractères")
        body = body[:BODY_CHARS].rstrip() + "…"
    return body or None


def resolve_column(name: str, available: Any) -> str:
    """The column to read for a mapped name: itself, or what replaced it when it is gone."""
    if name in available:
        return name
    replacement = LEGACY_COLUMNS.get(name)
    return replacement if replacement is not None and replacement in available else name


def _parts(message: EmailMessage) -> Iterator[EmailMessage]:
    """Leaf parts and attached e-mails, without descending into attached e-mails."""
    if not message.is_multipart():
        # A message whose whole body is one file (a scanned PDF sent as is) still has an attachment.
        if message.get_content_maintype() not in ("text", "multipart"):
            yield message
        return
    for child in message.get_payload():
        if child.get_content_type() == "message/rfc822" or not child.is_multipart():
            yield child
        else:
            yield from _parts(child)


def _attachment(message_key: str, index: int, filename: str, content_type: str,
                payload: bytes | None, *, inline: bool, is_email: bool,
                with_payloads: bool) -> Attachment:
    key = _attachment_key(message_key, index)
    status = _status(content_type, payload, filename)
    row = {
        "cle_piece_jointe": key,
        "cle_message": message_key,
        "nom_fichier": filename,
        "type_fichier": content_type,
        "taille": len(payload) if payload is not None else None,
        "empreinte": f"sha256:{hashlib.sha256(payload).hexdigest()}" if payload is not None else None,
        "statut_lecture": status,
        "integree": inline,
        "email_joint": is_email,
    }
    return Attachment(key, filename, content_type, payload if with_payloads else None,
                      inline, is_email, status, row)


def _message_document(row: dict[str, Any], new_text: str, full_text: str) -> str:
    """Plain-text rendering indexed in the workspace: headers, new text, then quoted text."""
    lines = [
        f"Objet : {row.get('objet') or ''}",
        f"De : {row.get('nom_expediteur') or ''} <{row.get('adresse_expediteur') or ''}>",
        f"À : {row.get('destinataires') or ''}",
        f"Date d'envoi : {row.get('date_envoi') or ''}",
        f"Date de réception : {row.get('date_reception') or ''}",
        f"Clé du message : {row['cle_message']}",
        "",
        new_text,
    ]
    quoted = full_text[len(new_text):].strip() if full_text.startswith(new_text) else ""
    if quoted:
        lines += ["", "---- Messages cités ----", quoted]
    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------- tables

def iter_sheet_rows(data: bytes | Any, mime_type: str, sheet: str) -> Iterator[dict[str, Any]]:
    if sheet not in SHEETS:
        raise ValueError("sheet_not_found")
    for message in read_messages(data, mime_type):
        if sheet == SHEET_MESSAGES:
            yield message.row
        elif sheet == SHEET_PARTICIPANTS:
            yield from message.participants
        else:
            for attachment in message.attachments:
                yield attachment.row


def selected_sheet(options: dict[str, Any] | None) -> str:
    requested = (options or {}).get("sheetName")
    if requested is None or requested == "":
        return SHEET_MESSAGES
    if requested not in SHEETS:
        raise ValueError("sheet_not_found")
    return requested


@dataclass
class DerivedFile:
    """A file written back to the workspace's derived folder for indexing."""
    file_name: str
    mime_type: str
    payload: bytes
    message_key: str
    attachment_key: str | None


def derived_manifest(data: Any, mime_type: str, output_dir: Any) -> list[dict[str, Any]]:
    """Write every derived file into ``output_dir`` and describe them (sandbox side)."""
    from pathlib import Path

    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = []
    for number, item in enumerate(iter_derived_files(data, mime_type), start=1):
        stored = f"{number:06d}.bin"
        (directory / stored).write_bytes(item.payload)
        manifest.append({"stored": stored, "fileName": item.file_name, "mimeType": item.mime_type,
                         "size": len(item.payload), "sha256": hashlib.sha256(item.payload).hexdigest(),
                         "messageKey": item.message_key, "attachmentKey": item.attachment_key})
    return manifest


def _safe_name(name: str, limit: int = 80) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", name).strip(" .") or "fichier"
    if len(cleaned) <= limit:
        return cleaned
    stem, dot, extension = cleaned.rpartition(".")
    return (stem[:limit - len(extension) - 1] + "." + extension) if dot and len(extension) <= 8 else cleaned[:limit]


def iter_derived_files(data: bytes | Any, mime_type: str) -> Iterator[DerivedFile]:
    """One text file per e-mail plus every readable attachment, with keyed names.

    Names are ``<cle_message>-message.txt`` and
    ``<cle_message>-<cle_piece_jointe>-<name>``: they all go in one folder, and
    a fact found in an indexed file leads back to its e-mail and attachment by
    the name alone.
    """
    for message in read_messages(data, mime_type, with_payloads=True):
        yield DerivedFile(f"{message.key}-message.txt", "text/plain",
                          message.text.encode("utf-8"), message.key, None)
        for attachment in message.attachments:
            if attachment.status != "lue" or attachment.is_email or attachment.payload is None:
                continue
            if attachment.content_type not in _INDEXABLE:
                continue
            name = _safe_name(attachment.filename)
            if not name.lower().endswith(_INDEXABLE[attachment.content_type]):
                name += _INDEXABLE[attachment.content_type]
            yield DerivedFile(f"{message.key}-{attachment.key}-{name}", attachment.content_type,
                              attachment.payload, message.key, attachment.key)


# ---------------------------------------------------------------- preview

PREVIEW_EMAILS = 200


def _count_emails(data: bytes | Any, mime_type: str) -> int:
    if mime_type in EML_MIMES:
        return 1
    handle = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    try:
        with zipfile.ZipFile(handle) as archive:
            return sum(1 for info in archive.infolist() if not info.is_dir() and _is_eml_entry(info.filename))
    except zipfile.BadZipFile as exc:
        raise ValueError("unreadable_source") from exc
    finally:
        if hasattr(handle, "seek"):
            handle.seek(0)


def parse_email_archive_preview(data: bytes | Any, mime_type: str,
                                options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Bounded preview: the first e-mails only, with the full e-mail count from the zip index."""
    from .parsers import SHEET_ROW_KEY, _finalize

    sheet = selected_sheet(options)
    total = _count_emails(data, mime_type)
    if total == 0:
        raise ValueError("archive_has_no_emails")
    rows: dict[str, list[dict[str, Any]]] = {name: [] for name in SHEETS}
    read = 0
    for message in read_messages(data, mime_type):
        read += 1
        rows[SHEET_MESSAGES].append(message.row)
        rows[SHEET_PARTICIPANTS].extend(message.participants)
        rows[SHEET_ATTACHMENTS].extend(attachment.row for attachment in message.attachments)
        if read >= PREVIEW_EMAILS:
            break
    complete = read >= total
    warnings: list[dict[str, str]] = []
    if not complete:
        warnings.append({"code": "email_preview_partial",
                         "message": f"The preview reads the first {read} of {total} e-mails; "
                                    "the full archive is read when the dataset is prepared."})
    records = [{SHEET_ROW_KEY: number, **row} for number, row in enumerate(rows[sheet], start=2)]
    structure = {
        "kind": "email_archive",
        "sheets": [{"name": name, "visible": True,
                    "reportedRows": total if name == SHEET_MESSAGES and complete is False else len(rows[name]),
                    "reportedColumns": len(COLUMNS[name])} for name in SHEETS],
        "selectedSheet": sheet, "headerRow": 1, "columns": COLUMNS[sheet],
        "emailCount": total,
        "dataRows": len(records) if complete else None,
    }
    if isinstance(data, (bytes, bytearray)):
        fingerprint = f"sha256:{hashlib.sha256(data).hexdigest()}"
    else:
        digest = hashlib.sha256()
        data.seek(0)
        for chunk in iter(lambda: data.read(1024 * 1024), b""):
            digest.update(chunk)
        data.seek(0)
        fingerprint = f"sha256:{digest.hexdigest()}"
    result = _finalize(COLUMNS[sheet], records, warnings, len(records), complete, records, structure)
    result["warnings"] = [w for w in result["warnings"] if w["code"] != "scan_capped"]
    return {"contentFingerprint": fingerprint, **result}
