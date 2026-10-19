"""
Outlook/Calendar MCP Server

Provides MCP tools to interact with Microsoft Outlook (email) and Calendar
using Microsoft Graph API. Includes email sending, user lookup, and meeting creation.

Authentication is injected at runtime via the Authorization header or environment
variables by the connector auth layer. This server is fully stateless — it does
not read or write any local token files.
"""

import asyncio
import base64
import html
import json
import os
import sys
from datetime import datetime, timezone
from typing import Literal, Mapping, Optional
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth import AuthMiddleware

import mail_export
from mail_enumeration import (
    ATTACHMENT_SELECT,
    DEFAULT_PAGE_SIZE,
    FETCH_ALL_MAX_DEFAULT,
    MAX_PAGE_SIZE,
    MESSAGE_SELECT,
    build_filter,
    client_predicates,
    decode_cursor,
    encode_cursor,
    normalize_attachment,
    normalize_message,
    slim_message,
)

# Import local helpers (fully independent project)
from graph_helpers import (
    _request_conversation_id,
    _request_user_id,
    AttachmentError,
    GRAPH_BASE,
    MAIL_ATTACH_MAX_BYTES,
    as_byte_attachment,
    build_message_attachments,
    fetch_storage_object,
    get_request_user_id,
    graph_headers,
    invite_recipients,
    logger,
    parse_attachments,
    put_in_chunks,
    put_storage_object,
    run_storage_key,
    share_id_for_url,
    split_bytes_by_message_budget,
    stat_storage_object,
    storage_key_owner,
    system_workspace_prefix,
    upload_to_onedrive,
)

# Generated files too large to attach land here in the sender's OneDrive, then
# get shared with the recipients. A dedicated folder keeps them out of the way.
ONEDRIVE_FOLDER = os.getenv("MAIL_ATTACH_ONEDRIVE_FOLDER", "Email Attachments")

load_dotenv()

mcp = FastMCP("Outlook/Calendar Connector")


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


# ---------------------------------------------------------------------------
# Graph HTTP resilience
# ---------------------------------------------------------------------------

# Graph throttles reads per mailbox: a burst of parallel calls (a $batch of
# message gets, several attachment listings) trips 429 / MailboxConcurrency.
# Retrying with the Retry-After the server asks for is the difference between
# "content not retrieved" and a complete answer.
GRAPH_RETRY_STATUSES = frozenset({429, 503, 504})
GRAPH_MAX_ATTEMPTS = 4
GRAPH_MAX_WAIT_SECONDS = 30.0
# Sub-requests per $batch. Graph's ceiling is 20, but 20 parallel mailbox reads
# is exactly what trips the concurrency limit; 5 stays comfortably under it.
GRAPH_BATCH_SIZE = 5
# Strings longer than this are truncated by the platform, so a long Markdown table
# is returned as a list of chunks rather than one blob.
MARKDOWN_INLINE_MAX = 18_000


def _retry_after_seconds(headers: Mapping[str, str], fallback: float) -> float:
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw:
        try:
            return max(0.0, min(float(raw), GRAPH_MAX_WAIT_SECONDS))
        except (TypeError, ValueError):
            pass
    return fallback


async def _graph_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: dict,
    params: Optional[dict] = None,
    json: Optional[dict] = None,
    timeout: float = 60.0,
    attempts: int = GRAPH_MAX_ATTEMPTS,
) -> httpx.Response:
    """A Graph request that honours throttling: retry on 429/503/504, waiting the
    Retry-After the response asks for, else an exponential backoff. The last
    response is returned either way, so callers keep their status checks."""
    delay = 1.0
    response: Optional[httpx.Response] = None
    for attempt in range(1, attempts + 1):
        response = await client.request(
            method, url, headers=headers, params=params, json=json, timeout=timeout
        )
        if response.status_code not in GRAPH_RETRY_STATUSES or attempt == attempts:
            return response
        await asyncio.sleep(_retry_after_seconds(response.headers, delay))
        delay = min(delay * 2, GRAPH_MAX_WAIT_SECONDS)
    return response  # pragma: no cover - the loop always returns


def _graph_error_hint(status_code: Optional[int], body: str) -> Optional[str]:
    """Turn a raw Graph error into something the agent can act on. The common
    failure when reading many messages is an id the model re-typed incorrectly:
    Graph can only say `Id is malformed`, so spell out the likely cause."""
    text = body or ""
    if "ErrorInvalidIdMalformed" in text or "Id is malformed" in text:
        return (
            "the message id is malformed and matches no message — it was most "
            "likely altered when copied. Re-read the `id` verbatim from a "
            "search_emails item (or a search_m365 hitId) and retry."
        )
    if status_code == 429 or "ApplicationThrottled" in text or "MailboxConcurrency" in text:
        return (
            "the mailbox is temporarily throttled (too many concurrent reads). "
            "Wait a few seconds and retry with fewer messages per call."
        )
    return None


def _graph_error_payload(response: httpx.Response, prefix: str = "") -> dict:
    payload: dict = {
        "status": "error",
        "message": f"{prefix}Graph returned {response.status_code}: {response.text[:300]}",
    }
    hint = _graph_error_hint(response.status_code, response.text)
    if hint:
        payload["hint"] = hint
    return payload


