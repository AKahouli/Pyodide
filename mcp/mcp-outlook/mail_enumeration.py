"""Deterministic Outlook mail enumeration.

`search_m365` is a discovery tool: one Microsoft Search page, `from` fixed at 0,
capped at 25 for the `message` entity. It cannot answer "all mail from X". This
module backs the tools that do, on top of the standard Graph List Messages API
(`GET /me/messages`) which pages with `@odata.nextLink`.

Two Graph restrictions shape the design and are handled here rather than left to
the caller:
  - `$filter` string functions are not reliable across tenants, so `sender_domain`
    and `subject` are matched client-side while paging instead of in OData.
  - A page URL travels to the model as an opaque base64 cursor; it is decoded and
    its host checked before use, so a forged cursor cannot redirect a bearer token
    to another origin.
"""

import base64
from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlparse

GRAPH_HOST = "graph.microsoft.com"

MESSAGE_SELECT = (
    "id,conversationId,subject,from,toRecipients,ccRecipients,"
    "receivedDateTime,sentDateTime,hasAttachments,isRead,importance,"
    "bodyPreview,webLink"
)
ATTACHMENT_SELECT = "id,name,contentType,size,isInline"

# Upper bound for the explicit exhaustive mode, so a broad query cannot return an
# unbounded payload. Overridable per call via `max_results`; never a default.
FETCH_ALL_MAX_DEFAULT = 5000
MAX_PAGE_SIZE = 1000
DEFAULT_PAGE_SIZE = 100


def _odata_quote(value: str) -> str:
    return str(value).replace("'", "''")


def normalize_datetime(value: str | None, end_of_day: bool = False) -> str:
    """A date-only `YYYY-MM-DD` becomes a full UTC instant; anything else passes
    through. Graph's `$filter` needs a full ISO 8601 timestamp with a zone."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return f"{raw}T{'23:59:59' if end_of_day else '00:00:00'}Z"
    return raw


def build_filter(
    sender: str | None = None,
    subject: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    has_attachments: bool | None = None,
    unread: bool | None = None,
) -> list[str]:
    """The `$filter` clauses Graph can evaluate server-side, verified against the
    live API. `sender_domain` and `recipients` are NOT here: Graph rejects
    `toRecipients/any(...)` (ErrorInvalidUrlQueryFilter) and has no `endsWith`, so
    those are applied by `client_predicates`.

    No `$orderby` accompanies this on purpose: Exchange rejects any sort together
    with a `from/...` filter as `InefficientFilter` (even with an added date
    clause). Results then come in Graph's default order (observed oldest-first).
    """
    parts: list[str] = []
    if sender:
        parts.append(f"from/emailAddress/address eq '{_odata_quote(sender)}'")
    if subject:
        parts.append(f"contains(subject,'{_odata_quote(subject)}')")
    start = normalize_datetime(date_from)
    if start:
        parts.append(f"receivedDateTime ge {start}")
    end = normalize_datetime(date_to, end_of_day=True)
    if end:
        parts.append(f"receivedDateTime le {end}")
    if has_attachments is not None:
        parts.append(f"hasAttachments eq {str(bool(has_attachments)).lower()}")
    if unread is not None:
        parts.append(f"isRead eq {str(not unread).lower()}")
    return parts


def client_predicates(
    sender_domain: str | None = None, recipients: str | None = None
) -> list[Callable[[dict[str, Any]], bool]]:
    """Filters Graph cannot express, applied to each normalized message."""
    predicates: list[Callable[[dict[str, Any]], bool]] = []
    if sender_domain:
        domain = sender_domain.lower().strip().lstrip("@")
        predicates.append(
            lambda m: (m.get("from", {}).get("address") or "").lower().split("@")[-1]
            == domain
        )
    if recipients:
        wanted = recipients.lower().strip()
        predicates.append(
            lambda m: any(
                (r.get("address") or "").lower() == wanted
                for r in m.get("toRecipients", []) + m.get("ccRecipients", [])
            )
        )
    return predicates


def normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    """The subset of a Graph message an enumerating agent actually needs. `body`
    is intentionally excluded — timeline building must not pull every body."""
    sender = (raw.get("from") or {}).get("emailAddress") or {}

    def recipients(key: str) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for entry in raw.get(key) or []:
            address = (entry or {}).get("emailAddress") or {}
            if address.get("address"):
                out.append(
                    {
                        "name": address.get("name", ""),
                        "address": address.get("address"),
                    }
                )
        return out

    return {
        "id": raw.get("id"),
        "conversationId": raw.get("conversationId"),
        "subject": raw.get("subject") or "",
        "from": {
            "name": sender.get("name", ""),
            "address": sender.get("address", ""),
        },
        "toRecipients": recipients("toRecipients"),
        "ccRecipients": recipients("ccRecipients"),
        "receivedDateTime": raw.get("receivedDateTime"),
        "sentDateTime": raw.get("sentDateTime"),
        "hasAttachments": bool(raw.get("hasAttachments")),
        "isRead": raw.get("isRead"),
        "importance": raw.get("importance"),
        "bodyPreview": raw.get("bodyPreview") or "",
        "webLink": raw.get("webLink") or "",
    }


# The enumeration projection: identity, threading and ordering fields only.
# Recipient lists, body preview and web links dominated the payload (163 KB for
# 72 mail) and made the model under-report the count; get_email returns detail.
ENUMERATION_KEYS = (
    "id",
    "conversationId",
    "subject",
    "from",
    "receivedDateTime",
    "sentDateTime",
    "hasAttachments",
    "isRead",
    "importance",
)


def slim_message(
    message: dict[str, Any], include_preview: bool = False
) -> dict[str, Any]:
    """`normalize_message` trimmed to `ENUMERATION_KEYS` for list responses.

    `include_preview` adds `bodyPreview` (bounded by Graph, ~255 chars): enough
    to summarise a message without a second, id-based `get_emails` call — the
    step where a mis-copied id turns into a hard failure."""
    keys = ENUMERATION_KEYS + (("bodyPreview",) if include_preview else ())
    return {key: message[key] for key in keys if key in message}


def normalize_attachment(raw: dict[str, Any]) -> dict[str, Any]:
    odata_type = raw.get("@odata.type", "")
    return {
        "id": raw.get("id"),
        "filename": raw.get("name") or "attachment",
        "contentType": raw.get("contentType") or "application/octet-stream",
        "size": raw.get("size") or 0,
        "isInline": bool(raw.get("isInline")),
        "type": odata_type.rsplit(".", 1)[-1] if odata_type else "unknown",
    }


def encode_cursor(next_link: str | None) -> str | None:
    """The opaque cursor handed to the model: the real `@odata.nextLink`, base64url
    encoded so the model treats it as a token to pass back, not a URL to edit."""
    if not next_link:
        return None
    return base64.urlsafe_b64encode(next_link.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> str:
    """The URL behind a cursor, or ValueError if it is malformed or points off
    `graph.microsoft.com` — the bearer token must never leave Graph."""
    padded = str(cursor or "").strip()
    if not padded:
        raise ValueError("empty cursor")
    padded += "=" * (-len(padded) % 4)
    try:
        url = base64.urlsafe_b64decode(padded.encode()).decode()
    except Exception as exc:  # binascii.Error, UnicodeDecodeError
        raise ValueError("cursor is not valid base64url") from exc
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != GRAPH_HOST:
        raise ValueError("cursor does not point at Microsoft Graph")
    return url


def parse_iso(value: str | None) -> datetime | None:
    """A Graph timestamp as a sortable datetime, or None when unparseable."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
