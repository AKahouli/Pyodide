"""Shared Microsoft Graph API helpers for M365 Document Connector."""

import base64
import binascii
import json
import logging
import os
import sys
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote

import httpx

# A dedicated stderr logger so the attachment path is traceable in container
# logs regardless of how the host configured logging. Never logs the token or
# any secret — only sizes, keys (which are paths, not secrets), and outcomes.
logger = logging.getLogger("outlook_mcp")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s [outlook_mcp] %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# The internal user id (from the X-user-id header), needed to prove a storage_key
# belongs to the caller before its bytes are ever read.
_request_user_id: ContextVar[str | None] = ContextVar("_request_user_id", default=None)
# The run this request belongs to: x-conversation-id, or x-execution-id for a
# playbook run that has no conversation. Resolved in that order by the middleware
# because the sandbox MCP resolves it the same way — the two must agree or a file
# this server writes lands in a folder the sandbox never mounts.
_request_conversation_id: ContextVar[str | None] = ContextVar(
    "_request_conversation_id", default=None
)

# The acting user's delegated Microsoft Graph token, delivered per request by the
# connector auth layer in the configured token header (ADR-0017 provider
# authority). Set and reset by AuthMiddleware; never logged and never read from
# the environment — an ambient tenant token would let a caller inherit tenant
# authority.
_delegated_provider_token: ContextVar[str | None] = ContextVar(
    "_delegated_provider_token", default=None
)


def get_request_user_id() -> str | None:
    return _request_user_id.get()


def get_request_provider_token() -> str | None:
    return _delegated_provider_token.get()


def get_request_conversation_id() -> str | None:
    return _request_conversation_id.get()


def get_request_run_id() -> str | None:
    """The run folder segment: `conversation_id` already resolved conversation
    first then execution. Kept as its own name so mail tools can group their
    storage keys by run without re-deciding the fallback order."""
    return _request_conversation_id.get()


def system_workspace_prefix() -> str:
    """The Ceph folder for this run: `<user_id>/system_<conversation_id>`.

    Same convention the sandbox MCP uses for its own files, so anything written
    here is visible to the sandbox once that path is mounted. Empty string when
    either id is missing — the caller must refuse rather than write to a
    half-formed path.
    """
    user_id = get_request_user_id()
    conversation_id = get_request_conversation_id()
    if not user_id or not conversation_id:
        return ""
    return f"{user_id}/system_{conversation_id}"

TEXT_EXTENSIONS = frozenset(
    {
        "txt",
        "md",
        "markdown",
        "json",
        "csv",
        "tsv",
        "xml",
        "html",
        "htm",
        "xhtml",
        "yaml",
        "yml",
        "toml",
        "ini",
        "cfg",
        "conf",
        "properties",
        "env",
        "log",
        "py",
        "pyw",
        "js",
        "mjs",
        "cjs",
        "ts",
        "tsx",
        "jsx",
        "css",
        "scss",
        "less",
        "sass",
        "sql",
        "sh",
        "bash",
        "zsh",
        "fish",
        "bat",
        "ps1",
        "cmd",
        "rb",
        "go",
        "rs",
        "java",
        "kt",
        "kts",
        "scala",
        "groovy",
        "c",
        "h",
        "cpp",
        "hpp",
        "cc",
        "cxx",
        "cs",
        "fs",
        "fsx",
        "vb",
        "php",
        "phtml",
        "swift",
        "dart",
        "r",
        "m",
        "lua",
        "pl",
        "pm",
        "ex",
        "exs",
        "erl",
        "hrl",
        "clj",
        "cljs",
        "hs",
        "ml",
        "vue",
        "svelte",
        "astro",
        "graphql",
        "gql",
        "tf",
        "hcl",
        "proto",
        "dockerfile",
        "makefile",
        "gitignore",
        "editorconfig",
        "rtf",
    }
)