# ---------------------------------------------------------------------------
# Outlook Email Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_users(query: Optional[str] = None) -> str:
    """
    List or search users in the organization.

    Args:
        query: Optional search query (starts with name or email)

    Returns:
        JSON string containing list of users
    """
    try:
        url = f"{GRAPH_BASE}/users"
        params = {"$select": "id,displayName,mail,userPrincipalName", "$top": 20}

        headers = graph_headers()
        if query:
            params["$search"] = f'"displayName:{query}" OR "mail:{query}"'
            headers["ConsistencyLevel"] = "eventual"

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

        return json.dumps(
            {"status": "success", "users": data.get("value", [])}, indent=2
        )
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def send_email(
    to_recipients: list[str],
    subject: str,
    body: str,
    cc_recipients: Optional[list[str]] = None,
    bcc_recipients: Optional[list[str]] = None,
    importance: str = "normal",
    attachments: Optional[list[dict]] = None,
) -> str:
    """
    Send an email via Microsoft Outlook, optionally with files attached.

    Args:
        to_recipients: List of recipient email addresses
        subject: Email subject
        body: Email body (HTML supported)
        cc_recipients: Optional list of CC recipient email addresses
        bcc_recipients: Optional list of BCC recipient email addresses
        importance: Email importance (low, normal, high)
        attachments: Optional list of files. Each entry needs a `filename`,
            an optional `content_type`, and EXACTLY ONE source of the file:
              - `content_base64`: the file's bytes, base64-encoded — use this for
                something small you generated inline.
              - `storage_key`: a reference to a file already in storage (e.g. the
                key download_mail_attachments returned). The bytes are fetched
                server-side, so this is the way to attach anything large.
            You never choose how the file is delivered — the server does that from
            its real size: small files ride along as real attachments; a file too
            large to attach is uploaded to OneDrive, shared with the recipients,
            and its link is added to the message body automatically.

    Returns:
        JSON string with the result

    Examples:
        - send_email(["user@example.com"], "Meeting Notes", "<p>Here are the notes...</p>")
        - send_email(["user@example.com"], "Report", "<p>Attached.</p>",
                     attachments=[{"filename": "q3.pdf", "content_base64": "JVBER...",
                                   "content_type": "application/pdf"}])
        - send_email(["user@example.com"], "Deck", "<p>See attached.</p>",
                     attachments=[{"filename": "deck.pptx", "storage_key": "<user>/…/deck.pptx"}])
    """
    try:
        headers = graph_headers()
        try:
            parsed = parse_attachments(attachments)
        except AttachmentError as exc:
            # Caller error, not a Graph failure — say which file and why, so the
            # next attempt can be corrected rather than retried blindly.
            logger.info("send_email: attachment parse rejected: %s", exc)
            return json.dumps({"status": "error", "message": str(exc)}, indent=2)

        logger.info(
            "send_email: to=%s parsed_attachments=%s user_id=%s",
            to_recipients,
            [(e["name"], e["kind"]) for e in parsed],
            get_request_user_id(),
        )

        async with httpx.AsyncClient() as client:
            # Resolve each file to bytes (storage_key bytes are fetched here,
            # server-side, so they never travel through the caller) and route by
            # REAL size: small -> a real attachment; too large to deliver as one
            # -> OneDrive, shared with the recipients, link appended to the body.
            byte_attachments: list[dict] = []
            sharepoint_files: list[dict] = []
            for entry in parsed:
                if entry["kind"] == "storage":
                    problem = _authorize_storage(entry)
                    if problem:
                        return problem
                    try:
                        raw, ctype = await asyncio.to_thread(
                            fetch_storage_object, entry["storage_key"]
                        )
                    except AttachmentError as exc:
                        return json.dumps(
                            {"status": "error", "message": str(exc)}, indent=2
                        )
                    if entry["content_type"] != "application/octet-stream":
                        ctype = entry["content_type"]
                    resolved = as_byte_attachment(entry["name"], raw, ctype)
                else:
                    resolved = entry

                size = len(resolved["raw"])
                if size <= MAIL_ATTACH_MAX_BYTES:
                    byte_attachments.append(resolved)
                    logger.info(
                        "send_email: %r %d bytes <= %d -> attach",
                        resolved["name"], size, MAIL_ATTACH_MAX_BYTES,
                    )
                else:
                    sharepoint_files.append(resolved)
                    logger.info(
                        "send_email: %r %d bytes > %d -> OneDrive share",
                        resolved["name"], size, MAIL_ATTACH_MAX_BYTES,
                    )

            inline, upload = split_bytes_by_message_budget(byte_attachments)

            # Files too large to attach: upload to OneDrive, share only with the
            # recipients, and add their links to the body.
            shared: list[dict] = []
            if sharepoint_files:
                recipients = [
                    *to_recipients,
                    *(cc_recipients or []),
                    *(bcc_recipients or []),
                ]
                for f in sharepoint_files:
                    item = await upload_to_onedrive(
                        client, headers, ONEDRIVE_FOLDER, f["name"], f["raw"]
                    )
                    if item.get("id"):
                        await invite_recipients(client, headers, item["id"], recipients)
                    if item.get("webUrl"):
                        shared.append({"name": f["name"], "webUrl": item["webUrl"]})

            body = body + _shared_links_html(shared)
            message: dict = {
                "subject": subject,
                "body": {"contentType": "HTML", "content": body},
                "toRecipients": [
                    {"emailAddress": {"address": email}} for email in to_recipients
                ],
                "importance": importance,
            }
            if cc_recipients:
                message["ccRecipients"] = [
                    {"emailAddress": {"address": email}} for email in cc_recipients
                ]
            if bcc_recipients:
                message["bccRecipients"] = [
                    {"emailAddress": {"address": email}} for email in bcc_recipients
                ]

            built = build_message_attachments(inline)
            if built:
                message["attachments"] = built

            # Nothing sendMail cannot carry: one request, as before.
            if not upload:
                response = await client.post(
                    f"{GRAPH_BASE}/me/sendMail",
                    headers=headers,
                    json={"message": message},
                    timeout=60.0,
                )
                if response.status_code not in [200, 202]:
                    return json.dumps(
                        {
                            "status": "error",
                            "message": f"Failed to send email: {response.text}",
                        },
                        indent=2,
                    )
                result = {"status": "success", "message": "Email sent successfully"}
                # Only when something actually happened to a file: a plain text
                # email should read exactly as it always did.
                if inline or shared:
                    result["attachments"] = _attachment_summary(inline, [], shared)
                return json.dumps(result, indent=2)

            # sendMail cannot carry this message: an upload session attaches to
            # a message id, so the message has to exist as a draft first.
            return await _send_as_draft(client, headers, message, inline, upload, shared)

    except Exception as e:
        logger.exception("send_email: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


def _authorize_storage(entry: dict) -> Optional[str]:
    """Refuse a storage_key we cannot prove belongs to the caller. Returns an
    error-JSON string to return, or None if the key is the caller's own.

    The key is `<user_id>/…`, and the caller's id arrives out-of-band in the
    X-user-id header (never from the model), so a model cannot pass someone
    else's key to read their file. If the header is absent we FAIL CLOSED rather
    than read an unverifiable key."""
    user_id = get_request_user_id()
    name = entry["name"]
    if not user_id:
        logger.info("send_email: %r storage_key refused — no X-user-id on request", name)
        return json.dumps(
            {
                "status": "error",
                "message": f"{name}: cannot verify ownership of a storage_key "
                "(no X-user-id on this request)",
            },
            indent=2,
        )
    if storage_key_owner(entry["storage_key"]) != user_id:
        logger.info(
            "send_email: %r storage_key owner=%r != caller=%r — refused",
            name, storage_key_owner(entry["storage_key"]), user_id,
        )
        return json.dumps(
            {"status": "error", "message": f"{name}: storage_key does not belong to you"},
            indent=2,
        )
    return None


def _shared_links_html(shared: list[dict]) -> str:
    """An HTML block listing files shared via OneDrive, appended to the body when
    something was too large to attach. Empty when nothing was shared."""
    if not shared:
        return ""
    items = "".join(
        f'<li><a href="{html.escape(s["webUrl"])}">{html.escape(s["name"])}</a></li>'
        for s in shared
    )
    return (
        "<hr><p>The following file(s) were too large to attach and have been "
        f"shared with you on OneDrive:</p><ul>{items}</ul>"
    )


@mcp.tool()
async def search_m365(
    entity_type: Literal[
        "drive", "driveItem", "list", "listItem", "chatMessage", "message"
    ],
    query: str,
    size: int = 25,
) -> str:
    """
    Search Microsoft 365 data using Microsoft Graph Search API.

    Discovery only. This returns ONE Microsoft Search page: `from` is fixed at 0
    and the `message` entity is capped at 25 hits, so it can never list "all mail
    from X". For enumeration use `search_emails`, which pages through every result.

    Args:
        entity_type: Type of entity to search (drive, driveItem, list, listItem, chatMessage, message)
        query: Search query string (supports KQL - Keyword Query Language)
        size: Number of results to return (default: 25, max: 1000)

    Returns:
        JSON string containing search results

    Examples:
        - search_m365("message", "contoso")
        - search_m365("message", "subject:meeting")
        - search_m365("driveItem", "report", size=50)
    """
    try:
        search_request = {
            "requests": [
                {
                    "entityTypes": [entity_type],
                    "query": {"queryString": query},
                    "from": 0,
                    "size": min(size, 1000),
                }
            ]
        }

        async with httpx.AsyncClient() as client:
            response = await _graph_request(
                client,
                "POST",
                f"{GRAPH_BASE}/search/query",
                headers=graph_headers(),
                json=search_request,
                timeout=30.0,
            )

        if response.status_code != 200:
            payload: dict = {
                "status": "error",
                "error": "graph_api_error",
                "status_code": response.status_code,
                "message": f"Microsoft Graph API error: {response.status_code}",
            }
            hint = _graph_error_hint(response.status_code, response.text)
            if hint:
                payload["hint"] = hint
            try:
                payload["details"] = response.json()
            except Exception:
                payload["details"] = response.text[:500]
            return json.dumps(payload, indent=2)

        return json.dumps(
            {
                "status": "success",
                "entity_type": entity_type,
                "query": query,
                "results": response.json(),
            },
            indent=2,
        )

    except Exception as e:
        return json.dumps(
            {"status": "error", "error": "unexpected_error", "message": str(e)},
            indent=2,
        )


def _attachment_summary(
    inline: list[dict], upload: list[dict], shared: list[dict]
) -> dict:
    """Which route each file took — the caller cannot see this otherwise, and it
    is the first thing worth knowing when a recipient reports a missing file."""
    return {
        "inline": [a["name"] for a in inline],
        "uploaded": [a["name"] for a in upload],
        "sharedOnOneDrive": [s["name"] for s in shared],
    }


async def _send_as_draft(
    client: httpx.AsyncClient,
    headers: dict,
    message: dict,
    inline: list[dict],
    upload: list[dict],
    shared: list[dict],
) -> str:
    """Draft -> upload each large attachment in chunks against the message id -> send.

    sendMail cannot carry a file over the inline limit, so it goes as a draft
    plus a createUploadSession per attachment, then the draft is sent.

    A failure part way through leaves a draft holding whatever attached so far,
    so the draft is deleted before returning: a half-attached message sitting in
    Drafts is worse than no message, because nothing signals it is incomplete.
    """
    draft = await client.post(
        f"{GRAPH_BASE}/me/messages", headers=headers, json=message, timeout=60.0
    )
    if draft.status_code not in (200, 201):
        return json.dumps(
            {"status": "error", "message": f"Failed to create draft: {draft.text}"},
            indent=2,
        )
    message_id = draft.json().get("id")

    try:
        for attachment in upload:
            raw = attachment["raw"]
            session = await client.post(
                f"{GRAPH_BASE}/me/messages/{message_id}/attachments/createUploadSession",
                headers=headers,
                json={
                    "AttachmentItem": {
                        "attachmentType": "file",
                        "name": attachment["name"],
                        "size": len(raw),
                        "contentType": attachment["content_type"],
                    }
                },
                timeout=60.0,
            )
            if session.status_code not in (200, 201):
                raise RuntimeError(
                    f"{attachment['name']}: could not open an upload session: {session.text}"
                )
            await put_in_chunks(client, session.json()["uploadUrl"], raw)

        sent = await client.post(
            f"{GRAPH_BASE}/me/messages/{message_id}/send", headers=headers, timeout=60.0
        )
        if sent.status_code not in (200, 202):
            raise RuntimeError(f"failed to send the draft: {sent.text}")
    except Exception as exc:
        await client.delete(
            f"{GRAPH_BASE}/me/messages/{message_id}", headers=headers, timeout=30.0
        )
        return json.dumps(
            {"status": "error", "message": f"Failed to send email: {exc}"}, indent=2
        )

    return json.dumps(
        {
            "status": "success",
            "message": "Email sent successfully",
            "attachments": _attachment_summary(inline, upload, shared),
        },
        indent=2,
    )


async def _attachment_bytes(
    client: httpx.AsyncClient, headers: dict, attachment: dict
) -> tuple[bytes, str]:
    """The bytes of one Graph attachment, whichever shape it arrived in.

    Raises AttachmentError for a kind that has no file bytes at all (an embedded
    message or event), so the caller can report it as skipped rather than failed.
    """
    odata_type = attachment.get("@odata.type", "")
    name = attachment.get("name") or "attachment"
    content_type = attachment.get("contentType") or "application/octet-stream"

    if odata_type.endswith("fileAttachment"):
        encoded = attachment.get("contentBytes") or ""
        if not encoded:
            raise AttachmentError(f"{name}: Graph returned no contentBytes")
        return base64.b64decode(encoded), content_type

    if odata_type.endswith("referenceAttachment"):
        # A cloud attachment is a link, not bytes. Resolve the link to a driveItem,
        # then fetch its pre-authorized download URL WITHOUT the bearer token —
        # that URL carries its own auth and Graph rejects a second credential.
        url = attachment.get("sourceUrl") or ""
        if not url:
            raise AttachmentError(f"{name}: reference attachment has no sourceUrl")
        item = await _graph_request(
            client,
            "GET",
            f"{GRAPH_BASE}/shares/{share_id_for_url(url)}/driveItem",
            headers=headers,
            timeout=30.0,
        )
        if item.status_code != 200:
            raise AttachmentError(
                f"{name}: cannot open the shared link ({item.status_code}): {item.text[:200]}"
            )
        item_data = item.json()
        download_url = item_data.get("@microsoft.graph.downloadUrl")
        if not download_url:
            raise AttachmentError(f"{name}: shared item exposes no download URL")
        got = await _graph_request(client, "GET", download_url, headers={}, timeout=300.0)
        if got.status_code != 200:
            raise AttachmentError(f"{name}: download failed ({got.status_code})")
        return got.content, (item_data.get("file") or {}).get("mimeType") or content_type

    raise AttachmentError(f"{name}: {odata_type or 'unknown kind'} carries no file")


async def _attachment_report(
    client: httpx.AsyncClient, headers: dict, message_id: str, extract: bool
) -> tuple[list[str], list[str]]:
    """A message's attachment names, and — when asked — the first page of each.

    Used by the CSV export. Reference links and inline images are already handled
    by `_attachment_bytes`; anything it cannot read is left out rather than
    aborting the whole export."""
    listing = await _get_message_attachments(client, headers, message_id)
    if listing.status_code != 200:
        return [], []
    names: list[str] = []
    pages: list[str] = []
    for attachment in listing.json().get("value", []):
        if attachment.get("isInline"):
            continue
        name = attachment.get("name") or "attachment"
        names.append(name)
        if not extract:
            continue
        try:
            raw, content_type = await _attachment_bytes(client, headers, attachment)
        except AttachmentError:
            continue
        # A Word file is rendered with LibreOffice, which is blocking; keep it off
        # the event loop so other requests keep flowing during the conversion.
        page = await asyncio.to_thread(
            mail_export.first_page_of, raw, content_type, name
        )
        if page:
            pages.append(f"[{name}]\n{page}")
    return names, pages


async def _get_message_attachments(
    client: httpx.AsyncClient, headers: dict, message_id: str, select: Optional[str] = None
) -> httpx.Response:
    """The raw attachment listing for a message. Shared so the read-only
    `list_mail_attachments` and the downloading tool never diverge on the URL.

    `select` is passed by the read-only listing only: the downloader must keep
    Graph's default projection, which carries `contentBytes`."""
    return await _graph_request(
        client,
        "GET",
        f"{GRAPH_BASE}/me/messages/{message_id}/attachments",
        headers=headers,
        params={"$select": select} if select else None,
    )


# A Graph message id is a ~150-character opaque string. When a model re-types one
# it can silently drop a run of characters, and Graph then answers
# ErrorInvalidIdMalformed — the failure behind "content not retrieved". These
# selector fields let every read tool resolve the message server-side from the
# same filters search_emails uses, so the model never has to copy an id at all.
_SELECTOR_SCAN_CAP = 2000


async def _resolve_messages(
    client: httpx.AsyncClient,
    headers: dict,
    *,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
    match: str = "newest",
    limit: int = 25,
) -> list[dict]:
    """Resolve a message selector to concrete messages, server-side.

    `match="newest"` returns only the most recent match; `match="all"` returns up
    to `limit` matches, oldest first. An empty list means the selector matched
    nothing. Graph returns oldest-first with no sortable order here, so results
    are ordered in Python; that is why the whole (capped) set is scanned."""
    filter_parts = build_filter(sender, subject, date_from, date_to, has_attachments, None)
    url: Optional[str] = (
        f"{GRAPH_BASE}/me/mailFolders/{quote(folder_id, safe='')}/messages"
        if folder_id
        else f"{GRAPH_BASE}/me/messages"
    )
    # Page in chunks of at least 100 so "newest" does not walk the mailbox one
    # message at a time; `limit` still caps what is returned.
    page_top = min(MAX_PAGE_SIZE, max(int(limit), 100))
    params: Optional[dict] = {
        "$select": MESSAGE_SELECT,
        "$top": str(page_top),
    }
    if filter_parts:
        params["$filter"] = " and ".join(filter_parts)

    scan_cap = max(limit, _SELECTOR_SCAN_CAP) if match == "newest" else limit
    collected: list[dict] = []
    while url and len(collected) < scan_cap:
        page = await _fetch_page(client, headers, url, params)
        params = None
        collected.extend(normalize_message(m) for m in page.get("value", []))
        url = page.get("@odata.nextLink")

    collected.sort(key=lambda m: m.get("receivedDateTime") or "")
    if match == "newest":
        return collected[-1:]
    return collected[:limit]


def _selector_given(**fields: Optional[object]) -> bool:
    return any(value is not None and value != "" for value in fields.values())


@mcp.tool()
async def download_mail_attachments(
    message_id: Optional[str] = None,
    filenames: Optional[list[str]] = None,
    message_ids: Optional[list[str]] = None,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
    match: str = "all",
    limit: int = 25,
) -> str:
    """Download one or more messages' attachments into this run's storage folder.

    Use this to get files out of email and into the code sandbox: the folder this
    writes to is mounted in the sandbox, so a downloaded file is readable there as
    /mnt/workspace/system_<run>/<filename> with no further step. The returned
    `storage_key` for each file is also what send_email accepts, so a downloaded
    file can be re-sent without ever passing its bytes through you.

    Prefer the SELECTOR (sender/subject/date_from/date_to/has_attachments) over raw
    ids: a Graph id is a ~150-character string and a re-typed one is often rejected
    as malformed, whereas a selector is resolved server-side. One call can take
    every attachment you need, e.g.
    `download_mail_attachments(sender="john@sony.com", has_attachments=True, match="all")`.

    The code-interpreter sandbox snapshots this folder when it is created: a file
    written afterwards is NOT visible inside a sandbox that already exists. So
    download every attachment you need with one call BEFORE creating the sandbox.

    Handles both attachment kinds: a normal attached file, and a cloud/"shared
    from OneDrive" link. Inline images (signatures and the like) are skipped,
    as are embedded messages and calendar events, which are not files.

    Args:
        message_id / message_ids: Exact message ids, when you already hold them
            verbatim.
        filenames: Optional — download only these attachment names. Omit to take
            every file attached to each message.
        sender, subject, date_from, date_to, has_attachments, folder_id: Selector
            resolved with the same filters as search_emails.
        match: With a selector, "all" (default) takes every match up to `limit`;
            "newest" takes only the most recent one.
        limit: Max messages a selector may resolve (default 25).

    Downloading does not show the file to the user. To hand one over, call
    send_file_to_user with the `storage_key` returned here.

    Returns:
        JSON with one entry per downloaded file (`message_id`, `subject`,
        `receivedDateTime`, `filename`, `storage_key`, `sandbox_path`, `size`),
        plus anything skipped or failed and why.

    Examples:
        - download_mail_attachments(sender="john@sony.com", has_attachments=True, match="all")
        - download_mail_attachments("AAMkAG...")
        - download_mail_attachments(message_ids=["AAMkAG...", "AAMkAH..."])
    """
    try:
        folder = system_workspace_prefix()
        if not folder:
            # No run folder means no mounted destination — writing anywhere else
            # would silently produce a file the sandbox can never read.
            return json.dumps(
                {
                    "status": "error",
                    "message": "cannot resolve this run's storage folder "
                    "(missing X-user-id or x-conversation-id/x-execution-id on this request)",
                },
                indent=2,
            )

        wanted = {n.strip() for n in (filenames or []) if n and n.strip()}
        headers = graph_headers()

        resolved: list[dict] = []
        for candidate in [message_id, *(message_ids or [])]:
            candidate = (candidate or "").strip()
            if candidate and all(candidate != r["id"] for r in resolved):
                resolved.append({"id": candidate, "subject": None, "receivedDateTime": None})

        downloaded: list[dict] = []
        skipped: list[dict] = []
        failed: list[dict] = []
        async with httpx.AsyncClient() as client:
            if not resolved and _selector_given(
                sender=sender,
                subject=subject,
                date_from=date_from,
                date_to=date_to,
                has_attachments=has_attachments,
                folder_id=folder_id,
            ):
                found = await _resolve_messages(
                    client,
                    headers,
                    sender=sender,
                    subject=subject,
                    date_from=date_from,
                    date_to=date_to,
                    has_attachments=has_attachments,
                    folder_id=folder_id,
                    match=match,
                    limit=max(1, int(limit or 25)),
                )
                resolved = [
                    {
                        "id": m.get("id"),
                        "subject": m.get("subject"),
                        "receivedDateTime": m.get("receivedDateTime"),
                    }
                    for m in found
                ]

            if not resolved:
                return json.dumps(
                    {
                        "status": "error",
                        "message": "provide message_id/message_ids, or a selector "
                        "(sender/subject/date_from/date_to/has_attachments)",
                    },
                    indent=2,
                )

            for target in resolved:
                mid = target["id"]
                listing = await _get_message_attachments(client, headers, mid)
                if listing.status_code != 200:
                    entry: dict = {
                        "message_id": mid,
                        "subject": target["subject"],
                        "error": f"could not list attachments: Graph {listing.status_code}",
                    }
                    hint = _graph_error_hint(listing.status_code, listing.text)
                    if hint:
                        entry["hint"] = hint
                    failed.append(entry)
                    continue

                for attachment in listing.json().get("value", []):
                    name = attachment.get("name") or "attachment"
                    if attachment.get("isInline"):
                        skipped.append(
                            {"message_id": mid, "filename": name, "reason": "inline content, not a file"}
                        )
                        continue
                    if wanted and name not in wanted:
                        continue
                    try:
                        raw, content_type = await _attachment_bytes(client, headers, attachment)
                    except AttachmentError as exc:
                        skipped.append(
                            {"message_id": mid, "filename": name, "reason": str(exc)}
                        )
                        continue

                    storage_key = f"{folder}/{name}"
                    await asyncio.to_thread(put_storage_object, storage_key, raw, content_type)
                    downloaded.append(
                        {
                            "message_id": mid,
                            "subject": target["subject"],
                            "receivedDateTime": target["receivedDateTime"],
                            "filename": name,
                            "storage_key": storage_key,
                            "sandbox_path": f"/mnt/workspace/{folder.split('/')[-1]}/{name}",
                            "size": len(raw),
                            "content_type": content_type,
                        }
                    )

        missing = sorted(wanted - {f["filename"] for f in downloaded})
        logger.info(
            "download_mail_attachments: messages=%s downloaded=%s skipped=%s failed=%s missing=%s",
            [r["id"] for r in resolved],
            [f["filename"] for f in downloaded],
            [s["filename"] for s in skipped],
            [f["error"] for f in failed],
            missing,
        )
        result = {"status": "success", "folder": folder, "files": downloaded}
        if skipped:
            result["skipped"] = skipped
        if failed:
            result["failed"] = failed
        if missing:
            result["not_found"] = missing
        return json.dumps(result, indent=2)

    except Exception as e:
        logger.exception("download_mail_attachments: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def send_file_to_user(ceph_path: str) -> str:
    """Deliver a file to the user, who then sees and downloads it in the chat.

    Files this connector touches are invisible to the user until this tool is
    called for them — sending is a separate act from fetching. Call it once per
    file, only for the files the user actually asked for.

    The file must already be in this run's storage, and download_mail_attachments
    is what puts it there. A message id or an attachment name cannot be sent, so
    download first, then send the `storage_key` that came back for each file.

    Args:
        ceph_path: The `storage_key` download_mail_attachments returned for the
            file, e.g. "42/system_abc/cv_dupont.pdf". The `sandbox_path` it
            returned for the same file works too.

    Returns:
        JSON confirming the delivery, carrying the `ceph_path` of the file that
        was sent.

    Examples:
        - send_file_to_user("42/system_abc/cv_dupont.pdf")
    """
    try:
        folder = system_workspace_prefix()
        if not folder:
            return json.dumps(
                {
                    "status": "error",
                    "message": "cannot resolve this run's storage folder "
                    "(missing X-user-id or x-conversation-id/x-execution-id on this request)",
                },
                indent=2,
            )
        key = run_storage_key(ceph_path, folder)
        if not key:
            return json.dumps(
                {
                    "status": "error",
                    "message": f"'{ceph_path}' is not a file from this run — pass the "
                    "storage_key download_mail_attachments returned for it",
                },
                indent=2,
            )
        stored = await asyncio.to_thread(stat_storage_object, key)
        if stored is None:
            return json.dumps(
                {
                    "status": "error",
                    "message": f"nothing stored at '{key}' — download the file with "
                    "download_mail_attachments before sending it",
                },
                indent=2,
            )
        filename = key.rsplit("/", 1)[-1]
        logger.info("send_file_to_user: key=%r size=%s", key, stored["size"])
        # `ceph_path` at the top level is what makes the file appear in the
        # conversation: the agent runtime keys its file detection on that field,
        # and reads `path` for the name it shows.
        return json.dumps(
            {
                "status": "success",
                "ceph_path": key,
                "path": key,
                "filename": filename,
                "size": stored["size"],
                "message": f"{filename} was sent to the user.",
            },
            indent=2,
        )
    except Exception as e:
        logger.exception("send_file_to_user: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Mail enumeration tools (standard Graph List Messages, not Search)
#
# `search_m365` above answers "which mail mentions X" with one capped Search
# page. These tools answer "every mail from Y", which needs the List Messages
# API and its `@odata.nextLink` pagination. Keep the two roles separate.
# ---------------------------------------------------------------------------

FOLDER_SELECT = (
    "id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount"
)
# The exhaustive mode's ceiling when the caller does not pass `max_results`.
FETCH_ALL_MAX = FETCH_ALL_MAX_DEFAULT


def _message_params(filter_parts: list[str], page_size: int) -> dict[str, str]:
    # No `$orderby`: Exchange answers `InefficientFilter` for any sort combined
    # with a `from/...` filter, even with an added date clause. Results come in
    # Graph's default order (observed oldest-first, stable across pages).
    params = {
        "$select": MESSAGE_SELECT,
        "$top": str(page_size),
        # A real server-side count. Without it the model conflates the (bogus)
        # Microsoft Search total with what this tool actually returns.
        "$count": "true",
    }
    if filter_parts:
        params["$filter"] = " and ".join(filter_parts)
    return params


async def _fetch_page(
    client: httpx.AsyncClient, headers: dict, url: str, params: dict | None
) -> dict:
    response = await _graph_request(client, "GET", url, headers=headers, params=params)
    if response.status_code != 200:
        detail = f"Graph returned {response.status_code}: {response.text[:300]}"
        hint = _graph_error_hint(response.status_code, response.text)
        raise RuntimeError(f"{detail} — {hint}" if hint else detail)
    return response.json()


@mcp.tool()
async def search_emails(
    sender: Optional[str] = None,
    sender_domain: Optional[str] = None,
    recipients: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    folder_id: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    unread: Optional[bool] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    cursor: Optional[str] = None,
    fetch_all_metadata: bool = False,
    max_results: Optional[int] = None,
    include_preview: bool = False,
) -> str:
    """Enumerate a mailbox deterministically, unlike the capped Search tool.

    Use this — not search_m365 — whenever the goal is "all mail matching a filter"
    rather than "mail mentioning a keyword". Each call returns one page plus a
    `pagination.nextCursor`; pass that cursor back to get the next page. Nothing
    is truncated to 25: page_size goes up to 1000.

    Counting: report `pagination.total` verbatim, and never count the items
    yourself — the list is truncated for size, so its length can be less than
    the real number. `total` is the authoritative Graph count; it is present
    only when no client-side filter (sender_domain/recipients) is active, and it
    beats any number from search_m365. Ordering is Graph's default
    (oldest-first); sort by receivedDateTime yourself for newest-first.

    Args:
        sender: Exact sender address, e.g. "john@sony.com". Matches the real
            address the mail was sent from. Viva Engage / Yammer notifications
            and announcements show the author's display name but are sent by the
            platform (notifications@/noreply@eu.yammer.com), so they are NOT
            returned — which is why Outlook can list more items under that
            person's name than this count.
        sender_domain: Any sender at this domain, e.g. "sony.com". Matched while
            paging (Graph cannot filter by domain), so pages may contain fewer
            hits than page_size.
        recipients: Exact recipient address (To or Cc). Matched while paging
            (Graph rejects the recipient filter), so pages may contain fewer hits.
        subject: Case-insensitive substring of the subject.
        date_from: ISO 8601 or YYYY-MM-DD (received on/after).
        date_to: ISO 8601 or YYYY-MM-DD (received on/before).
        folder_id: Restrict to a folder from list_mail_folders.
        has_attachments: Only mail with (True) or without (False) attachments.
        unread: Only unread (True) or read (False) mail.
        page_size: Items per page, 1..1000 (default 100).
        cursor: The `nextCursor` from the previous call. When given, all filters
            are ignored — the cursor already carries them.
        fetch_all_metadata: Follow every page in one call and return metadata for
            all matches. Off by default: a broad query can be huge.
        max_results: Cap for fetch_all_metadata (default 5000).
        include_preview: Add each item's `bodyPreview` (a short plain-text
            preview, ~255 chars). Set it when summaries are needed: it answers
            "what is this mail about" from the same list, avoiding a second,
            id-based get_emails call — the step where a mis-copied id fails.

    Returns:
        JSON: items (id, conversationId, subject, from, dates, hasAttachments,
        isRead, importance, plus bodyPreview when include_preview — deliberately
        no body, recipients or web link; use get_email for those) and a
        `pagination` block with returned, hasMore, nextCursor and (when
        applicable) total, complete, pages.
    """
    try:
        headers = graph_headers()
        size = max(1, min(int(page_size or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
        predicates = client_predicates(sender_domain, recipients)
        base_url = (
            f"{GRAPH_BASE}/me/mailFolders/{quote(folder_id, safe='')}/messages"
            if folder_id
            else f"{GRAPH_BASE}/me/messages"
        )

        if cursor:
            try:
                url: Optional[str] = decode_cursor(cursor)
                params: Optional[dict] = None
            except ValueError as exc:
                return json.dumps({"status": "error", "message": str(exc)}, indent=2)
        else:
            url = base_url
            params = _message_params(
                build_filter(
                    sender, subject, date_from, date_to, has_attachments, unread
                ),
                size,
            )

        if not fetch_all_metadata:
            async with httpx.AsyncClient() as client:
                page = await _fetch_page(client, headers, url or base_url, params)
            items = [normalize_message(m) for m in page.get("value", [])]
            items = [slim_message(m, include_preview) for m in items if all(p(m) for p in predicates)]
            next_link = page.get("@odata.nextLink")
            pagination = {
                "returned": len(items),
                "hasMore": bool(next_link),
                "nextCursor": encode_cursor(next_link),
            }
            total = page.get("@odata.count")
            if total is not None and not predicates:
                pagination["total"] = total
            return json.dumps(
                {"status": "success", "items": items, "pagination": pagination},
                indent=2,
            )

        limit = int(max_results) if max_results else FETCH_ALL_MAX
        collected: list[dict] = []
        pages = 0
        truncated = False
        total = None
        async with httpx.AsyncClient() as client:
            while url:
                page = await _fetch_page(client, headers, url, params)
                params = None  # a nextLink already carries its own query string
                if total is None:
                    total = page.get("@odata.count")
                pages += 1
                for raw in page.get("value", []):
                    message = normalize_message(raw)
                    if all(p(message) for p in predicates):
                        collected.append(slim_message(message, include_preview))
                        if len(collected) >= limit:
                            truncated = True
                            break
                if truncated:
                    break
                url = page.get("@odata.nextLink")
        pagination = {
            "returned": len(collected),
            "hasMore": truncated or bool(url),
            "nextCursor": None if truncated else encode_cursor(url),
            "complete": not truncated,
            "pages": pages,
        }
        if total is not None and not predicates:
            pagination["total"] = total
        return json.dumps(
            {"status": "success", "items": collected, "pagination": pagination},
            indent=2,
        )
    except Exception as e:
        logger.exception("search_emails: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def get_conversation(conversation_id: str) -> str:
    """Every message in one Outlook conversation, oldest first.

    Use the `conversationId` from a search_emails hit. This is the efficient unit
    for a timeline: a thread of replies becomes one document instead of N separate
    messages. Pagination is followed to completion internally.

    Args:
        conversation_id: The conversationId from a message.

    Returns:
        JSON {conversationId, messages, count, complete}.
    """
    try:
        headers = graph_headers()
        escaped = conversation_id.replace("'", "''")
        # No `$orderby`: a conversationId filter + sort is rejected as
        # InefficientFilter. Messages come newest-first, so the thread is sorted
        # oldest-first here instead.
        params: Optional[dict] = {
            "$select": MESSAGE_SELECT,
            "$filter": f"conversationId eq '{escaped}'",
            "$top": "100",
        }
        url: Optional[str] = f"{GRAPH_BASE}/me/messages"
        messages: list[dict] = []
        async with httpx.AsyncClient() as client:
            while url:
                page = await _fetch_page(client, headers, url, params)
                params = None
                messages.extend(normalize_message(m) for m in page.get("value", []))
                url = page.get("@odata.nextLink")
        messages.sort(
            key=lambda m: m.get("sentDateTime") or m.get("receivedDateTime") or ""
        )
        return json.dumps(
            {
                "status": "success",
                "conversationId": conversation_id,
                "messages": messages,
                "count": len(messages),
                "complete": True,
            },
            indent=2,
        )
    except Exception as e:
        logger.exception("get_conversation: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def get_email(
    message_id: Optional[str] = None,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
) -> str:
    """One email in full, including its body.

    Identify the message either by its exact `message_id`, or — preferred — by a
    selector (sender/subject/date_from/date_to/has_attachments). The selector is
    resolved server-side, so you never re-type the long, corruption-prone id; the
    most recent match is used. For several messages prefer get_emails.

    Args:
        message_id: Exact id, when you already hold it verbatim.
        sender, subject, date_from, date_to, has_attachments, folder_id: Selector
            resolved with the same filters as search_emails (newest match).

    Returns:
        JSON with the normalized message plus `body` {contentType, content}.
    """
    try:
        headers = graph_headers()
        async with httpx.AsyncClient() as client:
            if not (message_id or "").strip():
                if not _selector_given(
                    sender=sender,
                    subject=subject,
                    date_from=date_from,
                    date_to=date_to,
                    has_attachments=has_attachments,
                    folder_id=folder_id,
                ):
                    return json.dumps(
                        {
                            "status": "error",
                            "message": "provide message_id or a selector "
                            "(sender/subject/date_from/date_to/has_attachments)",
                        },
                        indent=2,
                    )
                found = await _resolve_messages(
                    client,
                    headers,
                    sender=sender,
                    subject=subject,
                    date_from=date_from,
                    date_to=date_to,
                    has_attachments=has_attachments,
                    folder_id=folder_id,
                    match="newest",
                    limit=1,
                )
                if not found:
                    return json.dumps(
                        {"status": "error", "message": "no message matches this selector"},
                        indent=2,
                    )
                message_id = found[0]["id"]

            response = await _graph_request(
                client,
                "GET",
                f"{GRAPH_BASE}/me/messages/{quote(message_id, safe='')}",
                headers=headers,
                params={"$select": f"{MESSAGE_SELECT},body"},
            )
        if response.status_code != 200:
            return json.dumps(_graph_error_payload(response), indent=2)
        raw = response.json()
        message = normalize_message(raw)
        body = raw.get("body") or {}
        message["body"] = {
            "contentType": body.get("contentType"),
            "content": body.get("content") or "",
        }
        return json.dumps({"status": "success", "message": message}, indent=2)
    except Exception as e:
        logger.exception("get_email: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


def _batch_message_entry(message_id: str, entry: dict) -> dict:
    body = entry.get("body")
    if entry.get("status") == 200 and isinstance(body, dict):
        message = normalize_message(body)
        inner = body.get("body") or {}
        message["body"] = {
            "contentType": inner.get("contentType"),
            "content": inner.get("content") or "",
        }
        return message
    status = entry.get("status")
    result: dict = {"id": message_id, "error": f"Graph status {status}"}
    serialized = json.dumps(body) if isinstance(body, dict) else str(body or "")
    hint = _graph_error_hint(status if isinstance(status, int) else None, serialized)
    if hint:
        result["hint"] = hint
    return result


async def _batch_fetch_messages(
    client: httpx.AsyncClient, headers: dict, ids: list[str]
) -> list[dict]:
    """GET each id through $batch, in small chunks, retrying only the reads Graph
    throttled. A 20-request batch is what trips the mailbox concurrency limit, so
    chunks are small and a throttled sub-response is retried rather than reported
    as a failure."""
    results: list[dict] = []
    unresolved = list(ids)
    attempt = 0
    while unresolved and attempt < GRAPH_MAX_ATTEMPTS:
        attempt += 1
        retry_ids: list[str] = []
        wait = 0.0
        for start in range(0, len(unresolved), GRAPH_BATCH_SIZE):
            chunk = unresolved[start : start + GRAPH_BATCH_SIZE]
            payload = {
                "requests": [
                    {
                        "id": str(idx),
                        "method": "GET",
                        "url": f"/me/messages/{quote(mid, safe='')}?$select={MESSAGE_SELECT},body",
                    }
                    for idx, mid in enumerate(chunk)
                ]
            }
            response = await _graph_request(
                client, "POST", f"{GRAPH_BASE}/$batch", headers=headers, json=payload
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"Graph $batch returned {response.status_code}: {response.text[:300]}"
                )
            for entry in response.json().get("responses", []):
                try:
                    message_id = chunk[int(entry.get("id", "-1"))]
                except (ValueError, IndexError):
                    continue
                status = entry.get("status")
                if status in GRAPH_RETRY_STATUSES and attempt < GRAPH_MAX_ATTEMPTS:
                    retry_ids.append(message_id)
                    wait = max(
                        wait,
                        _retry_after_seconds(entry.get("headers") or {}, float(attempt)),
                    )
                    continue
                results.append(_batch_message_entry(message_id, entry))
        unresolved = retry_ids
        if unresolved:
            await asyncio.sleep(wait or float(attempt))
    for message_id in unresolved:
        results.append(
            {
                "id": message_id,
                "error": "Graph status 429 (still throttled after retries)",
                "hint": "the mailbox stayed throttled; retry with fewer messages per call",
            }
        )
    return results


@mcp.tool()
async def get_emails(
    message_ids: Optional[list[str]] = None,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
    page_size: int = 10,
    cursor: Optional[str] = None,
) -> str:
    """Fetch full emails (with bodies), by exact ids or by a selector page.

    Two ways to call it:
      * `message_ids`: exact ids, batched through Graph $batch with retry.
      * a selector (sender/subject/date_from/date_to/has_attachments): returns the
        bodies for one page of matches plus `pagination.nextCursor`; call again
        with the cursor until `hasMore` is false. Prefer this — it avoids re-typing
        a long message id, which a model often corrupts (Graph then rejects it).

    Args:
        message_ids: Exact ids, when you already hold them verbatim.
        sender, subject, date_from, date_to, has_attachments, folder_id: Selector
            resolved with the same filters as search_emails.
        page_size: Items per selector page, 1..1000 (default 10; bodies are large).
        cursor: `pagination.nextCursor` from the previous selector call.

    Returns:
        JSON {messages, count} for ids, or {messages, count, pagination} for a
        selector, where each message carries its `body` {contentType, content}.
    """
    try:
        headers = graph_headers()
        if message_ids:
            ids = [str(i).strip() for i in message_ids if str(i).strip()]
            if not ids:
                return json.dumps({"status": "error", "message": "message_ids is empty"}, indent=2)
            async with httpx.AsyncClient() as client:
                messages = await _batch_fetch_messages(client, headers, ids)
            return json.dumps(
                {"status": "success", "messages": messages, "count": len(messages)}, indent=2
            )

        if not _selector_given(
            sender=sender,
            subject=subject,
            date_from=date_from,
            date_to=date_to,
            has_attachments=has_attachments,
            folder_id=folder_id,
        ):
            return json.dumps(
                {
                    "status": "error",
                    "message": "provide message_ids, or a selector "
                    "(sender/subject/date_from/date_to/has_attachments)",
                },
                indent=2,
            )

        size = max(1, min(int(page_size or 10), MAX_PAGE_SIZE))
        base_url = (
            f"{GRAPH_BASE}/me/mailFolders/{quote(folder_id, safe='')}/messages"
            if folder_id
            else f"{GRAPH_BASE}/me/messages"
        )
        if cursor:
            try:
                url: Optional[str] = decode_cursor(cursor)
            except ValueError as exc:
                return json.dumps({"status": "error", "message": str(exc)}, indent=2)
            params: Optional[dict] = None
        else:
            url = base_url
            params = {
                "$select": f"{MESSAGE_SELECT},body",
                "$top": str(size),
                "$count": "true",
            }
            parts = build_filter(sender, subject, date_from, date_to, has_attachments, None)
            if parts:
                params["$filter"] = " and ".join(parts)

        async with httpx.AsyncClient() as client:
            page = await _fetch_page(client, headers, url or base_url, params)

        messages: list[dict] = []
        for raw in page.get("value", []):
            message = normalize_message(raw)
            inner = raw.get("body") or {}
            message["body"] = {
                "contentType": inner.get("contentType"),
                "content": inner.get("content") or "",
            }
            messages.append(message)
        next_link = page.get("@odata.nextLink")
        pagination = {
            "returned": len(messages),
            "hasMore": bool(next_link),
            "nextCursor": encode_cursor(next_link),
        }
        total = page.get("@odata.count")
        if total is not None:
            pagination["total"] = total
        return json.dumps(
            {
                "status": "success",
                "messages": messages,
                "count": len(messages),
                "pagination": pagination,
            },
            indent=2,
        )
    except Exception as e:
        logger.exception("get_emails: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def list_mail_folders(parent_folder_id: Optional[str] = None) -> str:
    """List Outlook mail folders, to target a search_emails folder_id.

    Args:
        parent_folder_id: Omit for top-level folders; give a folder id to list its
            child folders.

    Returns:
        JSON {folders} with id, displayName, parentFolderId, item counts.
    """
    try:
        headers = graph_headers()
        url: Optional[str] = (
            f"{GRAPH_BASE}/me/mailFolders/{quote(parent_folder_id, safe='')}/childFolders"
            if parent_folder_id
            else f"{GRAPH_BASE}/me/mailFolders"
        )
        params: Optional[dict] = {"$select": FOLDER_SELECT, "$top": "100"}
        folders: list[dict] = []
        async with httpx.AsyncClient() as client:
            while url:
                page = await _fetch_page(client, headers, url, params)
                params = None
                folders.extend(page.get("value", []))
                url = page.get("@odata.nextLink")
        return json.dumps({"status": "success", "folders": folders}, indent=2)
    except Exception as e:
        logger.exception("list_mail_folders: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def list_mail_attachments(
    message_id: Optional[str] = None,
    sender: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
    match: str = "all",
    limit: int = 25,
) -> str:
    """List attachments without downloading them, for one message or a selector.

    Lets you decide what to fetch: read a contract PDF, skip a signature logo.
    Inline images and non-file kinds are reported too, so the choice is explicit.

    Prefer the selector (sender/subject/date_from/date_to/has_attachments) over an
    id: the message(s) are resolved server-side, so you never re-type a long id.
    With a selector, attachments are grouped per resolved message.

    Args:
        message_id: Exact id, when you already hold it verbatim (returns one group).
        sender, subject, date_from, date_to, has_attachments, folder_id: Selector
            resolved with the same filters as search_emails.
        match: With a selector, "all" (default) lists every match up to `limit`;
            "newest" lists only the most recent one.
        limit: Max messages a selector may resolve (default 25).

    Returns:
        For an id: {messageId, attachments, count}. For a selector:
        {messages: [{message_id, subject, receivedDateTime, attachments, count}], count}.
        Each attachment has id, filename, contentType, size, isInline, type.
    """
    try:
        headers = graph_headers()
        explicit = (message_id or "").strip()
        selected = _selector_given(
            sender=sender,
            subject=subject,
            date_from=date_from,
            date_to=date_to,
            has_attachments=has_attachments,
            folder_id=folder_id,
        )

        async with httpx.AsyncClient() as client:
            if explicit:
                response = await _get_message_attachments(
                    client, headers, message_id, select=ATTACHMENT_SELECT
                )
                if response.status_code != 200:
                    return json.dumps(
                        _graph_error_payload(response, prefix="could not list attachments: "),
                        indent=2,
                    )
                attachments = [
                    normalize_attachment(a) for a in response.json().get("value", [])
                ]
                return json.dumps(
                    {
                        "status": "success",
                        "messageId": message_id,
                        "attachments": attachments,
                        "count": len(attachments),
                    },
                    indent=2,
                )

            if not selected:
                return json.dumps(
                    {
                        "status": "error",
                        "message": "provide message_id, or a selector "
                        "(sender/subject/date_from/date_to/has_attachments)",
                    },
                    indent=2,
                )

            found = await _resolve_messages(
                client,
                headers,
                sender=sender,
                subject=subject,
                date_from=date_from,
                date_to=date_to,
                has_attachments=has_attachments,
                folder_id=folder_id,
                match=match,
                limit=max(1, int(limit or 25)),
            )
            grouped: list[dict] = []
            for m in found:
                entry: dict = {
                    "message_id": m.get("id"),
                    "subject": m.get("subject"),
                    "receivedDateTime": m.get("receivedDateTime"),
                    "attachments": [],
                    "count": 0,
                }
                listing = await _get_message_attachments(
                    client, headers, m.get("id"), select=ATTACHMENT_SELECT
                )
                if listing.status_code == 200:
                    entry["attachments"] = [
                        normalize_attachment(a) for a in listing.json().get("value", [])
                    ]
                    entry["count"] = len(entry["attachments"])
                else:
                    entry["error"] = f"Graph {listing.status_code}"
                    hint = _graph_error_hint(listing.status_code, listing.text)
                    if hint:
                        entry["hint"] = hint
                grouped.append(entry)

        return json.dumps(
            {"status": "success", "messages": grouped, "count": len(grouped)}, indent=2
        )
    except Exception as e:
        logger.exception("list_mail_attachments: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


@mcp.tool()
async def export_emails_table(
    sender: Optional[str] = None,
    sender_domain: Optional[str] = None,
    recipients: Optional[str] = None,
    subject: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_attachments: Optional[bool] = None,
    folder_id: Optional[str] = None,
    max_messages: int = 500,
    include_attachment_first_page: bool = True,
    filename: Optional[str] = None,
    delivery: Literal["file", "inline", "both"] = "both",
) -> str:
    """Export every matching email as one complete table.

    Works for any mailbox and any selector — a sender address, a whole domain, a
    recipient, a subject or a date range. Builds the table server-side (one row per
    mail with its complete body, a summary, its attachment names and the first page
    of each attachment) so the bodies never have to be assembled by you. Two ways
    to deliver it:

      * `delivery="inline"` (or "both") returns the table as Markdown, ready to
        paste into your answer VERBATIM — do not split or re-summarise it. Small
        tables come back as `markdown`; when the table is long it comes back as
        `markdown_parts`, a list of chunks: output `markdown_parts[0]`, then append
        `markdown_parts[1..]` in order to form the single complete table.
      * `delivery="file"` (or "both") writes a UTF-8 CSV into the run folder and
        returns `storage_key`; deliver it with `send_file_to_user`.

    Columns, in order: Réception (UTC), Expéditeur, Objet, Contenu intégral, Résumé
    du mail, Pièce jointe, Contenu de la première page de la pièce jointe. A mail
    without attachments gets "Aucune". Only the first page of an attachment is
    extracted; a Word file has no fixed pages, so its cell says so.

    Args:
        sender: Exact sender address, e.g. "john@sony.com".
        sender_domain: Any sender at this domain, e.g. "sony.com".
        recipients: Exact recipient address (To or Cc).
        subject, date_from, date_to, has_attachments, folder_id: As in search_emails.
            Give at least one selector field.
        max_messages: Safety cap on rows (default 500).
        include_attachment_first_page: Set False to skip opening attachments
            (faster; the first-page column then holds a short note).
        filename: Output file name (default: derived from the selector + a UTC stamp).
        delivery: "inline" (markdown only), "file" (CSV only) or "both" (default).

    Returns:
        JSON {status, rows, columns, preview, markdown? | markdown_parts?,
        markdown_chars?, storage_key?, sandbox_path?, size?}.
    """
    try:
        folder = system_workspace_prefix()
        if not folder:
            return json.dumps(
                {
                    "status": "error",
                    "message": "cannot resolve this run's storage folder "
                    "(missing X-user-id or x-conversation-id/x-execution-id on this request)",
                },
                indent=2,
            )
        if not _selector_given(
            sender=sender,
            sender_domain=sender_domain,
            recipients=recipients,
            subject=subject,
            date_from=date_from,
            date_to=date_to,
            has_attachments=has_attachments,
            folder_id=folder_id,
        ):
            return json.dumps(
                {
                    "status": "error",
                    "message": "provide a selector (sender/sender_domain/recipients/"
                    "subject/date_from/date_to/has_attachments)",
                },
                indent=2,
            )

        headers = graph_headers()
        limit = max(1, int(max_messages or 500))
        predicates = client_predicates(sender_domain, recipients)
        filter_parts = build_filter(sender, subject, date_from, date_to, has_attachments, None)
        base_url: Optional[str] = (
            f"{GRAPH_BASE}/me/mailFolders/{quote(folder_id, safe='')}/messages"
            if folder_id
            else f"{GRAPH_BASE}/me/messages"
        )
        params: Optional[dict] = {"$select": f"{MESSAGE_SELECT},body", "$top": "100"}
        if filter_parts:
            params["$filter"] = " and ".join(filter_parts)

        rows: list[dict] = []
        async with httpx.AsyncClient() as client:
            url = base_url
            while url and len(rows) < limit:
                page = await _fetch_page(client, headers, url, params)
                params = None
                for raw in page.get("value", []):
                    if len(rows) >= limit:
                        break
                    message = normalize_message(raw)
                    if predicates and not all(p(message) for p in predicates):
                        continue
                    inner = raw.get("body") or {}
                    message["body"] = {
                        "contentType": inner.get("contentType"),
                        "content": inner.get("content") or "",
                    }
                    names, pages = await _attachment_report(
                        client, headers, message.get("id"), include_attachment_first_page
                    )
                    rows.append(
                        mail_export.row_for(
                            message,
                            names,
                            "\n\n".join(pages),
                            (message.get("from") or {}).get("address") or "",
                        )
                    )
                url = page.get("@odata.nextLink")

        payload: dict = {
            "status": "success",
            "rows": len(rows),
            "columns": list(mail_export.COLUMNS),
        }
        if delivery in ("file", "both"):
            csv_bytes = mail_export.build_csv(rows)
            if (filename or "").strip():
                name = filename.strip()
            else:
                stem = mail_export.safe_filename(
                    "emails_" + (sender or sender_domain or recipients or subject or "export")
                )
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                name = f"{stem}_{stamp}.csv"
            storage_key = f"{folder}/{name}"
            await asyncio.to_thread(put_storage_object, storage_key, csv_bytes, "text/csv")
            payload["storage_key"] = storage_key
            payload["sandbox_path"] = f"/mnt/workspace/{folder.split('/')[-1]}/{name}"
            payload["size"] = len(csv_bytes)
            logger.info(
                "export_emails_table: rows=%s size=%s -> %s", len(rows), len(csv_bytes), storage_key
            )
        if delivery in ("inline", "both"):
            markdown = mail_export.build_markdown(rows)
            payload["markdown_chars"] = len(markdown)
            if len(markdown) <= MARKDOWN_INLINE_MAX:
                payload["markdown"] = markdown
            else:
                # The platform truncates any single string at 20k chars; a list of
                # short chunks survives whole and rebuilds one table in order.
                payload["markdown_parts"] = mail_export.build_markdown_parts(
                    rows, max_chars=MARKDOWN_INLINE_MAX
                )
                payload["markdown_note"] = (
                    "The table is long: output markdown_parts[0], then append "
                    "markdown_parts[1..] in order to form the single complete table."
                )
        payload["preview"] = rows[:3]
        return json.dumps(payload, indent=2)
    except Exception as e:
        logger.exception("export_emails_table: failed: %s", e)
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Calendar Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def create_meeting(
    subject: str,
    start_datetime: str,
    end_datetime: str,
    attendees: list[str],
    timezone: str = "UTC",
    location: Optional[str] = None,
    body: Optional[str] = None,
    is_online_meeting: bool = False,
) -> str:
    """
    Create a calendar meeting/event.

    Args:
        subject: Meeting subject
        start_datetime: Start date and time in ISO 8601 format (e.g., "2024-01-25T14:00:00")
        end_datetime: End date and time in ISO 8601 format (e.g., "2024-01-25T15:00:00")
        attendees: List of attendee email addresses
        timezone: Timezone (default: UTC). Examples: "Europe/Paris", "America/New_York"
        location: Optional meeting location
        body: Optional meeting description (HTML supported)
        is_online_meeting: If True, creates a Teams online meeting

    Returns:
        JSON string with the result including event ID and Teams meeting URL (if online)

    Examples:
        - create_meeting("Team Sync", "2024-01-25T14:00:00", "2024-01-25T15:00:00", ["user@example.com"])
        - create_meeting("Project Review", "2024-01-26T10:00:00", "2024-01-26T11:00:00",
                        ["user1@example.com", "user2@example.com"],
                        timezone="Europe/Paris", is_online_meeting=True)
    """
    try:
        headers = graph_headers()

        meeting_payload: dict = {
            "subject": subject,
            "start": {"dateTime": start_datetime, "timeZone": timezone},
            "end": {"dateTime": end_datetime, "timeZone": timezone},
            "attendees": [
                {"emailAddress": {"address": email}, "type": "required"}
                for email in attendees
            ],
        }

        if location:
            meeting_payload["location"] = {"displayName": location}
        if body:
            meeting_payload["body"] = {"contentType": "HTML", "content": body}
        if is_online_meeting:
            meeting_payload["isOnlineMeeting"] = True
            meeting_payload["onlineMeetingProvider"] = "teamsForBusiness"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GRAPH_BASE}/me/events",
                headers=headers,
                json=meeting_payload,
                timeout=30.0,
            )

            if response.status_code not in [200, 201]:
                return json.dumps(
                    {
                        "status": "error",
                        "message": f"Failed to create meeting: {response.text}",
                    },
                    indent=2,
                )

            event_data = response.json()

            result = {
                "status": "success",
                "message": "Meeting created successfully",
                "event_id": event_data.get("id"),
            }
            if is_online_meeting and "onlineMeeting" in event_data:
                result["online_meeting_url"] = event_data["onlineMeeting"].get(
                    "joinUrl"
                )

            return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, indent=2)


if __name__ == "__main__":
    os.environ.setdefault("HOST", "0.0.0.0")
    transport = os.getenv("OUTLOOK_MCP_TRANSPORT", "sse")
    port = int(os.getenv("OUTLOOK_MCP_PORT", os.getenv("PORT", "8002")))

    middleware = [Middleware(AuthMiddleware)]

    if transport in ["sse", "http", "streamable-http"]:
        origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
        allow_credentials = "*" not in origins

        logger.info(
            f"Enabling CORS for origins: {origins} (credentials: {allow_credentials})",
        )
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=origins,
                allow_credentials=allow_credentials,
                allow_methods=["*"],
                allow_headers=["*"],
            )
        )

    logger.info(
        f"Starting Outlook MCP server with transport: {transport} on port: {port}",
    )
    mcp.run(transport=transport, middleware=middleware, host="0.0.0.0", port=port)
