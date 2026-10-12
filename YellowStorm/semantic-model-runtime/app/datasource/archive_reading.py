"""What reading an e-mail archive left out or cut, counted per table (never the contents).

The counts travel with the table to the model health report, so a person can see how many attachments
a limit cut, and how many had no text to read (scans, images, formats the reader does not know).
"""

from __future__ import annotations

from collections import Counter

from .email_archive import SHEET_ATTACHMENTS, SHEET_MESSAGES, Message


class ReadingTally:
    """Counts the mails and attachments of an archive as they are read.

    Inline images (logos, signatures) are not counted: they are no attachment a person would look for."""

    def __init__(self) -> None:
        self.messages: Counter[str] = Counter()
        self.attachments: Counter[str] = Counter()

    def add(self, message: Message) -> None:
        anomalies = str(message.row.get("anomalies") or "")
        self.messages["total"] += 1
        # A mail over the size limit is a limit's doing (the admin can raise it); an unreadable one is not.
        self.messages["emlTooLarge"] += int("e-mail trop volumineux" in anomalies)
        self.messages["notRead"] += int("e-mail illisible" in anomalies)
        self.messages["bodyTruncated"] += int("tronqué à" in anomalies)
        for attachment in message.attachments:
            if attachment.inline:
                continue
            reading, content = attachment.status, str(attachment.row.get("statut_contenu") or "")
            self.attachments["total"] += 1
            self.attachments["attachedMails"] += int(attachment.is_email)
            for name, found in (
                ("extracted", content == "extrait"),
                ("truncated", content.startswith("tronqué")),
                ("scanned", content.startswith("sans texte")),
                ("unsupported", reading == "non prise en charge"),
                ("encrypted", reading == "chiffrée"),
                ("tooLarge", reading == "trop volumineuse"),
                ("inflatedTooLarge", content.startswith("trop volumineux une fois")),
                ("unreadable", "illisible" in (reading, content)),
                ("readerMissing", content == "lecteur indisponible"),
            ):
                self.attachments[name] += int(found)

    def summary(self, sheet: str) -> dict[str, int] | None:
        """The non-zero counts of a table; ``None`` for a table that is not counted."""
        counts = {SHEET_MESSAGES: self.messages, SHEET_ATTACHMENTS: self.attachments}.get(sheet)
        return {name: count for name, count in counts.items() if count} if counts else None