_TEXT_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/x-www-form-urlencoded",
    "application/manifest+json",
    "application/ld+json",
    "application/problem+json",
    "application/rdf+xml",
    "application/xhtml+xml",
)

MAX_INLINE_TEXT_SIZE = 512_000

DRIVE_ITEM_SELECT = (
    "id,name,file,folder,webUrl,size,lastModifiedDateTime,"
    "createdDateTime,parentReference,sharepointIds"
)


def get_access_token() -> str:
    token = _delegated_provider_token.get()
    if token:
        return token
    raise RuntimeError(
        "No delegated Microsoft Graph token for this request. "
        "The connector auth layer must send the acting user's token in the "
        "configured provider header (M365_TOKEN_HEADER)."
    )


def graph_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_access_token()}",
        "Content-Type": "application/json",
    }


def is_text_content(mime_type: str | None, filename: str | None) -> bool:
    if mime_type:
        lower = mime_type.lower()
        if any(lower.startswith(p) for p in _TEXT_MIME_PREFIXES):
            return True
        if lower != "application/octet-stream":
            return False
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        return ext in TEXT_EXTENSIONS
    return False


def normalize_drive_item(
    raw: dict[str, Any], drive_id: str | None = None
) -> dict[str, Any]:
    parent_ref = raw.get("parentReference") or {}
    site_id = parent_ref.get("siteId") or (raw.get("sharepointIds") or {}).get("siteId")
    sharepoint_ids = raw.get("sharepointIds") or {}
    file_info = raw.get("file") or {}
    return {
        "siteId": site_id,
        "driveId": drive_id or parent_ref.get("driveId", ""),
        "itemId": raw.get("id", ""),
        "name": raw.get("name", ""),
        "webUrl": raw.get("webUrl", ""),
        "listItemUniqueId": sharepoint_ids.get("listItemUniqueId", ""),
        "listId": sharepoint_ids.get("listId", ""),
        "siteUrl": parent_ref.get("siteUrl", ""),
        "mimeType": file_info.get("mimeType", ""),
        "size": raw.get("size", 0),
        "isFolder": "folder" in raw,
        "lastModifiedDateTime": raw.get("lastModifiedDateTime", ""),
        "createdDateTime": raw.get("createdDateTime", ""),
    }


def normalize_drive(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "driveId": raw.get("id", ""),
        "name": raw.get("name", ""),
        "driveType": raw.get("driveType", ""),
        "webUrl": raw.get("webUrl", ""),
        "createdDateTime": raw.get("createdDateTime", ""),
        "owner": (raw.get("owner") or {}).get("user", {}).get("displayName", ""),
    }


def normalize_site(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "siteId": raw.get("id", ""),
        "displayName": raw.get("displayName", ""),
        "name": raw.get("name", ""),
        "webUrl": raw.get("webUrl", ""),
    }


def error_response(
    message: str, status_code: int | None = None, details: str | None = None
) -> str:
    payload: dict[str, Any] = {"status": "error", "message": message}
    if status_code:
        payload["statusCode"] = status_code
    if details:
        payload["details"] = details
    return json.dumps(payload, indent=2)


def success_response(data: Any) -> str:
    return json.dumps({"status": "success", **data}, indent=2)


# Graph rejects a sendMail whose whole request body exceeds ~4MB; base64 costs
# ~33% on top of the raw bytes, so 3MB of real file is the safe inline ceiling.
INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024
# createUploadSession's own ceiling for a message attachment.
UPLOAD_ATTACHMENT_LIMIT = 150 * 1024 * 1024
# Upload chunks must be a multiple of 320 KiB. 10 of them keeps the request
# count sane without holding a large slice in memory.
UPLOAD_CHUNK_SIZE = 10 * 320 * 1024
# A file over this goes to OneDrive and is SHARED with the recipients rather than
# attached: the ceiling is a mail DELIVERY limit set by the mailboxes, not Graph
# (which accepts 150MB) — most gateways bounce well below that. Env-tunable, since
# a tenant that has raised its own message-size limit can attach larger files.
MAIL_ATTACH_MAX_BYTES = int(os.getenv("MAIL_ATTACH_MAX_BYTES", str(25 * 1024 * 1024)))


class AttachmentError(ValueError):
    """An attachment the caller described cannot be sent as given."""


def parse_attachments(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Validate caller attachments into typed entries, order preserved.

    Each entry is one of two shapes, chosen by the caller from what it HAS — not
    from how it wants the file delivered:

      - {"kind": "bytes",   "name", "raw", "content_base64", "content_type"}
            the caller supplied `content_base64` (a file it generated inline).
      - {"kind": "storage", "name", "storage_key", "content_type"}
            the caller supplied `storage_key`, a reference to a file already in
            Ceph (e.g. what send_file_to_user returned). Its bytes are fetched
            server-side at send time.

    The delivery route (attach inline / upload session / OneDrive-and-share) is
    decided later from the file's REAL size, never by the caller here.

    Raises AttachmentError on anything unsendable, so the caller gets a clear
    reason instead of an opaque Graph 400 later.
    """
    parsed: list[dict[str, Any]] = []
    if not attachments:
        return parsed

    for index, item in enumerate(attachments):
        if not isinstance(item, dict):
            raise AttachmentError(f"attachment #{index + 1} must be an object")
        name = (item.get("filename") or item.get("name") or "").strip()
        if not name:
            raise AttachmentError(f"attachment #{index + 1} is missing 'filename'")

        content_base64 = item.get("content_base64") or ""
        storage_key = (item.get("storage_key") or "").strip()
        content_type = item.get("content_type") or "application/octet-stream"
        if content_base64 and storage_key:
            raise AttachmentError(
                f"{name}: give either 'content_base64' or 'storage_key', not both"
            )
        if storage_key:
            parsed.append(
                {
                    "kind": "storage",
                    "name": name,
                    "storage_key": storage_key,
                    "content_type": content_type,
                }
            )
            continue
        if not content_base64:
            raise AttachmentError(
                f"{name}: needs 'content_base64' (the file's bytes) or 'storage_key' "
                "(a reference to a file already in storage)"
            )
        try:
            raw = base64.b64decode(content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise AttachmentError(f"{name}: 'content_base64' is not valid base64") from exc
        if not raw:
            raise AttachmentError(f"{name}: 'content_base64' decodes to an empty file")
        if len(raw) > UPLOAD_ATTACHMENT_LIMIT:
            raise AttachmentError(
                f"{name}: {len(raw) / 1024 / 1024:.1f}MB exceeds the "
                f"{UPLOAD_ATTACHMENT_LIMIT // 1024 // 1024}MB per-attachment limit"
            )
        parsed.append(
            {
                "kind": "bytes",
                "name": name,
                "raw": raw,
                "content_base64": content_base64,
                "content_type": content_type,
            }
        )
    return parsed


def as_byte_attachment(name: str, raw: bytes, content_type: str) -> dict[str, Any]:
    """A resolved bytes entry (freshly fetched from storage, say) in the shape
    the inline/upload split and the upload session expect."""
    return {
        "name": name,
        "raw": raw,
        "content_base64": base64.b64encode(raw).decode(),
        "content_type": content_type or "application/octet-stream",
    }


def split_bytes_by_message_budget(
    byte_attachments: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split resolved byte attachments into (inline, upload).

    Inline fileAttachments ride on the sendMail request, which is capped near
    4MB; so if the inline total would breach INLINE_ATTACHMENT_LIMIT, every byte
    attachment moves to the upload-session path rather than packing some inline
    and still risking a 413.
    """
    inline: list[dict[str, Any]] = []
    upload: list[dict[str, Any]] = []
    for a in byte_attachments:
        (inline if len(a["raw"]) <= INLINE_ATTACHMENT_LIMIT else upload).append(a)
    if sum(len(a["raw"]) for a in inline) > INLINE_ATTACHMENT_LIMIT:
        upload.extend(inline)
        inline = []
    return inline, upload


def storage_key_owner(storage_key: str) -> str:
    """The user id a storage key belongs to — its first path segment. Ceph keys
    are `<user_id>/<...>/<file>`, so the owner is checkable before any read."""
    return storage_key.strip("/").split("/", 1)[0] if storage_key else ""


def _storage_client():
    """Lazy S3/Ceph client, or None if storage is not configured — so the module
    imports without boto3 and the error only surfaces when a storage_key is used.

    Env names match the backend's Ceph config (CEPH_S3_*). Ceph/radosgw needs
    path-style addressing, hence CEPH_S3_FORCE_PATH_STYLE."""
    endpoint = os.getenv("CEPH_S3_ENDPOINT")
    access = os.getenv("CEPH_S3_ACCESS_KEY_ID")
    secret = os.getenv("CEPH_S3_SECRET_ACCESS_KEY")
    if not (endpoint and access and secret):
        missing = [
            n
            for n, v in (
                ("CEPH_S3_ENDPOINT", endpoint),
                ("CEPH_S3_ACCESS_KEY_ID", access),
                ("CEPH_S3_SECRET_ACCESS_KEY", secret),
            )
            if not v
        ]
        logger.info("storage: not configured, missing env %s", missing)
        return None
    try:
        import boto3  # lazy: only needed when a storage_key is actually used
        from botocore.config import Config
    except ImportError as exc:
        logger.info("storage: boto3 not installed in this image (%s)", exc)
        raise AttachmentError(
            "storage_key attachments need boto3 installed on this server"
        ) from exc

    force_path = os.getenv("CEPH_S3_FORCE_PATH_STYLE", "true").lower() == "true"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.getenv("CEPH_S3_REGION") or "us-east-1",
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=Config(s3={"addressing_style": "path"}) if force_path else None,
    )


def _require_storage() -> tuple[Any, str]:
    """The Ceph client and bucket, or AttachmentError naming what is unconfigured."""
    client = _storage_client()
    bucket = os.getenv("CEPH_S3_BUCKET")
    if client is None or not bucket:
        logger.info("storage: unconfigured (client=%s, bucket=%r)", client is not None, bucket)
        raise AttachmentError(
            "storage access needs CEPH_S3_ENDPOINT / CEPH_S3_BUCKET / "
            "CEPH_S3_ACCESS_KEY_ID / CEPH_S3_SECRET_ACCESS_KEY configured on this server"
        )
    return client, bucket


def fetch_storage_object(storage_key: str) -> tuple[bytes, str]:
    """Read a file's bytes from Ceph by key (sync — call via asyncio.to_thread so
    a large download does not block the event loop). Raises AttachmentError with
    a clear reason if storage is unconfigured or the object is missing."""
    client, bucket = _require_storage()
    logger.info("storage: fetching key=%r from bucket=%r", storage_key, bucket)
    try:
        obj = client.get_object(Bucket=bucket, Key=storage_key)
    except Exception as exc:  # botocore ClientError, etc.
        logger.info("storage: get_object failed key=%r: %s", storage_key, exc)
        raise AttachmentError(f"storage object not found: {storage_key}") from exc
    raw = obj["Body"].read()
    ctype = obj.get("ContentType") or "application/octet-stream"
    logger.info("storage: fetched key=%r bytes=%d ctype=%s", storage_key, len(raw), ctype)
    return raw, ctype


def put_storage_object(storage_key: str, raw: bytes, content_type: str) -> None:
    """Write bytes to Ceph under `storage_key` (sync — call via asyncio.to_thread).

    The sandbox symlinks each mounted workspace to live Ceph, so an object written
    here appears inside a already-running sandbox without restarting it — provided
    the run's folder is one of its mounted workspace paths.
    """
    client, bucket = _require_storage()
    logger.info("storage: writing key=%r bytes=%d to bucket=%r", storage_key, len(raw), bucket)
    try:
        client.put_object(
            Bucket=bucket,
            Key=storage_key,
            Body=raw,
            ContentType=content_type or "application/octet-stream",
        )
    except Exception as exc:  # botocore ClientError, etc.
        logger.info("storage: put_object failed key=%r: %s", storage_key, exc)
        raise AttachmentError(f"could not write to storage: {storage_key}: {exc}") from exc


def share_id_for_url(url: str) -> str:
    """Graph's sharing token for a web URL: base64url, unpadded, "u!"-prefixed.

    A reference (cloud) attachment carries only a URL, so this is the only way to
    reach its bytes: /shares/{share_id}/driveItem.
    """
    encoded = base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
    return f"u!{encoded}"


async def put_in_chunks(
    client: httpx.AsyncClient, upload_url: str, raw: bytes
) -> dict[str, Any]:
    """PUT raw bytes to a Graph upload session in UPLOAD_CHUNK_SIZE ranges.

    Returns the final response JSON — the created driveItem for a OneDrive
    upload, or {} for a message-attachment upload that echoes nothing.
    """
    last: dict[str, Any] = {}
    total = len(raw)
    for start in range(0, total, UPLOAD_CHUNK_SIZE):
        chunk = raw[start : start + UPLOAD_CHUNK_SIZE]
        end = start + len(chunk) - 1
        # The upload URL is pre-authorized — sending the bearer token here makes
        # Graph reject the chunk.
        put = await client.put(
            upload_url,
            content=chunk,
            headers={
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {start}-{end}/{total}",
            },
            timeout=300.0,
        )
        if put.status_code not in (200, 201, 202):
            raise RuntimeError(f"upload chunk {start}-{end} failed: {put.text}")
        if put.status_code in (200, 201):
            try:
                last = put.json()
            except (json.JSONDecodeError, ValueError):
                last = {}
    return last


async def upload_to_onedrive(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    folder: str,
    filename: str,
    raw: bytes,
) -> dict[str, Any]:
    """Upload bytes to the signed-in user's OneDrive via an upload session and
    return the created driveItem (has `id` and `webUrl`). Needs Files.ReadWrite."""
    item_path = quote(f"{folder}/{filename}".strip("/"))
    logger.info("onedrive: opening upload session for %r (%d bytes)", filename, len(raw))
    session = await client.post(
        f"{GRAPH_BASE}/me/drive/root:/{item_path}:/createUploadSession",
        headers=headers,
        json={
            "item": {
                "@microsoft.graph.conflictBehavior": "rename",
                "name": filename,
            }
        },
        timeout=60.0,
    )
    if session.status_code not in (200, 201):
        logger.info(
            "onedrive: createUploadSession failed %s: %s",
            session.status_code,
            session.text[:300],
        )
        raise RuntimeError(
            f"{filename}: could not open a OneDrive upload session: {session.text}"
        )
    item = await put_in_chunks(client, session.json()["uploadUrl"], raw)
    if not item.get("id"):
        # The final PUT did not echo the item; re-fetch it by path.
        got = await client.get(
            f"{GRAPH_BASE}/me/drive/root:/{item_path}", headers=headers, timeout=30.0
        )
        if got.status_code == 200:
            item = got.json()
    logger.info("onedrive: uploaded %r id=%s", filename, item.get("id"))
    return item


async def invite_recipients(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    item_id: str,
    emails: list[str],
) -> None:
    """Grant read to exactly these recipients, sign-in required, no Graph-sent
    notification (send_email is the notification). Shared only with the
    addressees — never an anonymous/public link."""
    recipients = [{"email": e} for e in emails if e]
    if not recipients:
        return
    logger.info("onedrive: inviting %d recipient(s) to item=%s", len(recipients), item_id)
    resp = await client.post(
        f"{GRAPH_BASE}/me/drive/items/{item_id}/invite",
        headers=headers,
        json={
            "recipients": recipients,
            "requireSignIn": True,
            "sendInvitation": False,
            "roles": ["read"],
        },
        timeout=60.0,
    )
    if resp.status_code not in (200, 201):
        logger.info("onedrive: invite failed %s: %s", resp.status_code, resp.text[:300])
        raise RuntimeError(f"could not share the file with recipients: {resp.text}")
    logger.info("onedrive: invite ok for item=%s", item_id)


def build_message_attachments(inline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The `attachments` array that rides on the message itself. Inline file
    attachments only."""
    return [
        {
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": a["name"],
            "contentType": a["content_type"],
            "contentBytes": a["content_base64"],
        }
        for a in inline
    ]


def build_item_ref(
    drive_id: str, item_id: str | None = None, path: str | None = None
) -> str:
    if item_id:
        return f"/drives/{drive_id}/items/{item_id}"
    if path:
        encoded = quote(path.strip("/"))
        return f"/drives/{drive_id}/root:/{encoded}"
    return f"/drives/{drive_id}/root"


async def graph_get(
    path: str,
    headers: dict[str, str],
    params: dict[str, Any] | None = None,
    timeout: float = 30.0,
    follow_redirects: bool = False,
) -> tuple[Any, int, str]:
    async with httpx.AsyncClient(
        follow_redirects=follow_redirects, timeout=timeout
    ) as client:
        resp = await client.get(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            params=params,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct:
            return resp.json(), resp.status_code, ct
        return resp.content, resp.status_code, ct


async def graph_post(
    path: str,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


async def graph_patch(
    path: str,
    headers: dict[str, str],
    json_body: dict[str, Any],
    timeout: float = 30.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.patch(
            f"{GRAPH_BASE}{path}",
            headers=headers,
            json=json_body,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


async def graph_delete(
    path: str,
    headers: dict[str, str],
    timeout: float = 30.0,
) -> int:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.delete(f"{GRAPH_BASE}{path}", headers=headers)
        return resp.status_code


async def graph_put_content(
    path: str,
    headers: dict[str, str],
    content: bytes,
    content_type: str = "text/plain",
    timeout: float = 60.0,
) -> tuple[Any, int]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.put(
            f"{GRAPH_BASE}{path}",
            headers={**headers, "Content-Type": content_type},
            content=content,
        )
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct and resp.content:
            return resp.json(), resp.status_code
        return None, resp.status_code


def run_storage_key(value: str, folder: str) -> str:
    """The Ceph key for a file the model named, or "" when it is not this run's.

    A download tool hands the model two names for the same file — the
    `storage_key` and the mounted `sandbox_path` — so both are accepted. Anything
    outside `folder` is refused rather than resolved: the model chooses this
    string, and the run folder is the only prefix its own files can be under.
    """
    key = str(value or "").strip().lstrip("/")
    if key.startswith("mnt/workspace/"):
        # /mnt/workspace/system_<run>/x  ->  <user_id>/system_<run>/x
        key = f"{folder.split('/')[0]}/{key[len('mnt/workspace/'):]}"
    return key if folder and key.startswith(f"{folder}/") else ""


def stat_storage_object(storage_key: str) -> dict[str, Any] | None:
    """Size and content type of a stored object, or None when there is none."""
    client, bucket = _require_storage()
    try:
        head = client.head_object(Bucket=bucket, Key=storage_key)
    except Exception as exc:  # botocore ClientError for a missing key
        logger.info("storage: head_object miss key=%r: %s", storage_key, exc)
        return None
    return {
        "size": head.get("ContentLength"),
        "content_type": head.get("ContentType") or "application/octet-stream",
    }
